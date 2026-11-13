-- Dos lentitudes medidas, dos arreglos.
--
-- 1. FILTROS DEL CATÁLOGO PÚBLICO PRECALCULADOS.
--    `catalogo_publico_facetas` recorría el catálogo entero en cada visita:
--    913 ms sin filtros y 863 ms en «puntas y tubos», cerca del corte de 3 s
--    que tiene el visitante anónimo (y en frío, por encima: de ahí los 500).
--    Lo que muestra apenas cambia, así que se guarda: sin filtros y por cada
--    categoría pública, y se refresca cada 10 minutos desde la tarea que ya
--    mantiene caliente el catálogo (cron jobid 9, cada 3 minutos). Con
--    cualquier otro filtro —marca, tipo, texto, atributos— se calcula como
--    antes. Si la copia falta o tiene más de 30 minutos, también se calcula.
--
-- 2. BÚSQUEDA DE PRODUCTOS DEL MCP SIN RECORRER LOS ATRIBUTOS EN CADA LLAMADA.
--    `asistente_buscar_productos` armaba, para cada uno de los 21.800
--    productos y en cada búsqueda, el texto de sus atributos (jsonb_each_text)
--    para compararlo: 640 ms sólo en eso. Ahora ese texto vive en una columna
--    generada (`texto_busqueda`, ~3 MB por empresa) y la comparación cuesta
--    14 ms. El stock se trae en una sola consulta en vez de una por producto.
--    Lo que encuentra y el orden son los mismos.

-- ── 1. Filtros precalculados ─────────────────────────────────────────────────
create table if not exists app.facetas_publicas_cache (
  clave      text primary key,          -- '' = sin filtros; si no, el slug de la categoría
  valor      jsonb not null,
  calculado  timestamptz not null default now()
);
revoke all on app.facetas_publicas_cache from public, anon, authenticated;

-- El cálculo de siempre pasa a `app`, con otro nombre; la puerta pública lo
-- envuelve. Los permisos de la función se conservan al moverla.
alter function public.catalogo_publico_facetas(text, text, text, text, jsonb, text, text, jsonb)
  set schema app;
alter function app.catalogo_publico_facetas(text, text, text, text, jsonb, text, text, jsonb)
  rename to catalogo_publico_facetas_calcular;
revoke execute on function app.catalogo_publico_facetas_calcular(text, text, text, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.catalogo_publico_facetas(
  p_categoria text default null, p_marca text default null, p_serie text default null, p_tipo text default null,
  p_atributos jsonb default null, p_texto text default null, p_modelo text default null, p_rangos jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
set jit to 'off'
as $function$
declare
  v_guardado jsonb;
begin
  -- Sólo la portada y cada categoría sin otros filtros: es lo que más se pide
  -- y lo único que se guarda.
  if p_marca is null and p_serie is null and p_tipo is null and p_modelo is null
     and nullif(btrim(coalesce(p_texto, '')), '') is null
     and (p_atributos is null or p_atributos = '{}'::jsonb)
     and (p_rangos is null or p_rangos = '{}'::jsonb) then
    select c.valor into v_guardado
      from app.facetas_publicas_cache c
     where c.clave = coalesce(p_categoria, '')
       and c.calculado > now() - interval '30 minutes';
    if v_guardado is not null then
      return v_guardado;
    end if;
  end if;
  return app.catalogo_publico_facetas_calcular(p_categoria, p_marca, p_serie, p_tipo, p_atributos, p_texto, p_modelo, p_rangos);
end $function$;

grant execute on function public.catalogo_publico_facetas(text, text, text, text, jsonb, text, text, jsonb)
  to anon, authenticated, service_role;

-- Refresca la copia: sin filtros y cada categoría pública.
create or replace function app.refrescar_facetas_publicas()
returns integer
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_slug text; v_n integer := 0;
begin
  insert into app.facetas_publicas_cache (clave, valor, calculado)
  values ('', app.catalogo_publico_facetas_calcular(null, null, null, null, null, null, null, null), now())
  on conflict (clave) do update set valor = excluded.valor, calculado = excluded.calculado;
  v_n := 1;
  for v_slug in
    select distinct coalesce(c.slug_publico, c.slug) from product_categories c where c.publica
  loop
    insert into app.facetas_publicas_cache (clave, valor, calculado)
    values (v_slug, app.catalogo_publico_facetas_calcular(v_slug, null, null, null, null, null, null, null), now())
    on conflict (clave) do update set valor = excluded.valor, calculado = excluded.calculado;
    v_n := v_n + 1;
  end loop;
  -- Una categoría que dejó de ser pública no se sigue sirviendo.
  delete from app.facetas_publicas_cache f
   where f.clave <> '' and not exists (
     select 1 from product_categories c where c.publica and coalesce(c.slug_publico, c.slug) = f.clave);
  return v_n;
end $function$;

revoke execute on function app.refrescar_facetas_publicas() from public, anon, authenticated;

-- La tarea de cada 3 minutos refresca la copia si tiene más de 10.
create or replace function app.calentar_catalogo_publico()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  -- Filtros del catálogo público precalculados (cada 10 minutos).
  if not exists (select 1 from app.facetas_publicas_cache where clave = '' and calculado > now() - interval '10 minutes') then
    perform app.refrescar_facetas_publicas();
  end if;

  -- Portada del catálogo PÚBLICO (anon): mantiene calientes las páginas que
  -- leen las tres RPC sin filtros.
  perform catalogo_publico_categorias();
  perform catalogo_publico_facetas(null,null,null,null,null,null,null);
  perform catalogo_publico_listar(null,null,null,1,100,null,null,null,null);

  -- Catálogo del ERP: la primera página de cada empresa. search_products lee
  -- ~60 MB (products + sus índices) para dar el total exacto; en frío son
  -- ~2,4 s (el primero que entra al catálogo lo paga). Tocarlo cada minuto lo
  -- deja en ~170 ms siempre. Corre como postgres, así que no lo frena la RLS;
  -- lo que importa es que las páginas queden en shared_buffers, que es
  -- compartido por todos los backends.
  perform * from search_products('bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
  perform * from search_products('492a0ee9-220f-4dc8-9eaa-ec914ea10907'::uuid, null, 50, 0, null, null, null, null, null, null, true, null);
end $function$;

select app.refrescar_facetas_publicas();

-- ── 2. Búsqueda rápida del MCP ───────────────────────────────────────────────
-- El texto en el que se busca: nombre, SKU, tipo, serie, modelo y los valores
-- de los atributos útiles (sin los campos de ruido del importador). La marca
-- y la categoría no van: están en otras tablas y se suman al buscar.
create or replace function app.texto_busqueda_producto(
  p_name text, p_sku text, p_type text, p_series text, p_model text, p_attrs jsonb)
returns text
language sql
immutable
parallel safe
set search_path to 'pg_catalog'
as $function$
  select lower(coalesce(p_name, '') || ' ' || coalesce(p_sku, '') || ' ' || coalesce(p_type, '') || ' '
         || coalesce(p_series, '') || ' ' || coalesce(p_model, '') || ' '
         || coalesce((select string_agg(e.value, ' ')
                        from jsonb_each_text(coalesce(p_attrs, '{}'::jsonb)
                               - array['catalogo_id','catalogo_pagina','longitud_raw','marca_disp','modelo',
                                       'categoria_full','codigo','dim_caja','dim_balanceador','peso_embalado_kg']) e), ''))
$function$;

alter table public.products
  add column if not exists texto_busqueda text
  generated always as (app.texto_busqueda_producto(name, sku, product_type, series, model_code, attributes)) stored;

create or replace function public.asistente_buscar_productos(p_company uuid, p_texto text, p_limite integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_vacias  constant text[] := array[
    'de','del','la','el','los','las','un','una','unos','unas','y','o','con','para',
    'en','al','por','no','si','que','se','es','lo','su','sus','este','esta','mas',
    'hay','tenes','tienen','tenemos','necesito','quiero','busco','dame','algo',
    'producto','productos','herramienta','herramientas','stock'];
  v_ruido   constant text[] := array[
    'catalogo_id','catalogo_pagina','longitud_raw','marca_disp','modelo',
    'categoria_full','codigo','dim_caja','dim_balanceador','peso_embalado_kg'];
  v_parecido constant real := 0.6;
  v_lim      integer := least(greatest(coalesce(p_limite, 15), 1), 40);
  v_q        text    := btrim(coalesce(p_texto, ''));
  v_palabras text[];
  v_n        integer;
  v_piso     integer;
  v_completos bigint;
  v_filas    jsonb;
begin
  if v_q = '' then
    return jsonb_build_object('error', 'Falta el texto a buscar.');
  end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);

  select array_agg(w) into v_palabras
    from unnest(regexp_split_to_array(lower(v_q), '[^a-z0-9./]+')) as w
   where (length(w) >= 2 or w ~ '^[0-9]$') and not (w = any (v_vacias));
  v_palabras := coalesce(v_palabras, array[lower(v_q)]);
  v_n    := array_length(v_palabras, 1);
  v_piso := greatest(1, (v_n + 1) / 2);

  with marcas as (
    select b.id from brands b
     where exists (select 1 from unnest(v_palabras) w where b.name ilike '%' || w || '%')
  ), preseleccion as (
    -- `texto_busqueda` ya trae nombre, SKU, tipo, serie, modelo y atributos
    -- en minúscula: comparar es leer una columna, no armar el texto.
    select p.id, p.sku, p.name, p.product_type, p.model_code, p.series, p.attributes,
           coalesce(b.name, '—') as marca,
           coalesce(c.name, '—') as categoria,
           p.texto_busqueda || ' ' || lower(coalesce(b.name, '')) || ' ' || lower(coalesce(c.name, '')) as texto,
           lower(coalesce(b.name, '')) as marca_baja
      from products p
      left join brands b             on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
     where p.company_id = p_company and p.deleted_at is null
       and (exists (select 1 from unnest(v_palabras) w where p.texto_busqueda like '%' || w || '%')
            or p.brand_id in (select id from marcas)
            or v_q <% p.name
            or v_q <% p.sku)
  ), candidatos as (
    select s.*,
           (select count(*) from unnest(v_palabras) w
             where case
                     when length(w) = 1
                       then s.texto ~ ('(^|[^a-z0-9])' || w || '([^a-z0-9]|$)')
                     else s.texto like '%' || w || '%'
                   end
                or word_similarity(w, s.texto) >= v_parecido) as palabras,
           exists (select 1 from unnest(v_palabras) w
                    where s.marca_baja <> ''
                      and (s.marca_baja like '%' || w || '%' or w like '%' || s.marca_baja || '%'))
             as marca_pedida,
           case
             when upper(s.sku) = upper(v_q)                       then 'sku'
             when s.sku  ilike '%' || v_q || '%'                  then 'codigo'
             when upper(coalesce(s.model_code,'')) = upper(v_q)   then 'modelo'
             when s.name ilike '%' || v_q || '%'                  then 'nombre'
             else 'parecido' end as como,
           greatest(word_similarity(v_q, s.name), word_similarity(v_q, s.sku)) as score
      from preseleccion s
  ), filtrados as (
    select * from candidatos
     where palabras >= v_piso or como <> 'parecido' or score >= 0.7
  ), con_saldo as (
    -- El stock de cada candidato por el índice de product_id. NO en una
    -- pasada sobre stock_balances: bajo RLS esa pasada evalúa
    -- `app.is_internal` en las 14.856 filas (1,7 s medidos); así sólo en las
    -- del candidato.
    select f.*, coalesce(s.disponible, 0) as disponible
      from filtrados f
      left join lateral (select sum(sb.on_hand - sb.reserved) as disponible
                           from stock_balances sb where sb.product_id = f.id) s on true
  ), ordenados as (
    select *, count(*) filter (where palabras >= v_n) over () as completos
      from con_saldo
     order by case como when 'sku' then 0 when 'codigo' then 1 when 'modelo' then 2 else 3 end,
              palabras desc, marca_pedida desc, (disponible > 0) desc, score desc, name
     limit v_lim
  )
  select max(completos),
         jsonb_agg(jsonb_build_object(
           'sku', sku, 'nombre', name, 'marca', marca, 'categoria', categoria,
           'tipo', product_type, 'serie', series,
           'atributos', nullif(coalesce(attributes, '{}'::jsonb) - v_ruido, '{}'::jsonb),
           'encontrado_por', como,
           'coincide', palabras || ' de ' || v_n,
           'precio', (select importe from app.precio_de_lista(p_company, id)),
           'moneda', (select moneda  from app.precio_de_lista(p_company, id)),
           'disponible', disponible)
           order by case como when 'sku' then 0 when 'codigo' then 1 when 'modelo' then 2 else 3 end,
                    palabras desc, marca_pedida desc, (disponible > 0) desc, score desc, name)
    into v_completos, v_filas
    from ordenados;

  if v_filas is null then
    return jsonb_build_object(
      'resultados', 0,
      'nota', 'No encontré ningún producto con «' || v_q || '». ' ||
              'Probá con menos palabras, sólo el modelo, o la marca.');
  end if;

  return jsonb_build_object(
    'resultados', jsonb_array_length(v_filas),
    'coinciden_del_todo', v_completos,
    'orden', 'Vienen ordenados: primero los que mejor coinciden y, a igual coincidencia, ' ||
             'los que tienen stock disponible. Respetá ese orden al nombrarlos.',
    'atributos', 'Cada producto trae sus atributos cargados: «encastre» es el enganche ' ||
                 '(1/4 HEX, 3/8 QC, 1/2 cuadrado), «medida» es el número de la punta o los ' ||
                 'milímetros del tubo, «largo» va en milímetros, «torq_min»/«torq_max» en Nm, ' ||
                 '«min_kg»/«max_kg» es el peso que sostiene un balanceador.',
    'nota', case
      when v_completos = 0 then
        'Ninguno tiene todas las palabras que pediste: éstos son los más parecidos. ' ||
        'Mirá el campo «coincide» antes de darlos por buenos.'
      when v_completos > jsonb_array_length(v_filas) then
        'Hay ' || v_completos || ' que coinciden del todo; te muestro los ' ||
        jsonb_array_length(v_filas) || ' mejores. Si hace falta, acotá la búsqueda.'
      end,
    'productos', v_filas);
end $function$;
