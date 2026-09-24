-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 25 · E1 — Una categoría se puede sacar del catálogo                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Las marcas ya se podían desactivar (`brands.is_active`, Fase 22 · B) y eso
-- saca del catálogo a sus productos sin borrar nada: los documentos que los
-- nombran siguen abriéndolos y Ventas sigue pudiendo cotizarlos. Las
-- categorías no tenían ese interruptor, y hacía falta: de las diez que hay,
-- dos son bolsas de «todavía no clasificado» —«Otros» con 12.588 productos y
-- «Pendiente de clasificación STEL» con 53— y hasta que se clasifiquen no
-- tienen por qué estar en el catálogo que se muestra.
--
-- **Misma semántica que las marcas, a propósito**: `p_solo_catalogo` es lo
-- único que mira el interruptor. Quien pregunta como catálogo no ve esos
-- productos; quien pregunta para armar un documento sí. Un producto sin
-- categoría no tiene quién lo esconda y sigue visible, igual que uno sin
-- marca.
--
-- No borra ni mueve un solo producto: es una columna y dos condiciones.
--
--   supabase: apply_migration fase25_e1_categorias_ocultables

begin;

-- ── 1 · el interruptor ─────────────────────────────────────────────────────
alter table product_categories
  add column if not exists is_active boolean not null default true;

comment on column product_categories.is_active is
  'false = la categoría y sus productos NO aparecen en el catálogo (p_solo_catalogo). '
  'No afecta a Ventas, Compras ni a los documentos ya emitidos. Espejo de brands.is_active.';

-- ── 2 · la bitácora acepta los dos estados nuevos ──────────────────────────
-- Sin esto el insert de `config_categoria_estado` falla con el CHECK y la
-- acción se pierde entera: la bitácora es parte de la operación, no un extra.
alter table catalog_audit drop constraint if exists catalog_audit_action_check;
alter table catalog_audit add constraint catalog_audit_action_check
  check (action = any (array[
    'BRAND_CREATED', 'BRAND_DISABLED', 'BRAND_ENABLED', 'BRAND_DELETED',
    'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED',
    'CATEGORY_DISABLED', 'CATEGORY_ENABLED'
  ]));

-- ── 3 · listar devuelve el estado ──────────────────────────────────────────
-- Agregar una columna al RETURNS TABLE obliga a recrear la función: Postgres
-- no deja cambiar el tipo de retorno con CREATE OR REPLACE. Y una función
-- recién creada le da EXECUTE a PUBLIC, así que hay que revocarlo y volver a
-- otorgar exactamente lo que tenía: authenticated y service_role, nunca anon.
drop function if exists public.config_categorias_listar(uuid);

create function public.config_categorias_listar(p_company uuid)
returns table(id uuid, name text, slug text, "position" smallint, needs_review boolean,
              is_active boolean, parent_id uuid, productos bigint, atributos bigint,
              subcategorias bigint, puede_editar boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rol text := app.catalogo_exigir_lector(p_company);
begin
  return query
  with usos as (
    select p.category_id, count(*) n from products p where p.company_id = p_company group by p.category_id
  ), attrs as (
    select x.category_id, count(*) n from product_attribute_categories x where x.company_id = p_company group by x.category_id
  )
  select c.id, c.name, c.slug, c.position, c.needs_review, c.is_active, c.parent_id,
         coalesce(u.n, 0), coalesce(a.n, 0),
         (select count(*) from product_categories h where h.parent_id = c.id),
         v_rol = 'admin'
    from product_categories c
    left join usos u on u.category_id = c.id
    left join attrs a on a.category_id = c.id
   where c.company_id = p_company
   order by c.position, lower(c.name);
end $function$;

revoke all on function public.config_categorias_listar(uuid) from public;
grant execute on function public.config_categorias_listar(uuid) to authenticated, service_role;

-- ── 4 · el estado se cambia con su propia función ──────────────────────────
-- Calcada de `config_marca_estado`: mismo permiso (admin), mismo `for update`
-- para no pisar un cambio simultáneo, misma respuesta `cambiado = false`
-- cuando ya estaba así —la pantalla lo usa para decir «no había cambios» en
-- vez de festejar una escritura que no ocurrió— y misma bitácora.
create or replace function public.config_categoria_estado(
  p_company uuid, p_categoria uuid, p_activa boolean
)
returns table(is_active boolean, cambiado boolean, productos bigint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_c product_categories%rowtype; v_n bigint;
begin
  perform app.catalogo_exigir_admin(p_company);
  if p_categoria is null or p_activa is null then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_c from product_categories c
   where c.id = p_categoria and c.company_id = p_company for update;
  if not found then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;
  select count(*) into v_n from products p where p.category_id = p_categoria;

  if v_c.is_active = p_activa then
    return query select v_c.is_active, false, v_n;
    return;
  end if;

  update product_categories c set is_active = p_activa where c.id = p_categoria;
  insert into catalog_audit (company_id, entity_type, entity_id, entity_name, action, changed_fields, actor_id)
  values (p_company, 'category', p_categoria, v_c.name,
          case when p_activa then 'CATEGORY_ENABLED' else 'CATEGORY_DISABLED' end,
          array['is_active'], auth.uid());
  return query select p_activa, true, v_n;
end $function$;

revoke all on function public.config_categoria_estado(uuid, uuid, boolean) from public;
grant execute on function public.config_categoria_estado(uuid, uuid, boolean) to authenticated, service_role;

-- ── 5 · el catálogo no muestra lo que está oculto ──────────────────────────
-- La condición se agrega al MISMO lugar donde ya vive la de marcas, en las dos
-- funciones que describen el conjunto: la que lista y pagina, y la que cuenta
-- las facetas. Si se agregara sólo en una, el paginador diría «1–50 de 407»
-- mostrando 48 filas — ya pasó una vez y por eso están juntas.
--
-- `product_categories` la puede leer cualquier `authenticated` de la empresa
-- (policy `categories_select`, sin distinguir interno de externo), así que el
-- EXISTS da lo mismo para los dos roles. Es la misma razón por la que el de
-- marcas funciona.

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
      CASE WHEN v_busca THEN GREATEST(
             word_similarity(p_query, p.name),
             word_similarity(p_query, p.sku))::real
           ELSE 0::real END AS score
    FROM products p
    LEFT JOIN brands b             ON b.id = p.brand_id
    LEFT JOIN product_categories c ON c.id = p.category_id
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
      -- Fase 25 · E1: lo mismo con la categoría. Un producto sin categoría
      -- sigue visible, por la misma razón que uno sin marca.
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
          CASE WHEN NOT v_desc AND v_campo NOT IN ('marca','categoria','serie','sku') THEN m.name END ASC,
          CASE WHEN     v_desc AND v_campo NOT IN ('marca','categoria','serie','sku') THEN m.name END DESC,
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

create or replace function public.catalog_facets(
  p_company uuid, p_query text default null::text, p_category uuid default null::uuid,
  p_brand uuid default null::uuid, p_type text[] default null::text[],
  p_attrs jsonb default null::jsonb, p_ranges jsonb default null::jsonb,
  p_solo_catalogo boolean default false
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_busca boolean := p_query is not null and btrim(p_query) <> '';
  v_resultado jsonb;
BEGIN
  -- El mismo umbral que search_products. Sin esto, <% usa 0.6 y las facetas
  -- describen menos productos que el listado.
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  WITH marcado AS (
    SELECT p.brand_id, p.category_id, p.product_type, p.attributes,
           (p_category IS NULL OR p.category_id = p_category)   AS ok_cat,
           (p_brand    IS NULL OR p.brand_id    = p_brand)      AS ok_marca,
           (p_type     IS NULL OR p.product_type = ANY(p_type)) AS ok_tipo,
           (p_attrs IS NULL OR p_attrs = '{}'::jsonb
            OR app.attrs_match(p.attributes, p_attrs))          AS ok_attrs,
           (p_ranges IS NULL OR p_ranges = '{}'::jsonb
            OR app.ranges_match(p.attributes, p_ranges))        AS ok_rango
    FROM products p
    WHERE p.company_id = p_company
      -- Visibilidad de catálogo, igual que en search_products.
      AND (NOT p_solo_catalogo
           OR p.brand_id IS NULL
           OR EXISTS (SELECT 1 FROM brands b
                       WHERE b.id = p.brand_id AND b.is_active))
      -- Fase 25 · E1: y la categoría, también igual que en search_products.
      AND (NOT p_solo_catalogo
           OR p.category_id IS NULL
           OR EXISTS (SELECT 1 FROM product_categories c
                       WHERE c.id = p.category_id AND c.is_active))
      AND (NOT v_busca
           OR p.search_vector @@ websearch_to_tsquery('spanish', p_query)
           OR p_query <% p.name
           OR p_query <% p.sku)
  ),
  f_total AS (
    SELECT count(*) AS n FROM marcado
    WHERE ok_cat AND ok_marca AND ok_tipo AND ok_attrs AND ok_rango
  ),
  f_marca AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.brand_id, 'name', b.name, 'count', s.n)
                              ORDER BY s.n DESC, b.name), '[]'::jsonb) AS j
    FROM (SELECT brand_id, count(*) n FROM marcado
          WHERE ok_cat AND ok_tipo AND ok_attrs AND ok_rango AND brand_id IS NOT NULL
          GROUP BY 1) s
    JOIN brands b ON b.id = s.brand_id
  ),
  f_cat AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.category_id, 'slug', c.slug,
                                                 'name', c.name, 'count', s.n)
                              ORDER BY s.n DESC, c.name), '[]'::jsonb) AS j
    FROM (SELECT category_id, count(*) n FROM marcado
          WHERE ok_marca AND ok_tipo AND ok_attrs AND ok_rango
          GROUP BY 1) s
    JOIN product_categories c ON c.id = s.category_id
  ),
  f_tipo AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', s.product_type, 'count', s.n)
                              ORDER BY s.n DESC, s.product_type), '[]'::jsonb) AS j
    FROM (SELECT product_type, count(*) n FROM marcado
          WHERE ok_cat AND ok_marca AND ok_attrs AND ok_rango
            AND product_type IS NOT NULL AND btrim(product_type) <> ''
          GROUP BY 1) s
  ),
  attr_pares AS (
    SELECT k.key, v.val, count(*) AS n
    FROM marcado m
    CROSS JOIN LATERAL jsonb_object_keys(m.attributes) AS k(key)
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(m.attributes -> k.key) = 'array'
             THEN m.attributes -> k.key
             ELSE jsonb_build_array(m.attributes -> k.key) END) AS v(val)
    WHERE m.ok_cat AND m.ok_marca AND m.ok_tipo
      AND (p_attrs IS NULL OR p_attrs = '{}'::jsonb
           OR app.attrs_match(m.attributes, p_attrs, k.key))
      AND (p_ranges IS NULL OR p_ranges = '{}'::jsonb
           OR app.ranges_match(m.attributes, p_ranges - k.key))
      AND btrim(v.val) <> ''
    GROUP BY 1, 2
  ),
  f_attr AS (
    SELECT coalesce(jsonb_object_agg(y.key, jsonb_build_object(
             'label', y.label, 'unit', y.unit, 'values', y.vals)), '{}'::jsonb) AS j
    FROM (
      SELECT ap.key, d.label, d.unit,
             jsonb_agg(jsonb_build_object('value', ap.val, 'count', ap.n)
                       ORDER BY ap.n DESC, ap.val) AS vals
      FROM attr_pares ap
      JOIN product_attribute_definitions d
        ON d.company_id = p_company AND d.key = ap.key AND d.is_filterable
      GROUP BY ap.key, d.label, d.unit, d.position
      ORDER BY d.position
    ) y
  )
  SELECT jsonb_build_object(
    'total',         (SELECT n FROM f_total),
    'brands',        (SELECT j FROM f_marca),
    'categories',    (SELECT j FROM f_cat),
    'product_types', (SELECT j FROM f_tipo),
    'attributes',    (SELECT j FROM f_attr)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

commit;
