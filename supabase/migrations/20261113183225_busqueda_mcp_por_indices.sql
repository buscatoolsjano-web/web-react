-- La búsqueda de productos del MCP usa índices, para todas las empresas.
--
-- «Mejorá y optimizá las búsquedas del MCP, en todas las empresas actuales y
-- futuras, que siempre se optimice.» Después del texto precalculado
-- (`texto_busqueda`) la búsqueda seguía en 1–2 s en Torquetools. Medido: la
-- preselección recorría los 28.000 productos uno por uno. No por falta de
-- índices —`name` y `sku` tienen trigramas—: con RLS activa, Postgres NO
-- puede usar un índice con `LIKE` ni `<%` (no son operadores «leakproof» y la
-- política de la tabla tiene que evaluarse antes). Como postgres, la misma
-- consulta usaba el índice: 45 ms contra 300+.
--
-- La solución no toca la seguridad:
--   1. `app.candidatos_busqueda` (SECURITY DEFINER) encuentra los CANDIDATOS
--      con los índices: texto (trigramas sobre `texto_busqueda`, índice
--      nuevo), nombre y SKU parecidos, y marca. Antes de nada verifica que
--      quien llama sea miembro activo de esa empresa; si no, no devuelve nada.
--      Sólo devuelve ids.
--   2. `asistente_buscar_productos` lee esos productos como siempre, BAJO RLS:
--      cada rol sigue viendo lo mismo (stock sólo internos, precios según su
--      lista, productos activos para clientes). Los ids de más que no pueda
--      ver, RLS los descarta.
--
-- El índice cubre la tabla entera: una empresa nueva queda optimizada sola.

create index if not exists products_texto_busqueda_trgm
  on public.products using gin (texto_busqueda gin_trgm_ops)
  where deleted_at is null;

create or replace function app.candidatos_busqueda(p_company uuid, p_palabras text[], p_q text)
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_w text;
begin
  -- Sólo para quien es miembro activo de la empresa: si no, nada.
  if p_company is null or not (p_company = any (app.current_company_ids())) then
    return;
  end if;

  -- Nombre o SKU parecidos a lo pedido (trigramas sobre name / sku).
  return query
    select p.id from products p
     where p.company_id = p_company and p.deleted_at is null and p_q <% p.name
    union
    select p.id from products p
     where p.company_id = p_company and p.deleted_at is null and p_q <% p.sku
    union
    -- La marca nombrada.
    select p.id from products p
     where p.company_id = p_company and p.deleted_at is null
       and p.brand_id in (select b.id from brands b
                           where b.company_id = p_company
                             and exists (select 1 from unnest(p_palabras) w where b.name ilike '%' || w || '%'));

  -- Cada palabra en el texto del producto (nombre, SKU, tipo, serie, modelo,
  -- atributos). Una consulta por palabra, para que use el índice.
  foreach v_w in array p_palabras loop
    return query
      select p.id from products p
       where p.company_id = p_company and p.deleted_at is null
         and p.texto_busqueda like '%' || v_w || '%';
  end loop;
end $function$;

revoke execute on function app.candidatos_busqueda(uuid, text[], text) from public, anon;
grant execute on function app.candidatos_busqueda(uuid, text[], text) to authenticated, service_role;

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

  with candidatos_ids as (
    -- Los candidatos salen de los índices; el resto se lee bajo RLS.
    select distinct id from app.candidatos_busqueda(p_company, v_palabras, v_q) as c(id)
  ), preseleccion as (
    select p.id, p.sku, p.name, p.product_type, p.model_code, p.series, p.attributes,
           coalesce(b.name, '—') as marca,
           coalesce(c.name, '—') as categoria,
           p.texto_busqueda || ' ' || lower(coalesce(b.name, '')) || ' ' || lower(coalesce(c.name, '')) as texto,
           lower(coalesce(b.name, '')) as marca_baja
      from candidatos_ids ci
      join products p                on p.id = ci.id
      left join brands b             on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
     where p.company_id = p_company and p.deleted_at is null
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
    -- El stock de cada candidato por el índice de product_id, bajo RLS.
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
