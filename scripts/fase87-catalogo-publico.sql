-- Fase 87 · E1 · La superficie pública del catálogo
--
-- Este archivo es lo que quedó APLICADO en producción, en seis migraciones
-- (`fase87_catalogo_publico_*`). Se aplicó por partes y hubo tres
-- correcciones sobre la marcha; están comentadas donde pasaron, porque cada
-- una se descubrió probando contra la base de verdad y ninguna se habría
-- visto leyendo el código.
--
-- ── QUÉ SE ABRE, Y POR QUÉ HAY QUE ABRIRLO A PROPÓSITO ─────────────────────
--
-- Antes de esto el rol `anon` no tenía NADA: las siete tablas del catálogo
-- tienen RLS y el `select` está concedido sólo a `authenticated`. Así que una
-- landing pública no es «sacarle el login a una pantalla»: es una superficie
-- nueva, y se abre por una puerta angosta.
--
-- La puerta son TRES funciones y ninguna tabla. `anon` no gana permiso sobre
-- `products` ni sobre nada: gana permiso para ejecutar tres funciones que
-- devuelven columnas elegidas a mano. Es la misma idea que `EXPUESTAS` en
-- `erp-api/logica.ts`: lo que se publica se lee de un lugar y se audita.
--
-- Verificado contra producción, sin sesión:
--   · `/rest/v1/products`, `product_prices`, `stock_balances`, `companies`,
--     `brands`, `customers` → 401 en todas.
--   · las tres funciones públicas → ni «precio», ni «costo», ni «stock» en
--     ninguna respuesta.
--   · `asistente_buscar_productos` → «permission denied for schema app».
--
-- ── LO QUE NO SALE ─────────────────────────────────────────────────────────
--
-- Ni precio, ni costo, ni stock, ni listas, ni ids internos, ni una palabra
-- de ningún cliente. No es que estén filtrados en la consulta: no están
-- nombrados en el `jsonb_build_object`, que es la única forma de que no se
-- escapen el día que alguien agregue una columna a la tabla.

-- ── 1. Los interruptores ───────────────────────────────────────────────────
--
-- Qué empresa publica y qué categorías se publican son DATOS, no literales
-- adentro de una función. Si fueran literales, el día que entre una empresa
-- nueva a la base su catálogo saldría publicado sin que nadie lo decidiera.

alter table public.companies
  add column if not exists catalogo_publico boolean not null default false;

comment on column public.companies.catalogo_publico is
  'Si el catálogo de esta empresa se publica sin sesión. Sólo UNA puede estarlo.';

alter table public.product_categories
  add column if not exists publica boolean not null default false;

comment on column public.product_categories.publica is
  'Si la categoría sale en el catálogo público. «Otros» y las de clasificación pendiente no.';

-- «Otros» son 12.602 productos sin clasificar y «Pendiente de clasificación
-- STEL» son restos del importador. Publicar fichas flacas y repetidas hunde
-- el posicionamiento de las buenas, que es justo lo que se quiere lograr.
update public.companies set catalogo_publico = (name = 'Buscatools');

update public.product_categories
   set publica = is_active and name not in ('Otros', 'Pendiente de clasificación STEL');

do $$
begin
  if (select count(*) from public.companies where catalogo_publico) <> 1 then
    raise exception 'Tiene que haber exactamente una empresa con catalogo_publico';
  end if;
end $$;

-- ── 2. El slug, que es la URL ──────────────────────────────────────────────
--
-- Antes la ficha vivía en `/catalogo/SP.2520%2F8B`: un SKU escapado, con el
-- punto y la barra convertidos en basura. Para buscar eso no sirve.
--
-- EL SLUG NO CAMBIA NUNCA una vez asignado. Los nombres los reescribe la
-- sincronización de STEL cada mañana, y un slug que siguiera al nombre
-- rompería todos los enlaces publicados cada vez que alguien corrige una
-- mayúscula. Se asigna al nacer y se queda.

create or replace function app.slugificar(p_texto text)
returns text
language sql
immutable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(extensions.unaccent(coalesce(p_texto, ''))), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')),
    '')
$$;

alter table public.products
  add column if not exists public_slug text;

comment on column public.products.public_slug is
  'La URL pública. Se asigna al nacer y NO cambia: los enlaces publicados tienen que seguir funcionando aunque STEL reescriba el nombre.';

-- El índice ANTES de rellenar, aunque la columna esté toda en null. No es
-- prolijidad: es lo que hace que el `exists` del disparador sea una búsqueda
-- por índice y no un recorrido de veintiún mil filas.
create unique index if not exists products_public_slug_uq
  on public.products (company_id, public_slug)
  where public_slug is not null;

/*
 * El relleno, en UNA pasada.
 *
 * CORRECCIÓN 1. La primera versión recorría fila por fila preguntando «¿ya
 * existe este slug?». Eso es cuadrático —veintiún mil consultas contra una
 * tabla que va creciendo— y se cortó por `statement timeout` a mitad de
 * camino. Como la migración es transaccional, no quedó nada a medias.
 *
 * Acá los choques se resuelven antes de escribir nada, con un `row_number`
 * por nombre: el más viejo de cada grupo se queda con la URL limpia y los
 * demás llevan el SKU pegado atrás, que es único por empresa.
 *
 * Medido: 21.902 productos, 8 necesitaron desempate. Los nombres de este
 * catálogo son más distintivos de lo que parecía.
 */
with base as (
  select p.id,
         left(app.slugificar(p.name), 80) as b,
         app.slugificar(p.sku) as s,
         row_number() over (
           partition by p.company_id, left(app.slugificar(p.name), 80)
           order by p.created_at, p.id
         ) as n
    from public.products p
   where p.public_slug is null
)
update public.products p
   set public_slug = case
                       when base.b is null then base.s
                       when base.n = 1     then base.b
                       else base.b || '-' || base.s
                     end
  from base
 where base.id = p.id;

-- El desempate para los que nazcan de acá en adelante, incluidos los que trae
-- STEL. Acá sí vale el `exists`: es una fila por vez y hay índice.
create or replace function app.slug_de_producto(p_company uuid, p_nombre text, p_sku text)
returns text
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_base text := left(app.slugificar(p_nombre), 80);
  v_sku  text := app.slugificar(p_sku);
begin
  if v_base is null then return v_sku; end if;
  if not exists (
    select 1 from public.products
     where company_id = p_company and public_slug = v_base
  ) then
    return v_base;
  end if;
  return v_base || '-' || v_sku;
end $function$;

create or replace function app.poner_slug_publico()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.public_slug is null then
    new.public_slug := app.slug_de_producto(new.company_id, new.name, new.sku);
  end if;
  return new;
end $function$;

drop trigger if exists products_slug_publico on public.products;
create trigger products_slug_publico
  before insert on public.products
  for each row execute function app.poner_slug_publico();

-- ── 3. El slug de la categoría, que es la otra mitad de la URL ─────────────
--
-- CORRECCIÓN 2. El slug interno de «Puntas y tubos» es `punta`: singular y
-- sin los tubos. Sirve para el ERP y lo usan sus pantallas, así que no se
-- toca. Pero era la URL que iba a quedar indexada, y lo que la gente escribe
-- es «puntas y tubos».
--
-- Columna aparte en vez de corregir la de siempre: cambiar el slug interno
-- rompería lo que ya lo usa, y además son dos cosas distintas —una es una
-- clave, la otra es texto para buscadores— que hoy se parecían por casualidad.
alter table public.product_categories
  add column if not exists slug_publico text;

comment on column public.product_categories.slug_publico is
  'La URL pública de la categoría. Aparte del `slug` interno: ésta se escribe para que la escriba la gente.';

update public.product_categories
   set slug_publico = app.slugificar(name)
 where slug_publico is null;

create unique index if not exists product_categories_slug_publico_uq
  on public.product_categories (slug_publico)
  where slug_publico is not null;

-- ── 4. Los atributos del importador no son del producto ────────────────────
--
-- `catalogo_id` y `catalogo_pagina` dicen de qué página del PDF del proveedor
-- salió la ficha. A quien mira el producto no le dicen nada, y publicarlos es
-- contar cómo está armado el catálogo por dentro. Misma lista que la Fase 85.
create or replace function app.atributos_publicos(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select nullif(coalesce(p, '{}'::jsonb) - array[
    'catalogo_id','catalogo_pagina','longitud_raw','marca_disp','modelo',
    'categoria_full','codigo','dim_caja','dim_balanceador','peso_embalado_kg'
  ], '{}'::jsonb)
$$;

-- ── 5. Qué es publicable, en un solo lugar ─────────────────────────────────
--
-- Es `app.` y no `public.`: no se expone a nadie, la usan las funciones.
create or replace view app.catalogo_publicable as
  select p.id, p.company_id, p.sku, p.name, p.model_code, p.series, p.product_type,
         p.description, app.atributos_publicos(p.attributes) as attributes,
         p.origin_country, p.weight_g, p.is_kit, p.public_slug, p.created_at,
         b.name as marca, c.name as categoria,
         coalesce(c.slug_publico, c.slug) as categoria_slug,
         -- La imagen principal. `storage_path` es la del bucket nuestro;
         -- `source_url` es la del proveedor, para los que no se subieron. Se
         -- prefiere la propia: la ajena puede desaparecer.
         i.storage_path as imagen_path,
         i.source_url   as imagen_url,
         i.alt_text     as imagen_alt
    from public.products p
    join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
    join public.brands b             on b.id = p.brand_id and b.is_active
    join public.product_categories c on c.id = p.category_id and c.publica
    left join lateral (
      select pi.storage_path, pi.source_url, pi.alt_text
        from public.product_images pi
       where pi.product_id = p.id
       order by pi.is_primary desc nulls last, pi.position nulls last, pi.created_at
       limit 1
    ) i on true
   where p.deleted_at is null and p.status = 'active';

-- ── 6. La puerta: tres funciones ───────────────────────────────────────────

/*
 * Las categorías, SIN pasar por la vista.
 *
 * CORRECCIÓN 3. Se colgaba por timeout. La vista trae la imagen principal de
 * cada producto con un lateral, y contar por categoría no necesita ninguna
 * imagen: eran nueve mil búsquedas en `product_images` para devolver ocho
 * números.
 *
 * Las condiciones de qué es publicable se repiten acá, y es la única
 * repetición que me permito: la alternativa —una segunda vista sin imagen—
 * son dos definiciones del mismo concepto que se separan en cuanto alguien
 * toque una.
 */
create or replace function public.catalogo_publico_categorias()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', slug, 'nombre', nombre, 'productos', n) order by n desc), '[]'::jsonb)
    from (
      select coalesce(c.slug_publico, c.slug) as slug, c.name as nombre, count(*) as n
        from public.products p
        join public.companies c0         on c0.id = p.company_id and c0.catalogo_publico
        join public.brands b             on b.id = p.brand_id and b.is_active
        join public.product_categories c on c.id = p.category_id and c.publica
       where p.deleted_at is null and p.status = 'active'
       group by 1, 2
    ) t
$$;

/**
 * El listado. Con un tope duro de página: una función pública sin tope es una
 * invitación a bajarse el catálogo entero de a un pedido.
 *
 * CORRECCIÓN 4. Buscar la FRASE entera devolvía cero: «phillips 2» hacía
 * `name ilike '%phillips 2%'` y ningún producto se llama así —se llaman
 * «SPEEDRILL PH2 PHILLIPS»—. Nadie escribe las palabras en el orden en que
 * están en el nombre. Ahora cada palabra tiene que aparecer en algún lado,
 * sin importar el orden ni en qué campo. Medido después: 112 resultados.
 */
create or replace function public.catalogo_publico_listar(
  p_categoria text default null,
  p_marca text default null,
  p_texto text default null,
  p_pagina integer default 1,
  p_por_pagina integer default 24
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
  -- son una palabra sola y partirlas sería buscar otra cosa. Y los dígitos
  -- sueltos cuentan —«Phillips 2» es la del dos—, que es lo mismo que se
  -- aprendió en la Fase 85 para el buscador hablado.
  if v_q is not null then
    select array_agg(w) into v_palabras
      from unnest(regexp_split_to_array(lower(extensions.unaccent(v_q)), '[^a-z0-9./]+')) as w
     where w <> '';
  end if;

  with publicables as (
    select v.*,
           lower(extensions.unaccent(
             v.name || ' ' || v.sku || ' ' || coalesce(v.marca, '') || ' ' ||
             coalesce(v.series, '') || ' ' || coalesce(v.product_type, '') || ' ' ||
             coalesce(v.categoria, ''))) as texto
      from app.catalogo_publicable v
     where (p_categoria is null or v.categoria_slug = p_categoria)
       and (p_marca is null or app.slugificar(v.marca) = p_marca)
  ), filtrados as (
    select * from publicables p
     where v_palabras is null
        or not exists (
             select 1 from unnest(v_palabras) w
              where p.texto not like '%' || w || '%')
  )
  select count(*),
         (select jsonb_agg(jsonb_build_object(
                   'slug', f.public_slug, 'sku', f.sku, 'nombre', f.name,
                   'marca', f.marca, 'categoria', f.categoria,
                   'categoriaSlug', f.categoria_slug,
                   'serie', f.series, 'tipo', f.product_type,
                   'imagen', f.imagen_path, 'imagenUrl', f.imagen_url,
                   'imagenAlt', f.imagen_alt) order by f.name)
            from (select * from filtrados order by name
                   limit v_por offset (v_pagina - 1) * v_por) f)
    into v_total, v_filas
    from filtrados;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'pagina', v_pagina,
    'porPagina', v_por,
    'productos', coalesce(v_filas, '[]'::jsonb));
end $function$;

/**
 * Una ficha por su slug, con sus parientes de la misma serie: es lo que hace
 * que una visita no termine en una sola página, que para posicionar importa
 * tanto como la ficha en sí.
 */
create or replace function public.catalogo_publico_producto(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v record;
begin
  select * into v
    from app.catalogo_publicable t
   where t.public_slug = btrim(coalesce(p_slug, ''))
   limit 1;

  if not found then return jsonb_build_object('encontrado', false); end if;

  return jsonb_build_object(
    'encontrado', true,
    'producto', jsonb_build_object(
      'slug', v.public_slug, 'sku', v.sku, 'nombre', v.name,
      'modelo', v.model_code, 'serie', v.series, 'tipo', v.product_type,
      'descripcion', v.description, 'atributos', v.attributes,
      'origen', v.origin_country, 'pesoG', v.weight_g, 'esKit', v.is_kit,
      'marca', v.marca, 'categoria', v.categoria, 'categoriaSlug', v.categoria_slug,
      'imagen', v.imagen_path, 'imagenUrl', v.imagen_url, 'imagenAlt', v.imagen_alt),
    'relacionados', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', r.public_slug, 'sku', r.sku, 'nombre', r.name,
               'marca', r.marca, 'categoriaSlug', r.categoria_slug,
               'imagen', r.imagen_path, 'imagenUrl', r.imagen_url)
               order by r.name)
        from (select * from app.catalogo_publicable r2
               where r2.id <> v.id
                 and (r2.series is not distinct from v.series
                      or r2.categoria_slug = v.categoria_slug)
               order by (r2.series is not distinct from v.series) desc, r2.name
               limit 8) r), '[]'::jsonb));
end $function$;

-- ── 7. Los permisos, uno por uno ───────────────────────────────────────────
--
-- `anon` puede ejecutar estas tres y nada más. Si alguien pide
-- `/rest/v1/products` sin sesión, sigue recibiendo lo mismo que antes: 401.

revoke all on function public.catalogo_publico_categorias() from public;
revoke all on function public.catalogo_publico_listar(text, text, text, integer, integer) from public;
revoke all on function public.catalogo_publico_producto(text) from public;

grant execute on function public.catalogo_publico_categorias() to anon, authenticated;
grant execute on function public.catalogo_publico_listar(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.catalogo_publico_producto(text) to anon, authenticated;
