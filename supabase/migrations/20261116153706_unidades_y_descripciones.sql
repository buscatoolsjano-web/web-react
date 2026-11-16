-- Unidades en «Medida» y descripciones armadas a partir de los datos.
--
-- 1. RESPALDO. Antes de tocar nada, la fila vieja (atributos y descripción)
--    de cada producto que cambia, en app.respaldo_unidades_descripciones. Para
--    deshacer: update products p set attributes = r.attributes,
--    description = r.description from app.respaldo_unidades_descripciones r
--    where r.id = p.id;
--
-- 2. «sufijos» SE DECLARA. Está cargado en ~6.600 productos y se muestra en la
--    web como «Variante», pero nunca se declaró en
--    product_attribute_definitions: cualquier edición de los atributos de esos
--    productos la rechazaba el trigger de validación.
--
-- 3. MEDIDA CON UNIDAD. Era el único atributo de medida sin unidad, y no puede
--    tenerla en la definición porque es mixto (mm, pulgadas, perfiles). Los
--    números sueltos se completan según el tipo de producto:
--      - milímetros: Allen, embocadura, cardánico, adaptador, bi-hexagonal,
--        nutsetter, plana, hexagonal  →  «13» pasa a «13 mm»
--      - tamaño de perfil, con el prefijo con que lo escribe la industria:
--        Torx T10, Torx Plus TP40, Torx Plus (IP) IP25, Torq-Set TS6,
--        Tri-Wing TW4, cuadrada SQ2, Phillips PH2, Pozidriv PZ2
--    Los de tipo desconocido no se tocan: no hay forma de saber qué son.
--    Los otros atributos numéricos (largo, torque, capacidad, rpm, cable) ya
--    tienen la unidad en su definición y se guardan como número para que
--    funcionen los filtros por rango: la unidad se agrega al mostrarlos.
--
-- 4. DESCRIPCIONES. Las vacías o iguales al nombre pasan a
--    «Nombre: …. Modelo: …. <Atributo>: <valor con unidad>. …», con los
--    atributos en el orden de su definición. Las que tienen texto propio no
--    se tocan. La función queda para usarla con productos nuevos.
--
-- Todo acotado por empresa: cada producto usa las definiciones de SU empresa.

-- ── 1. Respaldo ──────────────────────────────────────────────────────────────
create table if not exists app.respaldo_unidades_descripciones (
  id uuid primary key,
  company_id uuid not null,
  attributes jsonb,
  description text,
  respaldado_en timestamptz not null default now()
);

insert into app.respaldo_unidades_descripciones (id, company_id, attributes, description)
select p.id, p.company_id, p.attributes, p.description
from public.products p
where p.deleted_at is null
  and (
    p.attributes->>'medida' ~ '^[0-9]+([.,][0-9]+)?$'
    or coalesce(btrim(p.description), '') = ''
    or lower(btrim(p.description)) = lower(btrim(p.name))
  )
on conflict (id) do nothing;

-- ── 2. «sufijos» declarado donde se usa ──────────────────────────────────────
insert into public.product_attribute_definitions (company_id, key, label, data_type, is_filterable, position)
select distinct p.company_id, 'sufijos', 'Variante', 'text', false, 90
from public.products p
where p.attributes ? 'sufijos'
  and not exists (
    select 1 from public.product_attribute_definitions d
    where d.company_id = p.company_id and d.key = 'sufijos'
  );

-- ── 3. Medida con unidad ─────────────────────────────────────────────────────
update public.products p
set attributes = jsonb_set(
      p.attributes,
      '{medida}',
      to_jsonb(
        case p.product_type
          when 'Torx' then 'T'
          when 'Torx Plus' then 'TP'
          when 'Torx Plus (IP)' then 'IP'
          when 'Torq-Set' then 'TS'
          when 'Tri-Wing' then 'TW'
          when 'Cuadrado' then 'SQ'
          when 'Phillips' then 'PH'
          when 'Pozidrive' then 'PZ'
          else ''
        end
        || btrim(p.attributes->>'medida')
        || case when p.product_type in (
             'Allen', 'Embocadura', 'Cardánico', 'Adaptador', 'Bi-hexagonal',
             'Nutsetter', 'Plana', 'Hexagonal') then ' mm' else '' end
      )
    )
where p.deleted_at is null
  and p.attributes->>'medida' ~ '^[0-9]+([.,][0-9]+)?$'
  and p.product_type in (
    'Allen', 'Embocadura', 'Cardánico', 'Adaptador', 'Bi-hexagonal', 'Nutsetter',
    'Plana', 'Hexagonal', 'Torx', 'Torx Plus', 'Torx Plus (IP)', 'Torq-Set',
    'Tri-Wing', 'Cuadrado', 'Phillips', 'Pozidrive');

-- ── 4. Descripción concatenada ───────────────────────────────────────────────
-- Un valor de atributo como texto, con la unidad de su definición si el valor
-- no la trae ya («20V» con unidad V queda «20V», no «20V V»).
create or replace function app.valor_de_atributo(p_valor jsonb, p_unidad text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with t as (
    select case jsonb_typeof(p_valor)
      when 'string' then btrim(p_valor #>> '{}')
      when 'number' then p_valor #>> '{}'
      when 'boolean' then case when (p_valor #>> '{}')::boolean then 'sí' else 'no' end
      when 'array' then (
        select string_agg(btrim(x #>> '{}'), ', ')
        from jsonb_array_elements(p_valor) x
        where btrim(coalesce(x #>> '{}', '')) <> ''
      )
      else null
    end as v
  )
  select case
    when v is null or v = '' then null
    when p_unidad is null or p_unidad = '' then v
    when v ~* ('(^|[0-9 ])' || p_unidad || '$') then v
    else v || ' ' || p_unidad
  end
  from t
$$;

-- «Nombre: X. Modelo: Y. Encastre: 1/4 HEX. Medida: 13 mm. Largo: 50 mm.»
-- Sin las claves internas (catálogo de origen, página, texto original,
-- categoría completa) y sin repetir el modelo.
create or replace function app.descripcion_concatenada(p public.products)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select concat_ws('. ',
    'Nombre: ' || btrim(p.name),
    'Modelo: ' || coalesce(nullif(btrim(p.model_code), ''), nullif(btrim(p.attributes->>'modelo'), '')),
    (
      select string_agg(
               case when e.key = 'marca_disp' then 'Marca' else coalesce(d.label, e.key) end
               || ': ' || app.valor_de_atributo(e.value, d.unit),
               '. ' order by coalesce(d.position, 999), e.key)
      from jsonb_each(coalesce(p.attributes, '{}'::jsonb)) e
      left join product_attribute_definitions d
        on d.company_id = p.company_id and d.key = e.key
      where e.key not in ('catalogo_id', 'catalogo_pagina', 'longitud_raw', 'categoria_full', 'modelo')
        and app.valor_de_atributo(e.value, d.unit) is not null
    )
  ) || '.'
$$;

update public.products p
set description = app.descripcion_concatenada(p)
where p.deleted_at is null
  and (coalesce(btrim(p.description), '') = '' or lower(btrim(p.description)) = lower(btrim(p.name)));
