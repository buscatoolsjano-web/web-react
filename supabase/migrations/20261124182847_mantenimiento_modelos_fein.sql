-- Mantenimiento: catálogo de modelos (FEIN AccuTec) con sus especificaciones
-- y accesorios, traído del sitio viejo del taller (mantenimiento.buscatool.com,
-- «Modelos FEIN»).
--
-- Para qué sirve en el ERP:
--   · La pestaña Torque muestra el rango del modelo del equipo y avisa si el
--     nominal pedido está fuera de lo que la herramienta puede dar.
--   · Propone LCI/LCS con la precisión del modelo (±10 %, Cmk > 1,67 según
--     ISO 5393 / VDI 2647) a partir del nominal.
--   · La pantalla de modelos muestra especificaciones, accesorios con su código
--     FEIN y cuántos equipos de la flota son de cada modelo.
--
-- El cruce con los equipos es por el modelo normalizado (sin «FEIN», sin
-- espacios, sin «-PC»): en la base está escrito de muchas formas.
-- Los datos se cargan sólo en Buscatools: las empresas no se pisan.

create table if not exists public.maintenance_models (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  brand             text not null default 'FEIN',
  code              text not null,
  family            text,
  description       text,
  part_number       text,
  torque_min        numeric not null check (torque_min > 0),
  torque_max        numeric not null,
  accuracy_pct      numeric not null default 10 check (accuracy_pct > 0 and accuracy_pct < 100),
  speed             text,
  factory_speed     text,
  weight            text,
  battery           text,
  accuracy          text,
  programming       text,
  typical_use       text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (company_id, code),
  check (torque_max >= torque_min)
);

create table if not exists public.maintenance_accessories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id),
  code        text not null,
  name        text not null,
  part_number text,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.maintenance_model_accessories (
  model_id     uuid not null references public.maintenance_models (id) on delete cascade,
  accessory_id uuid not null references public.maintenance_accessories (id) on delete cascade,
  primary key (model_id, accessory_id)
);

alter table public.maintenance_models enable row level security;
alter table public.maintenance_accessories enable row level security;
alter table public.maintenance_model_accessories enable row level security;
revoke all on public.maintenance_models, public.maintenance_accessories, public.maintenance_model_accessories from anon;
revoke insert, update, delete on public.maintenance_models, public.maintenance_accessories, public.maintenance_model_accessories from authenticated;
grant select on public.maintenance_models, public.maintenance_accessories, public.maintenance_model_accessories to authenticated;

drop policy if exists mm_select on public.maintenance_models;
create policy mm_select on public.maintenance_models for select to authenticated
  using (company_id = any (app.current_maintenance_company_ids()));
drop policy if exists macc_select on public.maintenance_accessories;
create policy macc_select on public.maintenance_accessories for select to authenticated
  using (company_id = any (app.current_maintenance_company_ids()));
drop policy if exists mma_select on public.maintenance_model_accessories;
create policy mma_select on public.maintenance_model_accessories for select to authenticated
  using (exists (select 1 from public.maintenance_models m
                  where m.id = model_id and m.company_id = any (app.current_maintenance_company_ids())));

-- ── Carga: Buscatools ───────────────────────────────────────────────────────
do $$
declare c uuid := 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c';
begin
  if not exists (select 1 from companies where id = c) then return; end if;

  insert into maintenance_models (company_id, code, family, description, part_number, torque_min, torque_max,
                                  speed, factory_speed, weight, battery, accuracy, programming, typical_use)
  values
   (c,'ASM18-3','ASM','Atornilladora con empuñadura central','7 112 77 60 00 0',0.5,3,'110–1200 rpm','600 rpm','0,8 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Uniones de baja carga, electrónica, pequeñas fijaciones'),
   (c,'ASM18-8','ASM','Atornilladora con empuñadura central','7 112 78 60 00 0',1,8,'110–1200 rpm','600 rpm','0,8 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Ensambles medianos, autopartes, electrodomésticos'),
   (c,'ASM18-12','ASM','Atornilladora con empuñadura central','7 112 79 60 00 0',4,12,'80–900 rpm','450 rpm','0,8 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Líneas de ensamble industrial, fijaciones críticas'),
   (c,'ASW18-6','ASW','Atornilladora angular','7 112 66 60 00 0',1.2,6,'100–1100 rpm','570 rpm','1 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Accesos difíciles, torques pequeños con cabezal angular'),
   (c,'ASW18-12','ASW','Atornilladora angular','7 112 68 60 00 0',3,12,'75–850 rpm','430 rpm','1 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Ensambles medianos en accesos reducidos'),
   (c,'ASW18-18','ASW','Atornilladora angular','7 112 70 60 00 0',6,18,'65–765 rpm','375 rpm','1,2 kg (sin batería)','MultiVolt 12–18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Líneas industriales, fijaciones medianas con cabezal angular'),
   (c,'ASW18-30','ASW','Atornilladora angular','7 112 62 60 00 0',12,30,'30–357 rpm','180 rpm','1,5 kg (sin batería)','18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Ensamble automotriz, maquinaria pesada'),
   (c,'ASW18-45','ASW','Atornilladora angular','7 112 63 60 00 0',20,45,'25–264 rpm','130 rpm','1,65 kg (sin batería)','18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Fijaciones críticas de alta carga, montajes industriales'),
   (c,'ASW18-60','ASW','Atornilladora angular','7 112 64 60 00 0',25,60,'20–196 rpm','100 rpm','1,65 kg (sin batería)','18 V','Cmk > 1,67 ±10 % (ISO 5393 / VDI 2647)','ParameterControl (hasta 7 pasos)','Torques elevados, estructuras, montajes críticos')
  on conflict (company_id, code) do nothing;

  insert into maintenance_accessories (company_id, code, name, part_number) values
   (c,'ACC-001','Protector de carcasa ASM 18','3 217 40 28 01 0'),
   (c,'ACC-002','Soporte de máquina ASM/ASW (todos los modelos)','3 21 26 012 01 0'),
   (c,'ACC-003','Herramienta de ajuste (todos los modelos AccuTec)','3 21 23 002 00 6'),
   (c,'ACC-004','Casquillo de codificación (mezcla de colores, x7)','3 05 01 352 02 0'),
   (c,'ACC-005','Casquillo de codificación negro (x10)','3 05 01 352 01 0'),
   (c,'ACC-006','Casquillo de codificación gris (x10)','3 05 01 353 01 0'),
   (c,'ACC-007','Casquillo de codificación verde (x10)','3 05 01 354 01 0'),
   (c,'ACC-008','Casquillo de codificación azul (x10)','3 05 01 355 01 0'),
   (c,'ACC-009','Casquillo de codificación rojo (x10)','3 05 01 356 01 0'),
   (c,'ACC-010','Casquillo de codificación amarillo (x10)','3 05 01 358 01 0'),
   (c,'ACC-011','Casquillo de codificación naranja (x10)','3 05 01 357 01 0'),
   (c,'ACC-020','Protector de carcasa ASW 18','3 21 74 024 01 0'),
   (c,'ACC-021','Cabezal angular Quick-IN hasta 12 Nm — hexágono interior (ASW18-6/12)','9 01 02 012 01 0'),
   (c,'ACC-022','Cabezal angular Quick-IN hasta 12 Nm — cuadrado ext. 3/8" (ASW18-6/12)','9 01 02 013 01 0'),
   (c,'ACC-023','Cabezal angular Quick-IN hasta 12 Nm — cuadrado ext. 1/4" (ASW18-6/12)','9 01 02 014 01 0'),
   (c,'ACC-024','Cabezal angular Quick-IN hasta 45 Nm — cuadrado ext. 3/8" (ASW18-30/45)','9 01 02 015 02 0'),
   (c,'ACC-025','Cabezal angular Quick-IN hasta 60 Nm — cuadrado ext. 1/2" (ASW18-60)','9 01 02 016 02 0'),
   (c,'ACC-026','Cabezal angular Quick-IN hasta 18 Nm — cuadrado ext. 3/8" (ASW18-18)','9 01 02 017 01 0'),
   (c,'ACC-027','Protector cabezal angular 30/45 Nm (ASW18-30/45)','3 21 74 022 01 0'),
   (c,'ACC-028','Protector cabezal angular 60 Nm (ASW18-60)','3 21 74 021 01 0'),
   (c,'ACC-029','Protector cabezal angular hasta 12 Nm (ASW18-6/12/18)','3 21 74 023 01 0'),
   (c,'ACC-030','Llave para tuercas ranuradas — fijación cabezal angular (ASW18-18/30/45/60)','6 29 08 014 00 0'),
   (c,'ACC-031','Prolongación ASW 18 (ASW18-30/45/60)','6 42 03 005 01 0'),
   (c,'ACC-040','Batería Li-Ion 18 V / 6 Ah (SafetyCell FEIN)','9 26 04 175 02 0'),
   (c,'ACC-041','Batería Li-Ion 18 V / 3 Ah (SafetyCell FEIN)','9 26 04 182 02 0'),
   (c,'ACC-042','Batería Li-Ion 12 V / 3 Ah (SafetyCell FEIN)','9 26 04 183 02 0'),
   (c,'ACC-043','Batería Li-Ion 12 V / 6 Ah (SafetyCell FEIN)','9 26 04 184 02 0'),
   (c,'ACC-044','Cargador rápido ALG 80 — 12/14/18 V, 8 A (carga en 26–38 min)','9 26 04 180 01 0'),
   (c,'ACC-050','Adaptador de programación ParameterControl USB (todos los modelos)','9 26 04 163 02 0'),
   (c,'ACC-051','Funda protectora batería 18 V / 6 Ah','3 21 74 019 01 0'),
   (c,'ACC-052','Funda protectora batería 18 V / 3 Ah','3 21 74 020 01 0')
  on conflict (company_id, code) do nothing;

  insert into maintenance_model_accessories (model_id, accessory_id)
  select m.id, a.id
    from (values
      ('ASM18-3',  'ACC-001,ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-040,ACC-041,ACC-042,ACC-043,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASM18-8',  'ACC-001,ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-040,ACC-041,ACC-042,ACC-043,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASM18-12', 'ACC-001,ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-040,ACC-041,ACC-042,ACC-043,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-6',  'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-021,ACC-022,ACC-023,ACC-029,ACC-040,ACC-041,ACC-042,ACC-043,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-12', 'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-021,ACC-022,ACC-023,ACC-029,ACC-040,ACC-041,ACC-042,ACC-043,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-18', 'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-026,ACC-029,ACC-030,ACC-040,ACC-041,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-30', 'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-024,ACC-027,ACC-030,ACC-031,ACC-040,ACC-041,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-45', 'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-024,ACC-027,ACC-030,ACC-031,ACC-040,ACC-041,ACC-044,ACC-050,ACC-051,ACC-052'),
      ('ASW18-60', 'ACC-002,ACC-003,ACC-004,ACC-005,ACC-006,ACC-007,ACC-008,ACC-009,ACC-010,ACC-011,ACC-020,ACC-025,ACC-028,ACC-030,ACC-031,ACC-040,ACC-041,ACC-044,ACC-050,ACC-051,ACC-052')
    ) v(modelo, accs)
    cross join lateral unnest(string_to_array(v.accs, ',')) as acc(code)
    join maintenance_models m on m.company_id = c and m.code = v.modelo
    join maintenance_accessories a on a.company_id = c and a.code = acc.code
  on conflict do nothing;
end $$;
