-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 25 · E2 — Ordenar el catálogo por stock real y por stock virtual   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Paridad con el legacy: `app.js:15518` tiene `<th data-cat-sort="sr">Stock
-- real</th>` y `data-cat-sort="sv"`, las dos ordenables en los dos sentidos.
-- Aquél podía hacerlo en memoria porque se bajaba los 21.775 productos; acá
-- el orden lo tiene que decidir la misma función que pagina y cuenta, porque
-- si no la página 2 no es la continuación de la página 1.
--
-- **Dos diferencias con el legacy, las dos medidas y a propósito:**
--
--  · El legacy trata «sin saldo» como cero (`getEffectiveStock` devuelve 0
--    cuando el campo no es número). Acá **no**: sólo 379 de 21.828 productos
--    tienen fila en `stock_balances`, así que tratar el resto como cero
--    pondría 21.449 filas de «—» antes de la primera con stock. Los sin
--    saldo van **al final en las dos direcciones** (NULLS LAST), que es lo
--    que alguien quiere ver cuando ordena por stock.
--  · Dentro del mismo saldo desempata el **nombre**, no el id. Con 21.449
--    empatados en «sin saldo», desempatar por uuid se ve como ruido.
--
-- `stock_balances` sólo la puede leer un rol interno (policy `stockbal_select`,
-- `app.is_internal`). Esta función es SECURITY INVOKER, así que para un rol
-- externo el lateral no devuelve ninguna fila, los dos saldos quedan en NULL
-- y el orden se resuelve por el desempate. No hay filtración: la pantalla
-- tampoco le ofrece estas columnas.
--
-- Incluye el filtro de categoría de E1: esta es la versión final de la
-- función, no un parche encima.
--
--   supabase: apply_migration fase25_e2_orden_por_stock

create or replace function public.search_products(
  p_company uuid, p_query text default null::text, p_limit integer default 50,
  p_offset integer default 0, p_category uuid default null::uuid, p_brand uuid default null::uuid,
  p_attrs jsonb default null::jsonb, p_type text[] default null::text[],
  p_ranges jsonb default null::jsonb, p_orden text default 'nombre'::text,
  p_solo_catalogo boolean default false
)
returns table(id uuid, score real, rank_position integer, total_count bigint)
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_busca boolean := p_query is not null and btrim(p_query) <> '';
  v_desc  boolean := p_orden like '%\_desc';
  v_campo text   := case when p_orden like '%\_desc'
                         then left(p_orden, length(p_orden) - 5)
                         else coalesce(p_orden, 'nombre') end;
  -- Traer el saldo cuesta un lateral por producto candidato. Se paga sólo
  -- cuando el orden lo pide; en las otras nueve formas de ordenar, el WHERE
  -- de adentro es falso y el lateral no toca la tabla.
  v_por_stock boolean := v_campo in ('stock_real', 'stock_virtual');
BEGIN
  -- El operador <% compara contra pg_trgm.word_similarity_threshold, que por
  -- defecto es 0.6. Fijarlo con ALTER FUNCTION requiere superusuario; por
  -- transacción sí se puede.
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  RETURN QUERY
  WITH matches AS (
    SELECT
      p.id, p.name, p.sku,
      -- El nulo es cadena vacía, como en el legacy: así «sin marca» ordena
      -- primero ascendente y último descendente, en vez de quedar suelto.
      coalesce(b.name, '')  AS marca,
      coalesce(c.name, '')  AS categoria,
      coalesce(p.series,'') AS serie,
      -- NULL cuando el producto no tiene saldo registrado, o cuando quien
      -- pregunta no puede ver stock. Nunca cero: «no sé» no es «hay cero».
      s.saldo_real, s.saldo_virtual,
      CASE WHEN v_busca THEN GREATEST(
             word_similarity(p_query, p.name),
             word_similarity(p_query, p.sku))::real
           ELSE 0::real END AS score
    FROM products p
    LEFT JOIN brands b             ON b.id = p.brand_id
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN LATERAL (
      SELECT sum(sb.on_hand)               AS saldo_real,
             sum(sb.on_hand - sb.reserved) AS saldo_virtual
        FROM stock_balances sb
       WHERE sb.product_id = p.id
         AND v_por_stock
    ) s ON true
    WHERE p.company_id = p_company
      -- deleted_at y status los decide RLS, no esta función.
      AND (p_category IS NULL OR p.category_id = p_category)
      AND (p_brand    IS NULL OR p.brand_id    = p_brand)
      AND (p_type     IS NULL OR p.product_type = ANY(p_type))
      AND (p_attrs  IS NULL OR p_attrs  = '{}'::jsonb
           OR app.attrs_match(p.attributes, p_attrs))
      AND (p_ranges IS NULL OR p_ranges = '{}'::jsonb
           OR app.ranges_match(p.attributes, p_ranges))
      -- Visibilidad de catálogo: sólo cuando quien pregunta ES el catálogo.
      -- Un producto sin marca no tiene quién lo oculte y sigue visible.
      AND (NOT p_solo_catalogo
           OR p.brand_id IS NULL
           OR EXISTS (SELECT 1 FROM brands b2
                       WHERE b2.id = p.brand_id AND b2.is_active))
      -- Fase 25 · E1: lo mismo con la categoría.
      AND (NOT p_solo_catalogo
           OR p.category_id IS NULL
           OR EXISTS (SELECT 1 FROM product_categories c2
                       WHERE c2.id = p.category_id AND c2.is_active))
      AND (NOT v_busca
           OR p.search_vector @@ websearch_to_tsquery('spanish', p_query)
           OR p_query <% p.name
           OR p_query <% p.sku)
  ),
  ranked AS (
    -- Orden TOTAL siempre: `id` es único, así que la posición de cada fila es
    -- estable entre páginas. Sin esto, .range() devuelve filas repetidas y
    -- omite otras.
    --
    -- La relevancia va primero y SIEMPRE descendente: la dirección que elige
    -- el usuario es la de la columna, no la de «qué tan bien coincide».
    SELECT m.id, m.score,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_busca THEN m.score END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_campo = 'marca'     THEN m.marca     END ASC,
          CASE WHEN     v_desc AND v_campo = 'marca'     THEN m.marca     END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'categoria' THEN m.categoria END ASC,
          CASE WHEN     v_desc AND v_campo = 'categoria' THEN m.categoria END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'serie'     THEN m.serie     END ASC,
          CASE WHEN     v_desc AND v_campo = 'serie'     THEN m.serie     END DESC,
          CASE WHEN NOT v_desc AND v_campo = 'sku'       THEN m.sku       END ASC,
          CASE WHEN     v_desc AND v_campo = 'sku'       THEN m.sku       END DESC,
          -- Fase 25 · E2. NULLS LAST en las dos direcciones: «sin saldo» no
          -- es el más chico ni el más grande, es «no sé», y va al final.
          CASE WHEN NOT v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END DESC NULLS LAST,
          -- Desempate dentro del mismo saldo: el nombre, no el uuid.
          CASE WHEN v_por_stock THEN m.name END ASC,
          CASE WHEN NOT v_desc AND v_campo NOT IN ('marca','categoria','serie','sku','stock_real','stock_virtual') THEN m.name END ASC,
          CASE WHEN     v_desc AND v_campo NOT IN ('marca','categoria','serie','sku','stock_real','stock_virtual') THEN m.name END DESC,
          m.id ASC
      ) AS rank_position,
      count(*) OVER () AS total_count
    FROM matches m
  )
  SELECT r.id, r.score, r.rank_position::integer, r.total_count
  FROM ranked r
  ORDER BY r.rank_position
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$function$;
