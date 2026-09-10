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


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_pedidos_compra_reglas
-- versión 20260910134126 · entrega 3
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 3 — las reglas del pedido de compra
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El schema de la entrega 1 ya tenía las columnas y los totales. Lo que falta
-- es lo que NO puede quedar en un botón deshabilitado: qué se puede editar en
-- cada estado, qué transiciones existen, quién firma cada fila y qué se
-- audita.

-- ── 1 · updated_at y autor ────────────────────────────────────────────────
--
-- `purchase_orders` y sus líneas tienen `updated_at` pero no el trigger que
-- lo mueve: se había quedado sin el `touch` que sí tienen las tablas de
-- Ventas. Y `created_by` / `updated_by` no los puede poner el frontend, por
-- la misma razón por la que `salesperson_id` se asigna en el servidor: no se
-- confía en que el navegador mande el uuid correcto.

create or replace function app.sellar_autor_compra()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.created_by := old.created_by;   -- no se reescribe nunca
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_po_autor on public.purchase_orders;
create trigger trg_po_autor
  before insert or update on public.purchase_orders
  for each row execute function app.sellar_autor_compra();

drop trigger if exists trg_pol_touch on public.purchase_order_lines;
create trigger trg_pol_touch
  before update on public.purchase_order_lines
  for each row execute function app.touch_updated_at();

-- ── 2 · Qué se puede editar en cada estado ────────────────────────────────
--
-- Reemplaza a `proteger_estado_pedido_compra`, que sólo miraba la
-- cancelación. La matriz completa:
--
--                    draft   confirmed   confirmed+recepción   cancelled
--   proveedor          sí       no             no                 no
--   moneda / TC        sí       no             no                 no
--   fecha del pedido   sí       no             no                 no
--   número             no       no             no                 no
--   ETA / cond. pago   sí     sí (auditado)  sí (auditado)        no
--   notas              sí     sí (auditado)  sí (auditado)        no
--   líneas             sí     sí (auditado)    NO                 no
--
-- Un pedido cancelado está congelado. El número no se edita nunca: lo asigna
-- `next_document_number` una sola vez.

create or replace function app.proteger_estado_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_recibidas int;
begin
  -- El número y la serie no se tocan, en ningún estado.
  if new.number is distinct from old.number
     or new.series_code is distinct from old.series_code then
    raise exception 'El número del pedido no se cambia: lo asigna la numeración'
      using errcode = 'restrict_violation';
  end if;

  -- Un pedido cancelado está congelado.
  if old.status = 'cancelled' then
    raise exception 'El pedido % está cancelado: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;

  -- Transiciones válidas: draft → confirmed | cancelled, confirmed → cancelled.
  -- Reabrir un pedido confirmado no está previsto: se cancela y se duplica.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'     and new.status in ('confirmed', 'cancelled')) or
      (old.status = 'confirmed' and new.status = 'cancelled')
    ) then
      raise exception 'Transición no permitida: % → %', old.status, new.status
        using errcode = 'restrict_violation';
    end if;
  end if;

  if old.status = 'confirmed' then
    if new.supplier_id  is distinct from old.supplier_id
       or new.currency_code is distinct from old.currency_code
       or new.exchange_rate is distinct from old.exchange_rate
       or new.order_date    is distinct from old.order_date then
      raise exception
        'El pedido % está confirmado: no se cambian proveedor, moneda ni fecha', old.number
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- Cancelar con mercadería recibida: nunca. Ya hubo impacto operativo.
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

-- ── 3 · Las líneas siguen el estado de su pedido ──────────────────────────
--
-- Antes sólo miraba la mercadería recibida. Ahora también: un pedido
-- cancelado no acepta líneas nuevas ni cambios.

create or replace function app.proteger_lineas_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order uuid; v_estado text; v_numero text; v_recibidas int;
begin
  v_order := coalesce(new.purchase_order_id, old.purchase_order_id);

  select status, number into v_estado, v_numero
    from purchase_orders where id = v_order;

  if v_estado = 'cancelled' then
    raise exception 'El pedido % está cancelado: sus líneas no se editan', v_numero
      using errcode = 'restrict_violation';
  end if;

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

-- El trigger de líneas no cubría el INSERT: se podían agregar líneas a un
-- pedido con mercadería ya recibida.
drop trigger if exists trg_pol_congelar on public.purchase_order_lines;
create trigger trg_pol_congelar
  before insert or update or delete on public.purchase_order_lines
  for each row execute function app.proteger_lineas_pedido_compra();

-- ── 4 · Auditoría: sólo lo que significa algo ─────────────────────────────
--
-- NO se audita cada UPDATE técnico. Se auditan:
--
--   · el alta                                    → create
--   · la confirmación                            → confirm
--   · la cancelación                             → cancel
--   · un cambio en un pedido YA CONFIRMADO        → update, con el diff
--
-- Un pedido en borrador se edita libremente y no deja rastro: todavía no
-- salió de la empresa. Uno confirmado ya se le mandó al proveedor, y ahí sí
-- importa quién cambió qué.
--
-- `receipt_status` y los totales NO cuentan como cambio sensible: los mueve
-- la base sola cuando se confirma una recepción, y eso se audita del lado de
-- la recepción.

create or replace function app.auditar_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    insert into purchases_audit (company_id, entity_type, entity_id, action,
                                 from_status, to_status, actor_id)
    values (new.company_id, 'purchase_order', new.id, 'create',
            null, new.status, auth.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into purchases_audit (company_id, entity_type, entity_id, action,
                                 from_status, to_status, actor_id)
    values (new.company_id, 'purchase_order', new.id,
            case new.status when 'confirmed' then 'confirm'
                            when 'cancelled' then 'cancel'
                            else 'status_change' end,
            old.status, new.status, auth.uid());
    return new;
  end if;

  if old.status = 'confirmed' then
    v_diff := '{}'::jsonb;
    if new.expected_date is distinct from old.expected_date then
      v_diff := v_diff || jsonb_build_object('expected_date',
        jsonb_build_array(old.expected_date, new.expected_date));
    end if;
    if new.payment_terms is distinct from old.payment_terms then
      v_diff := v_diff || jsonb_build_object('payment_terms',
        jsonb_build_array(old.payment_terms, new.payment_terms));
    end if;
    if new.notes is distinct from old.notes then
      v_diff := v_diff || jsonb_build_object('notes',
        jsonb_build_array(old.notes, new.notes));
    end if;

    if v_diff <> '{}'::jsonb then
      insert into purchases_audit (company_id, entity_type, entity_id, action,
                                   from_status, to_status, diff, actor_id)
      values (new.company_id, 'purchase_order', new.id, 'update',
              old.status, new.status, v_diff, auth.uid());
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_po_auditar on public.purchase_orders;
create trigger trg_po_auditar
  after insert or update on public.purchase_orders
  for each row execute function app.auditar_pedido_compra();

-- Un cambio de líneas sobre un pedido confirmado también es sensible.
create or replace function app.auditar_lineas_pedido_compra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order uuid; v_company uuid; v_estado text; v_linea int;
begin
  v_order := coalesce(new.purchase_order_id, old.purchase_order_id);
  select company_id, status into v_company, v_estado
    from purchase_orders where id = v_order;

  if v_estado is distinct from 'confirmed' then
    return coalesce(new, old);
  end if;

  v_linea := coalesce(new.line_no, old.line_no);
  insert into purchases_audit (company_id, entity_type, entity_id, action,
                               from_status, to_status, diff, actor_id)
  values (v_company, 'purchase_order', v_order, 'update', v_estado, v_estado,
          jsonb_build_object('linea', v_linea, 'operacion', lower(tg_op)),
          auth.uid());

  return coalesce(new, old);
end $$;

drop trigger if exists trg_pol_auditar on public.purchase_order_lines;
create trigger trg_pol_auditar
  after insert or update or delete on public.purchase_order_lines
  for each row execute function app.auditar_lineas_pedido_compra();

-- ── 5 · Duplicar un pedido ────────────────────────────────────────────────
--
-- uuid nuevo, número nuevo, `draft`, las líneas con sus snapshots. NO copia
-- recepciones, ni facturas, ni la auditoría del original: el duplicado es un
-- pedido nuevo, no una copia de su historia.
--
-- Va en una sola función porque numerar y copiar tienen que pasar juntos: si
-- el número se toma y el insert falla, queda un hueco.

create or replace function public.duplicar_pedido_compra(p_order uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_o purchase_orders; v_nuevo uuid; v_numero text;
begin
  select * into v_o from purchase_orders where id = p_order;
  if not found then
    raise exception 'El pedido % no existe', p_order using errcode = 'no_data_found';
  end if;

  if v_o.company_id <> all (app.current_writer_company_ids()) then
    raise exception 'Sin permiso sobre ese pedido' using errcode = 'insufficient_privilege';
  end if;

  v_numero := public.next_document_number(v_o.company_id, 'purchase_order', v_o.series_code);

  insert into purchase_orders (company_id, supplier_id, number, series_code, status,
                               currency_code, exchange_rate, order_date, expected_date,
                               payment_terms, notes)
  values (v_o.company_id, v_o.supplier_id, v_numero, v_o.series_code, 'draft',
          v_o.currency_code, v_o.exchange_rate, current_date, v_o.expected_date,
          v_o.payment_terms, v_o.notes)
  returning id into v_nuevo;

  insert into purchase_order_lines (company_id, purchase_order_id, line_no, line_type,
                                    product_id, sku_snapshot, name_snapshot,
                                    description_snapshot, quantity, unit_price,
                                    discount_pct, tax_treatment, tax_rate_snapshot)
  select v_o.company_id, v_nuevo, line_no, line_type, product_id, sku_snapshot,
         name_snapshot, description_snapshot, quantity, unit_price, discount_pct,
         tax_treatment, tax_rate_snapshot
    from purchase_order_lines
   where purchase_order_id = p_order
   order by line_no;

  return v_nuevo;
end $$;

revoke execute on function public.duplicar_pedido_compra(uuid) from public, anon;
grant execute on function public.duplicar_pedido_compra(uuid) to authenticated;

-- ── 6 · El último precio de compra de un producto ─────────────────────────
--
-- No hay ninguna fuente de costo en la base: `price_lists` son las tres
-- listas de VENTA —Lista base, Distribuidores, Especial Cliente Demo—, y
-- `products` no tiene columna de costo. Sugerir un precio de venta como
-- precio de compra sería exactamente el accidente que hay que evitar.
--
-- Así que el precio de compra se escribe a mano. Lo único que se ofrece es
-- un dato REAL: qué se pagó la última vez por ese producto, en esa moneda,
-- en un pedido confirmado. Si nunca se compró, no devuelve nada. No
-- autocompleta: es un dato al lado del campo.

create or replace function public.ultimo_precio_compra(
  p_company uuid,
  p_products uuid[],
  p_currency text,
  p_supplier uuid default null
)
returns table (
  product_id uuid,
  unit_price numeric,
  discount_pct numeric,
  order_number text,
  order_date date,
  supplier_name text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct on (l.product_id)
         l.product_id, l.unit_price, l.discount_pct, o.number, o.order_date, s.legal_name
    from purchase_order_lines l
    join purchase_orders o on o.id = l.purchase_order_id
    join suppliers s on s.id = o.supplier_id
   where o.company_id = p_company
     and o.status = 'confirmed'
     and o.currency_code = p_currency
     and l.product_id = any (p_products)
     and l.unit_price is not null
     and (p_supplier is null or o.supplier_id = p_supplier)
   order by l.product_id, o.order_date desc, o.created_at desc;
$$;

revoke execute on function public.ultimo_precio_compra(uuid, uuid[], text, uuid) from public, anon;
grant execute on function public.ultimo_precio_compra(uuid, uuid[], text, uuid) to authenticated;

-- ── 7 · Índice para el listado ────────────────────────────────────────────
--
-- El listado ordena por fecha y filtra por empresa. `idx_po_estado` cubre el
-- filtro por estado, pero no el orden por defecto.
create index if not exists idx_po_fecha
  on public.purchase_orders (company_id, order_date desc, number desc);


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_alicuota_siempre_del_tratamiento
-- versión 20260910140432 · entrega 3
-- --------------------------------------------------------------------------

-- El bug del 1 % del legacy SÍ se podía reproducir.
--
-- `app.normalizar_linea_compra()` derivaba la alícuota del tratamiento sólo
-- cuando venía en null. Mandando `tax_treatment = 'vat_21'` junto con
-- `tax_rate_snapshot = 1` la línea quedaba con IVA al 1 %: exactamente lo que
-- hacía el legacy, y exactamente lo que la entrega 1 dijo que no se podía
-- hacer. El test de la entrega 3 lo desmintió.
--
-- La entrega 1 sólo había probado que un TRATAMIENTO inventado se rechaza. El
-- agujero era el otro: el tratamiento válido con la alícuota escrita a mano.
--
-- Ahora la alícuota se deriva SIEMPRE del tratamiento y se pisa lo que venga.
-- La única excepción es `other`, que existe justamente para las alícuotas que
-- no están en la lista: ahí `app.tasa_de_tratamiento()` devuelve null y la
-- escribe quien carga el documento.
--
-- Vale para las líneas de pedido y para las de factura de proveedor: las dos
-- usan este trigger.
create or replace function app.normalizar_linea_compra()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tax_treatment = 'other' then
    -- La única alícuota que se escribe a mano. Sin ella la línea no tiene
    -- impuesto calculable, y el CHECK ya exige que no sea negativa.
    new.tax_rate_snapshot := new.tax_rate_snapshot;
  else
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


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_limpiar_auditoria_huerfana_de_pruebas
-- versión 20260910140758 · entrega 3
-- --------------------------------------------------------------------------

-- Limpieza de eventos huérfanos que dejaron las corridas de prueba.
--
-- La suite de la entrega 3 borraba la auditoría ANTES que las líneas, y
-- borrar una línea de un pedido confirmado dispara `trg_pol_auditar`, que
-- escribe un evento nuevo. Resultado: filas apuntando a pedidos y recepciones
-- que ya no existen.
--
-- No hay ningún documento de compra real todavía, así que esto no toca nada
-- productivo. La suite quedó corregida para borrar la auditoría al final.
delete from purchases_audit a
where not exists (select 1 from purchase_orders   o where o.id = a.entity_id)
  and not exists (select 1 from suppliers         s where s.id = a.entity_id)
  and not exists (select 1 from goods_receipts    r where r.id = a.entity_id)
  and not exists (select 1 from supplier_invoices i where i.id = a.entity_id);


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_normalizar_linea_compra_security_definer
-- versión 20260910142647 · entrega 3 (revisión visual)
-- --------------------------------------------------------------------------

-- `service_role` no podía insertar líneas de compra.
--
-- `app.normalizar_linea_compra()` es un trigger SECURITY INVOKER que llama a
-- `app.tasa_de_tratamiento()`. `authenticated` tiene USAGE sobre el esquema
-- `app`, pero `service_role` NO, así que cualquier script que corra con la
-- clave de servicio se choca con `42501: permission denied for schema app` al
-- insertar una línea de pedido o de factura de proveedor.
--
-- Apareció armando datos de prueba para la revisión visual, no en la suite:
-- la suite escribe con una sesión `authenticated`, que sí tiene el permiso.
-- Era un agujero latente desde la entrega 1 que iba a aparecer en la
-- migración de datos de la entrega 4.
--
-- Se arregla poniendo el trigger en SECURITY DEFINER —como ya están los otros
-- de Compras— y no dándole a `service_role` USAGE sobre `app`: el esquema es
-- interno a propósito y abrirlo entero para esto sería aflojar de más.
-- La función sólo calcula valores a partir de NEW y tiene `search_path` fijo.
alter function app.normalizar_linea_compra() security definer;


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_recepciones_reglas_y_concurrencia
-- versión 20260910150610 · entrega 4
-- --------------------------------------------------------------------------

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 4 — recepciones: coherencia, congelado y carrera
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Una línea libre se puede recibir, pero no genera stock ─────────────
--
-- `goods_receipt_lines.product_id` era NOT NULL, así que una línea libre del
-- pedido —un flete, un servicio, algo que no está en el catálogo— NO SE PODÍA
-- RECIBIR. Y `app.derivar_receipt_status()` cuenta todas las líneas que no son
-- capítulo: un pedido con una línea de flete no podía llegar nunca a
-- `received`.
--
-- Ahora se puede recibir documentalmente y **no mueve stock**: no hay producto
-- de catálogo al que sumarle nada, y `stock_movements.product_id` es NOT NULL
-- justamente porque un movimiento sin producto no significa nada.
alter table public.goods_receipt_lines alter column product_id drop not null;

-- Y no se puede inventar un producto donde el pedido no tenía ninguno, ni
-- perderlo donde sí lo tenía: el producto de la recepción es el de la línea
-- del pedido. Lo comprueba `app.validar_linea_recepcion()`.

-- ── 2 · Coherencia de la cabecera ─────────────────────────────────────────
--
-- Faltaba todo esto: nada impedía recibir en el depósito de OTRA empresa, ni
-- contra un pedido de otra empresa, ni contra un pedido de otro proveedor, ni
-- contra un pedido en borrador o cancelado.

create or replace function app.validar_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_dep record; v_po record;
begin
  select company_id, is_active into v_dep from warehouses where id = new.warehouse_id;
  if v_dep is null then
    raise exception 'El depósito no existe' using errcode = 'foreign_key_violation';
  end if;
  if v_dep.company_id <> new.company_id then
    raise exception 'El depósito es de otra empresa' using errcode = 'check_violation';
  end if;
  if not v_dep.is_active then
    raise exception 'El depósito está inactivo' using errcode = 'check_violation';
  end if;

  if new.purchase_order_id is not null then
    select company_id, supplier_id, status, number into v_po
      from purchase_orders where id = new.purchase_order_id;
    if v_po is null then
      raise exception 'El pedido no existe' using errcode = 'foreign_key_violation';
    end if;
    if v_po.company_id <> new.company_id then
      raise exception 'El pedido es de otra empresa' using errcode = 'check_violation';
    end if;
    if v_po.supplier_id <> new.supplier_id then
      raise exception 'El pedido % es de otro proveedor', v_po.number
        using errcode = 'check_violation';
    end if;
    -- Sólo se recibe contra un pedido confirmado. Un borrador todavía no se
    -- mandó; uno cancelado ya no espera nada.
    if v_po.status <> 'confirmed' then
      raise exception 'El pedido % no está confirmado: no se puede recibir contra él',
        v_po.number using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_gr_validar on public.goods_receipts;
create trigger trg_gr_validar
  before insert or update on public.goods_receipts
  for each row execute function app.validar_recepcion();

-- ── 3 · Coherencia de la línea ────────────────────────────────────────────

create or replace function app.validar_linea_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_r record; v_l record;
begin
  select company_id, purchase_order_id, status into v_r
    from goods_receipts where id = new.goods_receipt_id;

  if new.company_id <> v_r.company_id then
    raise exception 'La línea es de otra empresa que la recepción'
      using errcode = 'check_violation';
  end if;

  if new.purchase_order_line_id is null then
    -- Una recepción contra un pedido recibe LO DEL PEDIDO. Recibir algo que
    -- nadie pidió no es una recepción: es un ajuste de stock, y eso ya existe.
    if v_r.purchase_order_id is not null then
      raise exception 'La línea tiene que apuntar a una línea del pedido'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select purchase_order_id, product_id, line_type, line_no into v_l
    from purchase_order_lines where id = new.purchase_order_line_id;

  if v_r.purchase_order_id is null or v_l.purchase_order_id <> v_r.purchase_order_id then
    raise exception 'Esa línea no es del pedido de esta recepción'
      using errcode = 'check_violation';
  end if;
  if v_l.line_type = 'chapter' then
    raise exception 'Un capítulo no se recibe' using errcode = 'check_violation';
  end if;
  -- El producto no se elige: es el de la línea del pedido. Ni se inventa donde
  -- no había, ni se cambia por otro.
  if new.product_id is distinct from v_l.product_id then
    raise exception 'La línea % del pedido es de otro producto', v_l.line_no
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_grl_validar on public.goods_receipt_lines;
create trigger trg_grl_validar
  before insert or update on public.goods_receipt_lines
  for each row execute function app.validar_linea_recepcion();

-- ── 4 · Una recepción confirmada está congelada ───────────────────────────
--
-- No se edita, no se vuelve a borrador, no se borra. La reversión de una
-- recepción confirmada sería un contramovimiento explícito de stock, y eso NO
-- está en v1.

create or replace function app.proteger_recepcion_confirmada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then
      raise exception 'La recepción % está confirmada: movió stock y no se borra', old.number
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'La recepción % está confirmada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;
  if new.number is distinct from old.number or new.series_code is distinct from old.series_code then
    raise exception 'El número de la recepción no se cambia' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_gr_congelar on public.goods_receipts;
create trigger trg_gr_congelar
  before update or delete on public.goods_receipts
  for each row execute function app.proteger_recepcion_confirmada();

create or replace function app.proteger_lineas_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_estado text; v_numero text;
begin
  select status, number into v_estado, v_numero
    from goods_receipts where id = coalesce(new.goods_receipt_id, old.goods_receipt_id);

  -- Si la recepción ya no existe, esto es el CASCADE de su borrado: no hay
  -- nada que proteger.
  if v_estado is null then return coalesce(new, old); end if;

  if v_estado = 'confirmed' then
    raise exception 'La recepción % está confirmada: sus líneas no se tocan', v_numero
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_grl_congelar on public.goods_receipt_lines;
create trigger trg_grl_congelar
  before insert or update or delete on public.goods_receipt_lines
  for each row execute function app.proteger_lineas_recepcion();

-- ── 5 · Autor y auditoría del alta ────────────────────────────────────────

create or replace function app.sellar_autor_recepcion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_gr_autor on public.goods_receipts;
create trigger trg_gr_autor
  before insert or update on public.goods_receipts
  for each row execute function app.sellar_autor_recepcion();

create or replace function app.auditar_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into purchases_audit (company_id, entity_type, entity_id, action,
                               from_status, to_status, diff, actor_id)
  values (new.company_id, 'goods_receipt', new.id, 'create', null, new.status,
          case when new.purchase_order_id is null then null
               else jsonb_build_object('pedido', new.purchase_order_id) end,
          auth.uid());
  return new;
end $$;

drop trigger if exists trg_gr_auditar on public.goods_receipts;
create trigger trg_gr_auditar
  after insert on public.goods_receipts
  for each row execute function app.auditar_recepcion();

-- ── 6 · Lo pendiente de un pedido, con lo que hay en borradores ───────────
--
-- Los borradores NO reservan nada. Se midió cómo quedó la entrega 1 y es así:
-- `confirmar_recepcion` calcula lo pendiente contando SÓLO las recepciones
-- confirmadas. Dos borradores de 70 sobre una línea de 100 pueden convivir, y
-- el segundo que intente confirmar falla porque para entonces quedan 30.
--
-- No se agrega un sistema de reservas —ya hay uno, `stock_reservations`, y es
-- de Ventas; usarlo acá sería inventarle un segundo significado—. Lo que sí se
-- hace es DECIRLO: esta función devuelve, además de lo pendiente, cuánto de
-- eso ya está comprometido en borradores y en cuáles. La pantalla lo muestra,
-- y quien recibe decide con el dato a la vista en vez de enterarse al
-- confirmar.
--
-- La contracara es que un borrador abandonado no bloquea mercadería. Es
-- deliberado: un papel olvidado no puede dejar stock inmovilizado para
-- siempre.

create or replace function public.pendiente_de_pedido(
  p_order uuid,
  p_excluir_recepcion uuid default null
)
returns table (
  purchase_order_line_id uuid,
  line_no int,
  product_id uuid,
  sku text,
  descripcion text,
  pedido numeric,
  recibido numeric,
  en_borrador numeric,
  pendiente numeric,
  borradores text[]
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.id, l.line_no, l.product_id, l.sku_snapshot, l.name_snapshot,
         l.quantity,
         coalesce(c.recibido, 0),
         coalesce(b.en_borrador, 0),
         l.quantity - coalesce(c.recibido, 0),
         coalesce(b.numeros, array[]::text[])
    from purchase_order_lines l
    left join lateral (
      select sum(rl.quantity) recibido
        from goods_receipt_lines rl
        join goods_receipts r on r.id = rl.goods_receipt_id
       where rl.purchase_order_line_id = l.id and r.status = 'confirmed'
    ) c on true
    left join lateral (
      select sum(rl.quantity) en_borrador, array_agg(r.number order by r.number) numeros
        from goods_receipt_lines rl
        join goods_receipts r on r.id = rl.goods_receipt_id
       where rl.purchase_order_line_id = l.id and r.status = 'draft'
         and (p_excluir_recepcion is null or r.id <> p_excluir_recepcion)
    ) b on true
   where l.purchase_order_id = p_order
     and l.line_type <> 'chapter'
     and l.quantity > 0
   order by l.line_no;
$$;

revoke execute on function public.pendiente_de_pedido(uuid, uuid) from public, anon;
grant execute on function public.pendiente_de_pedido(uuid, uuid) to authenticated;

-- ── 7 · Confirmar: dos agujeros tapados ───────────────────────────────────
--
-- Lo que ya estaba bien y no se toca: el `for update` sobre la recepción, la
-- idempotencia por estado, el rechazo de la sobre-recepción sin recortar, el
-- índice único que hace imposible duplicar el movimiento, y que todo pasa en
-- una sola transacción.
--
-- Lo que estaba mal:
--
--   1. **Dos recepciones DISTINTAS sobre la misma línea.** El `for update`
--      bloqueaba la recepción, que es una fila distinta en cada transacción.
--      Dos confirmaciones simultáneas leían las dos «quedan 30», las dos
--      pasaban la validación y entraban 40. Ahora se bloquean las LÍNEAS DEL
--      PEDIDO con `for update` antes de calcular, así la segunda espera a la
--      primera y recalcula sobre lo que quedó de verdad.
--
--   2. **Las líneas sin producto.** Ahora que se pueden recibir, el insert de
--      movimientos las tiene que saltear: un movimiento de stock sin producto
--      no significa nada.

create or replace function public.confirmar_recepcion(p_receipt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r          goods_receipts;
  v_rol        text;
  v_linea      record;
  v_pendiente  numeric;
  v_movs       int := 0;
  v_lineas     int := 0;
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

  -- EL BLOQUEO QUE FALTABA. Se toman las líneas del pedido que toca esta
  -- recepción, en orden de id para que dos transacciones no se traben entre
  -- sí. Desde acá hasta el commit, nadie más puede confirmar contra estas
  -- líneas: la segunda espera y después recalcula.
  perform 1
    from purchase_order_lines l
   where l.id in (select rl.purchase_order_line_id
                    from goods_receipt_lines rl
                   where rl.goods_receipt_id = p_receipt
                     and rl.purchase_order_line_id is not null)
   order by l.id
     for update;

  -- Sobre-recepción: se RECHAZA. No se recorta en silencio ni queda stock sin
  -- explicación.
  for v_linea in
    select rl.id, rl.quantity, rl.product_id, rl.purchase_order_line_id,
           l.quantity pedida, l.line_no
      from goods_receipt_lines rl
      left join purchase_order_lines l on l.id = rl.purchase_order_line_id
     where rl.goods_receipt_id = p_receipt
  loop
    v_lineas := v_lineas + 1;
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
  --
  -- Las líneas SIN producto no mueven nada: se recibieron documentalmente.
  insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                               quantity, source_type, source_id, notes, created_by)
  select v_r.company_id, rl.product_id, v_r.warehouse_id, 'purchase_receipt',
         sum(rl.quantity), 'goods_receipt', p_receipt,
         'Recepción ' || v_r.number, auth.uid()
    from goods_receipt_lines rl
   where rl.goods_receipt_id = p_receipt
     and rl.product_id is not null
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
    'draft', 'confirmed', jsonb_build_object('lineas', v_lineas));

  -- Un solo evento de stock por recepción, no uno por línea: la auditoría es
  -- para leerla, y veinte filas «entró un producto» no dicen más que una que
  -- diga «entraron veinte».
  if v_movs > 0 then
    perform registrar_evento_compra('goods_receipt', p_receipt, 'stock_applied',
      null, null, jsonb_build_object('movimientos', v_movs, 'deposito', v_r.warehouse_id));
  end if;

  return jsonb_build_object(
    'receipt_id', p_receipt, 'ya_estaba', false,
    'movimientos', v_movs, 'receipt_status_pedido', v_estado_po);
end $$;

-- ── 8 · Índice para el listado ────────────────────────────────────────────
create index if not exists idx_gr_fecha
  on public.goods_receipts (company_id, receipt_date desc, number desc);


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_recepcion_confirmada_borrado_de_mantenimiento
-- versión 20260910150734 · entrega 4
-- --------------------------------------------------------------------------

-- Una recepción confirmada no se toca. Pero las suites tienen que poder
-- limpiar lo que crean.
--
-- La versión anterior de la guarda bloqueaba el DELETE de una recepción
-- confirmada para TODO el mundo, incluida la clave de servicio. Correcto en
-- producción y un problema en mantenimiento: las suites confirman recepciones
-- de prueba, y sin poder borrarlas quedaban proveedores y pedidos colgados que
-- tampoco se podían borrar por las FK. La suite de la entrega 1 dejó doce
-- proveedores atrás y así se descubrió.
--
-- La salida es explícita y angosta: **sólo el DELETE**, y sólo desde una
-- sesión que corre como `service_role` y sin `auth.uid()`. Eso es un script de
-- mantenimiento con la clave secreta; nunca un navegador. Desde la aplicación
-- —admin incluido— una recepción confirmada sigue sin poder borrarse ni
-- modificarse.
--
-- Sigue sin haber reversión: deshacer una recepción confirmada es un
-- contramovimiento explícito de stock, y eso no está en v1.
create or replace function app.proteger_recepcion_confirmada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and current_user = 'service_role';

  if tg_op = 'DELETE' then
    if old.status = 'confirmed' and not v_mantenimiento then
      raise exception 'La recepción % está confirmada: movió stock y no se borra', old.number
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  -- El UPDATE no tiene salida: una recepción confirmada no se modifica nunca,
  -- ni siquiera desde un script.
  if old.status = 'confirmed' then
    raise exception 'La recepción % está confirmada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;
  if new.number is distinct from old.number or new.series_code is distinct from old.series_code then
    raise exception 'El número de la recepción no se cambia' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create or replace function app.proteger_lineas_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_estado text; v_numero text; v_mantenimiento boolean;
begin
  select status, number into v_estado, v_numero
    from goods_receipts where id = coalesce(new.goods_receipt_id, old.goods_receipt_id);

  -- Si la recepción ya no existe, esto es el CASCADE de su borrado: no hay
  -- nada que proteger.
  if v_estado is null then return coalesce(new, old); end if;

  v_mantenimiento := auth.uid() is null and current_user = 'service_role';

  if v_estado = 'confirmed' and not (tg_op = 'DELETE' and v_mantenimiento) then
    raise exception 'La recepción % está confirmada: sus líneas no se tocan', v_numero
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_recepcion_mantenimiento_por_rol_del_jwt
-- versión 20260910150830 · entrega 4
-- --------------------------------------------------------------------------

-- La salida de mantenimiento no funcionaba: `current_user` dentro de una
-- función SECURITY DEFINER es el DUEÑO de la función (postgres), no quien la
-- llamó. La condición nunca era cierta y ni siquiera un script podía borrar
-- una recepción de prueba.
--
-- Se mira el rol del JWT de la request, que sí es el de quien llama:
-- `auth.role()`. Con la clave secreta es `service_role`; desde el navegador es
-- `authenticated` o `anon`, nunca `service_role`.
--
-- Sigue siendo sólo para el DELETE. Una recepción confirmada no se modifica
-- nunca, ni desde un script.
create or replace function app.proteger_recepcion_confirmada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if tg_op = 'DELETE' then
    if old.status = 'confirmed' and not v_mantenimiento then
      raise exception 'La recepción % está confirmada: movió stock y no se borra', old.number
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'La recepción % está confirmada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;
  if new.number is distinct from old.number or new.series_code is distinct from old.series_code then
    raise exception 'El número de la recepción no se cambia' using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create or replace function app.proteger_lineas_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_estado text; v_numero text; v_mantenimiento boolean;
begin
  select status, number into v_estado, v_numero
    from goods_receipts where id = coalesce(new.goods_receipt_id, old.goods_receipt_id);

  if v_estado is null then return coalesce(new, old); end if;

  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if v_estado = 'confirmed' and not (tg_op = 'DELETE' and v_mantenimiento) then
    raise exception 'La recepción % está confirmada: sus líneas no se tocan', v_numero
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;


-- --------------------------------------------------------------------------
-- Migración aplicada: fase6_confirmar_recepcion_permiso_antes_que_idempotencia
-- versión 20260910152848 · entrega 4
-- --------------------------------------------------------------------------

-- Un externo podía preguntarle a `confirmar_recepcion` por una recepción
-- confirmada y recibir una respuesta.
--
-- La comprobación de permisos estaba DESPUÉS del atajo de idempotencia. Sobre
-- una recepción ya confirmada, la función devolvía el JSON —cuántos
-- movimientos tiene, en qué estado quedó el pedido— sin mirar quién
-- preguntaba. No confirmaba nada, pero contaba cosas: la RPC es SECURITY
-- DEFINER, así que RLS no la cubre.
--
-- Lo encontró el test de la entrega 4 y el orden correcto es el obvio: primero
-- se mira si esta persona puede tocar esta recepción, después todo lo demás.
-- De paso, el depósito en null ahora se rechaza con su propio mensaje en vez
-- de caer en «el depósito no existe».
create or replace function public.confirmar_recepcion(p_receipt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r          goods_receipts;
  v_rol        text;
  v_linea      record;
  v_pendiente  numeric;
  v_movs       int := 0;
  v_lineas     int := 0;
  v_estado_po  text;
begin
  select * into v_r from goods_receipts where id = p_receipt for update;
  if not found then
    raise exception 'La recepción no existe' using errcode = 'no_data_found';
  end if;

  -- EL PERMISO VA PRIMERO. Antes estaba después del atajo de idempotencia y
  -- un externo podía sacarle información a una recepción ya confirmada.
  v_rol := app."current_role"(v_r.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para confirmar recepciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotencia: doble click, refresh o dos pestañas no suman stock dos veces.
  if v_r.status = 'confirmed' then
    return jsonb_build_object(
      'receipt_id', p_receipt, 'ya_estaba', true,
      'movimientos', (select count(*) from stock_movements
                       where source_type = 'goods_receipt' and source_id = p_receipt),
      'receipt_status_pedido', (select receipt_status from purchase_orders where id = v_r.purchase_order_id));
  end if;

  if not exists (select 1 from goods_receipt_lines where goods_receipt_id = p_receipt) then
    raise exception 'La recepción no tiene líneas' using errcode = 'restrict_violation';
  end if;

  -- Las líneas del pedido, bloqueadas: desde acá hasta el commit nadie más
  -- puede confirmar contra ellas. La segunda espera y recalcula.
  perform 1
    from purchase_order_lines l
   where l.id in (select rl.purchase_order_line_id
                    from goods_receipt_lines rl
                   where rl.goods_receipt_id = p_receipt
                     and rl.purchase_order_line_id is not null)
   order by l.id
     for update;

  -- Sobre-recepción: se RECHAZA. No se recorta en silencio.
  for v_linea in
    select rl.id, rl.quantity, rl.product_id, rl.purchase_order_line_id,
           l.quantity pedida, l.line_no
      from goods_receipt_lines rl
      left join purchase_order_lines l on l.id = rl.purchase_order_line_id
     where rl.goods_receipt_id = p_receipt
  loop
    v_lineas := v_lineas + 1;
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

  -- Las líneas SIN producto no mueven nada: se recibieron documentalmente.
  insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                               quantity, source_type, source_id, notes, created_by)
  select v_r.company_id, rl.product_id, v_r.warehouse_id, 'purchase_receipt',
         sum(rl.quantity), 'goods_receipt', p_receipt,
         'Recepción ' || v_r.number, auth.uid()
    from goods_receipt_lines rl
   where rl.goods_receipt_id = p_receipt
     and rl.product_id is not null
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
    'draft', 'confirmed', jsonb_build_object('lineas', v_lineas));

  -- Un solo evento de stock por recepción, no uno por línea.
  if v_movs > 0 then
    perform registrar_evento_compra('goods_receipt', p_receipt, 'stock_applied',
      null, null, jsonb_build_object('movimientos', v_movs, 'deposito', v_r.warehouse_id));
  end if;

  return jsonb_build_object(
    'receipt_id', p_receipt, 'ya_estaba', false,
    'movimientos', v_movs, 'receipt_status_pedido', v_estado_po);
end $$;

-- El depósito en null tiene su propio mensaje.
create or replace function app.validar_recepcion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_dep record; v_po record;
begin
  if new.warehouse_id is null then
    raise exception 'El depósito es obligatorio' using errcode = 'not_null_violation';
  end if;

  select company_id, is_active into v_dep from warehouses where id = new.warehouse_id;
  if v_dep is null then
    raise exception 'El depósito no existe' using errcode = 'foreign_key_violation';
  end if;
  if v_dep.company_id <> new.company_id then
    raise exception 'El depósito es de otra empresa' using errcode = 'check_violation';
  end if;
  if not v_dep.is_active then
    raise exception 'El depósito está inactivo' using errcode = 'check_violation';
  end if;

  if new.purchase_order_id is not null then
    select company_id, supplier_id, status, number into v_po
      from purchase_orders where id = new.purchase_order_id;
    if v_po is null then
      raise exception 'El pedido no existe' using errcode = 'foreign_key_violation';
    end if;
    if v_po.company_id <> new.company_id then
      raise exception 'El pedido es de otra empresa' using errcode = 'check_violation';
    end if;
    if v_po.supplier_id <> new.supplier_id then
      raise exception 'El pedido % es de otro proveedor', v_po.number
        using errcode = 'check_violation';
    end if;
    if v_po.status <> 'confirmed' then
      raise exception 'El pedido % no está confirmado: no se puede recibir contra él',
        v_po.number using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;


-- ###########################################################################
-- ENTREGA 5 — FACTURAS DE PROVEEDOR
-- ###########################################################################

-- ===========================================================================
-- fase6_facturas_proveedor_reglas
-- ===========================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 6 · Compras · entrega 5 — facturas de proveedor: integridad y estados
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El schema de la entrega 1 ya tenía todo lo que hace falta y no se le agrega
-- ni una tabla ni una columna:
--
--   · `goods_receipt_line_id` y `purchase_order_line_id` nullables e
--     independientes en la línea, así que una factura puede cubrir varias
--     recepciones, varias facturas pueden cubrir un pedido, y una línea puede
--     no venir de ningún lado (flete, seguro, servicio).
--   · `number` + `series_code = 'FP'` es la referencia interna; `supplier_number`
--     es el número REAL del proveedor, con su único parcial por proveedor.
--   · Los totales ya los calcula el servidor.
--
-- Lo que falta es todo lo que impide que entre algo incoherente.

-- ── 1 · Autor y updated_at ────────────────────────────────────────────────

create or replace function app.sellar_autor_factura()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.updated_by := coalesce(auth.uid(), old.updated_by);
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_si_autor on public.supplier_invoices;
create trigger trg_si_autor
  before insert or update on public.supplier_invoices
  for each row execute function app.sellar_autor_factura();

drop trigger if exists trg_sil_touch on public.supplier_invoice_lines;
create trigger trg_sil_touch
  before update on public.supplier_invoice_lines
  for each row execute function app.touch_updated_at();

-- ── 2 · Coherencia de la cabecera ─────────────────────────────────────────
--
-- El proveedor tiene que ser de la misma empresa. La FK sola no lo garantiza.

create or replace function app.validar_factura_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_emp uuid;
begin
  select company_id into v_emp from suppliers where id = new.supplier_id;
  if v_emp is null then
    raise exception 'El proveedor no existe' using errcode = 'foreign_key_violation';
  end if;
  if v_emp <> new.company_id then
    raise exception 'El proveedor es de otra empresa' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_si_validar on public.supplier_invoices;
create trigger trg_si_validar
  before insert or update on public.supplier_invoices
  for each row execute function app.validar_factura_proveedor();

-- ── 3 · Coherencia de la línea ────────────────────────────────────────────
--
-- Una línea vinculada tiene que venir de una recepción CONFIRMADA, del MISMO
-- proveedor y de la MISMA empresa, y de un pedido en la MISMA moneda que la
-- factura. El producto y la línea del pedido no se eligen: salen de la línea
-- de recepción.
--
-- Una línea sin vínculo —flete, seguro, servicio, diferencia— se acepta tal
-- cual: es lo que pide el punto 9. No mueve stock, porque las facturas no
-- mueven stock, punto.

create or replace function app.validar_linea_factura()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_f record; v_rl record; v_pl record;
begin
  select company_id, supplier_id, currency_code, status
    into v_f from supplier_invoices where id = new.supplier_invoice_id;

  if new.company_id <> v_f.company_id then
    raise exception 'La línea es de otra empresa que la factura'
      using errcode = 'check_violation';
  end if;

  if new.goods_receipt_line_id is not null then
    select rl.product_id, rl.purchase_order_line_id, rl.quantity,
           r.company_id, r.supplier_id, r.status, r.number
      into v_rl
      from goods_receipt_lines rl
      join goods_receipts r on r.id = rl.goods_receipt_id
     where rl.id = new.goods_receipt_line_id;

    if v_rl is null then
      raise exception 'La línea de recepción no existe' using errcode = 'foreign_key_violation';
    end if;
    if v_rl.company_id <> v_f.company_id then
      raise exception 'Esa recepción es de otra empresa' using errcode = 'check_violation';
    end if;
    if v_rl.supplier_id <> v_f.supplier_id then
      raise exception 'La recepción % es de otro proveedor', v_rl.number
        using errcode = 'check_violation';
    end if;
    -- Sólo se factura lo que efectivamente llegó.
    if v_rl.status <> 'confirmed' then
      raise exception 'La recepción % no está confirmada: todavía no llegó nada', v_rl.number
        using errcode = 'restrict_violation';
    end if;

    -- El producto y la línea del pedido salen de la recepción; no se eligen.
    new.product_id := v_rl.product_id;
    new.purchase_order_line_id := v_rl.purchase_order_line_id;
  end if;

  if new.purchase_order_line_id is not null then
    select l.purchase_order_id, o.company_id, o.supplier_id, o.currency_code, o.number
      into v_pl
      from purchase_order_lines l
      join purchase_orders o on o.id = l.purchase_order_id
     where l.id = new.purchase_order_line_id;

    if v_pl is null then
      raise exception 'La línea del pedido no existe' using errcode = 'foreign_key_violation';
    end if;
    if v_pl.company_id <> v_f.company_id then
      raise exception 'Ese pedido es de otra empresa' using errcode = 'check_violation';
    end if;
    if v_pl.supplier_id <> v_f.supplier_id then
      raise exception 'El pedido % es de otro proveedor', v_pl.number
        using errcode = 'check_violation';
    end if;
    -- UNA factura, UNA moneda. No se mezclan pedidos de monedas distintas.
    if v_pl.currency_code <> v_f.currency_code then
      raise exception 'El pedido % está en % y la factura en %',
        v_pl.number, v_pl.currency_code, v_f.currency_code
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sil_validar on public.supplier_invoice_lines;
create trigger trg_sil_validar
  before insert or update on public.supplier_invoice_lines
  for each row execute function app.validar_linea_factura();

-- ── 4 · Estados ───────────────────────────────────────────────────────────
--
-- Los tres del CHECK, sin agregar ninguno: `draft`, `registered`, `cancelled`.
--
--   draft → registered   se registra
--   draft → cancelled    se descarta antes de registrar
--   registered → cancelled  se anula
--
-- Reabrir no existe: una factura registrada no vuelve a borrador.
--
-- Una factura NO mueve stock, así que anularla no deshace nada físico; lo que
-- hace es LIBERAR lo facturado, porque `pendiente_de_facturar` cuenta sólo las
-- registradas. Cuando existan pagos habrá que agregar la guarda «una factura
-- con pagos no se anula»; hoy no hay pagos y no se inventa la tabla.

create or replace function app.proteger_factura_registrada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if tg_op = 'DELETE' then
    -- Un borrador se descarta. Una registrada o anulada es un documento con
    -- historia: se anula, no se borra. La salida de mantenimiento es la misma
    -- que en recepciones, y por la misma razón: las suites limpian lo suyo.
    if old.status <> 'draft' and not v_mantenimiento then
      raise exception 'La factura % está %: no se borra, se anula', old.number, old.status
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if new.number is distinct from old.number
     or new.series_code is distinct from old.series_code then
    raise exception 'La referencia interna de la factura no se cambia'
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'cancelled' then
    raise exception 'La factura % está anulada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'      and new.status in ('registered', 'cancelled')) or
      (old.status = 'registered' and new.status = 'cancelled')
    ) then
      raise exception 'Transición no permitida: % → %', old.status, new.status
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- Una factura registrada sólo cambia de estado. Ni el proveedor, ni la
  -- moneda, ni el número del proveedor, ni las fechas, ni los importes.
  if old.status = 'registered' then
    raise exception 'La factura % está registrada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_si_congelar on public.supplier_invoices;
create trigger trg_si_congelar
  before update or delete on public.supplier_invoices
  for each row execute function app.proteger_factura_registrada();

create or replace function app.proteger_lineas_factura()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_estado text; v_numero text; v_mantenimiento boolean;
begin
  select status, number into v_estado, v_numero
    from supplier_invoices where id = coalesce(new.supplier_invoice_id, old.supplier_invoice_id);

  -- Si la factura ya no existe, esto es el CASCADE de su borrado.
  if v_estado is null then return coalesce(new, old); end if;

  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if v_estado <> 'draft' and not (tg_op = 'DELETE' and v_mantenimiento) then
    raise exception 'La factura % está %: sus líneas no se tocan', v_numero, v_estado
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sil_congelar on public.supplier_invoice_lines;
create trigger trg_sil_congelar
  before insert or update or delete on public.supplier_invoice_lines
  for each row execute function app.proteger_lineas_factura();

-- ── 5 · Auditoría ─────────────────────────────────────────────────────────
--
-- Sólo eventos de negocio: el alta, el registro y la anulación. Editar un
-- borrador no deja rastro: todavía no es un documento.

create or replace function app.auditar_factura_proveedor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into purchases_audit (company_id, entity_type, entity_id, action,
                                 from_status, to_status, actor_id)
    values (new.company_id, 'supplier_invoice', new.id, 'create',
            null, new.status, auth.uid());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into purchases_audit (company_id, entity_type, entity_id, action,
                                 from_status, to_status, diff, actor_id)
    values (new.company_id, 'supplier_invoice', new.id,
            case new.status when 'registered' then 'confirm'
                            when 'cancelled'  then 'cancel'
                            else 'status_change' end,
            old.status, new.status,
            case when new.supplier_number is null then null
                 else jsonb_build_object('numero_proveedor', new.supplier_number) end,
            auth.uid());
  end if;

  return new;
end $$;

drop trigger if exists trg_si_auditar on public.supplier_invoices;
create trigger trg_si_auditar
  after insert or update on public.supplier_invoices
  for each row execute function app.auditar_factura_proveedor();

-- ── 6 · Qué falta facturar ────────────────────────────────────────────────
--
-- Por línea de recepción: cuánto llegó, cuánto ya se facturó y cuánto queda.
--
-- Lo facturado cuenta SÓLO las facturas `registered`. Los borradores no
-- reservan, igual que en recepciones: dos borradores pueden anotar lo mismo y
-- el segundo que intente registrar falla. Y una factura anulada libera lo
-- suyo, que es lo que hace que anular sirva para algo.
--
-- Devuelve además el snapshot de la línea del pedido —precio, tratamiento,
-- cantidad pedida— para precompletar la factura con el costo de la OC y para
-- poder mostrar las diferencias sin ninguna tabla nueva.

create or replace function public.pendiente_de_facturar(
  p_company uuid,
  p_receipts uuid[] default null,
  p_supplier uuid default null,
  p_excluir_factura uuid default null
)
returns table (
  goods_receipt_line_id uuid,
  goods_receipt_id uuid,
  receipt_number text,
  receipt_date date,
  purchase_order_line_id uuid,
  purchase_order_id uuid,
  order_number text,
  currency_code text,
  product_id uuid,
  sku text,
  descripcion text,
  recibido numeric,
  facturado numeric,
  en_borrador numeric,
  pendiente numeric,
  precio_pedido numeric,
  tratamiento_pedido text,
  cantidad_pedida numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select rl.id, r.id, r.number, r.receipt_date,
         rl.purchase_order_line_id, o.id, o.number, o.currency_code,
         rl.product_id, rl.sku_snapshot, rl.name_snapshot,
         rl.quantity,
         coalesce(f.facturado, 0),
         coalesce(b.en_borrador, 0),
         rl.quantity - coalesce(f.facturado, 0),
         l.unit_price, l.tax_treatment, l.quantity
    from goods_receipt_lines rl
    join goods_receipts r on r.id = rl.goods_receipt_id
    left join purchase_order_lines l on l.id = rl.purchase_order_line_id
    left join purchase_orders o on o.id = l.purchase_order_id
    left join lateral (
      select sum(il.quantity) facturado
        from supplier_invoice_lines il
        join supplier_invoices i on i.id = il.supplier_invoice_id
       where il.goods_receipt_line_id = rl.id and i.status = 'registered'
    ) f on true
    left join lateral (
      select sum(il.quantity) en_borrador
        from supplier_invoice_lines il
        join supplier_invoices i on i.id = il.supplier_invoice_id
       where il.goods_receipt_line_id = rl.id and i.status = 'draft'
         and (p_excluir_factura is null or i.id <> p_excluir_factura)
    ) b on true
   where r.company_id = p_company
     and r.status = 'confirmed'
     and (p_receipts is null or r.id = any (p_receipts))
     and (p_supplier is null or r.supplier_id = p_supplier)
   order by r.number, rl.created_at;
$$;

revoke execute on function public.pendiente_de_facturar(uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function public.pendiente_de_facturar(uuid, uuid[], uuid, uuid) to authenticated;

-- ── 7 · Registrar la factura ──────────────────────────────────────────────
--
-- La transición que importa, del lado del servidor y en una sola transacción:
-- bloquea las líneas de recepción que toca, valida la sobre-facturación
-- contra lo que quedó de verdad, cambia el estado y audita.
--
-- Es idempotente: dos clicks o dos pestañas devuelven `ya_estaba`.
--
-- **No mueve stock.** El stock entró con la recepción. Acá no hay ni un
-- insert en `stock_movements`, y hay un test que lo comprueba.

create or replace function public.registrar_factura_proveedor(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_f         supplier_invoices;
  v_rol       text;
  v_linea     record;
  v_pendiente numeric;
  v_lineas    int := 0;
begin
  select * into v_f from supplier_invoices where id = p_invoice for update;
  if not found then
    raise exception 'La factura no existe' using errcode = 'no_data_found';
  end if;

  -- El permiso va PRIMERO, antes del atajo de idempotencia: si no, un externo
  -- le saca información a una factura ya registrada. Es el mismo error que
  -- tenía `confirmar_recepcion` y que la entrega 4 corrigió.
  v_rol := app."current_role"(v_f.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para registrar facturas en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_f.status = 'registered' then
    return jsonb_build_object('invoice_id', p_invoice, 'ya_estaba', true,
                              'lineas', (select count(*) from supplier_invoice_lines
                                          where supplier_invoice_id = p_invoice));
  end if;
  if v_f.status = 'cancelled' then
    raise exception 'La factura % está anulada', v_f.number using errcode = 'restrict_violation';
  end if;

  if not exists (select 1 from supplier_invoice_lines where supplier_invoice_id = p_invoice) then
    raise exception 'La factura no tiene líneas' using errcode = 'restrict_violation';
  end if;

  -- Las líneas de recepción que toca esta factura, bloqueadas y en orden de
  -- id para que dos transacciones no se traben entre sí. Desde acá hasta el
  -- commit nadie más puede registrar contra ellas.
  perform 1
    from goods_receipt_lines rl
   where rl.id in (select il.goods_receipt_line_id
                     from supplier_invoice_lines il
                    where il.supplier_invoice_id = p_invoice
                      and il.goods_receipt_line_id is not null)
   order by rl.id
     for update;

  -- Sobre-facturación: se RECHAZA. No se recorta en silencio.
  for v_linea in
    select il.id, il.line_no, il.quantity, il.goods_receipt_line_id,
           rl.quantity recibida
      from supplier_invoice_lines il
      left join goods_receipt_lines rl on rl.id = il.goods_receipt_line_id
     where il.supplier_invoice_id = p_invoice
  loop
    v_lineas := v_lineas + 1;
    if v_linea.goods_receipt_line_id is not null then
      select v_linea.recibida - coalesce(sum(il2.quantity), 0)
        into v_pendiente
        from supplier_invoice_lines il2
        join supplier_invoices i2 on i2.id = il2.supplier_invoice_id
       where il2.goods_receipt_line_id = v_linea.goods_receipt_line_id
         and i2.status = 'registered';

      if v_linea.quantity > v_pendiente then
        raise exception
          'Línea %: se intenta facturar % y quedan % por facturar', v_linea.line_no,
          v_linea.quantity, v_pendiente
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  update supplier_invoices set status = 'registered' where id = p_invoice;

  return jsonb_build_object('invoice_id', p_invoice, 'ya_estaba', false,
                            'lineas', v_lineas);
end $$;

revoke execute on function public.registrar_factura_proveedor(uuid) from public, anon;
grant execute on function public.registrar_factura_proveedor(uuid) to authenticated;

-- ── 8 · Índice para el listado ────────────────────────────────────────────
create index if not exists idx_si_fecha
  on public.supplier_invoices (company_id, invoice_date desc, number desc);

-- ===========================================================================
-- fase6_limpiar_auditoria_huerfana_de_facturas
-- ===========================================================================

-- Dos eventos `create` de facturas que ya no existen: quedaron de una prueba
-- manual de la entrega 5 donde la factura se borró y el evento no. La
-- auditoría no se borra desde la aplicación —su única policy es SELECT— y
-- ésta es la misma limpieza de mantenimiento que hizo falta en la entrega 3.
delete from purchases_audit a
 where a.entity_type = 'supplier_invoice'
   and not exists (select 1 from supplier_invoices i where i.id = a.entity_id);

-- ===========================================================================
-- fase6_confirmar_y_registrar_solo_por_su_funcion
-- ===========================================================================

-- ===========================================================================
-- Confirmar una recepción y registrar una factura, SÓLO por su función
-- ===========================================================================
--
-- Encontrado probando la entrega 5: la validación pesada de los dos circuitos
-- —sobre-recepción y sobre-facturación— vive dentro de `confirmar_recepcion()`
-- y de `registrar_factura_proveedor()`, pero NADA obligaba a pasar por ahí.
-- Un UPDATE directo por PostgREST, que cualquier admin o employee puede hacer
-- con un cliente REST, saltaba las dos:
--
--   update goods_receipts   set status = 'confirmed'  -- sin un solo stock_movement
--   update supplier_invoices set status = 'registered' -- facturando 999 sobre 40
--
-- Ambos fueron REPRODUCIDOS contra la base real antes de este arreglo. El de
-- recepciones es el peor de los dos: deja la mercadería marcada como recibida
-- y el stock sin entrar, o sea el saldo desincronizado en silencio.
--
-- La corrección es la misma para los dos: la transición al estado que dispara
-- efectos sólo se acepta si viene desde adentro de su función, que deja una
-- marca en la transacción. `set_config(..., true)` es local a la transacción y
-- PostgREST envuelve cada request en una, así que la marca no puede filtrarse
-- de un pedido al siguiente.
--
-- Lo que NO cambia: anular una factura y cancelar un pedido siguen siendo un
-- UPDATE directo, porque no tienen ninguna validación que saltear. Sólo se
-- cierran las dos transiciones que sí la tienen.

-- ── Recepciones ────────────────────────────────────────────────────────────

create or replace function app.proteger_recepcion_confirmada()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if tg_op = 'DELETE' then
    if old.status = 'confirmed' and not v_mantenimiento then
      raise exception 'La recepción % está confirmada: movió stock y no se borra', old.number
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'La recepción % está confirmada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;
  if new.number is distinct from old.number or new.series_code is distinct from old.series_code then
    raise exception 'El número de la recepción no se cambia' using errcode = 'restrict_violation';
  end if;

  -- Confirmar es lo que genera el stock y lo que valida la sobre-recepción.
  -- Por un UPDATE suelto no se pasa: entraría la mercadería al documento sin
  -- entrar al depósito.
  if new.status = 'confirmed'
     and coalesce(current_setting('app.confirmando_recepcion', true), '') <> new.id::text then
    raise exception 'Una recepción se confirma con confirmar_recepcion(), no cambiándole el estado'
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

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
  v_lineas     int := 0;
  v_estado_po  text;
begin
  select * into v_r from goods_receipts where id = p_receipt for update;
  if not found then
    raise exception 'La recepción no existe' using errcode = 'no_data_found';
  end if;

  -- EL PERMISO VA PRIMERO. Antes estaba después del atajo de idempotencia y
  -- un externo podía sacarle información a una recepción ya confirmada.
  v_rol := app."current_role"(v_r.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para confirmar recepciones en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotencia: doble click, refresh o dos pestañas no suman stock dos veces.
  if v_r.status = 'confirmed' then
    return jsonb_build_object(
      'receipt_id', p_receipt, 'ya_estaba', true,
      'movimientos', (select count(*) from stock_movements
                       where source_type = 'goods_receipt' and source_id = p_receipt),
      'receipt_status_pedido', (select receipt_status from purchase_orders where id = v_r.purchase_order_id));
  end if;

  if not exists (select 1 from goods_receipt_lines where goods_receipt_id = p_receipt) then
    raise exception 'La recepción no tiene líneas' using errcode = 'restrict_violation';
  end if;

  -- Las líneas del pedido, bloqueadas: desde acá hasta el commit nadie más
  -- puede confirmar contra ellas. La segunda espera y recalcula.
  perform 1
    from purchase_order_lines l
   where l.id in (select rl.purchase_order_line_id
                    from goods_receipt_lines rl
                   where rl.goods_receipt_id = p_receipt
                     and rl.purchase_order_line_id is not null)
   order by l.id
     for update;

  -- Sobre-recepción: se RECHAZA. No se recorta en silencio.
  for v_linea in
    select rl.id, rl.quantity, rl.product_id, rl.purchase_order_line_id,
           l.quantity pedida, l.line_no
      from goods_receipt_lines rl
      left join purchase_order_lines l on l.id = rl.purchase_order_line_id
     where rl.goods_receipt_id = p_receipt
  loop
    v_lineas := v_lineas + 1;
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

  -- Las líneas SIN producto no mueven nada: se recibieron documentalmente.
  insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                               quantity, source_type, source_id, notes, created_by)
  select v_r.company_id, rl.product_id, v_r.warehouse_id, 'purchase_receipt',
         sum(rl.quantity), 'goods_receipt', p_receipt,
         'Recepción ' || v_r.number, auth.uid()
    from goods_receipt_lines rl
   where rl.goods_receipt_id = p_receipt
     and rl.product_id is not null
   group by rl.product_id;
  get diagnostics v_movs = row_count;

  -- La marca que el trigger exige. Local a la transacción.
  perform set_config('app.confirmando_recepcion', p_receipt::text, true);
  update goods_receipts
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_receipt;
  perform set_config('app.confirmando_recepcion', '', true);

  if v_r.purchase_order_id is not null then
    v_estado_po := app.derivar_receipt_status(v_r.purchase_order_id);
    perform registrar_evento_compra('purchase_order', v_r.purchase_order_id,
      'receive', null, v_estado_po,
      jsonb_build_object('recepcion', v_r.number));
  end if;

  perform registrar_evento_compra('goods_receipt', p_receipt, 'confirm',
    'draft', 'confirmed', jsonb_build_object('lineas', v_lineas));

  -- Un solo evento de stock por recepción, no uno por línea.
  if v_movs > 0 then
    perform registrar_evento_compra('goods_receipt', p_receipt, 'stock_applied',
      null, null, jsonb_build_object('movimientos', v_movs, 'deposito', v_r.warehouse_id));
  end if;

  return jsonb_build_object(
    'receipt_id', p_receipt, 'ya_estaba', false,
    'movimientos', v_movs, 'receipt_status_pedido', v_estado_po);
end $$;

-- ── Facturas ───────────────────────────────────────────────────────────────

create or replace function app.proteger_factura_registrada()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_mantenimiento boolean;
begin
  v_mantenimiento := auth.uid() is null and coalesce(auth.role(), '') = 'service_role';

  if tg_op = 'DELETE' then
    -- Un borrador se descarta. Una registrada o anulada es un documento con
    -- historia: se anula, no se borra. La salida de mantenimiento es la misma
    -- que en recepciones, y por la misma razón: las suites limpian lo suyo.
    if old.status <> 'draft' and not v_mantenimiento then
      raise exception 'La factura % está %: no se borra, se anula', old.number, old.status
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if new.number is distinct from old.number
     or new.series_code is distinct from old.series_code then
    raise exception 'La referencia interna de la factura no se cambia'
      using errcode = 'restrict_violation';
  end if;

  if old.status = 'cancelled' then
    raise exception 'La factura % está anulada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'      and new.status in ('registered', 'cancelled')) or
      (old.status = 'registered' and new.status = 'cancelled')
    ) then
      raise exception 'Transición no permitida: % → %', old.status, new.status
        using errcode = 'restrict_violation';
    end if;

    -- Registrar es lo que valida las cantidades contra lo recibido. Por un
    -- UPDATE suelto no se pasa: se facturaría de más sin que nadie lo mire.
    -- Anular sí puede seguir siendo un UPDATE: no tiene nada que validar.
    if new.status = 'registered'
       and coalesce(current_setting('app.registrando_factura', true), '') <> new.id::text then
      raise exception 'Una factura se registra con registrar_factura_proveedor(), no cambiándole el estado'
        using errcode = 'restrict_violation';
    end if;

    return new;
  end if;

  -- Una factura registrada sólo cambia de estado. Ni el proveedor, ni la
  -- moneda, ni el número del proveedor, ni las fechas, ni los importes.
  if old.status = 'registered' then
    raise exception 'La factura % está registrada: no se modifica', old.number
      using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create or replace function public.registrar_factura_proveedor(p_invoice uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_f         supplier_invoices;
  v_rol       text;
  v_linea     record;
  v_pendiente numeric;
  v_lineas    int := 0;
begin
  select * into v_f from supplier_invoices where id = p_invoice for update;
  if not found then
    raise exception 'La factura no existe' using errcode = 'no_data_found';
  end if;

  -- El permiso va PRIMERO, antes del atajo de idempotencia: si no, un externo
  -- le saca información a una factura ya registrada. Es el mismo error que
  -- tenía `confirmar_recepcion` y que la entrega 4 corrigió.
  v_rol := app."current_role"(v_f.company_id);
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'Sin permiso para registrar facturas en esta empresa'
      using errcode = 'insufficient_privilege';
  end if;

  if v_f.status = 'registered' then
    return jsonb_build_object('invoice_id', p_invoice, 'ya_estaba', true,
                              'lineas', (select count(*) from supplier_invoice_lines
                                          where supplier_invoice_id = p_invoice));
  end if;
  if v_f.status = 'cancelled' then
    raise exception 'La factura % está anulada', v_f.number using errcode = 'restrict_violation';
  end if;

  if not exists (select 1 from supplier_invoice_lines where supplier_invoice_id = p_invoice) then
    raise exception 'La factura no tiene líneas' using errcode = 'restrict_violation';
  end if;

  -- Las líneas de recepción que toca esta factura, bloqueadas y en orden de
  -- id para que dos transacciones no se traben entre sí. Desde acá hasta el
  -- commit nadie más puede registrar contra ellas.
  perform 1
    from goods_receipt_lines rl
   where rl.id in (select il.goods_receipt_line_id
                     from supplier_invoice_lines il
                    where il.supplier_invoice_id = p_invoice
                      and il.goods_receipt_line_id is not null)
   order by rl.id
     for update;

  -- Sobre-facturación: se RECHAZA. No se recorta en silencio.
  for v_linea in
    select il.id, il.line_no, il.quantity, il.goods_receipt_line_id,
           rl.quantity recibida
      from supplier_invoice_lines il
      left join goods_receipt_lines rl on rl.id = il.goods_receipt_line_id
     where il.supplier_invoice_id = p_invoice
  loop
    v_lineas := v_lineas + 1;
    if v_linea.goods_receipt_line_id is not null then
      select v_linea.recibida - coalesce(sum(il2.quantity), 0)
        into v_pendiente
        from supplier_invoice_lines il2
        join supplier_invoices i2 on i2.id = il2.supplier_invoice_id
       where il2.goods_receipt_line_id = v_linea.goods_receipt_line_id
         and i2.status = 'registered';

      if v_linea.quantity > v_pendiente then
        raise exception
          'Línea %: se intenta facturar % y quedan % por facturar', v_linea.line_no,
          v_linea.quantity, v_pendiente
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- La marca que el trigger exige. Local a la transacción.
  perform set_config('app.registrando_factura', p_invoice::text, true);
  update supplier_invoices set status = 'registered' where id = p_invoice;
  perform set_config('app.registrando_factura', '', true);

  return jsonb_build_object('invoice_id', p_invoice, 'ya_estaba', false,
                            'lineas', v_lineas);
end $$;

revoke execute on function public.confirmar_recepcion(uuid) from anon;
revoke execute on function public.registrar_factura_proveedor(uuid) from anon;
