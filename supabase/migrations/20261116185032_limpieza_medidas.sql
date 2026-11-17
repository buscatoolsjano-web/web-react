-- Limpieza de «Medida» y descripción automática para productos nuevos.
--
-- 1. app.propuestas_medida(): clasifica cada valor dudoso de «Medida» y
--    propone el correcto, con el motivo y la confianza. Sirve para aplicar lo
--    seguro (abajo) y para sacar la lista de revisión de lo demás.
--      notacion                   TX25 → T25, #2 → PH2/PZ2/SQ2/TS2 según tipo
--      mm_cargados_como_pulgadas  «24"» en una embocadura APEX 24MM → «24 mm»
--      pulgadas_cargadas_como_mm  «9 mm» en una pinza de 9 PULGADAS → «9"»
--      perfil_valor_incorrecto    punta Torx con «32 mm» (es el largo): el
--                                 tamaño se saca del nombre si está (T25)
--      numero_sin_unidad          sin tipo de producto: la unidad se saca del
--                                 nombre si el número aparece con MM o pulgadas
--    `segura` = el nombre del producto confirma la propuesta.
--
-- 2. Se aplican SÓLO las seguras de los cuatro primeros motivos. Las de
--    «numero_sin_unidad» y las que no tienen propuesta quedan para revisar.
--
-- 3. Las descripciones armadas por la migración anterior («Nombre: …») se
--    rehacen en los productos tocados, para que digan la medida nueva.
--
-- 4. Trigger: un producto nuevo (o uno al que le borran la descripción) nace
--    con la descripción concatenada.
--
-- Respaldo en app.respaldo_medidas_limpieza. Para deshacer:
--   update products p set attributes = r.attributes, description = r.description
--   from app.respaldo_medidas_limpieza r where r.id = p.id;

create or replace function app.propuestas_medida()
returns table (
  id uuid, company_id uuid, sku text, nombre text, tipo text,
  medida_actual text, largo text, motivo text, propuesta text, segura boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with perfiles(tipo, prefijo, patron) as (values
    ('Torx', 'T', '(?:\mT|TX)[- ]?0*([0-9]{1,2})\M'),
    ('Torx Plus', 'TP', '\mTP[- ]?0*([0-9]{1,2})\M'),
    ('Torx Plus (IP)', 'IP', '\mIP[- ]?0*([0-9]{1,2})\M'),
    ('Torq-Set', 'TS', '\mTS[- ]?0*([0-9]{1,2})\M'),
    ('Tri-Wing', 'TW', '\mTW[- ]?0*([0-9]{1,2})\M'),
    ('Cuadrado', 'SQ', '\mSQ[- ]?#?0*([0-9]{1,2})\M'),
    ('Phillips', 'PH', '\mPH[- ]?#?0*([0-9])\M'),
    ('Pozidrive', 'PZ', '\mPZ[- ]?#?0*([0-9])\M')
  ),
  base as (
    select p.id, p.company_id, p.sku, p.name, p.product_type tipo,
           btrim(p.attributes->>'medida') medida, p.attributes->>'largo' largo,
           upper(p.name) n, pf.prefijo, pf.patron
    from products p
    left join perfiles pf on pf.tipo = p.product_type
    where p.deleted_at is null and p.attributes ? 'medida'
  ),
  clasif as (
    select b.*,
      case
        when b.prefijo = 'T' and b.medida ~* '^TX[- ]?0*[0-9]{1,2}$' then 'notacion'
        when b.prefijo is not null and b.medida ~ '^#0*[0-9]{1,2}$' then 'notacion'
        when b.prefijo is not null and b.medida ~* ('^' || b.prefijo || '0[0-9]$') then 'notacion'
        when b.prefijo is not null and b.medida !~* ('^' || b.prefijo || '[0-9]{1,2}$') then 'perfil_valor_incorrecto'
        when b.medida ~* '^[0-9]+([.,][0-9]+)? ?mm$'
          and b.n ~ ('(^|[^0-9./])' || regexp_replace(b.medida, '[^0-9.,]', '', 'g') || ' ?(PULGADAS|PULGADA|PULG|"|'''')')
          then 'pulgadas_cargadas_como_mm'
        when b.medida ~ '"$'
          and b.n ~ ('(^|[^0-9./])' || regexp_replace(b.medida, '[^0-9./]', '', 'g') || ' ?MM')
          then 'mm_cargados_como_pulgadas'
        when b.medida ~ '^[0-9]+([.,][0-9]+)?$' then 'numero_sin_unidad'
      end motivo
    from base b
  ),
  prop as (
    select c.*,
      case c.motivo
        when 'notacion' then c.prefijo || coalesce(nullif(ltrim(regexp_replace(c.medida, '[^0-9]', '', 'g'), '0'), ''), '0')
        when 'perfil_valor_incorrecto' then c.prefijo || (regexp_match(c.n, c.patron))[1]
        when 'pulgadas_cargadas_como_mm' then regexp_replace(c.medida, '[^0-9.,]', '', 'g') || '"'
        when 'mm_cargados_como_pulgadas' then regexp_replace(c.medida, '[^0-9.]', '', 'g') || ' mm'
        when 'numero_sin_unidad' then case
            when c.n ~ ('(^|[^0-9.])' || c.medida || ' ?MM') then c.medida || ' mm'
            when c.n ~ ('(^|[^0-9./])' || c.medida || ' ?(PULGADAS|PULGADA|PULG|"|'''')') then c.medida || '"'
          end
      end propuesta
    from clasif c
    where c.motivo is not null
  )
  select id, company_id, sku, name, coalesce(tipo, '(sin tipo)'), medida, largo, motivo,
         propuesta, propuesta is not null and motivo <> 'numero_sin_unidad'
  from prop
$$;

-- ── Respaldo ─────────────────────────────────────────────────────────────────
create table if not exists app.respaldo_medidas_limpieza (
  id uuid primary key,
  company_id uuid not null,
  attributes jsonb,
  description text,
  respaldado_en timestamptz not null default now()
);

insert into app.respaldo_medidas_limpieza (id, company_id, attributes, description)
select p.id, p.company_id, p.attributes, p.description
from public.products p
join app.propuestas_medida() m on m.id = p.id
where m.segura
on conflict (id) do nothing;

-- ── Aplicar las seguras ──────────────────────────────────────────────────────
update public.products p
set attributes = jsonb_set(p.attributes, '{medida}', to_jsonb(m.propuesta))
from app.propuestas_medida() m
where m.id = p.id and m.segura;

-- ── Rehacer las descripciones armadas que mencionaban la medida vieja ────────
update public.products p
set description = app.descripcion_concatenada(p)
from app.respaldo_medidas_limpieza r
where r.id = p.id and p.description like 'Nombre: %';

-- ── Productos nuevos: nacen con descripción ──────────────────────────────────
create or replace function app.poner_descripcion_concatenada()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(btrim(new.description), '') = '' then
    new.description := app.descripcion_concatenada(new);
  end if;
  return new;
end $$;

drop trigger if exists trg_products_descripcion on public.products;
create trigger trg_products_descripcion
  before insert or update of description on public.products
  for each row execute function app.poner_descripcion_concatenada();
