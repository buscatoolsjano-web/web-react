-- Unificar encastres y atributos de texto para que los filtros tengan menos
-- opciones y se entiendan solos.
--
-- ENCASTRE = tamaño + forma, nada más: «1/4 HEX», «1/2 SQ». Antes mezclaba
-- tres cosas y por eso «1/4 HEX» aparecía partido en cinco opciones:
--   · el tamaño y la forma (lo que importa para filtrar);
--   · la forma escrita de tres maneras («1/2 SQ», «1/2 Cuadrado», «1/2»);
--   · el sistema de cambio rápido (BIT, QC con bola, con anillo, ERGO-DRIVE).
-- El sistema no se pierde: pasa al atributo nuevo `sistema` («Sistema de
-- encastre»), que se ve en la ficha pero no es un filtro más. Según ISO 1173
-- la punta C 6.3 (inserto corto, 25 mm) y la E 6.3 (con ranura y bola, más
-- larga) tienen el mismo encastre de 1/4" hexagonal: las separa el largo.
-- En SPEEDRILL la letra de la serie es el tamaño (R 1/4", J 3/8", K 3/4") y su
-- «QC» es hexagonal de cambio rápido: «3/8 QC» es 3/8 HEX.
--
-- Errores que se limpian: «14 SQ», «345 SQ», «975 SQ» (son milímetros o un
-- código, no un encastre), «-» y «Cabezal hexagonal».
--
-- Además: «NEUMATICA» → «Neumático», carcasa y ergonomía en mayúsculas →
-- normales, «Voltaje: No» fuera.
--
-- Todas las empresas. Respaldo en app.respaldo_unificar_atributos.

create table if not exists app.respaldo_unificar_atributos (
  id uuid primary key,
  company_id uuid not null,
  attributes jsonb,
  description text,
  respaldado_en timestamptz not null default now()
);

-- ── El encastre normalizado y su sistema ─────────────────────────────────────
create or replace function app.encastre_normalizado(p_valor text, p_nombre text, p_categoria text)
returns table (encastre text, sistema text)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := btrim(coalesce(p_valor, ''));
  n text := upper(coalesce(p_nombre, ''));
  m text[];
begin
  if v in ('', '-') or v ~* '^cabezal' then
    return query select null::text, null::text; return;
  end if;
  if v ~* '^1/4 HEX BIT$' then
    return query select '1/4 HEX', 'Inserto corto (C 6.3)'; return;
  end if;
  if v ~* '^1/4 HEX QC con bola$' then
    return query select '1/4 HEX', 'Con ranura y bola (E 6.3)'; return;
  end if;
  if v ~* '^1/4 HEX con anillo$' then
    return query select '1/4 HEX', 'Con anillo'; return;
  end if;
  if v ~* '^1/4 HEX QC$' then
    return query select '1/4 HEX', 'Cambio rápido (QC)'; return;
  end if;
  m := regexp_match(v, '^(\S+) QC ERGO-DRIVE$', 'i');
  if m is not null then
    return query select m[1] || ' HEX', 'Ergo-Drive'; return;
  end if;
  m := regexp_match(v, '^(\S+) QC$', 'i');
  if m is not null then
    return query select m[1] || ' HEX', 'Cambio rápido (QC)'; return;
  end if;
  m := regexp_match(v, '^(.+) Cuadrado$', 'i');
  if m is not null then
    return query select btrim(m[1]) || ' SQ', null::text; return;
  end if;
  if v ~* '^1 1/2 SQ$' then
    return query select '1-1/2 SQ', null::text; return;
  end if;
  -- Tamaño sin forma. TORERO lo dice en el modelo: …PH/…SH hexagonal,
  -- …PD/…SD/…SC cuadrado. El resto (llaves dinamométricas, TOHNICHI) es
  -- cuadrado, que es como salen todas las herramientas de torque.
  if v ~ '^(1/4|3/8|1/2|3/4|1)$' then
    if n ~ '-[0-9]+[PS]H\M' then
      return query select v || ' HEX', null::text; return;
    end if;
    return query select v || ' SQ', null::text; return;
  end if;
  -- «14 SQ», «345 SQ»: un número entero que no es 1 no es un encastre
  -- cuadrado (no existe un cuadrado de 14"). Se quita.
  if v ~ '^[0-9]+ SQ$' and v <> '1 SQ' then
    return query select null::text, null::text; return;
  end if;
  return query select v, null::text;
end $$;

-- ── El atributo nuevo, donde haga falta ──────────────────────────────────────
insert into public.product_attribute_definitions
  (company_id, key, label, data_type, is_filterable, show_in_sheet, position)
select distinct p.company_id, 'sistema', 'Sistema de encastre', 'text', false, true, 15
from public.products p
where p.attributes->>'encastre' ~* '(BIT|QC|anillo|bola|ERGO-DRIVE)$'
  and not exists (select 1 from public.product_attribute_definitions d
                  where d.company_id = p.company_id and d.key = 'sistema');

-- ── Los cambios, calculados una vez ──────────────────────────────────────────
create temporary table _cambios on commit drop as
select p.id, p.company_id, p.attributes viejo,
  (
    select
      case when x.encastre is null then a - 'encastre' else jsonb_set(a, '{encastre}', to_jsonb(x.encastre)) end
      || case when x.sistema is not null then jsonb_build_object('sistema', x.sistema) else '{}'::jsonb end
    from (select p.attributes a) aa,
         app.encastre_normalizado(p.attributes->>'encastre', p.name, null) x
  ) nuevo_encastre
from public.products p
where p.deleted_at is null and p.attributes ? 'encastre';

-- Un número tirado del encastre de un tubo («14 SQ» en un TOHNICHI SOCKET)
-- es su medida en mm: si no tenía medida, la gana.
update _cambios c
set nuevo_encastre = c.nuevo_encastre
  || jsonb_build_object('medida', (regexp_match(c.viejo->>'encastre', '^([0-9]+) SQ$'))[1] || ' mm')
from public.products p
join public.product_categories pc on pc.id = p.category_id
where p.id = c.id
  and c.viejo->>'encastre' ~ '^[0-9]+ SQ$' and c.viejo->>'encastre' <> '1 SQ'
  and not (c.viejo ? 'medida')
  and pc.name = 'Puntas y tubos'
  and (regexp_match(c.viejo->>'encastre', '^([0-9]+) SQ$'))[1]::int between 4 and 80;

delete from _cambios where nuevo_encastre = viejo;

-- Texto: mismas palabras, una sola forma.
create temporary table _texto on commit drop as
select p.id, p.company_id, p.attributes viejo,
  (p.attributes
    || case p.attributes->>'alimentacion' when 'NEUMATICA' then '{"alimentacion":"Neumático"}'::jsonb else '{}'::jsonb end
    || case p.attributes->>'carcasa'
         when 'ALUMINIO' then '{"carcasa":"Aluminio"}'::jsonb
         when 'INOXIDABLE' then '{"carcasa":"Acero inoxidable"}'::jsonb
         when 'NYLON' then '{"carcasa":"Nylon"}'::jsonb
         when 'ACERO' then '{"carcasa":"Acero"}'::jsonb
         when 'PLASTICO' then '{"carcasa":"Plástico"}'::jsonb
         when 'Doble ALUMINIO, recubierto de GOMA' then '{"carcasa":"Aluminio doble con goma"}'::jsonb
         else '{}'::jsonb end
    || case p.attributes->>'ergonomia'
         when 'ANGULAR' then '{"ergonomia":"Angular"}'::jsonb
         when 'PISTOLA' then '{"ergonomia":"Pistola"}'::jsonb
         when 'RECTO' then '{"ergonomia":"Recto"}'::jsonb
         else '{}'::jsonb end
  ) - case when p.attributes->>'voltaje' = 'No' then 'voltaje' else '' end nuevo
from public.products p
where p.deleted_at is null
  and (p.attributes->>'alimentacion' = 'NEUMATICA'
       or p.attributes->>'carcasa' in ('ALUMINIO','INOXIDABLE','NYLON','ACERO','PLASTICO','Doble ALUMINIO, recubierto de GOMA')
       or p.attributes->>'ergonomia' in ('ANGULAR','PISTOLA','RECTO')
       or p.attributes->>'voltaje' = 'No');

-- ── Respaldo y aplicación ────────────────────────────────────────────────────
insert into app.respaldo_unificar_atributos (id, company_id, attributes, description)
select p.id, p.company_id, p.attributes, p.description
from public.products p
where p.id in (select id from _cambios union select id from _texto)
on conflict (id) do nothing;

update public.products p
set attributes = c.nuevo_encastre
from _cambios c where c.id = p.id;

-- El texto se aplica sobre el estado YA actualizado (un producto puede estar
-- en los dos grupos).
update public.products p
set attributes = (p.attributes
    || case p.attributes->>'alimentacion' when 'NEUMATICA' then '{"alimentacion":"Neumático"}'::jsonb else '{}'::jsonb end
    || case p.attributes->>'carcasa'
         when 'ALUMINIO' then '{"carcasa":"Aluminio"}'::jsonb
         when 'INOXIDABLE' then '{"carcasa":"Acero inoxidable"}'::jsonb
         when 'NYLON' then '{"carcasa":"Nylon"}'::jsonb
         when 'ACERO' then '{"carcasa":"Acero"}'::jsonb
         when 'PLASTICO' then '{"carcasa":"Plástico"}'::jsonb
         when 'Doble ALUMINIO, recubierto de GOMA' then '{"carcasa":"Aluminio doble con goma"}'::jsonb
         else '{}'::jsonb end
    || case p.attributes->>'ergonomia'
         when 'ANGULAR' then '{"ergonomia":"Angular"}'::jsonb
         when 'PISTOLA' then '{"ergonomia":"Pistola"}'::jsonb
         when 'RECTO' then '{"ergonomia":"Recto"}'::jsonb
         else '{}'::jsonb end
  ) - case when p.attributes->>'voltaje' = 'No' then 'voltaje' else '' end
from _texto t where t.id = p.id;

-- Las descripciones armadas («Nombre: …») se rehacen con los valores nuevos.
update public.products p
set description = app.descripcion_concatenada(p)
from app.respaldo_unificar_atributos r
where r.id = p.id and p.description like 'Nombre: %';
