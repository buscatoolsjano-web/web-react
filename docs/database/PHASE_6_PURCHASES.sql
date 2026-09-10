-- ============================================================================
-- Fase 6 · Compras — SQL APLICADO (entrega 1)
--
-- Este archivo es el reflejo textual de las migraciones que ya corrieron en
-- el proyecto uaxcfufvapzulqvynanp. No es una propuesta: es lo que hay.
--
-- Compras es funcionalidad NUEVA. Del legacy sólo se migra el maestro de
-- proveedores (entrega 2). El circuito -- pedido → recepción → factura -- se
-- construye acá desde cero, con las convenciones que las fases anteriores nos
-- fueron imponiendo a golpes:
--
--   · currency_code text FK a currencies(code), nunca currency_id.
--   · Totales SIEMPRE del lado del servidor: app.totales_X() STABLE, más un
--     BEFORE UPDATE en la cabecera y un AFTER en las líneas que la empuja.
--     La aplicación no escribe totales.
--   · Los estados derivados (receipt_status) los deriva la base; la
--     aplicación que intente escribirlos es ignorada, no premiada.
--   · RLS con funciones SIN argumentos y DENTRO de un subquery, o se llama
--     por fila.
--   · Numeración por document_sequences, jamás MAX+1.
-- ============================================================================


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_compras_schema
-- versión 20260910121328
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 1 — schema
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Compras se construye como funcionalidad nueva: el legacy tiene un solo
-- pedido de prueba, cero recepciones y cero facturas. Lo único que se migra
-- —en la entrega 2— es el maestro de 142 proveedores.
--
-- Por eso NO se reproduce ninguno de los defectos del legacy: nada de IVA
-- booleano, nada de `entregado[índice]`, nada de proveedor por texto, nada de
-- MAX+1, nada de moneda implícita.

-- ── Proveedores ────────────────────────────────────────────────────────────
create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  -- La referencia comercial que el equipo lee: PROV00008. La identidad es el
  -- uuid; ésta es un dato más, como `legacy_ref` en clientes.
  legacy_ref       text,
  legal_name       text not null,
  trade_name       text,
  tax_id           text,
  email            text,
  phone            text,
  -- La dirección del legacy, TAL CUAL. 122 de 142 parecen estructuradas y 20
  -- son sólo «AR»: partirlas por « · » sería una suposición.
  address_text     text,
  activity         text,
  agent            text,
  -- Forma de pago POR proveedor. El legacy sí la tiene, con 13 valores
  -- distintos en texto libre: incoterms, medios y plazos mezclados.
  payment_terms    text,
  default_currency text references public.currencies(code),
  notes            text,
  status           text not null default 'active'
                   check (status in ('active', 'inactive')),
  legacy_source    text,
  imported_at      timestamptz,
  needs_review     boolean not null default false,
  review_reason    text,
  deleted_at       timestamptz,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now()
);

create unique index uq_suppliers_legacy_ref
  on public.suppliers (company_id, legacy_ref) where legacy_ref is not null;

-- El CUIT se compara por sus dígitos, no por el texto: «30-50328441-0» y
-- «30503284410» son el mismo. Sólo alcanza a los valores que SON un CUIT.
create unique index uq_suppliers_cuit_norm
  on public.suppliers (company_id, (regexp_replace(tax_id, '\D', '', 'g')))
  where tax_id is not null and deleted_at is null
    and length(regexp_replace(tax_id, '\D', '', 'g')) = 11;

create index idx_suppliers_company on public.suppliers (company_id) where deleted_at is null;
create index idx_suppliers_legal_trgm
  on public.suppliers using gin (legal_name extensions.gin_trgm_ops);

-- ── Pedidos a proveedor ────────────────────────────────────────────────────
create table public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  supplier_id    uuid not null references public.suppliers(id),
  number         text not null,
  series_code    text not null default 'PC',
  -- Lo que escribe la gente.
  status         text not null default 'draft'
                 check (status in ('draft', 'confirmed', 'cancelled')),
  -- Lo que DERIVA la base a partir de las recepciones confirmadas. La
  -- aplicación no lo escribe nunca; un trigger lo impide.
  receipt_status text not null default 'pending'
                 check (receipt_status in ('pending', 'partially_received', 'received')),
  currency_code  text not null references public.currencies(code),
  exchange_rate  numeric(18,6) check (exchange_rate is null or exchange_rate > 0),
  order_date     date not null,
  expected_date  date,
  payment_terms  text,
  notes          text,
  subtotal       numeric(18,4) not null default 0,
  tax_amount     numeric(18,4) not null default 0,
  total          numeric(18,4) not null default 0,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_po_company_supplier on public.purchase_orders (company_id, supplier_id);
create index idx_po_estado on public.purchase_orders (company_id, status, receipt_status);

create table public.purchase_order_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  purchase_order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  line_no              int not null check (line_no > 0),
  line_type            text not null default 'product'
                       check (line_type in ('product', 'chapter')),
  -- Nullable a propósito: una línea puede describir algo que no está en el
  -- catálogo. Lo que NO se puede es recibirla (ver goods_receipt_lines).
  product_id           uuid references public.products(id),
  sku_snapshot         text,
  name_snapshot        text,
  description_snapshot text,
  quantity             numeric(18,4) not null default 0 check (quantity >= 0),
  unit_price           numeric(18,4) check (unit_price is null or unit_price >= 0),
  discount_pct         numeric(6,3) not null default 0
                       check (discount_pct >= 0 and discount_pct <= 100),
  -- El mismo CHECK que `sales_quote_lines`. Nada de `iva boolean`.
  tax_treatment        text not null default 'vat_21'
                       check (tax_treatment in ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot    numeric(6,3) check (tax_rate_snapshot is null or tax_rate_snapshot >= 0),
  line_total           numeric(18,4) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (purchase_order_id, line_no)
);

create index idx_pol_order on public.purchase_order_lines (purchase_order_id);
create index idx_pol_product on public.purchase_order_lines (company_id, product_id);

-- ── Recepciones ────────────────────────────────────────────────────────────
create table public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  supplier_id       uuid not null references public.suppliers(id),
  -- Nullable: puede haber una recepción sin pedido previo.
  purchase_order_id uuid references public.purchase_orders(id),
  warehouse_id      uuid not null references public.warehouses(id),
  number            text not null,
  series_code       text not null default 'NEP',
  status            text not null default 'draft'
                    check (status in ('draft', 'confirmed')),
  receipt_date      date not null,
  -- El número del remito que trae el proveedor.
  supplier_document text,
  notes             text,
  confirmed_at      timestamptz,
  confirmed_by      uuid references public.profiles(id),
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_gr_company_supplier on public.goods_receipts (company_id, supplier_id);
create index idx_gr_order on public.goods_receipts (purchase_order_id);

create table public.goods_receipt_lines (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id),
  goods_receipt_id       uuid not null references public.goods_receipts(id) on delete cascade,
  -- LA relación. Nunca un índice de array: eso es lo que costó reconstruir 484
  -- líneas en Ventas.
  purchase_order_line_id uuid references public.purchase_order_lines(id),
  -- NOT NULL: lo que entra al depósito tiene que ser un producto del catálogo,
  -- o el movimiento de stock no tiene a qué apuntar.
  product_id             uuid not null references public.products(id),
  sku_snapshot           text,
  name_snapshot          text,
  quantity               numeric(18,4) not null check (quantity > 0),
  created_at             timestamptz not null default now(),
  -- Una línea del pedido entra una sola vez por recepción; las parciales van
  -- en recepciones distintas.
  unique (goods_receipt_id, purchase_order_line_id)
);

create index idx_grl_receipt on public.goods_receipt_lines (goods_receipt_id);
create index idx_grl_order_line on public.goods_receipt_lines (purchase_order_line_id);

-- ── Facturas de proveedor ──────────────────────────────────────────────────
create table public.supplier_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  supplier_id     uuid not null references public.suppliers(id),
  -- Nuestro número interno.
  number          text not null,
  series_code     text not null default 'FP',
  -- El número que trae impreso la factura del proveedor.
  supplier_number text,
  status          text not null default 'draft'
                  check (status in ('draft', 'registered', 'cancelled')),
  currency_code   text not null references public.currencies(code),
  exchange_rate   numeric(18,6) check (exchange_rate is null or exchange_rate > 0),
  invoice_date    date not null,
  due_date        date,
  payment_terms   text,
  notes           text,
  subtotal        numeric(18,4) not null default 0,
  tax_amount      numeric(18,4) not null default 0,
  total           numeric(18,4) not null default 0,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  unique (company_id, number)
);

create index idx_si_company_supplier on public.supplier_invoices (company_id, supplier_id);
-- Dos facturas del mismo proveedor no pueden traer el mismo número impreso.
create unique index uq_si_supplier_number
  on public.supplier_invoices (company_id, supplier_id, supplier_number)
  where supplier_number is not null;

create table public.supplier_invoice_lines (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id),
  supplier_invoice_id    uuid not null references public.supplier_invoices(id) on delete cascade,
  -- La relación con Compras vive ACÁ y no en la cabecera. Así una factura
  -- puede cubrir varias recepciones, una recepción puede facturarse en
  -- partes, y una línea de flete puede no venir de ninguna recepción.
  goods_receipt_line_id  uuid references public.goods_receipt_lines(id),
  purchase_order_line_id uuid references public.purchase_order_lines(id),
  line_no                int not null check (line_no > 0),
  line_type              text not null default 'product'
                         check (line_type in ('product', 'chapter')),
  product_id             uuid references public.products(id),
  sku_snapshot           text,
  description_snapshot   text,
  quantity               numeric(18,4) not null check (quantity > 0),
  unit_price             numeric(18,4) not null check (unit_price >= 0),
  discount_pct           numeric(6,3) not null default 0
                         check (discount_pct >= 0 and discount_pct <= 100),
  tax_treatment          text not null default 'vat_21'
                         check (tax_treatment in ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot      numeric(6,3) check (tax_rate_snapshot is null or tax_rate_snapshot >= 0),
  line_total             numeric(18,4) not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (supplier_invoice_id, line_no)
);

create index idx_sil_invoice on public.supplier_invoice_lines (supplier_invoice_id);
create index idx_sil_receipt_line on public.supplier_invoice_lines (goods_receipt_line_id);

-- ── Auditoría propia ───────────────────────────────────────────────────────
--
-- Separada de `sales_audit` a propósito: las suites de Ventas afirman conteos
-- sobre esa tabla y Ventas está cerrado. Misma filosofía: acciones de negocio,
-- diff chico, sin filas completas, sin triggers genéricos de UPDATE.
create table public.purchases_audit (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id),
  entity_type text not null
              check (entity_type in ('supplier', 'purchase_order', 'goods_receipt', 'supplier_invoice')),
  entity_id   uuid not null,
  action      text not null
              check (action in ('create','update','status_change','confirm','cancel','receive','stock_applied','delete')),
  from_status text,
  to_status   text,
  diff        jsonb,
  actor_id    uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index idx_purchases_audit_entidad
  on public.purchases_audit (company_id, entity_type, entity_id, created_at desc);

-- ── Retoques a lo que ya existía ───────────────────────────────────────────

-- Un solo depósito por defecto por empresa. La columna ya existía; le faltaba
-- la garantía.
create unique index uq_warehouse_default
  on public.warehouses (company_id) where is_default;

-- Los adjuntos se reutilizan: sólo hay que dejar entrar las dos entidades
-- nuevas. `purchase_order` ya estaba.
alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check
  check (entity_type = any (array[
    'quote', 'purchase_order', 'order', 'delivery', 'invoice', 'payment',
    'customer', 'goods_receipt', 'supplier_invoice', 'supplier'
  ]));

-- Que una recepción mueva el stock dos veces pasa a ser IMPOSIBLE a nivel de
-- base, no sólo improbable a nivel de aplicación.
create unique index uq_stock_mov_recepcion
  on public.stock_movements (source_type, source_id, product_id, warehouse_id)
  where source_type = 'goods_receipt';


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_compras_totales_y_estados
-- versión 20260910121423
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 1 — totales, tratamientos y estados
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La alícuota sale del tratamiento, no de un booleano ────────────────────
--
-- El legacy guardaba `iva: true` y después hacía `Number(true)`, que da 1: sus
-- notas de entrega de proveedor habrían salido con 1 % de IVA. Acá el
-- tratamiento es un valor del CHECK y la alícuota se deriva de él.
--
-- `other` devuelve null a propósito: si alguien elige «otro», tiene que decir
-- cuál es la alícuota. No se supone 21.
create or replace function app.tasa_de_tratamiento(p_tratamiento text)
returns numeric
language sql
immutable
as $$
  select case p_tratamiento
           when 'vat_21'    then 21.0
           when 'vat_105'   then 10.5
           when 'vat_0'     then 0.0
           when 'exempt'    then 0.0
           when 'not_taxed' then 0.0
           else null
         end::numeric;
$$;

-- ── Normalización de la línea ──────────────────────────────────────────────
--
-- Completa la alícuota cuando no vino y calcula el neto de la línea. Un
-- capítulo es un título: no suma.
create or replace function app.normalizar_linea_compra()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.tax_rate_snapshot is null then
    new.tax_rate_snapshot := app.tasa_de_tratamiento(new.tax_treatment);
  end if;

  if new.line_type = 'chapter' then
    new.line_total := 0;
  else
    new.line_total := round(
      coalesce(new.quantity, 0) * coalesce(new.unit_price, 0)
      * (1 - coalesce(new.discount_pct, 0) / 100), 4);
  end if;

  return new;
end $$;

create trigger trg_pol_normalizar
  before insert or update on public.purchase_order_lines
  for each row execute function app.normalizar_linea_compra();

create trigger trg_sil_normalizar
  before insert or update on public.supplier_invoice_lines
  for each row execute function app.normalizar_linea_compra();

-- ── Totales, calculados por el servidor ────────────────────────────────────
create or replace function app.totales_pedido_compra(p_order uuid)
returns table (subtotal numeric, tax_amount numeric, total numeric)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with l as (
    select line_total neto, coalesce(tax_rate_snapshot, 0) / 100 tasa
      from purchase_order_lines
     where purchase_order_id = p_order and line_type <> 'chapter'
  ), c as (
    select round(coalesce(sum(neto), 0), 2) sub,
           round(coalesce(sum(neto * tasa), 0), 2) iva
      from l
  )
  select c.sub, c.iva, c.sub + c.iva from c;
$$;

create or replace function app.totales_factura_proveedor(p_invoice uuid)
returns table (subtotal numeric, tax_amount numeric, total numeric)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with l as (
    select line_total neto, coalesce(tax_rate_snapshot, 0) / 100 tasa
      from supplier_invoice_lines
     where supplier_invoice_id = p_invoice and line_type <> 'chapter'
  ), c as (
    select round(coalesce(sum(neto), 0), 2) sub,
           round(coalesce(sum(neto * tasa), 0), 2) iva
      from l
  )
  select c.sub, c.iva, c.sub + c.iva from c;
$$;

create or replace function app.recalcular_totales_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare t record;
begin
  select * into t from app.totales_pedido_compra(new.id);
  new.subtotal   := t.subtotal;
  new.tax_amount := t.tax_amount;
  new.total      := t.total;
  return new;
end $$;

create or replace function app.recalcular_totales_factura_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare t record;
begin
  select * into t from app.totales_factura_proveedor(new.id);
  new.subtotal   := t.subtotal;
  new.tax_amount := t.tax_amount;
  new.total      := t.total;
  return new;
end $$;

-- Cambiar una línea toca la cabecera, y tocar la cabecera dispara el recálculo.
create or replace function app.empujar_totales_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update purchase_orders set updated_at = now()
   where id = coalesce(new.purchase_order_id, old.purchase_order_id);
  return coalesce(new, old);
end $$;

create or replace function app.empujar_totales_factura_proveedor()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update supplier_invoices set updated_at = now()
   where id = coalesce(new.supplier_invoice_id, old.supplier_invoice_id);
  return coalesce(new, old);
end $$;

-- ── El estado de recepción lo deriva la base ───────────────────────────────
--
-- Se compara, línea por línea, lo pedido contra lo recibido en recepciones
-- CONFIRMADAS. Un borrador de recepción no cuenta para nada.
create or replace function app.derivar_receipt_status(p_order uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_lineas int;
  v_completas int;
  v_algo numeric;
  v_estado text;
begin
  select count(*) into v_lineas
    from purchase_order_lines
   where purchase_order_id = p_order and line_type <> 'chapter' and quantity > 0;

  if v_lineas = 0 then
    return 'pending';
  end if;

  select count(*) filter (where recibido >= pedido),
         coalesce(sum(recibido), 0)
    into v_completas, v_algo
    from (
      select l.quantity pedido,
             coalesce((
               select sum(rl.quantity)
                 from goods_receipt_lines rl
                 join goods_receipts r on r.id = rl.goods_receipt_id
                where rl.purchase_order_line_id = l.id
                  and r.status = 'confirmed'
             ), 0) recibido
        from purchase_order_lines l
       where l.purchase_order_id = p_order
         and l.line_type <> 'chapter' and l.quantity > 0
    ) x;

  if v_completas = v_lineas then v_estado := 'received';
  elsif v_algo > 0        then v_estado := 'partially_received';
  else                         v_estado := 'pending';
  end if;

  -- La marca deja pasar el UPDATE por el trigger que protege la columna.
  perform set_config('app.derivando_recepcion', p_order::text, true);
  update purchase_orders set receipt_status = v_estado where id = p_order;
  perform set_config('app.derivando_recepcion', '', true);

  return v_estado;
end $$;

-- La aplicación NO escribe `receipt_status`. Si lo intenta, se ignora.
create or replace function app.proteger_receipt_status()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.receipt_status is distinct from old.receipt_status
     and coalesce(current_setting('app.derivando_recepcion', true), '') <> new.id::text then
    new.receipt_status := old.receipt_status;
  end if;
  return new;
end $$;

-- ── Las líneas se congelan cuando ya se recibió algo ───────────────────────
--
-- Es la regla del legacy y es buena: con una recepción confirmada, editar lo
-- pedido cambiaría el sentido de lo ya recibido.
create or replace function app.proteger_lineas_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_order uuid; v_recibidas int;
begin
  v_order := coalesce(new.purchase_order_id, old.purchase_order_id);

  select count(*) into v_recibidas
    from goods_receipt_lines rl
    join goods_receipts r on r.id = rl.goods_receipt_id
    join purchase_order_lines l on l.id = rl.purchase_order_line_id
   where l.purchase_order_id = v_order and r.status = 'confirmed';

  if v_recibidas > 0 then
    raise exception 'El pedido ya tiene mercadería recibida: sus líneas no se editan'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end $$;

-- ── Un pedido con recepciones confirmadas no se cancela ────────────────────
create or replace function app.proteger_estado_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_recibidas int;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    select count(*) into v_recibidas
      from goods_receipt_lines rl
      join goods_receipts r on r.id = rl.goods_receipt_id
      join purchase_order_lines l on l.id = rl.purchase_order_line_id
     where l.purchase_order_id = new.id and r.status = 'confirmed';

    if v_recibidas > 0 then
      raise exception 'No se puede cancelar: el pedido ya tiene mercadería recibida'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

-- ── Triggers ───────────────────────────────────────────────────────────────
create trigger trg_po_totales
  before update on public.purchase_orders
  for each row execute function app.recalcular_totales_pedido_compra();

create trigger trg_po_receipt_status
  before update on public.purchase_orders
  for each row execute function app.proteger_receipt_status();

create trigger trg_po_estado
  before update on public.purchase_orders
  for each row execute function app.proteger_estado_pedido_compra();

create trigger trg_pol_empujar
  after insert or update or delete on public.purchase_order_lines
  for each row execute function app.empujar_totales_pedido_compra();

create trigger trg_pol_congelar
  before update or delete on public.purchase_order_lines
  for each row execute function app.proteger_lineas_pedido_compra();

create trigger trg_si_totales
  before update on public.supplier_invoices
  for each row execute function app.recalcular_totales_factura_proveedor();

create trigger trg_sil_empujar
  after insert or update or delete on public.supplier_invoice_lines
  for each row execute function app.empujar_totales_factura_proveedor();

create trigger trg_suppliers_touch
  before update on public.suppliers
  for each row execute function app.touch_updated_at();

create trigger trg_gr_touch
  before update on public.goods_receipts
  for each row execute function app.touch_updated_at();


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_compras_rls_funciones_y_series
-- versión 20260910121538
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 1 — RLS, funciones y numeración
-- ═══════════════════════════════════════════════════════════════════════════

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Compras es admin y employee, y nadie más. Un pedido de compra lleva precio
-- de costo: un vendedor que lo lea puede deducir el margen de cada producto.
-- El legacy no prueba que lo necesite. Si aparece la necesidad, se abre la
-- lectura y se prueba; es una línea.
--
-- `app.current_writer_company_ids()` es exactamente admin + employee.
alter table public.suppliers               enable row level security;
alter table public.purchase_orders         enable row level security;
alter table public.purchase_order_lines    enable row level security;
alter table public.goods_receipts          enable row level security;
alter table public.goods_receipt_lines     enable row level security;
alter table public.supplier_invoices       enable row level security;
alter table public.supplier_invoice_lines  enable row level security;
alter table public.purchases_audit         enable row level security;

create policy suppliers_all on public.suppliers
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy purchase_orders_all on public.purchase_orders
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy purchase_order_lines_all on public.purchase_order_lines
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy goods_receipts_all on public.goods_receipts
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy goods_receipt_lines_all on public.goods_receipt_lines
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy supplier_invoices_all on public.supplier_invoices
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

create policy supplier_invoice_lines_all on public.supplier_invoice_lines
  for all to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())))
  with check (company_id in (select unnest(app.current_writer_company_ids())));

-- La auditoría se lee, no se escribe desde la aplicación: para escribir está
-- `registrar_evento_compra`, que verifica el permiso.
create policy purchases_audit_select on public.purchases_audit
  for select to authenticated
  using (company_id in (select unnest(app.current_writer_company_ids())));

-- ── Auditoría ──────────────────────────────────────────────────────────────
--
-- La empresa NO se recibe por parámetro: se resuelve desde la entidad, así
-- nadie puede escribir un evento en la auditoría de otra empresa.
create or replace function public.registrar_evento_compra(
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_from_status text default null,
  p_to_status   text default null,
  p_diff        jsonb default null
) returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_company uuid; v_id bigint;
begin
  v_company := case p_entity_type
    when 'supplier'         then (select company_id from suppliers          where id = p_entity_id)
    when 'purchase_order'   then (select company_id from purchase_orders    where id = p_entity_id)
    when 'goods_receipt'    then (select company_id from goods_receipts     where id = p_entity_id)
    when 'supplier_invoice' then (select company_id from supplier_invoices  where id = p_entity_id)
  end;

  if v_company is null then
    raise exception 'La entidad % / % no existe', p_entity_type, p_entity_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'Sin permiso para auditar en esa empresa'
      using errcode = 'insufficient_privilege';
  end if;

  insert into purchases_audit (company_id, entity_type, entity_id, action,
                               from_status, to_status, diff, actor_id)
  values (v_company, p_entity_type, p_entity_id, p_action,
          p_from_status, p_to_status, p_diff, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

-- ── Confirmar una recepción ────────────────────────────────────────────────
--
-- Todo o nada, y una sola vez. Misma forma que `confirmar_entrega` de Ventas,
-- que ya está probada:
--
--   1. bloquea la fila (dos pestañas se serializan)
--   2. si YA estaba confirmada, devuelve lo mismo y no toca nada
--   3. valida permiso
--   4. valida, línea por línea, que no se reciba más de lo pendiente
--   5. inserta los movimientos de stock
--   6. cierra la recepción
--   7. deriva el estado del pedido
--   8. audita
create or replace function public.confirmar_recepcion(p_receipt uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_r          goods_receipts;
  v_rol        text;
  v_linea      record;
  v_pendiente  numeric;
  v_movs       int := 0;
  v_estado_po  text;
begin
  select * into v_r from goods_receipts where id = p_receipt for update;
  if not found then
    raise exception 'La recepción no existe' using errcode = 'no_data_found';
  end if;

  -- Idempotencia: doble click, refresh o dos pestañas no suman stock dos veces.
  if v_r.status = 'confirmed' then
    return jsonb_build_object(
      'receipt_id', p_receipt, 'ya_estaba', true,
      'movimientos', (select count(*) from stock_movements
                       where source_type = 'goods_receipt' and source_id = p_receipt),
      'receipt_status_pedido', (select receipt_status from purchase_orders where id = v_r.purchase_order_id));
  end if;

  v_rol := app."current_role"(v_r.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para confirmar recepciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from goods_receipt_lines where goods_receipt_id = p_receipt) then
    raise exception 'La recepción no tiene líneas' using errcode = 'restrict_violation';
  end if;

  -- Sobre-recepción: se RECHAZA. No se recorta en silencio ni queda stock sin
  -- explicación.
  for v_linea in
    select rl.id, rl.quantity, rl.product_id, rl.purchase_order_line_id,
           l.quantity pedida, l.line_no
      from goods_receipt_lines rl
      left join purchase_order_lines l on l.id = rl.purchase_order_line_id
     where rl.goods_receipt_id = p_receipt
  loop
    if v_linea.purchase_order_line_id is not null then
      select v_linea.pedida - coalesce(sum(rl2.quantity), 0)
        into v_pendiente
        from goods_receipt_lines rl2
        join goods_receipts r2 on r2.id = rl2.goods_receipt_id
       where rl2.purchase_order_line_id = v_linea.purchase_order_line_id
         and r2.status = 'confirmed';

      if v_linea.quantity > v_pendiente then
        raise exception
          'Línea %: se intenta recibir % y quedan % pendientes', v_linea.line_no,
          v_linea.quantity, v_pendiente
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- El movimiento de stock. El índice único sobre (source_type, source_id,
  -- product_id, warehouse_id) hace imposible duplicarlo.
  insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                               quantity, source_type, source_id, notes, created_by)
  select v_r.company_id, rl.product_id, v_r.warehouse_id, 'purchase_receipt',
         sum(rl.quantity), 'goods_receipt', p_receipt,
         'Recepción ' || v_r.number, auth.uid()
    from goods_receipt_lines rl
   where rl.goods_receipt_id = p_receipt
   group by rl.product_id;
  get diagnostics v_movs = row_count;

  update goods_receipts
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_receipt;

  if v_r.purchase_order_id is not null then
    v_estado_po := app.derivar_receipt_status(v_r.purchase_order_id);
    perform registrar_evento_compra('purchase_order', v_r.purchase_order_id,
      'receive', null, v_estado_po,
      jsonb_build_object('recepcion', v_r.number));
  end if;

  perform registrar_evento_compra('goods_receipt', p_receipt, 'confirm',
    'draft', 'confirmed', jsonb_build_object('movimientos', v_movs));

  return jsonb_build_object(
    'receipt_id', p_receipt, 'ya_estaba', false,
    'movimientos', v_movs, 'receipt_status_pedido', v_estado_po);
end $$;

revoke all on function public.registrar_evento_compra(text, uuid, text, text, text, jsonb) from public;
revoke all on function public.confirmar_recepcion(uuid) from public;
grant execute on function public.registrar_evento_compra(text, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.confirmar_recepcion(uuid) to authenticated;

-- ── Numeración ─────────────────────────────────────────────────────────────
--
-- `next_document_number` NO se toca: su rama por defecto ya exige
-- `app.current_writer_company_ids()`, que es exactamente quién puede crear
-- documentos de compras. Sólo hay que sembrar las series.
--
-- Proveedores arranca en 146: el máximo real del legacy es PROV00145 y los 3
-- huecos NO se rellenan. Pedidos arranca en 2 para no reutilizar PC00001, que
-- queda como fixture de prueba y no se migra.
insert into public.document_sequences
  (company_id, doc_type, series_code, prefix, padding, next_number, is_default)
select c.id, d.doc_type, d.series_code, d.prefix, 5, d.next_number, true
from public.companies c
cross join (values
  ('supplier',         'PROV', 'PROV', 1),
  ('purchase_order',   'PC',   'PC',   1),
  ('goods_receipt',    'NEP',  'NEP',  1),
  ('supplier_invoice', 'FP',   'FP',   1)
) as d(doc_type, series_code, prefix, next_number)
where not exists (
  select 1 from public.document_sequences s
   where s.company_id = c.id and s.doc_type = d.doc_type
);

update public.document_sequences s
   set next_number = 146
  from public.companies c
 where c.id = s.company_id and c.slug = 'buscatools' and s.doc_type = 'supplier';

update public.document_sequences s
   set next_number = 2
  from public.companies c
 where c.id = s.company_id and c.slug = 'buscatools' and s.doc_type = 'purchase_order';


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_compras_endurecimiento_advisors
-- versión 20260910123224
-- --------------------------------------------------------------------------

-- 1. search_path fijo en la única función de Compras que quedó sin él.
--    No referencia objetos, pero la casa exige que toda función de `app` lo tenga.
alter function app.tasa_de_tratamiento(text) set search_path = public, pg_temp;

-- 2. `anon` no debe poder ejecutar RPCs SECURITY DEFINER.
--    Las gemelas de Ventas (confirmar_entrega, registrar_evento_venta) ya lo tenían
--    revocado; las de Compras y la de Clientes quedaron con el EXECUTE por defecto.
revoke execute on function public.confirmar_recepcion(uuid) from anon;
revoke execute on function public.registrar_evento_compra(text, uuid, text, text, text, jsonb) from anon;
revoke execute on function public.resolver_revision_cliente(uuid, text[]) from anon;

-- 3. Índice sobre la FK que sí está en un camino de consulta real:
--    derivar lo facturado por línea de pedido parte de purchase_order_line_id.
create index if not exists idx_sil_order_line
  on public.supplier_invoice_lines (purchase_order_line_id)
  where purchase_order_line_id is not null;


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_proveedores_pais_y_adjuntos
-- versión 20260910125441 · entrega 2
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 2 — lo que le faltaba al schema para proveedores
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · País del proveedor
--
-- `suppliers` no tenía NINGÚN campo estructurado de dirección, sólo
-- `address_text`. Se agrega uno solo: el país.
--
-- No es intuición y no es parsear la dirección: en el maestro legacy los 142
-- registros terminan en un código de dos letras —o SON un código de dos
-- letras y nada más—, 142 de 142, sin una sola excepción. AR 136, ES 2, IT 2,
-- UY 1, US 1.
--
-- `address_text` se guarda ENTERO y sin tocar, con el país incluido. Esta
-- columna se siembra una vez en la migración y después es un campo más que se
-- edita a mano: nunca se vuelve a derivar de la dirección, así que las dos
-- cosas no pueden pelearse.
--
-- Calle, localidad, provincia y CP NO se separan. Ahí sí habría que adivinar.
alter table public.suppliers add column if not exists country_code text;

alter table public.suppliers drop constraint if exists suppliers_country_code_check;
alter table public.suppliers add constraint suppliers_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

comment on column public.suppliers.country_code is
  'Código de país de dos letras. Se sembró desde el último segmento de la dirección legacy (142/142 exactos) y desde entonces se edita a mano; no se deriva de address_text.';

-- 2 · Los adjuntos de Compras no son de Ventas
--
-- `attachments_select` dejaba leer a `app.current_internal_company_ids()`, que
-- incluye salesperson y technician. Con Ventas estaba bien. Pero la entrega 1
-- habilitó `supplier`, `purchase_order`, `goods_receipt` y `supplier_invoice`
-- en el CHECK de `entity_type`, y Compras es admin + employee: un salesperson
-- podía leer la fila del adjunto de un proveedor que no puede ni ver —nombre
-- de archivo, tamaño y ruta— y, con esa fila, la policy del bucket le dejaba
-- firmar la URL y bajarse el archivo.
--
-- Se parte la condición por tipo de entidad. Ventas queda exactamente igual.
alter policy attachments_select on public.attachments
using (
  case
    when entity_type in ('supplier', 'purchase_order', 'goods_receipt', 'supplier_invoice')
      then company_id in (select unnest(app.current_writer_company_ids()))
    else company_id in (select unnest(app.current_internal_company_ids()))
  end
);


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_proteger_borrado_proveedor
-- versión 20260910131825 · entrega 2
-- --------------------------------------------------------------------------

-- Un proveedor con documentos no se borra: se da de baja.
--
-- La policy de `suppliers` es `FOR ALL`, así que también autoriza DELETE. En
-- la entrega 1 di por sentado que no —los clientes no tienen policy de DELETE—
-- y el test de la entrega 2 lo desmintió: un admin borró un proveedor de una
-- fila.
--
-- No se le saca el DELETE a la policy: partirla en cuatro por esto sería
-- rehacer algo probado. Se pone la misma guarda que tiene Clientes,
-- `app.proteger_borrado_cliente()`, que además protege contra el borrado por
-- la clave de servicio —un trigger corre igual— cosa que una policy no hace.
--
-- Los adjuntos cuentan: un proveedor con una lista de precios subida ya tiene
-- historia, aunque todavía no tenga un pedido.
create or replace function app.proteger_borrado_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_docs int;
begin
  select (select count(*) from purchase_orders   where supplier_id = old.id)
       + (select count(*) from goods_receipts    where supplier_id = old.id)
       + (select count(*) from supplier_invoices where supplier_id = old.id)
       + (select count(*) from attachments
           where entity_type = 'supplier' and entity_id = old.id)
    into v_docs;

  if v_docs > 0 then
    raise exception
      'El proveedor % tiene % documento(s) o adjunto(s): se da de baja, no se borra',
      old.legal_name, v_docs
      using errcode = 'restrict_violation';
  end if;

  return old;
end $$;

drop trigger if exists trg_suppliers_no_borrar on public.suppliers;
create trigger trg_suppliers_no_borrar
  before delete on public.suppliers
  for each row execute function app.proteger_borrado_proveedor();
