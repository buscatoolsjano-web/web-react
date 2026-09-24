-- Fase 28 · E7 — ordenar el catálogo por un atributo.
--
-- `search_products` ya ordenaba por sku, nombre, marca, categoría, serie y los
-- dos saldos de stock. Faltaban los atributos: en «Puntas y tubos», encastre,
-- medida y largo son LAS columnas por las que se busca, y no se podían ordenar.
--
-- `p_orden` acepta ahora `attr:<clave>` y `attr:<clave>_desc`. La clave viaja
-- como dato, nunca concatenada al SQL: es un `->>` con una variable.
--
-- NUMÉRICO PRIMERO, Y POR ESO IMPORTA: `largo` está guardado como texto («25»,
-- «100», «38») porque así vino del sistema anterior, pero es un número. En
-- texto, «100» va antes que «25». Se ordena por el valor numérico cuando el
-- texto es un número, y por el texto cuando no lo es. Un atributo de texto
-- —encastre, medida— cae solo en la segunda rama.
--
-- Lo demás queda igual. Se recrea entera porque `CREATE OR REPLACE` no puede
-- cambiar el cuerpo de una función que devuelve TABLE sin repetirlo completo.

create or replace function public.search_products(
  p_company        uuid,
  p_query          text    default null,
  p_limit          integer default 50,
  p_offset         integer default 0,
  p_category       uuid    default null,
  p_brand          uuid    default null,
  p_attrs          jsonb   default null,
  p_type           text[]  default null,
  p_ranges         jsonb   default null,
  p_orden          text    default 'nombre',
  p_solo_catalogo  boolean default false
)
returns table (id uuid, score real, rank_position integer, total_count bigint)
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
  -- cuando el orden lo pide.
  v_por_stock boolean := v_campo in ('stock_real', 'stock_virtual');
  -- Fase 28 · E7: `attr:encastre` ordena por ese atributo. La clave es un
  -- parámetro del `->>`, no texto pegado a la consulta.
  v_attr_key  text    := case when v_campo like 'attr:%'
                              then substring(v_campo from 6) end;
BEGIN
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  RETURN QUERY
  WITH matches AS (
    SELECT
      p.id, p.name, p.sku,
      coalesce(b.name, '')  AS marca,
      coalesce(c.name, '')  AS categoria,
      coalesce(p.series,'') AS serie,
      -- NULL cuando el producto no tiene saldo registrado, o cuando quien
      -- pregunta no puede ver stock. Nunca cero: «no sé» no es «hay cero».
      s.saldo_real, s.saldo_virtual,
      p.attributes ->> v_attr_key AS attr_txt,
      -- Sólo si el texto ES un número. Sin esto un `::numeric` a ciegas
      -- reventaría con «1/4 HEX».
      CASE WHEN p.attributes ->> v_attr_key ~ '^\s*-?\d+([.,]\d+)?\s*$'
           THEN replace(btrim(p.attributes ->> v_attr_key), ',', '.')::numeric
      END AS attr_num,
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
      AND (p_category IS NULL OR p.category_id = p_category)
      AND (p_brand    IS NULL OR p.brand_id    = p_brand)
      AND (p_type     IS NULL OR p.product_type = ANY(p_type))
      AND (p_attrs  IS NULL OR p_attrs  = '{}'::jsonb
           OR app.attrs_match(p.attributes, p_attrs))
      AND (p_ranges IS NULL OR p_ranges = '{}'::jsonb
           OR app.ranges_match(p.attributes, p_ranges))
      AND (NOT p_solo_catalogo
           OR p.brand_id IS NULL
           OR EXISTS (SELECT 1 FROM brands b2
                       WHERE b2.id = p.brand_id AND b2.is_active))
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
          -- NULLS LAST en las dos direcciones: «sin saldo» no es el más chico
          -- ni el más grande, es «no sé», y va al final.
          CASE WHEN NOT v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_real'    THEN m.saldo_real    END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_campo = 'stock_virtual' THEN m.saldo_virtual END DESC NULLS LAST,
          -- Por atributo. El número manda; el texto decide lo que no es número.
          -- NULLS LAST siempre: «sin ese atributo» va al final en las dos
          -- direcciones, igual que el stock.
          CASE WHEN NOT v_desc AND v_attr_key IS NOT NULL THEN m.attr_num END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_attr_key IS NOT NULL THEN m.attr_num END DESC NULLS LAST,
          CASE WHEN NOT v_desc AND v_attr_key IS NOT NULL THEN m.attr_txt END ASC  NULLS LAST,
          CASE WHEN     v_desc AND v_attr_key IS NOT NULL THEN m.attr_txt END DESC NULLS LAST,
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

comment on function public.search_products is
  'Búsqueda del catálogo. p_orden: relevancia | nombre | sku | marca | categoria | serie | stock_real | stock_virtual | attr:<clave>, cada uno con sufijo _desc.';
