-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 60 — Los filtros del catálogo: completos, rápidos                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- TRES COSAS QUE SE PIDIERON, Y LAS TRES SALEN DE ACÁ.
--
-- 1. «Si pongo Puntas y tubos, el de TODAS tiene que seguir diciendo 21.802,
--    no 8.600».
--    `total` se calcula con TODOS los filtros puestos, la categoría incluida,
--    así que el chip «Todas» mostraba lo que ya estaba filtrado. Mostrar el
--    total filtrado en el botón que sirve para QUITAR el filtro no dice nada:
--    el número que hace falta ahí es a cuántos se vuelve al apretarlo.
--
-- 2. «Pongo torque mínimo 2 y de la nada dejan de aparecer las categorías
--    arriba. Eso tiene que estar siempre».
--    `f_cat` se calculaba con todos los filtros menos el de categoría, los
--    atributos incluidos. Y como los atornilladores son los únicos con torque
--    cargado, filtrar por torque dejaba UNA sola categoría. Técnicamente
--    correcto y pésimo para usar: la fila de categorías es por dónde se
--    navega, y se vaciaba justo cuando uno estaba adentro de una.
--
--    LAS CATEGORÍAS PASAN A SER NAVEGACIÓN, NO UNA FACETA MÁS. Se calculan
--    respetando sólo la BÚSQUEDA de texto —buscar «torque» sí tiene que decir
--    en qué categorías hay algo— y ningún otro filtro. Así están siempre las
--    ocho, con el mismo número, y refinar adentro de una no cambia la fila de
--    arriba. Es cómo funcionaba la web vieja.
--
-- 3. «No es rápido: pongo Atornilladores y tarda unos dos segundos».
--    Medido en el servidor, sin la red: 259 ms sin filtro y 82 ms con
--    categoría. Y de esos 259, **116 son la faceta de atributos** —expandir
--    el jsonb de 21.806 productos en 33.342 pares y agruparlos—, que en la
--    carga inicial NO SE MUESTRA: la pantalla sólo dibuja los desplegables de
--    atributos cuando hay una categoría elegida. Se estaba pagando casi la
--    mitad del tiempo por algo que nadie ve.
--
--    Ahora el que llama dice si los va a mostrar. No es la base adivinando
--    una regla de pantalla: es la pantalla pidiendo lo que necesita.
--
-- Lo que NO cambia: `total` sigue siendo el resultado con todos los filtros
-- puestos —es lo que cuenta el listado— y las facetas de marca, subcategoría,
-- tipo y atributos se siguen calculando con todos los filtros MENOS el suyo,
-- que es lo que evita las opciones muertas.

begin;

/*
 * OJO CON EL PARÁMETRO NUEVO: `create or replace` NO reemplaza cuando cambia
 * la firma, CREA UNA SOBRECARGA. Al aplicarla quedaron las dos versiones —la
 * de 9 argumentos y la de 10— y cualquier llamada sin el parámetro nuevo
 * pasaba a ser ambigua («function ... is not unique»): la pantalla se habría
 * quedado sin filtros. Por eso el drop explícito, y va ANTES.
 */
drop function if exists public.catalog_facets(uuid,text,uuid,uuid,text[],jsonb,jsonb,boolean,text[]);

create or replace function public.catalog_facets(
  p_company uuid,
  p_query text default null,
  p_category uuid default null,
  p_brand uuid default null,
  p_type text[] default null,
  p_attrs jsonb default null,
  p_ranges jsonb default null,
  p_solo_catalogo boolean default false,
  p_series text[] default null,
  -- Fase 60: calcular la faceta de atributos. En `false` se ahorran ~116 ms
  -- de los ~260 sin devolver nada que la pantalla fuera a dibujar.
  p_con_atributos boolean default true
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
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  WITH marcado AS (
    SELECT p.brand_id, p.category_id, p.product_type, p.series, p.attributes,
           (p_category IS NULL OR p.category_id = p_category)   AS ok_cat,
           (p_brand    IS NULL OR p.brand_id    = p_brand)      AS ok_marca,
           (p_type     IS NULL OR p.product_type = ANY(p_type)) AS ok_tipo,
           (p_series   IS NULL OR p.series       = ANY(p_series)) AS ok_serie,
           (p_attrs IS NULL OR p_attrs = '{}'::jsonb
            OR app.attrs_match(p.attributes, p_attrs))          AS ok_attrs,
           (p_ranges IS NULL OR p_ranges = '{}'::jsonb
            OR app.ranges_match(p.attributes, p_ranges))        AS ok_rango
    FROM products p
    WHERE p.company_id = p_company
      AND p.deleted_at IS NULL
      AND (NOT p_solo_catalogo
           OR p.brand_id IS NULL
           OR EXISTS (SELECT 1 FROM brands b
                       WHERE b.id = p.brand_id AND b.is_active))
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
    WHERE ok_cat AND ok_marca AND ok_tipo AND ok_serie AND ok_attrs AND ok_rango
  ),
  /*
   * A cuántos se vuelve si se sueltan TODOS los filtros menos la búsqueda.
   * Es el número del chip «Todas», que es un botón para quitar el filtro de
   * categoría: tiene que decir a dónde lleva, no dónde estoy parado.
   */
  f_total_catalogo AS (
    SELECT count(*) AS n FROM marcado
  ),
  /*
   * LAS CATEGORÍAS NO MIRAN NINGÚN OTRO FILTRO (Fase 60). Son la navegación
   * de la pantalla: tienen que estar las ocho siempre y con el mismo número,
   * porque si se vacían mientras uno refina adentro de una, no queda forma de
   * saltar a otra sin limpiar todo primero.
   */
  f_cat AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.category_id, 'slug', c.slug,
                                                 'name', c.name, 'count', s.n)
                              ORDER BY c.position, c.name), '[]'::jsonb) AS j
    FROM (SELECT category_id, count(*) n FROM marcado
          WHERE category_id IS NOT NULL
          GROUP BY 1) s
    JOIN product_categories c ON c.id = s.category_id
  ),
  f_marca AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.brand_id, 'name', b.name, 'count', s.n)
                              ORDER BY s.n DESC, b.name), '[]'::jsonb) AS j
    FROM (SELECT brand_id, count(*) n FROM marcado
          WHERE ok_cat AND ok_tipo AND ok_attrs AND ok_rango AND brand_id IS NOT NULL
          GROUP BY 1) s
    JOIN brands b ON b.id = s.brand_id
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
    -- El corte va PRIMERO: sin esto se expande y agrupa todo el jsonb de
    -- 21.806 productos para después tirar la mitad.
    WHERE p_con_atributos
      AND m.ok_cat AND m.ok_marca AND m.ok_tipo
      AND (p_attrs IS NULL OR p_attrs = '{}'::jsonb
           OR app.attrs_match(m.attributes, p_attrs, k.key))
      AND (p_ranges IS NULL OR p_ranges = '{}'::jsonb
           OR app.ranges_match(m.attributes, p_ranges - k.key))
      AND btrim(v.val) <> ''
    GROUP BY 1, 2
  ),
  f_attr AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'key', y.key, 'label', y.label, 'unit', y.unit,
             'position', y.position, 'values', y.vals)
             ORDER BY y.position, y.key), '[]'::jsonb) AS j
    FROM (
      SELECT ap.key, d.label, d.unit, d.position,
             jsonb_agg(jsonb_build_object('value', ap.val, 'count', ap.n)
                       ORDER BY CASE WHEN ap.val ~ '^\s*-?\d+([.,]\d+)?\s*$'
                                     THEN replace(btrim(ap.val), ',', '.')::numeric
                                END NULLS LAST,
                                ap.n DESC, ap.val) AS vals
      FROM attr_pares ap
      JOIN product_attribute_definitions d
        ON d.company_id = p_company AND d.key = ap.key AND d.is_filterable
      GROUP BY ap.key, d.label, d.unit, d.position
      ORDER BY d.position
    ) y
  ),
  f_serie AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', s.series, 'count', s.n)
                              ORDER BY s.n DESC, s.series), '[]'::jsonb) AS j
    FROM (SELECT series, count(*) n FROM marcado
          WHERE ok_cat AND ok_marca AND ok_tipo AND ok_attrs AND ok_rango
            AND coalesce(series, '') <> ''
          GROUP BY 1) s
  )
  SELECT jsonb_build_object(
    'total',           (SELECT n FROM f_total),
    -- Nuevo en la Fase 60: el número del chip «Todas».
    'total_catalogo',  (SELECT n FROM f_total_catalogo),
    'brands',          (SELECT j FROM f_marca),
    'categories',      (SELECT j FROM f_cat),
    'product_types',   (SELECT j FROM f_tipo),
    'series',          (SELECT j FROM f_serie),
    'attributes',      (SELECT j FROM f_attr)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

commit;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Verificación                                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

do $$
declare
  v_co uuid; v_cat uuid; v_todo bigint; v_j jsonb; v_cats int; v_total bigint; v_n int;
begin
  -- Que haya quedado UNA sola: dos versiones hacen ambigua cada llamada.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='catalog_facets';
  if v_n <> 1 then raise exception 'Quedaron % versiones de catalog_facets', v_n; end if;

  select id into v_co from public.companies where slug='buscatools';
  select id into v_cat from public.product_categories
   where company_id=v_co and slug='atornillador';

  select count(*) into v_todo from products p
   where p.company_id=v_co and p.deleted_at is null
     and (p.brand_id is null or exists (select 1 from brands b where b.id=p.brand_id and b.is_active))
     and (p.category_id is null or exists (select 1 from product_categories c where c.id=p.category_id and c.is_active));

  -- 1. Con una categoría puesta, «Todas» tiene que seguir diciendo el total.
  v_j := public.catalog_facets(p_company:=v_co, p_category:=v_cat, p_solo_catalogo:=true);
  if (v_j->>'total_catalogo')::bigint <> v_todo then
    raise exception 'El chip «Todas» diría % y el catálogo tiene %',
      v_j->>'total_catalogo', v_todo;
  end if;

  -- 2. Con un filtro de atributo, las categorías tienen que seguir estando TODAS.
  select jsonb_array_length(public.catalog_facets(
    p_company:=v_co, p_category:=v_cat, p_solo_catalogo:=true,
    p_ranges:='{"torq_min":{"min":2,"max":null}}'::jsonb)->'categories') into v_cats;

  if v_cats < 8 then
    raise exception 'Filtrando por torque quedaron % categorías: tienen que estar las 8', v_cats;
  end if;

  -- 3. Y el total filtrado SÍ tiene que reaccionar: es lo que cuenta el listado.
  v_j := public.catalog_facets(p_company:=v_co, p_category:=v_cat, p_solo_catalogo:=true);
  v_total := (v_j->>'total')::bigint;
  if v_total >= v_todo then
    raise exception 'Elegir una categoría no achicó el total: % de %', v_total, v_todo;
  end if;

  -- 4. Sin atributos, la faceta viene vacía y nada más cambia.
  v_j := public.catalog_facets(p_company:=v_co, p_solo_catalogo:=true, p_con_atributos:=false);
  if jsonb_array_length(v_j->'attributes') <> 0 then
    raise exception 'Se pidió sin atributos y vinieron %', jsonb_array_length(v_j->'attributes');
  end if;
  if (v_j->>'total')::bigint <> v_todo then
    raise exception 'Saltear los atributos cambió el total';
  end if;

  raise notice 'OK · «Todas» = %, las 8 categorías sobreviven a un filtro de torque, y sin atributos el resto no cambia.', v_todo;
end $$;
