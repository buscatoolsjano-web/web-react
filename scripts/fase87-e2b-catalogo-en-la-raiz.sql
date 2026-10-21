-- Fase 87 · E2b · Filtrar el catálogo público, y que entre rápido
--
-- «Entrás a la web y ya tenés el catálogo ahí listo para filtrar.»
--
-- Aplicado en producción en tres migraciones. La tercera salió de que la
-- segunda no entraba en el tiempo de consulta: ver el punto 2.

-- ── 1. Las facetas: qué se puede elegir ────────────────────────────────────
--
-- Hasta acá lo público se filtraba por categoría y por texto, que es poco
-- para nueve mil productos: dentro de «Puntas y tubos» hay 8.623, y lo que
-- separa una de otra es la marca, la serie y el tipo.
--
-- Son una función aparte porque las opciones dependen de lo YA filtrado:
-- elegida la categoría «Balanceadores», las marcas que se pueden ofrecer son
-- las tres que tienen balanceadores, no las treinta y tres del catálogo. Un
-- desplegable con opciones que devuelven cero resultados es peor que no
-- tener filtro.

-- ── 2. Una fuente FLACA, y por qué ─────────────────────────────────────────
--
-- CORRECCIÓN. La primera versión usaba `app.catalogo_publicable`, la misma
-- vista que la ficha. Esa vista trae la imagen principal de cada producto con
-- un `lateral`, y eso está bien para UNA ficha y es ruinoso para contar nueve
-- mil: se colgó por `statement timeout` apenas la portada pasó a pedir el
-- catálogo entero junto con las facetas.
--
-- Contar no necesita ninguna imagen, y paginar necesita veinticuatro. Así que
-- hay dos fuentes: ésta, flaca, para filtrar, contar y cortar la página; y la
-- de siempre, con imagen, para la ficha de a una.
--
-- Lo mismo con el texto buscable: se armaba como columna del CTE, así que
-- `lower(unaccent(...))` se calculaba para las nueve mil filas aunque nadie
-- hubiera escrito nada en el buscador. Ahora la condición se evalúa sólo si
-- hay palabras.
--
-- Medido después, con el plan caliente: el conteo completo tarda 25 ms del
-- lado del servidor, y la llamada entera unos 470 ms desde Argentina, de los
-- cuales ~220 son la latencia fija hasta São Paulo.

create or replace view app.catalogo_publicable_flaco as
  select p.id, p.company_id, p.sku, p.name, p.series, p.product_type,
         p.public_slug,
         b.name as marca, c.name as categoria,
         coalesce(c.slug_publico, c.slug) as categoria_slug
    from public.products p
    join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
    join public.brands b             on b.id = p.brand_id and b.is_active
    join public.product_categories c on c.id = p.category_id and c.publica
   where p.deleted_at is null and p.status = 'active';

create or replace function public.catalogo_publico_facetas(
  p_categoria text default null
) returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  with dentro as (
    select * from app.catalogo_publicable_flaco v
     where p_categoria is null or v.categoria_slug = p_categoria
  )
  select jsonb_build_object(
    'total', (select count(*) from dentro),
    -- La marca viaja con su slug además del nombre: el filtro va en la URL y
    -- «Chicago Pneumatic» con espacios y mayúsculas no es una dirección. Y se
    -- slugifica DESPUÉS de agrupar: son treinta y tres marcas, no nueve mil
    -- filas.
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', app.slugificar(nombre), 'nombre', nombre, 'cuantos', n)
             order by n desc, nombre)
        from (select marca as nombre, count(*) as n
                from dentro where marca is not null group by 1) m), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', nombre, 'cuantos', n) order by n desc, nombre)
        from (select series as nombre, count(*) as n
                from dentro where series is not null and series <> '' group by 1) s), '[]'::jsonb),
    'tipos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', nombre, 'cuantos', n) order by n desc, nombre)
        from (select product_type as nombre, count(*) as n
                from dentro where product_type is not null and product_type <> '' group by 1) t),
      '[]'::jsonb))
$$;

-- ── 3. El listado, con los dos filtros nuevos ──────────────────────────────
--
-- OJO con la firma: pasó de cinco parámetros a siete, y un `create or
-- replace` con otra firma deja las DOS funciones vivas. PostgREST entonces no
-- sabe cuál elegir y falla. Hay un `drop` explícito de la vieja más abajo; es
-- la lección de la Fase 84.
create or replace function public.catalogo_publico_listar(
  p_categoria text default null,
  p_marca text default null,
  p_texto text default null,
  p_pagina integer default 1,
  p_por_pagina integer default 24,
  p_serie text default null,
  p_tipo text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_por    integer := least(greatest(coalesce(p_por_pagina, 24), 1), 48);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
  v_q      text    := nullif(btrim(coalesce(p_texto, '')), '');
  v_palabras text[];
  v_total  bigint;
  v_filas  jsonb;
begin
  -- Se parte en palabras conservando el punto y la barra: «SP.PH2» y «3/8»
  -- son una palabra sola. Y los dígitos sueltos cuentan —«Phillips 2» es la
  -- del dos—, que es lo que se aprendió en la Fase 85.
  if v_q is not null then
    select array_agg(w) into v_palabras
      from unnest(regexp_split_to_array(lower(extensions.unaccent(v_q)), '[^a-z0-9./]+')) as w
     where w <> '';
  end if;

  with filtrados as (
    select v.*
      from app.catalogo_publicable_flaco v
     where (p_categoria is null or v.categoria_slug = p_categoria)
       and (p_marca is null or app.slugificar(v.marca) = p_marca)
       and (p_serie is null or v.series = p_serie)
       and (p_tipo is null or v.product_type = p_tipo)
       and (v_palabras is null
            or not exists (
                 select 1 from unnest(v_palabras) w
                  where lower(extensions.unaccent(
                          v.name || ' ' || v.sku || ' ' || coalesce(v.marca, '') || ' ' ||
                          coalesce(v.series, '') || ' ' || coalesce(v.product_type, '') || ' ' ||
                          coalesce(v.categoria, ''))) not like '%' || w || '%'))
  ), pagina as (
    select * from filtrados order by name limit v_por offset (v_pagina - 1) * v_por
  )
  select (select count(*) from filtrados),
         (select jsonb_agg(jsonb_build_object(
                   'slug', f.public_slug, 'sku', f.sku, 'nombre', f.name,
                   'marca', f.marca, 'categoria', f.categoria,
                   'categoriaSlug', f.categoria_slug,
                   'serie', f.series, 'tipo', f.product_type,
                   'imagen', i.storage_path, 'imagenUrl', i.source_url,
                   'imagenAlt', i.alt_text) order by f.name)
            from pagina f
            -- La imagen, acá y sólo para las veinticuatro de la página.
            left join lateral (
              select pi.storage_path, pi.source_url, pi.alt_text
                from public.product_images pi
               where pi.product_id = f.id
               order by pi.is_primary desc nulls last, pi.position nulls last, pi.created_at
               limit 1
            ) i on true)
    into v_total, v_filas;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'pagina', v_pagina,
    'porPagina', v_por,
    'productos', coalesce(v_filas, '[]'::jsonb));
end $function$;

drop function if exists public.catalogo_publico_listar(text, text, text, integer, integer);

revoke all on function public.catalogo_publico_facetas(text) from public;
revoke all on function public.catalogo_publico_listar(text, text, text, integer, integer, text, text) from public;
grant execute on function public.catalogo_publico_facetas(text) to anon, authenticated;
grant execute on function public.catalogo_publico_listar(text, text, text, integer, integer, text, text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 87 · E2c · Las columnas por atributo, como en el ERP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- «Que lo repliques: una fila donde está cada columna con su título. Imagen,
-- referencia, modelo, así con todo. Como está cuando iniciás sesión.»
--
-- El catálogo interno agrega columnas según la categoría elegida —en «Puntas
-- y tubos» aparecen Encastre, Medida, Largo y Sufijos— y las etiquetas, las
-- unidades y el orden salen de `product_attribute_definitions`. Acá se usa la
-- MISMA fuente: dos listas de etiquetas escritas por separado se separan, y
-- el día que alguien corrija «Torque mín.» lo haría en un solo lado.
--
-- Y esa tabla ya marca con `is_filterable = false` lo que es del importador
-- —`catalogo_id`, `catalogo_pagina`, `marca_disp`—, que es exactamente lo que
-- la Fase 85 había listado a mano. Se reemplaza la lista por la marca, que es
-- un dato que alguien puede cambiar sin tocar código.
--
-- El SQL exacto está en la migración `fase87_catalogo_publico_columnas_por_
-- atributo`. Lo que cambió respecto de lo de arriba:
--
--  · `app.claves_de_atributo_publicas()` y `app.atributos_publicos()` leen
--    `product_attribute_definitions` en vez de una lista escrita a mano.
--  · la vista flaca gana `model_code` y `attributes`. Ojo: `create or replace
--    view` NO deja cambiar el orden ni el nombre de las columnas, así que hay
--    que tirarla y volver a crearla.
--  · `catalogo_publico_facetas` devuelve además `categorias` y `atributos`,
--    cada atributo con su etiqueta, su unidad, cuántos productos lo tienen
--    cargado y sus valores con cuántos hay de cada uno. Con eso la pantalla
--    arma la columna Y su filtro sin saber nada del catálogo.
--  · `catalogo_publico_listar` devuelve `modelo` y `atributos` por fila, y
--    acepta `p_atributos jsonb` para filtrar por ellos. Todos los elegidos
--    tienen que coincidir: encastre 1/4 Y medida 2 es pedir las dos cosas.
--
-- Y otra vez el `drop function` explícito de la firma anterior: es la tercera
-- vez en esta fase que agregar un parámetro deja dos funciones vivas y
-- PostgREST no sabe cuál elegir.
--
-- Medido: las facetas del catálogo entero tardan ~850 ms —el `jsonb_each_text`
-- sobre nueve mil filas— y se piden una vez por categoría, cacheadas media
-- hora. El listado, que es el que cambia con cada filtro, ~470 ms.

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 87 · E2d/E3b/E4 · Ajustes de la landing pedidos sobre la marcha
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Aplicado en dos migraciones. Lo del lado de la base:
--
-- `fase87_catalogo_publico_buscar_por_modelo`: `catalogo_publico_listar` gana
-- un parámetro `p_modelo` al final de la firma —búsqueda por subcadena,
-- insensible a acentos— porque el modelo no estaba en el texto buscable
-- general. Con el consabido `drop` de la firma anterior, que es la cuarta vez
-- en esta fase. Verificado: «5422» devuelve 5 productos con ese modelo.
--
-- El resto fue en el front:
--  · barra flotante del pedido abajo a la derecha (ítems · vaciar · ver);
--  · fotos en la página del pedido (el carrito guarda la URL al agregar);
--  · encabezado del catálogo compacto, para que la tabla arranque más arriba;
--  · caja de búsqueda por modelo en su columna;
--  · logo sobre una plaquita blanca, para que se lea en modo oscuro;
--  · las consultas llegan al ERP como notificación y a una pantalla propia
--    en Ventas → Consultas del sitio (`public_quote_requests`, sólo internos).
