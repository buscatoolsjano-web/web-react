-- Fase 85 · El catálogo, legible de una sola lectura
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
--
-- Dicho por quien la usa: «necesito que sea experta en todo el catálogo y
-- sepa leerlo; que sepa interpretar qué es cada característica, cada
-- atributo».
--
-- `asistente_buscar_productos` devolvía SKU, nombre, marca, categoría, precio
-- y stock. Nada de lo que distingue un producto de otro: ni la SERIE —si es
-- una punta, una embocadura, una extensión— ni los ATRIBUTOS —el encastre, la
-- medida, el largo, el torque, los kilos que aguanta—.
--
-- Con eso, «necesito una punta Phillips 2» devolvía cinco Phillips y ninguna
-- forma de saber cuál es la del 2: había que pedir la ficha de cada una, una
-- llamada por producto. Por teléfono eso es medio minuto de silencio.
--
-- Y la búsqueda tampoco MIRABA esos campos: el texto buscable era nombre, SKU,
-- marca, tipo y categoría. La serie, el modelo y los atributos existían en la
-- base y no servían para encontrar nada.
--
-- ── LOS TRES CAMBIOS ───────────────────────────────────────────────────────
--
--  1. Los dígitos sueltos cuentan como palabra. Estaban descartados por el
--     piso de dos caracteres, así que en «punta Phillips 2» el 2 —que es
--     justamente lo que se pide— se tiraba antes de buscar.
--  2. Y cuentan COMO PALABRA, no adentro de otra. Con el `like '%2%'` de
--     siempre, «punta Phillips 2» le daba 3 de 3 a la BR.PH1 —que es la del
--     UNO— porque su nombre dice «S2» y «3.0mm», y la del 2 de verdad quedaba
--     tercera. Para una palabra larga el substring está bien; para un dígito
--     solo es ruido puro, porque un dígito aparece adentro de casi todo.
--  3. La serie, el modelo y los atributos entran al texto buscable.
--  4. Cada fila vuelve con su serie y sus atributos útiles.
--
-- Medido después: «punta Phillips 2» devuelve cuatro puntas con `medida: 2`,
-- las cuatro con stock. Antes, dos de las tres primeras eran del 1.
--
-- ── POR QUÉ «ÚTILES» Y NO TODOS ────────────────────────────────────────────
--
-- Porque la mitad de los atributos son del importador, no del producto:
-- `catalogo_id`, `catalogo_pagina`, `longitud_raw`, `marca_disp`. En cuarenta
-- filas eso son miles de caracteres de contexto —que se pagan y que corren el
-- corte de 12.000— para decir de qué página del PDF salió. Se van por nombre
-- en una resta de claves, que es una lista que se lee y se audita.
--
-- Esto lo usan TAMBIÉN el asistente escrito, la API y el MCP. Es aditivo:
-- ningún campo cambia de nombre ni de forma, sólo se agregan dos.
--
-- La firma no cambia, así que el `create or replace` reemplaza y no crea una
-- sobrecarga.

create or replace function public.asistente_buscar_productos(
  p_company uuid, p_texto text, p_limite integer default 15
) returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_vacias  constant text[] := array[
    'de','del','la','el','los','las','un','una','unos','unas','y','o','con','para',
    'en','al','por','no','si','que','se','es','lo','su','sus','este','esta','mas',
    'hay','tenes','tienen','tenemos','necesito','quiero','busco','dame','algo',
    'producto','productos','herramienta','herramientas','stock'];
  -- Lo que es del importador y no del producto. Ver arriba.
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

  /*
   * Las palabras de la pregunta.
   *
   * El piso de dos caracteres es para que «de» y «la» no cuenten, pero se
   * llevaba puestos los dígitos sueltos, y en este catálogo un dígito suelto
   * ES el dato: «Phillips 2», «Torx 3», «punta del 6». Por eso la excepción.
   */
  select array_agg(w) into v_palabras
    from unnest(regexp_split_to_array(lower(v_q), '[^a-z0-9./]+')) as w
   where (length(w) >= 2 or w ~ '^[0-9]$') and not (w = any (v_vacias));
  v_palabras := coalesce(v_palabras, array[lower(v_q)]);
  v_n    := array_length(v_palabras, 1);
  v_piso := greatest(1, (v_n + 1) / 2);

  with preseleccion as (
    select p.id, p.sku, p.name, p.product_type, p.model_code, p.series,
           coalesce(b.name, '—') as marca,
           coalesce(c.name, '—') as categoria,
           a.utiles as atributos,
           -- El tipo y la categoría entran al texto buscable: son la parte en
           -- castellano de un catálogo escrito mitad en inglés. La serie y los
           -- atributos entran por lo mismo: «embocadura», «1/4 QC» y «medida
           -- 2» son como se pide un producto por teléfono, y hasta ahora no se
           -- podían encontrar aunque estuvieran cargados.
           lower(p.name || ' ' || p.sku || ' ' || coalesce(b.name, '') || ' '
                 || coalesce(p.product_type, '') || ' ' || coalesce(c.name, '') || ' '
                 || coalesce(p.series, '') || ' ' || coalesce(p.model_code, '') || ' '
                 || coalesce(a.texto, '')) as texto,
           lower(coalesce(b.name, '')) as marca_baja
      from products p
      left join brands b             on b.id = p.brand_id
      left join product_categories c on c.id = p.category_id
      left join lateral (
        select nullif(coalesce(p.attributes, '{}'::jsonb) - v_ruido, '{}'::jsonb) as utiles,
               (select string_agg(e.value, ' ')
                  from jsonb_each_text(coalesce(p.attributes, '{}'::jsonb) - v_ruido) e) as texto
      ) a on true
     where p.company_id = p_company and p.deleted_at is null
       and (exists (select 1 from unnest(v_palabras) w
                     where p.name ilike '%' || w || '%'
                        or p.sku  ilike '%' || w || '%'
                        or coalesce(b.name,'') ilike '%' || w || '%'
                        or coalesce(p.product_type,'') ilike '%' || w || '%'
                        or coalesce(p.series,'') ilike '%' || w || '%'
                        or coalesce(a.texto,'') ilike '%' || w || '%')
            or v_q <% p.name
            or v_q <% p.sku)
  ), candidatos as (
    select s.*,
           -- El dígito suelto, con bordes. Ver el punto 2 de arriba.
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
    -- El saldo se calcula acá, antes de cortar: si se calculara después, el
    -- corte ya habría dejado afuera justo lo que tiene stock, que es lo que
    -- se quiere arriba. Se guarda para no pedirlo dos veces.
    select f.*, coalesce((select disponible from app.stock_de(f.id)), 0) as disponible
      from filtrados f
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
           'tipo', product_type, 'serie', series, 'atributos', atributos,
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
