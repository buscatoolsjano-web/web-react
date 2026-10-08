-- Fase 43 · Los atributos del catálogo, en el orden en que se leen
--
-- Tres cosas, y las tres son de datos salvo una línea de función.
--
--
-- ── EL PROBLEMA ──────────────────────────────────────────────────────────
--
-- En Balanceadores se veía «Cap. máx. · Medida · Cap. mín.». Nadie eligió ese
-- orden: es el orden de claves de un objeto jsonb, que Postgres normaliza por
-- LARGO y después por bytes. `max_kg`, `medida`, `min_kg` y `modelo` miden
-- seis letras, así que salen en alfabético.
--
-- Lo peor es que la función YA ordenaba bien. Acá abajo, tal como está hoy:
--
--     SELECT coalesce(jsonb_object_agg(y.key, jsonb_build_object(…
--     FROM ( SELECT … ORDER BY d.position ) y
--
-- El `ORDER BY d.position` se escribió creyendo que sobrevivía, y
-- `jsonb_object_agg` lo tira sin decir nada: un objeto jsonb no conserva el
-- orden de inserción. Un ORDER BY que no hace nada y no avisa.
--
-- Por eso el arreglo no es ordenar mejor: es dejar de usar un objeto. La
-- función pasa a devolver un ARRAY, donde el orden es parte de la estructura y
-- no puede volver a perderse en silencio.
--
--
-- ── DE DÓNDE SALE EL ORDEN ───────────────────────────────────────────────
--
-- De las dos webs que ya muestran este catálogo:
--
--   · La web vieja tiene el mapa explícito
--     `CATEGORY_FILTERS['balanceador'] = ['min_kg','max_kg','carcasa',
--     'longitud','eslinga']` — mínima antes que máxima, carcasa antes que
--     cable, y sin «medida».
--   · torquetools.es lista «Par mínimo» y después «Par máximo» en
--     torquímetros, y abre la ficha del GEDORE TF-K400 con el rango de par,
--     que es lo que define a la herramienta.
--
-- (La ficha de balanceador de torquetools pone máxima antes que mínima, pero
-- esa página es un volcado crudo del archivo y lo dice ella misma: «datos
-- transcritos de un archivo aportado». No se tomó como orden.)
--
-- De ahí sale una sola regla de lectura, que es la de un catálogo de papel:
--
--     rango que define la herramienta → cómo se conecta → medidas propias
--     → prestaciones → materiales → físicos y embalaje → residuo
--
-- Un solo orden GLOBAL alcanza para las siete categorías. Se comprobó una por
-- una: ninguna necesita dos atributos en orden distinto del de otra, así que
-- no hace falta una posición por categoría ni una tabla nueva.
--
--
-- ── 1 · LAS POSICIONES ───────────────────────────────────────────────────

begin;

-- ESTA BASE TIENE DOS EMPRESAS. `torquetools` todavía no tiene definiciones
-- ni balanceadores, así que hoy nada de esto la tocaría — pero está en armado,
-- y un UPDATE sin `company_id` es una bomba de tiempo que explota el día que
-- cargue sus datos. Todo lo de abajo va acotado a Buscatools.
update product_attribute_definitions d
   set position = v.pos
  from (values
    -- El rango primero: es lo que define la herramienta y lo que se busca.
    -- Mínimo antes que máximo, que es como se lee un rango y como lo tienen
    -- las dos webs. Los dos pares nunca conviven en la misma categoría
    -- —capacidad es de balanceadores, torque de herramientas— así que entre
    -- pares el orden da igual; dentro de cada par, no.
    ('min_kg', 1), ('max_kg', 2), ('torq_min', 3), ('torq_max', 4),

    -- Después, cómo se conecta. El encastre va antes que las medidas propias
    -- porque es lo que decide si la herramienta sirve: una punta de 10 mm con
    -- encastre 1/4 QC no reemplaza a una de 10 mm con 3/8 SQ.
    ('encastre', 5),

    -- Y recién ahí las medidas del propio producto.
    ('medida', 6), ('largo', 7),

    -- Prestaciones.
    ('rpm', 8), ('voltaje', 9), ('alimentacion', 10),

    -- Lo propio del balanceador. `carcasa` antes que `longitud` porque así lo
    -- tiene la web vieja, y esas dos claves no aparecen en ninguna otra
    -- categoría, así que respetarla no le cuesta nada a las demás.
    ('carcasa', 11), ('longitud', 12), ('eslinga', 13),

    -- Ergonomía y forma.
    ('ergonomia', 14), ('sufijos', 15),

    -- Físicos y embalaje: describen al producto, pero no es lo que se compara.
    ('peso_kg', 16), ('dim_balanceador', 17), ('dim_caja', 18), ('peso_embalado_kg', 19),

    -- Y al final el residuo de la importación.
    ('longitud_raw', 20), ('catalogo_id', 21), ('catalogo_pagina', 22),
    ('codigo', 23), ('categoria_full', 24), ('marca_disp', 25), ('modelo', 26)
  ) as v(key, pos)
 where d.key = v.key
   and d.company_id = (select id from companies where slug = 'buscatools');


-- ── 2 · LO QUE NO ES UNA CARACTERÍSTICA ──────────────────────────────────
--
-- Seis claves son residuo de la importación y se estaban listando en la ficha
-- del producto como si fueran datos técnicos. «Modelo» y «Marca (display)»
-- repiten columnas que ya están en la tabla; las otras cuatro son plomería.
--
-- No se borran: `catalogo_id` y `catalogo_pagina` los usa la hoja de catálogo
-- para encontrar la página escaneada. Lo que se marca es que no se MUESTRAN
-- como características.
--
-- Columna nueva y no una lista de claves en el frontend, porque esto es un
-- hecho del atributo y no de una pantalla: la ficha, la descripción de una
-- línea de cotización y la impresión tienen que coincidir.
alter table product_attribute_definitions
  add column if not exists show_in_sheet boolean not null default true;

comment on column product_attribute_definitions.show_in_sheet is
  'Fase 43: false = residuo de la importación, no se lista como característica del producto. El dato se conserva y se sigue pudiendo usar (la hoja de catálogo usa catalogo_id/catalogo_pagina).';

update product_attribute_definitions
   set show_in_sheet = false
 where key in ('catalogo_id', 'catalogo_pagina', 'codigo',
               'categoria_full', 'marca_disp', 'modelo')
   and company_id = (select id from companies where slug = 'buscatools');


-- ── 3 · «MEDIDA» EN BALANCEADORES ────────────────────────────────────────
--
-- En los 376 balanceadores, `medida` guarda el MISMO número que `max_kg`:
--
--     {"max_kg": 22, "medida": "22", "min_kg": 18, …}
--
-- Se verificaron los 376, no una muestra: 376 iguales, 0 distintos, 0 sin el
-- par. Es una copia que dejó la importación, y encima se colaba entre la
-- mínima y la máxima por el orden alfabético, que es como se notó.
--
-- Hay que borrar el DATO y no sólo el vínculo con la categoría: `catalog_facets`
-- saca los atributos del jsonb de cada producto y nunca consulta
-- `product_attribute_categories`, así que mientras el valor esté cargado la
-- columna aparece igual.

-- Respaldo antes de tocar nada. No es ceremonia: es lo que permite deshacerlo
-- con un update si mañana resulta que «medida» quería decir otra cosa.
create table if not exists public.respaldo_fase43_medida_balanceador (
  product_id uuid primary key,
  sku        text        not null,
  medida     jsonb       not null,
  max_kg     jsonb,
  guardado   timestamptz not null default now()
);

insert into public.respaldo_fase43_medida_balanceador (product_id, sku, medida, max_kg)
select p.id, p.sku, p.attributes -> 'medida', p.attributes -> 'max_kg'
  from products p
  join product_categories c on c.id = p.category_id
 where c.slug = 'balanceador'
   and p.company_id = (select id from companies where slug = 'buscatools')
   and p.attributes ? 'medida'
on conflict (product_id) do nothing;

-- La comprobación es parte de la migración y no una nota al pie: si aparece
-- un balanceador donde `medida` NO es la máxima, esto corta y no se borra nada.
do $$
declare n_distintos int;
begin
  select count(*) into n_distintos
    from products p
    join product_categories c on c.id = p.category_id
   where c.slug = 'balanceador'
     and p.company_id = (select id from companies where slug = 'buscatools')
     and p.attributes ? 'medida'
     and (p.attributes -> 'max_kg') is distinct from to_jsonb((p.attributes ->> 'medida')::numeric);
  if n_distintos > 0 then
    raise exception 'fase43: % balanceador(es) tienen «medida» distinta de «max_kg». No se borra nada: hay que mirarlos uno por uno.', n_distintos;
  end if;
end $$;

update products p
   set attributes = p.attributes - 'medida'
  from product_categories c
 where c.id = p.category_id
   and c.slug = 'balanceador'
   and p.company_id = (select id from companies where slug = 'buscatools')
   and p.attributes ? 'medida';

-- Y el vínculo con la categoría, que es lo que gobierna qué campos ofrece el
-- formulario de alta. Sin esto, cargar un balanceador nuevo seguiría pidiendo
-- una «Medida» que no existe para esa familia.
delete from product_attribute_categories pac
 using product_attribute_definitions d, product_categories c
 where pac.attribute_definition_id = d.id
   and pac.category_id = c.id
   and d.key = 'medida'
   and c.slug = 'balanceador'
   and pac.company_id = (select id from companies where slug = 'buscatools');


-- ── 4 · QUE EL ORDEN SOBREVIVA AL VIAJE ──────────────────────────────────
--
-- `attributes` deja de ser un objeto jsonb y pasa a ser un array ordenado.
-- Cada elemento lleva su `key` adentro y además su `position`, para que el
-- cliente pueda volver a ordenar si algún día alguien reordena el array.
--
-- El reemplazo se hace sobre `pg_get_functiondef` y no copiando las 200 líneas
-- de la función: dos migraciones anteriores ya la parchearon y copiar el texto
-- del repo la haría retroceder.
do $$
declare d text; a_viejo text; b_viejo text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'catalog_facets';

  a_viejo := 'SELECT coalesce(jsonb_object_agg(y.key, jsonb_build_object(' || E'\n' ||
             '             ''label'', y.label, ''unit'', y.unit, ''values'', y.vals)), ''{}''::jsonb) AS j';
  b_viejo := '      SELECT ap.key, d.label, d.unit,' || E'\n';

  if position(a_viejo in d) = 0 then
    raise notice 'fase43: catalog_facets ya devuelve los atributos como array';
    return;
  end if;
  if position(b_viejo in d) = 0 then
    raise exception 'fase43: no se encontró el SELECT interno de f_attr. Mirar pg_get_functiondef a mano antes de seguir.';
  end if;

  -- `d.position` tiene que salir en el SELECT: hoy sólo está en el GROUP BY,
  -- que alcanzaba para el ORDER BY que no servía pero no para llevarlo afuera.
  d := replace(d, b_viejo, '      SELECT ap.key, d.label, d.unit, d.position,' || E'\n');

  d := replace(d, a_viejo,
    'SELECT coalesce(jsonb_agg(jsonb_build_object(' || E'\n' ||
    '             ''key'', y.key, ''label'', y.label, ''unit'', y.unit,' || E'\n' ||
    '             ''position'', y.position, ''values'', y.vals)' || E'\n' ||
    '             ORDER BY y.position, y.key), ''[]''::jsonb) AS j');

  execute d;
end $$;

commit;


-- ── COMPROBACIÓN ─────────────────────────────────────────────────────────
--
-- Con <empresa> = el id de Buscatools y <balanceador> = el de la categoría:
--
--   select jsonb_path_query_array(
--            public.catalog_facets('<empresa>', null, '<balanceador>'::uuid),
--            '$.attributes[*].key');
--
--   esperado → ["min_kg", "max_kg", "carcasa", "longitud", "eslinga"]
--              el orden de la web vieja, y sin «medida»
--
--   select jsonb_path_query_array(
--            public.catalog_facets('<empresa>', null, '<puntas>'::uuid),
--            '$.attributes[*].key');
--
--   esperado → ["encastre", "medida", "largo"]
--
-- Para deshacer el punto 3:
--
--   update products p set attributes = p.attributes || jsonb_build_object('medida', r.medida)
--     from public.respaldo_fase43_medida_balanceador r where r.product_id = p.id;
