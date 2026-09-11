-- ###########################################################################
-- FASE 7 · MANTENIMIENTO — SQL aplicado
--
-- Generado desde las migraciones realmente ejecutadas contra
-- uaxcfufvapzulqvynanp. Es la referencia canónica del schema del módulo.
-- ###########################################################################

-- ===========================================================================
-- fase7_mantenimiento_tablas
-- ===========================================================================

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO — Entrega 1 (1/3): cambios mínimos, helpers y tablas
-- ===========================================================================
--
-- No se migra un solo dato del legacy: los 4 registros que existen son de
-- prueba (identificador «Prueba», serie «123456») y quedan clasificados
-- TEST / NON_PRODUCTION. Esto es una migración de FUNCIONALIDAD, no de datos.

-- ── 1 · Tres cambios sobre lo que ya existe ────────────────────────────────

-- 1.1 attachments: dos tipos de entidad nuevos, sin tabla de archivos paralela.
alter table attachments drop constraint attachments_entity_type_check;
alter table attachments add constraint attachments_entity_type_check
  check (entity_type = any (array[
    'quote','purchase_order','order','delivery','invoice','payment','customer',
    'goods_receipt','supplier_invoice','supplier',
    'maintenance_asset','maintenance_order']));

-- La policy ya estaba partida por entity_type desde la entrega 2 de Compras:
-- los adjuntos de Mantenimiento entran por la rama restrictiva.
drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments for select using (
  case
    when entity_type = any (array['supplier','purchase_order','goods_receipt',
                                  'supplier_invoice',
                                  'maintenance_asset','maintenance_order'])
      then company_id in (select unnest(app.current_writer_company_ids()))
    else company_id in (select unnest(app.current_internal_company_ids()))
  end);

-- 1.2 stock_movements: UN valor nuevo. Ninguno de los ocho que había sirve —
-- `sale_delivery` es una venta, `adjustment` taparía el motivo y
-- `transfer_out` implica otro depósito.
alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = any (array[
    'opening_balance','purchase_receipt','sale_delivery','adjustment',
    'transfer_in','transfer_out','return_in','return_out',
    'service_consumption']));

-- 1.3 document_sequences: dos filas por empresa, con la misma forma que las
-- ocho que ya existen (prefix = series_code, padding 5, is_default). Sin DDL.
insert into document_sequences (company_id, doc_type, prefix, padding,
                                next_number, series_code, is_default)
select c.id, t.doc_type, t.prefijo, 5, 1, t.prefijo, true
  from companies c,
       (values ('maintenance_asset','EQ'), ('maintenance_order','OS'))
       as t(doc_type, prefijo)
on conflict do nothing;

-- ── 2 · Helpers de RLS ─────────────────────────────────────────────────────
--
-- Hoy los dos devuelven lo mismo: admin + employee. `technician` NO entra en
-- v1: el rol existe en el CHECK de company_memberships pero tiene 0 miembros,
-- y el legacy trataba igual a los seis de su lista blanca, así que no hay
-- evidencia de un rol técnico acotado. Cuando exista alguien con ese rol y un
-- flujo real, el de lectura suma una línea.

create or replace function app.current_maintenance_company_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id), '{}') from company_memberships
   where user_id = auth.uid() and status = 'active'
     and role in ('admin','employee');
$$;

create or replace function app.current_maintenance_writer_ids()
returns uuid[] language sql stable security definer
set search_path to 'public','pg_temp' as $$
  select coalesce(array_agg(company_id), '{}') from company_memberships
   where user_id = auth.uid() and status = 'active'
     and role in ('admin','employee');
$$;

-- ── 3 · Las ocho tablas ────────────────────────────────────────────────────

-- 3.1 Puntos de revisión. Configurables por empresa y no un CHECK fijo: las
-- ocho partes del legacy son de un atornillador FEIN, y el schema es
-- multiempresa desde el día uno.
create table maintenance_check_points (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  key         text not null,
  label       text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, key)
);

-- 3.2 Equipos.
--
-- `owner_customer_id` es NULLABLE y representa el dueño ACTUAL. La orden
-- guarda su propio `customer_id` congelado: si el equipo cambia de manos, las
-- órdenes viejas siguen diciendo a quién se le hizo el trabajo.
create table maintenance_assets (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id),
  reference          text not null,
  owner_customer_id  uuid references customers(id),
  product_id         uuid references products(id),
  delivery_serial_id uuid references delivery_serials(id),
  serial_number      text,
  -- Normalizado para BUSCAR y para DETECTAR duplicados. El índice NO es único:
  -- el legacy nunca garantizó el serial y bloquear un alta legítima por una
  -- regla que no existía sería inventarla.
  serial_normalized  text generated always as (
                       nullif(upper(regexp_replace(
                         coalesce(serial_number,''), '[^A-Za-z0-9]', '', 'g')), '')
                     ) stored,
  brand_id           uuid references brands(id),
  brand_text         text,
  model_text         text,
  asset_type         text,
  identifier         text,
  city               text,
  state              text,
  warranty_start     date,
  warranty_end       date,
  under_contract     boolean not null default false,
  notes              text,
  deleted_at         timestamptz,
  deleted_by         uuid references profiles(id),
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references profiles(id),
  updated_at         timestamptz not null default now(),
  unique (company_id, reference),
  constraint chk_ma_garantia check (
    warranty_end is null or warranty_start is null or warranty_end >= warranty_start)
);
create index idx_ma_serial   on maintenance_assets (company_id, serial_normalized)
  where serial_normalized is not null;
create index idx_ma_customer on maintenance_assets (company_id, owner_customer_id)
  where owner_customer_id is not null;
create index idx_ma_product  on maintenance_assets (product_id) where product_id is not null;
create index idx_ma_vivos    on maintenance_assets (company_id, reference)
  where deleted_at is null;

-- 3.3 Órdenes de servicio.
create table maintenance_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  number        text not null,
  series_code   text not null default 'OS',
  asset_id      uuid not null references maintenance_assets(id),
  -- Congelado al ingresar. NUNCA se reescribe, ni aunque el equipo se venda.
  customer_id   uuid not null references customers(id),

  status        text not null default 'open'
                check (status in ('open','closed','cancelled')),
  stage         text not null default 'diagnosis'
                check (stage in ('diagnosis','quotation','repair','torque','closing')),
  on_hold       boolean not null default false,
  on_hold_since timestamptz,

  service_type     text not null default 'corrective'
                   check (service_type in ('corrective','preventive','general_review')),
  entry_reason     text,
  visual_condition text,
  technician_id    uuid references profiles(id),
  received_by      uuid references profiles(id),
  received_at      date not null default current_date,

  diagnosis_notes text,
  diagnosed_at    date,
  diagnosed_by    uuid references profiles(id),

  quote_status    text not null default 'pending'
                  check (quote_status in ('pending','approved','rejected')),
  quote_currency  text references currencies(code),
  quote_contact   text,
  quote_notes     text,
  quote_approved_at      date,
  -- Quién aprueba DEL LADO DEL CLIENTE: es un nombre, no un usuario nuestro.
  quote_approved_by_name text,
  quote_subtotal  numeric(18,4) not null default 0,
  quote_total     numeric(18,4) not null default 0,

  repair_required boolean not null default true,
  repair_notes    text,
  pending_parts   text,
  repaired_at     date,
  repaired_by     uuid references profiles(id),
  labour_hours    numeric(10,2) check (labour_hours is null or labour_hours >= 0),

  torque_required boolean not null default true,
  torque_lsl      numeric(12,4),
  torque_nominal  numeric(12,4),
  torque_usl      numeric(12,4),
  torque_at       date,
  torque_by       uuid references profiles(id),

  next_preventive_date date,
  delivered_at    date,
  closing_notes   text,
  closed_at       timestamptz,
  closed_by       uuid references profiles(id),

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),

  unique (company_id, number),
  constraint chk_mo_fechas check (delivered_at is null or delivered_at >= received_at),
  constraint chk_mo_torque_rango check (
    torque_lsl is null or torque_usl is null or torque_usl >= torque_lsl),
  -- Las tres situaciones de una etapa salteable son EXPLÍCITAS y no ambiguas:
  --   required=true  + fecha nula      → PENDIENTE
  --   required=true  + fecha cargada   → COMPLETADA
  --   required=false                   → NO REQUERIDA
  -- «no requerida y completada» no existe, y tampoco se puede marcar como no
  -- requerida la etapa en la que se está parado.
  constraint chk_mo_repair_coherente check (
    repair_required or (repaired_at is null and stage <> 'repair')),
  constraint chk_mo_torque_coherente check (
    torque_required or (torque_at is null and stage <> 'torque'))
);
create index idx_mo_fecha    on maintenance_orders (company_id, received_at desc, number desc);
create index idx_mo_asset    on maintenance_orders (asset_id);
create index idx_mo_customer on maintenance_orders (company_id, customer_id);
create index idx_mo_abiertas on maintenance_orders (company_id, stage) where status = 'open';

-- 3.4 Líneas de cotización: lo que se le COTIZA al cliente.
create table maintenance_quote_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  line_no              int  not null check (line_no > 0),
  line_type            text not null default 'labour'
                       check (line_type in ('labour','part','freight','diagnosis','other')),
  -- Opcional: se puede cotizar algo que no está en el catálogo.
  product_id           uuid references products(id),
  sku_snapshot         text,
  description_snapshot text,
  quantity             numeric(14,4) not null check (quantity > 0),
  unit_price           numeric(18,4) not null default 0 check (unit_price >= 0),
  line_total           numeric(18,4) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (maintenance_order_id, line_no)
);
create index idx_mql_order on maintenance_quote_lines (maintenance_order_id);

-- 3.5 Repuestos consumidos: lo que REALMENTE salió del depósito.
--
-- Separada de la cotización a propósito: se puede cotizar sin consumir (la
-- cotización se rechaza) y consumir sin cotizar (apareció en la reparación).
-- Acá `product_id` es obligatorio porque sin producto no hay movimiento.
create table maintenance_order_parts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  product_id           uuid not null references products(id),
  warehouse_id         uuid not null references warehouses(id),
  quantity             numeric(14,4) not null check (quantity > 0),
  sku_snapshot         text,
  name_snapshot        text,
  unit_cost_snapshot   numeric(18,4),
  consumed_at          timestamptz,
  -- bigint: `stock_movements.id` es bigserial, no uuid.
  stock_movement_id    bigint references stock_movements(id),
  created_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- O las dos, o ninguna: «consumido sin movimiento de stock» no existe.
  constraint chk_mop_consumo check (
    (consumed_at is null and stock_movement_id is null) or
    (consumed_at is not null and stock_movement_id is not null))
);
create index idx_mop_order on maintenance_order_parts (maintenance_order_id);
create index idx_mop_pend  on maintenance_order_parts (maintenance_order_id)
  where consumed_at is null;

-- 3.6 Mediciones de torque. Filas VARIABLES, no las 10 fijas del legacy —que
-- en los datos reales están las 30 vacías—. Numeric, no texto.
create table maintenance_measurements (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  row_no               int  not null check (row_no > 0),
  min_value            numeric(12,4),
  max_value            numeric(12,4),
  target_value         numeric(12,4),
  created_at           timestamptz not null default now(),
  unique (maintenance_order_id, row_no),
  constraint chk_mm_rango check (
    min_value is null or max_value is null or max_value >= min_value)
);
create index idx_mm_order on maintenance_measurements (maintenance_order_id);

-- 3.7 Estado de cada parte, antes y después de la intervención.
create table maintenance_order_checks (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id),
  maintenance_order_id uuid not null references maintenance_orders(id) on delete cascade,
  check_point_id       uuid not null references maintenance_check_points(id),
  phase                text not null check (phase in ('diagnosis','repair')),
  result               text not null check (result in ('ok','nok','na')),
  created_at           timestamptz not null default now(),
  unique (maintenance_order_id, check_point_id, phase)
);
create index idx_moc_order on maintenance_order_checks (maintenance_order_id);

-- 3.8 Auditoría. Mismo esquema que purchases_audit y sales_audit.
create table maintenance_audit (
  id          bigserial primary key,
  company_id  uuid not null references companies(id),
  entity_type text not null check (entity_type in ('maintenance_asset','maintenance_order')),
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  diff        jsonb,
  actor_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index idx_mau_entity  on maintenance_audit (entity_type, entity_id, id);
create index idx_mau_company on maintenance_audit (company_id, id desc);

-- ── 4 · Semilla: las ocho partes que revisa el legacy ──────────────────────
insert into maintenance_check_points (company_id, key, label, sort_order)
select c.id, p.key, p.label, p.ord
  from companies c,
       (values ('carcasa','CARCASA/ENCASTRE',1), ('tornillos','TORNILLOS',2),
               ('conectores','CONECTORES',3),    ('reversa','REVERSA',4),
               ('software','SOFT/FIRMWARE',5),   ('embrague','EMBRAGUE',6),
               ('cabezal','CABEZAL/BOLILLAS',7), ('rotor','ROTOR',8))
       as p(key,label,ord)
on conflict do nothing;

-- ===========================================================================
-- fase7_mantenimiento_reglas
-- ===========================================================================

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO — Entrega 1 (2/3): funciones, triggers y reglas
-- ===========================================================================

-- ── 1 · Autor y coherencia ─────────────────────────────────────────────────

create or replace function app.sellar_autor_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := new.created_by;
  else
    new.created_by := old.created_by;   -- no se puede borrar quién lo cargó
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function app.validar_equipo_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v uuid;
begin
  if new.owner_customer_id is not null then
    select company_id into v from customers where id = new.owner_customer_id;
    if v is null then raise exception 'El cliente no existe' using errcode='foreign_key_violation'; end if;
    if v <> new.company_id then
      raise exception 'El cliente es de otra empresa' using errcode='check_violation';
    end if;
  end if;
  if new.delivery_serial_id is not null then
    select company_id into v from delivery_serials where id = new.delivery_serial_id;
    if v is distinct from new.company_id then
      raise exception 'Ese serial entregado es de otra empresa' using errcode='check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function app.validar_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_emp uuid;
begin
  select company_id into v_emp from maintenance_assets where id = new.asset_id;
  if v_emp is null then
    raise exception 'El equipo no existe' using errcode='foreign_key_violation';
  end if;
  if v_emp <> new.company_id then
    raise exception 'El equipo es de otra empresa' using errcode='check_violation';
  end if;

  select company_id into v_emp from customers where id = new.customer_id;
  if v_emp <> new.company_id then
    raise exception 'El cliente es de otra empresa' using errcode='check_violation';
  end if;
  return new;
end $$;

-- ── 2 · La secuencia de etapas, salteando las no requeridas ────────────────

create or replace function app.etapas_requeridas(p_repair boolean, p_torque boolean)
returns text[] language sql immutable as $$
  select array_remove(array[
    'diagnosis', 'quotation',
    case when p_repair then 'repair' end,
    case when p_torque then 'torque' end,
    'closing'], null);
$$;

/**
 * Avance y retroceso de etapa.
 *
 * Adelante: exactamente una etapa por vez, salteando SÓLO las marcadas como no
 * requeridas. Atrás: a cualquier etapa anterior de la secuencia, y queda
 * auditado. Nunca saltos silenciosos.
 */
create or replace function app.validar_etapa_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_seq text[]; v_old int; v_new int;
begin
  if new.stage is not distinct from old.stage then return new; end if;

  if old.status <> 'open' then
    raise exception 'La orden % está %: no cambia de etapa', old.number, old.status
      using errcode='restrict_violation';
  end if;

  v_seq := app.etapas_requeridas(new.repair_required, new.torque_required);
  v_new := array_position(v_seq, new.stage);
  v_old := array_position(v_seq, old.stage);

  if v_new is null then
    raise exception 'La etapa % está marcada como no requerida', new.stage
      using errcode='check_violation';
  end if;
  if v_old is null then
    -- La etapa vieja dejó de ser requerida en este mismo UPDATE: se permite
    -- salir de ella hacia adelante, que es la única salida sensata.
    return new;
  end if;
  if v_new > v_old + 1 then
    raise exception 'No se saltean etapas: de % sólo se pasa a %',
      old.stage, v_seq[v_old + 1] using errcode='check_violation';
  end if;
  return new;
end $$;

-- ── 3 · Congelado y la puerta del cierre ───────────────────────────────────

create or replace function app.proteger_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(),'') = 'service_role';

  if tg_op = 'DELETE' then
    if old.status <> 'open' and not v_mantenimiento then
      raise exception 'La orden % está %: no se borra', old.number, old.status
        using errcode='restrict_violation';
    end if;
    return old;
  end if;

  if new.number is distinct from old.number
     or new.series_code is distinct from old.series_code then
    raise exception 'El número de la orden no se cambia' using errcode='restrict_violation';
  end if;

  -- El cliente de la orden es un snapshot: no se reescribe nunca, ni aunque el
  -- equipo cambie de dueño.
  if new.customer_id is distinct from old.customer_id then
    raise exception 'El cliente de la orden queda congelado al ingresar'
      using errcode='restrict_violation';
  end if;

  if old.status in ('closed','cancelled') then
    raise exception 'La orden % está %: no se modifica', old.number, old.status
      using errcode='restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status not in ('closed','cancelled') then
      raise exception 'Transición no permitida: % → %', old.status, new.status
        using errcode='restrict_violation';
    end if;
    -- Cerrar valida doce invariantes y eso vive DENTRO de su función. Por un
    -- UPDATE suelto no se pasa: es la misma puerta que cerramos en Compras.
    if new.status = 'closed'
       and coalesce(current_setting('app.cerrando_orden_mant', true),'') <> new.id::text then
      raise exception 'Una orden se cierra con cerrar_orden_mantenimiento(), no cambiándole el estado'
        using errcode='restrict_violation';
    end if;
    if new.status = 'cancelled'
       and coalesce(current_setting('app.cancelando_orden_mant', true),'') <> new.id::text then
      raise exception 'Una orden se cancela con cancelar_orden_mantenimiento()'
        using errcode='restrict_violation';
    end if;
  end if;

  -- Marcar el torque como completado exige al menos una medición cargada: una
  -- etapa «hecha» sin ninguna medición no midió nada.
  if new.torque_at is not null and old.torque_at is null and new.torque_required then
    if not exists (select 1 from maintenance_measurements
                    where maintenance_order_id = new.id and target_value is not null) then
      raise exception 'El torque no se puede dar por completado sin ninguna medición cargada'
        using errcode='check_violation';
    end if;
  end if;

  return new;
end $$;

-- Las mediciones no se pueden vaciar después de dar el torque por completado.
create or replace function app.proteger_mediciones_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v record; v_quedan int;
begin
  select status, number, torque_at, torque_required into v
    from maintenance_orders
   where id = coalesce(new.maintenance_order_id, old.maintenance_order_id);
  if v is null then return coalesce(new, old); end if;   -- CASCADE del borrado

  if v.status <> 'open' then
    raise exception 'La orden % está %: sus mediciones no se tocan', v.number, v.status
      using errcode='restrict_violation';
  end if;

  if tg_op in ('DELETE','UPDATE') and v.torque_at is not null and v.torque_required then
    select count(*) into v_quedan
      from maintenance_measurements
     where maintenance_order_id = old.maintenance_order_id
       and target_value is not null
       and id <> old.id;
    if tg_op = 'UPDATE' and new.target_value is not null then v_quedan := v_quedan + 1; end if;
    if v_quedan = 0 then
      raise exception 'El torque está dado por completado: no puede quedar sin mediciones'
        using errcode='check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- Las líneas de una orden que no está abierta no se tocan.
create or replace function app.proteger_lineas_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_estado text; v_numero text;
begin
  select status, number into v_estado, v_numero from maintenance_orders
   where id = coalesce(new.maintenance_order_id, old.maintenance_order_id);
  if v_estado is null then return coalesce(new, old); end if;
  if v_estado <> 'open' then
    raise exception 'La orden % está %: sus líneas no se tocan', v_numero, v_estado
      using errcode='restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

-- El consumo sólo se marca desde su función. Sin esto, un UPDATE por PostgREST
-- dejaría el repuesto como consumido SIN generar el movimiento de stock —
-- exactamente el agujero que encontramos en recepciones.
create or replace function app.proteger_consumo_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if tg_op = 'UPDATE' and old.consumed_at is not null then
    raise exception 'Un repuesto ya consumido no se edita ni se borra'
      using errcode='restrict_violation';
  end if;
  if new.consumed_at is not distinct from
     (case when tg_op='UPDATE' then old.consumed_at else null end) then
    return new;
  end if;
  if coalesce(current_setting('app.consumiendo_mant', true),'') <> new.maintenance_order_id::text then
    raise exception 'El consumo se registra con confirmar_consumo_mantenimiento()'
      using errcode='restrict_violation';
  end if;
  return new;
end $$;

create or replace function app.proteger_consumo_borrado()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(),'') = 'service_role';
  if old.consumed_at is not null and not v_mantenimiento then
    raise exception 'Un repuesto ya consumido no se borra: ahí está el movimiento de stock'
      using errcode='restrict_violation';
  end if;
  return old;
end $$;

-- ── 4 · Totales de la cotización, del lado del servidor ────────────────────

create or replace function app.totales_cotizacion_mant(p_order uuid)
returns numeric language sql stable
set search_path to 'public','pg_temp' as $$
  select coalesce(round(sum(quantity * unit_price), 2), 0)
    from maintenance_quote_lines where maintenance_order_id = p_order;
$$;

create or replace function app.recalcular_linea_cotizacion_mant()
returns trigger language plpgsql
set search_path to 'public','pg_temp' as $$
begin
  new.line_total := round(new.quantity * new.unit_price, 2);
  new.updated_at := now();
  return new;
end $$;

create or replace function app.empujar_totales_cotizacion_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v uuid; v_total numeric;
begin
  v := coalesce(new.maintenance_order_id, old.maintenance_order_id);
  v_total := app.totales_cotizacion_mant(v);
  update maintenance_orders
     set quote_subtotal = v_total, quote_total = v_total
   where id = v and (quote_total is distinct from v_total);
  return coalesce(new, old);
end $$;

-- Un total mandado por el cliente se ignora: manda la suma de las líneas.
create or replace function app.recalcular_totales_orden_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_total numeric;
begin
  v_total := app.totales_cotizacion_mant(new.id);
  new.quote_subtotal := v_total;
  new.quote_total := v_total;
  return new;
end $$;

-- ── 5 · Auditoría: sólo eventos de negocio ────────────────────────────────

create or replace function app.auditar_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_accion text;
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'create', null, new.status, auth.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case new.status when 'closed' then 'order_closed'
                            when 'cancelled' then 'order_cancelled'
                            else 'status_changed' end,
            old.status, new.status, auth.uid());
  end if;

  if new.stage is distinct from old.stage then
    v_accion := case
      when array_position(app.etapas_requeridas(new.repair_required, new.torque_required), new.stage)
         < array_position(app.etapas_requeridas(new.repair_required, new.torque_required), old.stage)
      then 'stage_reverted' else 'stage_changed' end;
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, v_accion,
            old.stage, new.stage, auth.uid());
  end if;

  if (old.repair_required and not new.repair_required)
     or (old.torque_required and not new.torque_required) then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
            jsonb_strip_nulls(jsonb_build_object(
              'repair', case when old.repair_required and not new.repair_required then true end,
              'torque', case when old.torque_required and not new.torque_required then true end)),
            auth.uid());
  end if;

  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('approved','rejected') then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            'quote_' || new.quote_status, old.quote_status, new.quote_status,
            jsonb_strip_nulls(jsonb_build_object('total', new.quote_total,
                                                 'por', new.quote_approved_by_name)),
            auth.uid());
  end if;

  return new;
end $$;

create or replace function app.auditar_equipo_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, actor_id)
    values (new.company_id, 'maintenance_asset', new.id, 'create', auth.uid());
    return new;
  end if;
  if new.owner_customer_id is distinct from old.owner_customer_id then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_asset', new.id, 'owner_changed',
            jsonb_build_object('de', old.owner_customer_id, 'a', new.owner_customer_id),
            auth.uid());
  end if;
  return new;
end $$;

-- ── 6 · Los triggers ───────────────────────────────────────────────────────

create trigger trg_ma_autor    before insert or update on maintenance_assets
  for each row execute function app.sellar_autor_mantenimiento();
create trigger trg_ma_validar  before insert or update on maintenance_assets
  for each row execute function app.validar_equipo_mantenimiento();
create trigger trg_ma_auditar  after insert or update on maintenance_assets
  for each row execute function app.auditar_equipo_mantenimiento();

create trigger trg_mo_autor    before insert or update on maintenance_orders
  for each row execute function app.sellar_autor_mantenimiento();
create trigger trg_mo_validar  before insert or update on maintenance_orders
  for each row execute function app.validar_orden_mantenimiento();
create trigger trg_mo_etapa    before update on maintenance_orders
  for each row execute function app.validar_etapa_mantenimiento();
create trigger trg_mo_congelar before delete or update on maintenance_orders
  for each row execute function app.proteger_orden_mantenimiento();
create trigger trg_mo_totales  before update on maintenance_orders
  for each row execute function app.recalcular_totales_orden_mant();
create trigger trg_mo_auditar  after insert or update on maintenance_orders
  for each row execute function app.auditar_orden_mantenimiento();

create trigger trg_mql_congelar before insert or delete or update on maintenance_quote_lines
  for each row execute function app.proteger_lineas_mantenimiento();
create trigger trg_mql_calcular before insert or update on maintenance_quote_lines
  for each row execute function app.recalcular_linea_cotizacion_mant();
create trigger trg_mql_empujar  after insert or delete or update on maintenance_quote_lines
  for each row execute function app.empujar_totales_cotizacion_mant();

create trigger trg_mop_congelar before insert or update on maintenance_order_parts
  for each row execute function app.proteger_lineas_mantenimiento();
create trigger trg_mop_consumo  before insert or update on maintenance_order_parts
  for each row execute function app.proteger_consumo_mantenimiento();
create trigger trg_mop_borrado  before delete on maintenance_order_parts
  for each row execute function app.proteger_consumo_borrado();

create trigger trg_mm_proteger  before insert or delete or update on maintenance_measurements
  for each row execute function app.proteger_mediciones_mantenimiento();

create trigger trg_moc_congelar before insert or delete or update on maintenance_order_checks
  for each row execute function app.proteger_lineas_mantenimiento();

-- ===========================================================================
-- fase7_mantenimiento_rpc_y_rls
-- ===========================================================================

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO — Entrega 1 (3/3): RPC, RLS y grants
-- ===========================================================================

-- ── 1 · Capacidad de torque: se DERIVA, no se guarda ───────────────────────
--
-- El legacy calcula Cp/Cpk/CV al vuelo y no los persiste, que es lo correcto:
-- una medición corregida no puede dejar un Cpk viejo pegado. Se replica la
-- misma cuenta del lado del servidor.
create or replace function public.capacidad_torque(p_order uuid)
returns jsonb language sql stable
set search_path to 'public','pg_temp' as $$
  with m as (
    select target_value t, min_value mn, max_value mx
      from maintenance_measurements
     where maintenance_order_id = p_order and target_value is not null and target_value > 0
  ), o as (
    select torque_lsl lsl, torque_usl usl, torque_nominal nom
      from maintenance_orders where id = p_order
  ), s as (
    select count(*) n, avg(t) mu, stddev_samp(t) sd,
           avg(mn) prom_min, avg(mx) prom_max
      from m
  )
  select jsonb_build_object(
    'mediciones', s.n,
    'promedio',   round(s.mu, 4),
    'desvio',     round(s.sd, 4),
    'promedio_min', round(s.prom_min, 4),
    'promedio_max', round(s.prom_max, 4),
    'cp',  case when s.sd > 0 and o.lsl is not null and o.usl is not null
                then round((o.usl - o.lsl) / (6 * s.sd), 4) end,
    'cpk', case when s.sd > 0 and o.lsl is not null and o.usl is not null and s.mu is not null
                then round(least((o.usl - s.mu) / (3 * s.sd), (s.mu - o.lsl) / (3 * s.sd)), 4) end,
    'cv',  case when s.sd > 0 and s.mu > 0 then round((s.sd / s.mu) * 100, 4) end,
    'veredicto', case
      when s.sd is null or s.sd = 0 or o.lsl is null or o.usl is null or s.mu is null then null
      when least((o.usl - s.mu) / (3 * s.sd), (s.mu - o.lsl) / (3 * s.sd)) >= 1.33 then 'capaz'
      when least((o.usl - s.mu) / (3 * s.sd), (s.mu - o.lsl) / (3 * s.sd)) >= 1.00 then 'aceptable'
      else 'no_capaz' end)
  from s, o;
$$;

-- ── 2 · Duplicados de serial: avisa, no bloquea ────────────────────────────
--
-- El legacy nunca garantizó el serial —no es obligatorio ni único— así que la
-- base no rechaza nada. Registra la ambigüedad, como `needs_review` en
-- proveedores.
create or replace function public.duplicados_de_serial(
  p_company uuid, p_serial text, p_excluir uuid default null)
returns table (id uuid, reference text, model_text text, serial_number text,
               owner_customer_id uuid, created_at timestamptz)
language sql stable
set search_path to 'public','pg_temp' as $$
  select a.id, a.reference, a.model_text, a.serial_number, a.owner_customer_id, a.created_at
    from maintenance_assets a
   where a.company_id = p_company
     and a.deleted_at is null
     and a.serial_normalized is not null
     and a.serial_normalized = nullif(upper(regexp_replace(
           coalesce(p_serial,''), '[^A-Za-z0-9]', '', 'g')), '')
     and (p_excluir is null or a.id <> p_excluir)
   order by a.created_at;
$$;

-- ── 3 · Confirmar el consumo de repuestos ──────────────────────────────────
--
-- Acción PROPIA, separada del cierre: el repuesto se pone el día de la
-- reparación y la orden puede cerrarse una semana después. Server-side,
-- transaccional, idempotente, con el permiso ANTES del atajo.
create or replace function public.confirmar_consumo_mantenimiento(p_order uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  v_o     maintenance_orders;
  v_rol   text;
  v_linea record;
  v_mov   bigint;
  v_n     int := 0;
  v_pend  int;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  -- El permiso va PRIMERO, antes del atajo de idempotencia: si no, un externo
  -- le saca información a una orden ya consumida.
  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para registrar consumos en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.status <> 'open' then
    raise exception 'La orden % está %: no se registran consumos', v_o.number, v_o.status
      using errcode = 'restrict_violation';
  end if;

  if not exists (select 1 from maintenance_order_parts where maintenance_order_id = p_order) then
    raise exception 'La orden no tiene repuestos cargados' using errcode = 'restrict_violation';
  end if;

  select count(*) into v_pend from maintenance_order_parts
   where maintenance_order_id = p_order and consumed_at is null;
  if v_pend = 0 then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true, 'lineas', 0);
  end if;

  -- Las líneas bloqueadas y en orden de id, para que dos transacciones no se
  -- traben entre sí.
  perform 1 from maintenance_order_parts
   where maintenance_order_id = p_order and consumed_at is null
   order by id for update;

  perform set_config('app.consumiendo_mant', p_order::text, true);

  for v_linea in
    select * from maintenance_order_parts
     where maintenance_order_id = p_order and consumed_at is null order by id
  loop
    -- Saldo negativo: PERMITIDO. La reparación ya ocurrió físicamente y
    -- negarse a registrarla haría que el sistema mienta sobre una herramienta
    -- que ya tiene el repuesto puesto. El faltante se ve en el saldo.
    insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                                 quantity, source_type, source_id, notes, created_by)
    values (v_linea.company_id, v_linea.product_id, v_linea.warehouse_id,
            'service_consumption', -v_linea.quantity, 'maintenance_order', p_order,
            'Orden ' || v_o.number, auth.uid())
    returning id into v_mov;

    update maintenance_order_parts
       set consumed_at = now(), stock_movement_id = v_mov, updated_at = now()
     where id = v_linea.id;
    v_n := v_n + 1;
  end loop;

  perform set_config('app.consumiendo_mant', '', true);

  -- Un evento por confirmación, no uno por línea.
  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_o.company_id, 'maintenance_order', p_order, 'consumption_confirmed',
          jsonb_build_object('lineas', v_n), auth.uid());

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false, 'lineas', v_n);
end $$;

-- ── 4 · Cerrar la orden: las doce validaciones ─────────────────────────────

create or replace function public.cerrar_orden_mantenimiento(p_order uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_o maintenance_orders; v_rol text; v_n int;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  -- 2. permiso, antes que nada
  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para cerrar órdenes en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1. no se cierra dos veces
  if v_o.status = 'closed' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true);
  end if;
  if v_o.status = 'cancelled' then
    raise exception 'La orden % está cancelada', v_o.number using errcode='restrict_violation';
  end if;

  -- 3. no se cierra salteando el circuito
  if v_o.stage <> 'closing' then
    raise exception 'La orden está en la etapa %: se cierra desde «cierre»', v_o.stage
      using errcode='check_violation';
  end if;

  -- 4. diagnóstico completado
  if v_o.diagnosed_at is null then
    raise exception 'Falta completar el diagnóstico' using errcode='check_violation';
  end if;

  -- 5. cotización resuelta (el bug del legacy: 2 de 3 fichas se cerraron
  --    con la cotización PENDIENTE)
  if v_o.quote_status = 'pending' then
    raise exception 'La cotización sigue pendiente: hay que aprobarla o rechazarla'
      using errcode='check_violation';
  end if;

  -- 6. una cotización aprobada sin líneas no es una cotización
  if v_o.quote_status = 'approved' then
    select count(*) into v_n from maintenance_quote_lines where maintenance_order_id = p_order;
    if v_n = 0 then
      raise exception 'La cotización está aprobada y no tiene ninguna línea'
        using errcode='check_violation';
    end if;
  end if;

  -- 7. reparación completada o marcada no requerida
  if v_o.repair_required and v_o.repaired_at is null then
    raise exception 'Falta completar la reparación, o marcarla como no requerida'
      using errcode='check_violation';
  end if;

  -- 8. torque completado o marcado no requerido
  if v_o.torque_required and v_o.torque_at is null then
    raise exception 'Falta completar el torque, o marcarlo como no requerido'
      using errcode='check_violation';
  end if;

  -- 9. si el torque aplica, al menos una medición cargada
  if v_o.torque_required then
    select count(*) into v_n from maintenance_measurements
     where maintenance_order_id = p_order and target_value is not null;
    if v_n = 0 then
      raise exception 'El torque es requerido y no hay ninguna medición cargada'
        using errcode='check_violation';
    end if;
  end if;

  -- 10. cerrar es entregar
  if v_o.delivered_at is null then
    raise exception 'Falta la fecha de entrega' using errcode='check_violation';
  end if;

  -- 11. fechas coherentes (lo garantiza además un CHECK)
  if v_o.delivered_at < v_o.received_at then
    raise exception 'La entrega no puede ser anterior al ingreso' using errcode='check_violation';
  end if;

  -- 12. no queda un repuesto «a consumir» colgado
  select count(*) into v_n from maintenance_order_parts
   where maintenance_order_id = p_order and consumed_at is null;
  if v_n > 0 then
    raise exception 'Quedan % repuesto(s) sin confirmar el consumo', v_n
      using errcode='check_violation';
  end if;

  perform set_config('app.cerrando_orden_mant', p_order::text, true);
  update maintenance_orders
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_order;
  perform set_config('app.cerrando_orden_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false);
end $$;

-- ── 5 · Cancelar: sin validaciones, es la salida ───────────────────────────

create or replace function public.cancelar_orden_mantenimiento(
  p_order uuid, p_motivo text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_o maintenance_orders; v_rol text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para cancelar órdenes en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.status = 'cancelled' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true);
  end if;
  if v_o.status = 'closed' then
    raise exception 'La orden % está cerrada: no se cancela', v_o.number
      using errcode='restrict_violation';
  end if;

  -- Una herramienta que entró y se devuelve sin trabajo. Exigirle requisitos
  -- sería burocracia; lo único que se pide es que no haya stock ya movido.
  if exists (select 1 from maintenance_order_parts
              where maintenance_order_id = p_order and consumed_at is not null) then
    raise exception 'Ya se consumieron repuestos en esta orden: no se cancela, se cierra'
      using errcode='restrict_violation';
  end if;

  perform set_config('app.cancelando_orden_mant', p_order::text, true);
  update maintenance_orders
     set status = 'cancelled', closing_notes = coalesce(p_motivo, closing_notes)
   where id = p_order;
  perform set_config('app.cancelando_orden_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false);
end $$;

-- ── 6 · RLS ────────────────────────────────────────────────────────────────

alter table maintenance_check_points   enable row level security;
alter table maintenance_check_points   force row level security;
alter table maintenance_assets         enable row level security;
alter table maintenance_assets         force row level security;
alter table maintenance_orders         enable row level security;
alter table maintenance_orders         force row level security;
alter table maintenance_quote_lines    enable row level security;
alter table maintenance_quote_lines    force row level security;
alter table maintenance_order_parts    enable row level security;
alter table maintenance_order_parts    force row level security;
alter table maintenance_measurements   enable row level security;
alter table maintenance_measurements   force row level security;
alter table maintenance_order_checks   enable row level security;
alter table maintenance_order_checks   force row level security;
alter table maintenance_audit          enable row level security;
alter table maintenance_audit          force row level security;

create policy mant_cp_select on maintenance_check_points for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_cp_write on maintenance_check_points for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_assets_select on maintenance_assets for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_assets_write on maintenance_assets for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_orders_select on maintenance_orders for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_orders_write on maintenance_orders for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_ql_select on maintenance_quote_lines for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_ql_write on maintenance_quote_lines for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_parts_select on maintenance_order_parts for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_parts_write on maintenance_order_parts for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_meas_select on maintenance_measurements for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_meas_write on maintenance_measurements for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

create policy mant_checks_select on maintenance_order_checks for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
create policy mant_checks_write on maintenance_order_checks for all
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

-- La auditoría es de SÓLO LECTURA desde PostgREST: se escribe por triggers
-- SECURITY DEFINER. Mismo criterio que purchases_audit.
create policy mant_audit_select on maintenance_audit for select
  using (company_id in (select unnest(app.current_maintenance_company_ids())));

-- ── 7 · Grants ─────────────────────────────────────────────────────────────

grant select, insert, update, delete on maintenance_check_points,
  maintenance_assets, maintenance_orders, maintenance_quote_lines,
  maintenance_order_parts, maintenance_measurements, maintenance_order_checks
  to authenticated;
grant select on maintenance_audit to authenticated;
grant usage, select on sequence maintenance_audit_id_seq to authenticated;

-- `anon` no ejecuta NADA. El hallazgo de la entrega 1 de Compras —tres RPC
-- abiertas a anónimos— no se repite.
revoke execute on function public.confirmar_consumo_mantenimiento(uuid) from anon;
revoke execute on function public.cerrar_orden_mantenimiento(uuid) from anon;
revoke execute on function public.cancelar_orden_mantenimiento(uuid, text) from anon;
revoke execute on function public.capacidad_torque(uuid) from anon;
revoke execute on function public.duplicados_de_serial(uuid, text, uuid) from anon;

-- ===========================================================================
-- fase7_mantenimiento_endurecimiento_advisors
-- ===========================================================================

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO — dos correcciones que marcó el advisor
-- ===========================================================================

-- 1 · `app.etapas_requeridas` quedó sin `search_path` fijo. Es IMMUTABLE y no
--     toca tablas, pero se corrige igual: una función sin search_path fijo es
--     un punto de entrada para el secuestro del schema.
create or replace function app.etapas_requeridas(p_repair boolean, p_torque boolean)
returns text[] language sql immutable
set search_path to 'public','pg_temp' as $$
  select array_remove(array[
    'diagnosis', 'quotation',
    case when p_repair then 'repair' end,
    case when p_torque then 'torque' end,
    'closing'], null);
$$;

-- 2 · Las tres RPC seguían siendo ejecutables por `anon`.
--
-- `revoke … from anon` NO alcanza: Postgres otorga EXECUTE a PUBLIC por
-- defecto al crear la función, y `anon` hereda de PUBLIC. Hay que revocarle a
-- PUBLIC, que es lo que realmente la abre.
revoke execute on function public.confirmar_consumo_mantenimiento(uuid) from public, anon;
revoke execute on function public.cerrar_orden_mantenimiento(uuid) from public, anon;
revoke execute on function public.cancelar_orden_mantenimiento(uuid, text) from public, anon;
revoke execute on function public.capacidad_torque(uuid) from public, anon;
revoke execute on function public.duplicados_de_serial(uuid, text, uuid) from public, anon;

-- Y se le devuelve explícitamente a quien sí tiene que poder.
grant execute on function public.confirmar_consumo_mantenimiento(uuid) to authenticated;
grant execute on function public.cerrar_orden_mantenimiento(uuid) to authenticated;
grant execute on function public.cancelar_orden_mantenimiento(uuid, text) to authenticated;
grant execute on function public.capacidad_torque(uuid) to authenticated;
grant execute on function public.duplicados_de_serial(uuid, text, uuid) to authenticated;

-- ===========================================================================
-- fase7_auditar_etapa_no_requerida_al_crear
-- ===========================================================================

-- Una etapa marcada como no requerida tiene que quedar explícita y auditada
-- SIEMPRE, no sólo cuando se marca después. Si la orden nace con la
-- reparación o el torque en «no requerido», también corresponde el evento:
-- si no, la única forma de saber por qué se salteó una etapa sería deducirlo
-- de un booleano, que es justo lo que pediste evitar.
create or replace function app.auditar_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_accion text;
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'create', null, new.status, auth.uid());

    if not new.repair_required or not new.torque_required then
      insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
      values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
              jsonb_strip_nulls(jsonb_build_object(
                'repair', case when not new.repair_required then true end,
                'torque', case when not new.torque_required then true end,
                'al_crear', true)),
              auth.uid());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case new.status when 'closed' then 'order_closed'
                            when 'cancelled' then 'order_cancelled'
                            else 'status_changed' end,
            old.status, new.status, auth.uid());
  end if;

  if new.stage is distinct from old.stage then
    v_accion := case
      when array_position(app.etapas_requeridas(new.repair_required, new.torque_required), new.stage)
         < array_position(app.etapas_requeridas(new.repair_required, new.torque_required), old.stage)
      then 'stage_reverted' else 'stage_changed' end;
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, v_accion,
            old.stage, new.stage, auth.uid());
  end if;

  if (old.repair_required and not new.repair_required)
     or (old.torque_required and not new.torque_required) then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
            jsonb_strip_nulls(jsonb_build_object(
              'repair', case when old.repair_required and not new.repair_required then true end,
              'torque', case when old.torque_required and not new.torque_required then true end)),
            auth.uid());
  end if;

  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('approved','rejected') then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            'quote_' || new.quote_status, old.quote_status, new.quote_status,
            jsonb_strip_nulls(jsonb_build_object('total', new.quote_total,
                                                 'por', new.quote_approved_by_name)),
            auth.uid());
  end if;

  return new;
end $$;

-- ===========================================================================
-- fix_rls_delivery_serials_select  (Fase 7 · fix de seguridad previo)
-- ===========================================================================

-- ===========================================================================
-- FIX DE SEGURIDAD · delivery_serials.serials_select
-- ===========================================================================
--
-- La policy anterior era:
--
--   EXISTS (SELECT 1 FROM delivery_lines dl
--            WHERE dl.id = delivery_serials.delivery_line_id
--              AND dl.company_id = delivery_serials.company_id)
--
-- Compara la línea de entrega con la empresa DE LA PROPIA FILA, nunca con las
-- del usuario autenticado. Para cualquier fila bien formada es equivalente a
-- `true`, así que con `authenticated` teniendo SELECT cualquier usuario
-- logueado vería los seriales de todas las empresas.
--
-- La nueva usa el patrón ya probado en el resto del proyecto, el mismo que
-- tiene `deliveries_select`: la empresa tiene que ser una de las del usuario,
-- y además o es interno de esa empresa, o es el cliente dueño del serial.
-- `delivery_serials` ya trae `customer_id` propio, así que no hace falta ir a
-- buscarlo por la cadena.
--
-- Sin cambios de schema, sin tocar datos y sin funciones nuevas.

drop policy if exists serials_select on delivery_serials;

create policy serials_select on delivery_serials for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or customer_id in (select unnest(app.current_customer_ids()))
  )
);

-- ===========================================================================
-- fix_rls_policies_tautologicas
-- ===========================================================================

-- ===========================================================================
-- FIX · seis policies de SELECT que no autorizan por sí mismas
-- ===========================================================================
--
-- Todas tenían la misma forma:
--
--   EXISTS (SELECT 1 FROM <padre> p
--            WHERE p.id = <hija>.<fk> AND p.company_id = <hija>.company_id)
--
-- Esa condición comprueba **consistencia interna** —que la línea y su
-- documento sean de la misma empresa— y NO que el usuario tenga permiso.
-- Por sí sola es equivalente a `true` para cualquier fila bien formada.
--
-- MEDIDO ANTES DE TOCAR NADA: hoy NO filtran. Postgres aplica RLS también
-- dentro de la subconsulta de una policy, así que la cadena termina en la
-- policy del padre, que sí está bien. Un `customer` ve 0 de las 600
-- delivery_lines y 0 de las 992 sales_quote_lines.
--
-- Se corrigen igual, y el motivo es la fragilidad: la garantía es IMPLÍCITA.
-- Depende de un comportamiento sutil de Postgres y de que la policy del padre
-- siga siendo correcta. Si mañana alguien mete un helper SECURITY DEFINER en
-- el medio, o reescribe la del padre, la hija se queda **sin ninguna
-- protección propia**. Después de esto, cada policy se defiende sola.
--
-- El objetivo es que la visibilidad quede EXACTAMENTE IGUAL. Se midió antes y
-- se vuelve a medir después; los números tienen que coincidir.
--
-- Sólo SELECT. No se toca ninguna policy de escritura.

-- ── 1 · delivery_lines → sigue a deliveries ────────────────────────────────
drop policy if exists delivery_lines_select on delivery_lines;
create policy delivery_lines_select on delivery_lines for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from deliveries d
       where d.id = delivery_lines.delivery_id
         and d.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

-- ── 2 · sales_quote_lines → sigue a sales_quotes ───────────────────────────
drop policy if exists quote_lines_select on sales_quote_lines;
create policy quote_lines_select on sales_quote_lines for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_quotes q
       where q.id = sales_quote_lines.quote_id
         and q.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

-- ── 3 · sales_order_lines → sigue a sales_orders ───────────────────────────
drop policy if exists order_lines_select on sales_order_lines;
create policy order_lines_select on sales_order_lines for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_orders o
       where o.id = sales_order_lines.order_id
         and o.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

-- ── 4 · sales_invoice_lines → sigue a sales_invoices ───────────────────────
-- Hoy hay 0 facturas. Se corrige ahora, antes de que se carguen.
drop policy if exists invoice_lines_select on sales_invoice_lines;
create policy invoice_lines_select on sales_invoice_lines for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_invoices i
       where i.id = sales_invoice_lines.invoice_id
         and i.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

-- ── 5 · customer_purchase_order_lines → sigue a customer_purchase_orders ───
drop policy if exists po_lines_select on customer_purchase_order_lines;
create policy po_lines_select on customer_purchase_order_lines for select using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from customer_purchase_orders p
       where p.id = customer_purchase_order_lines.po_id
         and p.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

-- ── 6 · product_images → sigue a products ──────────────────────────────────
--
-- Ojo acá: `products_select` NO es como los documentos. No tiene cliente; deja
-- ver los productos ACTIVOS a cualquier miembro de la empresa —por eso un
-- customer ve las 8.859 imágenes— y a los internos también los inactivos.
-- Copiar el patrón de los documentos rompería el catálogo. Se sigue el del
-- padre real: empresa + no borrado + (interno o activo).
drop policy if exists product_images_select on product_images;
create policy product_images_select on product_images for select using (
  company_id in (select unnest(app.current_company_ids()))
  and exists (
    select 1 from products p
     where p.id = product_images.product_id
       and p.deleted_at is null
       and (
         p.company_id in (select unnest(app.current_internal_company_ids()))
         or p.status = 'active'
       )
  )
);

-- ===========================================================================
-- fix_rls_policies_to_authenticated
-- ===========================================================================

-- ===========================================================================
-- CORRECCIÓN · las policies nuevas quedaron en PUBLIC en vez de authenticated
-- ===========================================================================
--
-- `create policy` sin cláusula `TO` la crea `TO PUBLIC`. Todas las policies
-- originales del proyecto son `TO authenticated`, así que las nuevas
-- empezaron a aplicarse también a `anon` — que no puede ejecutar
-- `app.current_company_ids()` (no tiene EXECUTE ni USAGE sobre el schema
-- `app`) y por eso recibía `42501: permission denied for function` en vez de
-- una lista vacía.
--
-- Medido: antes `anon` recibía 0 filas; después del cambio, error. Funcional-
-- mente sigue sin ver nada, pero es un cambio de comportamiento que no
-- corresponde a este fix.
--
-- Se recrean las SIETE con `TO authenticated` —las seis de este fix más
-- `delivery_serials`, donde cometí el mismo descuido en el fix anterior—.
-- Sin una policy aplicable, `anon` vuelve a recibir 0 filas.

drop policy if exists delivery_lines_select on delivery_lines;
create policy delivery_lines_select on delivery_lines for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from deliveries d
       where d.id = delivery_lines.delivery_id
         and d.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

drop policy if exists quote_lines_select on sales_quote_lines;
create policy quote_lines_select on sales_quote_lines for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_quotes q
       where q.id = sales_quote_lines.quote_id
         and q.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

drop policy if exists order_lines_select on sales_order_lines;
create policy order_lines_select on sales_order_lines for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_orders o
       where o.id = sales_order_lines.order_id
         and o.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

drop policy if exists invoice_lines_select on sales_invoice_lines;
create policy invoice_lines_select on sales_invoice_lines for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from sales_invoices i
       where i.id = sales_invoice_lines.invoice_id
         and i.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

drop policy if exists po_lines_select on customer_purchase_order_lines;
create policy po_lines_select on customer_purchase_order_lines for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or exists (
      select 1 from customer_purchase_orders p
       where p.id = customer_purchase_order_lines.po_id
         and p.customer_id in (select unnest(app.current_customer_ids()))
    )
  )
);

drop policy if exists product_images_select on product_images;
create policy product_images_select on product_images for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and exists (
    select 1 from products p
     where p.id = product_images.product_id
       and p.deleted_at is null
       and (
         p.company_id in (select unnest(app.current_internal_company_ids()))
         or p.status = 'active'
       )
  )
);

-- La del fix anterior, con el mismo descuido.
drop policy if exists serials_select on delivery_serials;
create policy serials_select on delivery_serials for select to authenticated using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or customer_id in (select unnest(app.current_customer_ids()))
  )
);

-- ===========================================================================
-- fix_policies_publicas_a_authenticated
-- ===========================================================================

-- ===========================================================================
-- Todas las policies creadas por mí quedaron en PUBLIC en vez de authenticated
-- ===========================================================================
--
-- `create policy` sin cláusula `TO` la crea `TO PUBLIC`. Toda policy previa
-- del proyecto es `TO authenticated`. Se me pasó en tres migraciones: la
-- entrega 5 de Compras (`attachments_select`), la entrega 1 de Mantenimiento
-- (sus 15) y el fix anterior de `delivery_serials` —esta última ya corregida—.
--
-- En estas 16 el efecto práctico es nulo: sus policies llaman a
-- `app.current_writer_company_ids()` y `app.current_maintenance_*()`, que
-- `anon` SÍ puede ejecutar, así que devuelven un array vacío y `anon` recibe
-- 0 filas igual. Verificado antes de tocar nada.
--
-- Se emparejan de todos modos: que el resultado sea correcto por qué helper
-- usa cada policy es exactamente la clase de garantía implícita que este fix
-- vino a eliminar.

-- ── attachments ────────────────────────────────────────────────────────────
drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments for select to authenticated using (
  case
    when entity_type = any (array['supplier','purchase_order','goods_receipt',
                                  'supplier_invoice',
                                  'maintenance_asset','maintenance_order'])
      then company_id in (select unnest(app.current_writer_company_ids()))
    else company_id in (select unnest(app.current_internal_company_ids()))
  end
);

-- ── Mantenimiento ──────────────────────────────────────────────────────────
drop policy if exists mant_cp_select on maintenance_check_points;
create policy mant_cp_select on maintenance_check_points for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_cp_write on maintenance_check_points;
create policy mant_cp_write on maintenance_check_points for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_assets_select on maintenance_assets;
create policy mant_assets_select on maintenance_assets for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_assets_write on maintenance_assets;
create policy mant_assets_write on maintenance_assets for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_orders_select on maintenance_orders;
create policy mant_orders_select on maintenance_orders for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_orders_write on maintenance_orders;
create policy mant_orders_write on maintenance_orders for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_ql_select on maintenance_quote_lines;
create policy mant_ql_select on maintenance_quote_lines for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_ql_write on maintenance_quote_lines;
create policy mant_ql_write on maintenance_quote_lines for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_parts_select on maintenance_order_parts;
create policy mant_parts_select on maintenance_order_parts for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_parts_write on maintenance_order_parts;
create policy mant_parts_write on maintenance_order_parts for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_meas_select on maintenance_measurements;
create policy mant_meas_select on maintenance_measurements for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_meas_write on maintenance_measurements;
create policy mant_meas_write on maintenance_measurements for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_checks_select on maintenance_order_checks;
create policy mant_checks_select on maintenance_order_checks for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));
drop policy if exists mant_checks_write on maintenance_order_checks;
create policy mant_checks_write on maintenance_order_checks for all to authenticated
  using (company_id in (select unnest(app.current_maintenance_writer_ids())))
  with check (company_id in (select unnest(app.current_maintenance_writer_ids())));

drop policy if exists mant_audit_select on maintenance_audit;
create policy mant_audit_select on maintenance_audit for select to authenticated
  using (company_id in (select unnest(app.current_maintenance_company_ids())));

-- ===========================================================================
-- fase7_auditar_espera_orden_mantenimiento  (Fase 7 · Mantenimiento entrega 2)
-- ===========================================================================
--
-- `on_hold` es un eje ortogonal a la etapa: pausa el trabajo sin moverlo. La
-- entrega 1 lo dejó sin auditar, y con la UI de la entrega 2 pasa a ser una
-- acción que una persona hace con un botón. Un «¿por qué estuvo parada tres
-- semanas?» no se contesta con un booleano.
--
-- Se agregan dos acciones —`order_put_on_hold` y `order_resumed`— al mismo
-- trigger que ya audita el resto, para que el orden temporal de los eventos
-- siga siendo uno solo. `from_status`/`to_status` guardan la ETAPA en la que
-- quedó parada, que es el dato que hace falta para entender la pausa.
--
-- El resto de la función queda idéntica a la de la entrega 1.

create or replace function app.auditar_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_accion text;
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'create', null, new.status, auth.uid());

    if not new.repair_required or not new.torque_required then
      insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
      values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
              jsonb_strip_nulls(jsonb_build_object(
                'repair', case when not new.repair_required then true end,
                'torque', case when not new.torque_required then true end,
                'al_crear', true)),
              auth.uid());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case new.status when 'closed' then 'order_closed'
                            when 'cancelled' then 'order_cancelled'
                            else 'status_changed' end,
            old.status, new.status, auth.uid());
  end if;

  if new.stage is distinct from old.stage then
    v_accion := case
      when array_position(app.etapas_requeridas(new.repair_required, new.torque_required), new.stage)
         < array_position(app.etapas_requeridas(new.repair_required, new.torque_required), old.stage)
      then 'stage_reverted' else 'stage_changed' end;
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, v_accion,
            old.stage, new.stage, auth.uid());
  end if;

  if new.on_hold is distinct from old.on_hold then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case when new.on_hold then 'order_put_on_hold' else 'order_resumed' end,
            old.stage, new.stage, auth.uid());
  end if;

  if (old.repair_required and not new.repair_required)
     or (old.torque_required and not new.torque_required) then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
            jsonb_strip_nulls(jsonb_build_object(
              'repair', case when old.repair_required and not new.repair_required then true end,
              'torque', case when old.torque_required and not new.torque_required then true end)),
            auth.uid());
  end if;

  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('approved','rejected') then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            'quote_' || new.quote_status, old.quote_status, new.quote_status,
            jsonb_strip_nulls(jsonb_build_object('total', new.quote_total,
                                                 'por', new.quote_approved_by_name)),
            auth.uid());
  end if;

  return new;
end $$;

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO · ENTREGA 3
-- ===========================================================================
--
-- Cuatro migraciones que cierran los gaps de integridad que midió la auditoría
-- previa (docs/PHASE_7_MANTENIMIENTO_ENTREGA_3_AUDITORIA.md):
--
--   fase7_entrega3_monedas_cotizacion_y_costo
--   fase7_entrega3_coherencia_empresa_y_referencias
--   fase7_entrega3_maquina_de_estados_de_la_cotizacion
--   fase7_entrega3_la_cotizacion_nace_pendiente
--
-- Abajo va el resultado consolidado de las cuatro, que es lo que está aplicado.

-- ===========================================================================
-- FASE 7 · MANTENIMIENTO · ENTREGA 3
-- Cierre de los gaps de integridad de la auditoría previa
-- ===========================================================================
--
-- Ocho cosas, ni una más:
--
--   1  quote_currency → quote_currency_code (convención del proyecto)
--   2  unit_cost_currency_code, obligatoria si hay costo
--   3  P1 · coherencia de empresa entre una fila hija y su orden
--   4  P2/P3 · producto, depósito y punto de revisión de esa misma empresa
--   5  P5 · una línea con importe exige moneda de cotización
--   6  P4 · máquina de estados: approved y rejected son terminales, por RPC
--   7  P6 · evento part_added (y part_removed)
--
-- No toca Ventas, Compras ni Clientes. No toca grants de stock_movements.

-- ── 1 · Renombre a la convención del proyecto ──────────────────────────────
--
-- Trece columnas de moneda en la base se llaman `currency_code` o
-- `default_currency`; ésta era la única `*_currency` de documento. La FK a
-- `currencies(code)` ya existía y viaja con la columna. La tabla tiene 0 filas.

alter table maintenance_orders rename column quote_currency to quote_currency_code;

-- ── 2 · La moneda del costo del repuesto ───────────────────────────────────
--
-- El costo NO se autocompleta desde `product_prices`: esas son listas de
-- VENTA. No hay ninguna fuente de costo confiable en la base —0 pedidos de
-- compra confirmados, 0 recepciones, 0 facturas de proveedor, ninguna columna
-- de costo en `products`— así que el costo es carga manual o NULL.
--
-- Y si hay costo, tiene que decir en qué moneda: un número sin unidad no es un
-- costo. La moneda de la cotización NO sirve de default: es lo que se le cobra
-- al cliente, no lo que costó el repuesto.

alter table maintenance_order_parts
  add column unit_cost_currency_code text references currencies(code);

alter table maintenance_order_parts
  add constraint chk_mop_costo_moneda check (
    unit_cost_snapshot is null or unit_cost_currency_code is not null);

comment on column maintenance_order_parts.unit_cost_currency_code is
  'Moneda del costo. Obligatoria si hay costo. Nunca se copia de quote_currency_code: la cotizacion es lo que se cobra, no lo que costo.';

-- ── 3 · P1 · Coherencia de empresa entre hija y orden ──────────────────────
--
-- El agujero medido en la auditoría: la RLS mira `company_id` DE LA FILA, que
-- es el del usuario. Nadie comparaba ese company_id con el de la orden. Un
-- admin de la empresa A podía insertar una línea de cotización en una orden de
-- la empresa B —que ni siquiera puede leer— y reescribirle el total.
--
-- La regla es: una fila hija NO se autoriza por su propio company_id.

create or replace function app.coherencia_empresa_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_emp uuid; v_num text;
begin
  select company_id, number into v_emp, v_num
    from maintenance_orders where id = new.maintenance_order_id;

  if v_emp is null then
    raise exception 'La orden no existe' using errcode = 'foreign_key_violation';
  end if;

  if new.company_id is distinct from v_emp then
    raise exception 'La fila dice ser de otra empresa que su orden %', v_num
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_mql_empresa on maintenance_quote_lines;
drop trigger if exists trg_mop_empresa on maintenance_order_parts;
drop trigger if exists trg_mm_empresa on maintenance_measurements;
drop trigger if exists trg_moc_empresa on maintenance_order_checks;

create trigger trg_mql_empresa before insert or update on maintenance_quote_lines
  for each row execute function app.coherencia_empresa_mant();
create trigger trg_mop_empresa before insert or update on maintenance_order_parts
  for each row execute function app.coherencia_empresa_mant();
create trigger trg_mm_empresa before insert or update on maintenance_measurements
  for each row execute function app.coherencia_empresa_mant();
create trigger trg_moc_empresa before insert or update on maintenance_order_checks
  for each row execute function app.coherencia_empresa_mant();

-- ── 4 · P2 y P3 · Las referencias también son de esa empresa ───────────────
--
-- Un producto, un depósito o un punto de revisión de otra empresa entraban sin
-- que nada los mirara. Se validan sólo las columnas que cada tabla tiene: las
-- ramas están separadas por `tg_table_name` porque plpgsql evalúa `new.<campo>`
-- recién al ejecutarlo, y `new.product_id` no existe en las otras dos tablas.

create or replace function app.coherencia_refs_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_otra uuid; v_activo boolean;
begin
  if tg_table_name = 'maintenance_quote_lines' then
    if new.product_id is not null then
      select company_id into v_otra from products where id = new.product_id;
      if v_otra is distinct from new.company_id then
        raise exception 'El producto de la línea es de otra empresa'
          using errcode = 'check_violation';
      end if;
    end if;

  elsif tg_table_name = 'maintenance_order_parts' then
    select company_id into v_otra from products where id = new.product_id;
    if v_otra is distinct from new.company_id then
      raise exception 'El repuesto es un producto de otra empresa'
        using errcode = 'check_violation';
    end if;

    select company_id, is_active into v_otra, v_activo
      from warehouses where id = new.warehouse_id;
    if v_otra is distinct from new.company_id then
      raise exception 'El depósito es de otra empresa' using errcode = 'check_violation';
    end if;

    -- Un depósito dado de baja no recibe repuestos nuevos. Sólo se mira cuando
    -- el depósito entra o cambia, para no invalidar una fila vieja si mañana se
    -- desactiva un depósito que ya tiene repuestos cargados. Los dos casos van
    -- en ramas separadas porque en un INSERT `old` no está asignado.
    if not v_activo then
      if tg_op = 'INSERT' then
        raise exception 'El depósito está inactivo' using errcode = 'check_violation';
      elsif new.warehouse_id is distinct from old.warehouse_id then
        raise exception 'El depósito está inactivo' using errcode = 'check_violation';
      end if;
    end if;

  elsif tg_table_name = 'maintenance_order_checks' then
    select company_id into v_otra from maintenance_check_points where id = new.check_point_id;
    if v_otra is distinct from new.company_id then
      raise exception 'El punto de revisión es de otra empresa'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_mql_refs on maintenance_quote_lines;
drop trigger if exists trg_mop_refs on maintenance_order_parts;
drop trigger if exists trg_moc_refs on maintenance_order_checks;

create trigger trg_mql_refs before insert or update on maintenance_quote_lines
  for each row execute function app.coherencia_refs_mant();
create trigger trg_mop_refs before insert or update on maintenance_order_parts
  for each row execute function app.coherencia_refs_mant();
create trigger trg_moc_refs before insert or update on maintenance_order_checks
  for each row execute function app.coherencia_refs_mant();

-- ── 5 · P5 · La cotización con importe necesita moneda ─────────────────────
--
-- Una cotización puede existir sin moneda mientras no tenga nada valorizado.
-- En cuanto aparece la primera línea con importe, la moneda deja de ser
-- opcional: un total numérico sin moneda no significa nada, que es la misma
-- razón por la que en este proyecto ningún importe se muestra sin su código.

create or replace function app.moneda_cotizacion_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_moneda text;
begin
  if new.unit_price <= 0 then return new; end if;

  select quote_currency_code into v_moneda
    from maintenance_orders where id = new.maintenance_order_id;

  if v_moneda is null then
    raise exception 'Antes de cargar una línea con importe hay que elegir la moneda de la cotización'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_mql_moneda on maintenance_quote_lines;
create trigger trg_mql_moneda before insert or update on maintenance_quote_lines
  for each row execute function app.moneda_cotizacion_mant();

-- ── 6 · P4 · La máquina de estados de la cotización ────────────────────────
--
-- Hoy pasaban las seis transiciones por un UPDATE suelto, incluido desaprobar
-- una cotización sin dejar rastro. Para v1:
--
--     pending → approved     por su RPC
--     pending → rejected     por su RPC
--     todo lo demás          rechazado
--
-- `approved` y `rejected` son TERMINALES. Si alguna vez hace falta reabrir,
-- será una acción explícita con su propio nombre y su propio evento, no un
-- UPDATE que deshaga la historia.
--
-- La puerta es la misma de `cerrar_orden_mantenimiento()` y de
-- `confirmar_consumo_mantenimiento()`: un marcador local de transacción. Por un
-- UPDATE suelto no se pasa, así que la auditoría no se puede saltear.

create or replace function app.validar_cotizacion_mant()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_n int;
begin
  if tg_op = 'INSERT' then
    if new.quote_status <> 'pending' then
      raise exception 'Una orden nace con la cotización pendiente: se aprueba o se rechaza después, con su función'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- La moneda se congela junto con la cotización.
  if new.quote_currency_code is distinct from old.quote_currency_code
     and old.quote_status <> 'pending' then
    raise exception 'La cotización está %: su moneda ya no se cambia', old.quote_status
      using errcode = 'restrict_violation';
  end if;

  -- Y no se puede dejar sin moneda una cotización que ya tiene importes.
  if new.quote_currency_code is null and old.quote_currency_code is not null then
    select count(*) into v_n from maintenance_quote_lines
     where maintenance_order_id = new.id and unit_price > 0;
    if v_n > 0 then
      raise exception 'No se puede quitar la moneda: la cotización tiene % línea(s) con importe', v_n
        using errcode = 'check_violation';
    end if;
  end if;

  if new.quote_status is not distinct from old.quote_status then
    return new;
  end if;

  if old.quote_status <> 'pending' then
    raise exception 'La cotización ya está %: es un estado final', old.quote_status
      using errcode = 'restrict_violation';
  end if;
  if new.quote_status not in ('approved','rejected') then
    raise exception 'Transición de cotización no permitida: % → %',
      old.quote_status, new.quote_status using errcode = 'restrict_violation';
  end if;
  if coalesce(current_setting('app.cotizando_mant', true), '') <> new.id::text then
    raise exception 'La cotización se aprueba o se rechaza con su función, no cambiándole el estado'
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_mo_cotizacion on maintenance_orders;
create trigger trg_mo_cotizacion before insert or update on maintenance_orders
  for each row execute function app.validar_cotizacion_mant();

-- ── 7 · La auditoría de la cotización, con su motivo ───────────────────────
--
-- Se reemplaza `auditar_orden_mantenimiento()` para una sola cosa: que el
-- evento `quote_rejected` / `quote_approved` pueda llevar el motivo que escribe
-- la persona. Va por un marcador local de transacción y no por un INSERT
-- aparte, para que siga habiendo UN evento por transición y no dos.
-- El resto de la función queda idéntica a la de la entrega 2.

create or replace function app.auditar_orden_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_accion text; v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'create', null, new.status, auth.uid());

    if not new.repair_required or not new.torque_required then
      insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
      values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
              jsonb_strip_nulls(jsonb_build_object(
                'repair', case when not new.repair_required then true end,
                'torque', case when not new.torque_required then true end,
                'al_crear', true)),
              auth.uid());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case new.status when 'closed' then 'order_closed'
                            when 'cancelled' then 'order_cancelled'
                            else 'status_changed' end,
            old.status, new.status, auth.uid());
  end if;

  if new.stage is distinct from old.stage then
    v_accion := case
      when array_position(app.etapas_requeridas(new.repair_required, new.torque_required), new.stage)
         < array_position(app.etapas_requeridas(new.repair_required, new.torque_required), old.stage)
      then 'stage_reverted' else 'stage_changed' end;
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id, v_accion,
            old.stage, new.stage, auth.uid());
  end if;

  if new.on_hold is distinct from old.on_hold then
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            case when new.on_hold then 'order_put_on_hold' else 'order_resumed' end,
            old.stage, new.stage, auth.uid());
  end if;

  if (old.repair_required and not new.repair_required)
     or (old.torque_required and not new.torque_required) then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id, 'stage_marked_not_required',
            jsonb_strip_nulls(jsonb_build_object(
              'repair', case when old.repair_required and not new.repair_required then true end,
              'torque', case when old.torque_required and not new.torque_required then true end)),
            auth.uid());
  end if;

  if new.quote_status is distinct from old.quote_status
     and new.quote_status in ('approved','rejected') then
    v_motivo := nullif(btrim(coalesce(current_setting('app.motivo_cotizacion_mant', true), '')), '');
    insert into maintenance_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.id,
            'quote_' || new.quote_status, old.quote_status, new.quote_status,
            jsonb_strip_nulls(jsonb_build_object('total', new.quote_total,
                                                 'moneda', new.quote_currency_code,
                                                 'por', new.quote_approved_by_name,
                                                 'motivo', v_motivo)),
            auth.uid());
  end if;

  return new;
end $$;

-- ── 8 · Aprobar y rechazar ─────────────────────────────────────────────────

-- Aprobar.
--
-- Exige al menos una línea. La regla ya existía —`cerrar_orden_mantenimiento()`
-- rechaza cerrar con una cotización aprobada y vacía— y acá sólo se adelanta al
-- momento de aprobar, para que no se pueda llegar al cierre con una orden que
-- es imposible de cerrar.
create or replace function public.aprobar_cotizacion_mantenimiento(
  p_order uuid, p_por text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_o maintenance_orders; v_rol text; v_n int;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  -- El permiso va PRIMERO, antes de cualquier atajo idempotente.
  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para aprobar cotizaciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.quote_status = 'approved' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true, 'estado', 'approved');
  end if;
  if v_o.quote_status <> 'pending' then
    raise exception 'La cotización está %: es un estado final', v_o.quote_status
      using errcode = 'restrict_violation';
  end if;
  if v_o.status <> 'open' then
    raise exception 'La orden % está %', v_o.number, v_o.status
      using errcode = 'restrict_violation';
  end if;

  select count(*) into v_n from maintenance_quote_lines where maintenance_order_id = p_order;
  if v_n = 0 then
    raise exception 'Una cotización sin ninguna línea no se puede aprobar'
      using errcode = 'check_violation';
  end if;
  if v_o.quote_currency_code is null then
    raise exception 'La cotización no tiene moneda' using errcode = 'check_violation';
  end if;

  perform set_config('app.cotizando_mant', p_order::text, true);
  update maintenance_orders
     set quote_status = 'approved',
         quote_approved_at = current_date,
         quote_approved_by_name = nullif(btrim(coalesce(p_por, '')), '')
   where id = p_order;
  perform set_config('app.cotizando_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false,
                            'estado', 'approved', 'lineas', v_n);
end $$;

-- Rechazar.
--
-- No exige líneas: se puede rechazar una cotización que nunca se llegó a
-- armar, y eso es información. El motivo va al diff del evento; no hay columna
-- `quote_rejected_*` y no se inventa ninguna.
create or replace function public.rechazar_cotizacion_mantenimiento(
  p_order uuid, p_motivo text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_o maintenance_orders; v_rol text;
begin
  select * into v_o from maintenance_orders where id = p_order for update;
  if not found then
    raise exception 'La orden no existe' using errcode = 'no_data_found';
  end if;

  v_rol := app."current_role"(v_o.company_id);
  if v_rol is null or v_rol not in ('admin','employee') then
    raise exception 'Sin permiso para rechazar cotizaciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_o.quote_status = 'rejected' then
    return jsonb_build_object('order_id', p_order, 'ya_estaba', true, 'estado', 'rejected');
  end if;
  if v_o.quote_status <> 'pending' then
    raise exception 'La cotización está %: es un estado final', v_o.quote_status
      using errcode = 'restrict_violation';
  end if;
  if v_o.status <> 'open' then
    raise exception 'La orden % está %', v_o.number, v_o.status
      using errcode = 'restrict_violation';
  end if;

  perform set_config('app.cotizando_mant', p_order::text, true);
  perform set_config('app.motivo_cotizacion_mant', coalesce(p_motivo, ''), true);
  update maintenance_orders set quote_status = 'rejected' where id = p_order;
  perform set_config('app.cotizando_mant', '', true);
  perform set_config('app.motivo_cotizacion_mant', '', true);

  return jsonb_build_object('order_id', p_order, 'ya_estaba', false, 'estado', 'rejected');
end $$;

revoke execute on function public.aprobar_cotizacion_mantenimiento(uuid, text) from public, anon;
revoke execute on function public.rechazar_cotizacion_mantenimiento(uuid, text) from public, anon;
grant execute on function public.aprobar_cotizacion_mantenimiento(uuid, text) to authenticated;
grant execute on function public.rechazar_cotizacion_mantenimiento(uuid, text) to authenticated;

-- ── 9 · P6 · El alta de un repuesto queda registrada ───────────────────────
--
-- Sólo al INSERT. Editar la cantidad o el costo de un borrador NO genera
-- eventos: sería el audit log por cada tecla que hay que evitar.
--
-- El borrado SÍ se audita, y es el criterio mínimo para que el historial no
-- mienta: sin esto, un repuesto agregado y después sacado dejaría un
-- `part_added` suelto que hace pensar que sigue ahí. Un repuesto ya consumido
-- no se puede borrar, así que este evento sólo aparece sobre borradores.

create or replace function app.auditar_repuesto_mantenimiento()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if tg_op = 'INSERT' then
    insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (new.company_id, 'maintenance_order', new.maintenance_order_id, 'part_added',
            jsonb_strip_nulls(jsonb_build_object(
              'product_id', new.product_id, 'sku', new.sku_snapshot,
              'cantidad', new.quantity, 'deposito', new.warehouse_id)),
            auth.uid());
    return new;
  end if;

  insert into maintenance_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (old.company_id, 'maintenance_order', old.maintenance_order_id, 'part_removed',
          jsonb_strip_nulls(jsonb_build_object(
            'product_id', old.product_id, 'sku', old.sku_snapshot,
            'cantidad', old.quantity)),
          auth.uid());
  return old;
end $$;

drop trigger if exists trg_mop_auditar on maintenance_order_parts;
create trigger trg_mop_auditar after insert or delete on maintenance_order_parts
  for each row execute function app.auditar_repuesto_mantenimiento();
