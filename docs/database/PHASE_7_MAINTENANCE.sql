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
