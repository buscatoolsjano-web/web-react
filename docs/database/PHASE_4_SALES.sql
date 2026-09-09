-- ============================================================================
-- Fase 4 · Ventas — SQL PROPUESTO
--
-- *** NO EJECUTADO. Esperando aprobación. ***
--
-- Convenciones heredadas de las fases anteriores, cada una por un error que
-- ya cometimos:
--
--   · RLS con funciones SIN argumentos y DENTRO de un subquery. Una función
--     con la columna como argumento se llama por fila (nos costó 6 s en un
--     count); una STABLE sin argumentos tampoco se pliega en InitPlan si no
--     está dentro de un subquery.
--   · La referencia dentro del subquery va CALIFICADA con el nombre de la
--     tabla, o resuelve contra la tabla de adentro y es una tautología.
--   · Los índices únicos PARCIALES no se pueden inferir desde ON CONFLICT.
--     Ninguno de acá es parcial, salvo los marcados, que llevan aviso.
--   · Las reglas que miran OTRAS filas no pueden ser un CHECK: van en
--     funciones.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0 · Funciones de apoyo
-- ────────────────────────────────────────────────────────────────────────────

-- Clientes ligados a las membresías del usuario. Sin argumentos, para que se
-- resuelva una sola vez. SECURITY DEFINER es NECESARIO: lee
-- company_memberships, cuya policy depende de auth.uid(), y sin él habría
-- recursión.
create or replace function app.current_customer_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(customer_id), '{}')
  from company_memberships
  where user_id = auth.uid()
    and status = 'active'
    and customer_id is not null;
$$;

grant execute on function app.current_customer_ids() to authenticated;


-- Numeración atómica. UPDATE ... RETURNING toma un lock de fila: dos
-- transacciones simultáneas se serializan sobre esa fila —y sólo sobre esa—
-- y reciben números distintos. Nunca un MAX().
create table document_sequences (
  company_id  uuid   not null references companies(id) on delete cascade,
  doc_type    text   not null,
  prefix      text   not null,
  padding     int    not null default 0 check (padding between 0 and 20),
  next_number bigint not null check (next_number > 0),
  primary key (company_id, doc_type)
);

alter table document_sequences enable row level security;
-- Sin policies: nadie la lee ni la escribe directamente. Sólo la función.

create or replace function app.next_document_number(p_company uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prefix text; v_padding int; v_num bigint;
begin
  update document_sequences
     set next_number = next_number + 1
   where company_id = p_company and doc_type = p_doc_type
  returning prefix, padding, next_number - 1
       into v_prefix, v_padding, v_num;

  if not found then
    raise exception 'No hay secuencia para % / %', p_company, p_doc_type
      using errcode = 'no_data_found';
  end if;

  return v_prefix || lpad(v_num::text, v_padding, '0');
end $$;

revoke all on function app.next_document_number(uuid, text) from public, anon;
grant execute on function app.next_document_number(uuid, text) to authenticated;

-- Valores iniciales: máximo real + 1, NO el conteo de registros — hay huecos.
--   quote        COTI  máx real 2540
--   sales_order  PDV   máx real 1315 (los 9 "PDV11xxx" son un 1 de más, no otra serie)
--   delivery     RT    máx real 1423
--
-- 'invoice' NO LLEVA FILA, y no es por falta de datos: es una decisión. Si el
-- número fiscal lo asigna STEL, inventar acá una secuencia paralela sería
-- crear una SEGUNDA numeración fiscal compitiendo con la real. El número de
-- la factura viene de afuera; ver sales_invoices.
--
-- Una secuencia INTERNA no fiscal —para identificar borradores o solicitudes
-- de facturación— es posible, pero no se crea sin un caso de uso concreto.


-- ────────────────────────────────────────────────────────────────────────────
-- 1 · Cliente
-- ────────────────────────────────────────────────────────────────────────────

create table customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  kind         text not null check (kind in ('billing','shipping','both')),
  is_default   boolean not null default false,
  street       text,
  city         text,
  state        text,
  postal_code  text,
  country_code text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Una sola dirección predeterminada por cliente y propósito.
-- OJO: índice PARCIAL → ON CONFLICT no lo puede inferir. El importador lee e
-- inserta, no hace upsert.
create unique index uq_customer_addr_default
  on customer_addresses (company_id, customer_id, kind) where is_default;
create index idx_customer_addr on customer_addresses (company_id, customer_id);

-- Campos tomados de los 87 contactos reales del legacy:
-- nombre, cargo, email, telefono, fax, observaciones.
create table customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  full_name   text not null,
  role        text,
  email       text,
  phone       text,
  fax         text,
  is_default  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index uq_customer_contact_default
  on customer_contacts (company_id, customer_id) where is_default;
create index idx_customer_contact on customer_contacts (company_id, customer_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 2 · Cotización
-- ────────────────────────────────────────────────────────────────────────────

create table sales_quotes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  number          text not null,
  external_number text,
  external_source text,                       -- 'STEL' u otro
  customer_id     uuid not null references customers(id),
  contact_id      uuid references customer_contacts(id),
  salesperson_id  uuid references profiles(id),
  quote_date      date not null,
  valid_until     date,
  -- NULL cuando el dato histórico no existe: 32 documentos no tienen moneda.
  -- No se asume ninguna.
  currency_code   text references currencies(code),
  -- NULL cuando no se registró: 104 ventas en ARS sin tipo de cambio. No se
  -- inventa; los reportes distinguen ARS / USD / SIN TC y no convierten.
  exchange_rate   numeric(18,6),
  payment_terms   text,
  notes           text,
  status          text not null default 'draft'
                  check (status in ('draft','sent','accepted','rejected','expired')),
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  needs_review    boolean not null default false,
  review_reason   text,
  -- El número ORIGINAL del legacy, tal como aparece. Nunca se reemplaza ni se
  -- corrige: es lo que hace trazable el documento contra el sistema viejo.
  -- Para los documentos migrados, `number` guarda este mismo valor.
  original_number text,
  -- Dato AUXILIAR de revisión, nunca de uso. Los 9 "PDV11xxx" parecen el
  -- número correcto con un 1 de más: siete de los ocho huecos de la serie los
  -- llena exactamente uno de ellos. Se deja la sospecha registrada para que
  -- una persona decida, sin tocar el número real.
  --   original_number             = 'PDV11157'
  --   suspected_normalized_number = 'PDV1157'
  suspected_normalized_number text,
  number_outlier  boolean not null default false,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now(),
  unique (company_id, number)
);

create table sales_quote_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  quote_id              uuid not null references sales_quotes(id) on delete cascade,
  line_no               int  not null check (line_no > 0),
  -- NULL a propósito: 39 SKU del histórico no existen en el catálogo (SER*,
  -- servicios) y una OC puede traer una línea todavía sin resolver.
  product_id            uuid references products(id),
  sku_snapshot          text,
  name_snapshot         text,
  description_snapshot  text,
  brand_snapshot        text,
  quantity              numeric(18,4) not null check (quantity <> 0),
  unit_price            numeric(18,4) not null,
  list_price_snapshot   numeric(18,4),         -- lo que decía la lista
  discount_pct          numeric(6,3) not null default 0 check (discount_pct between 0 and 100),
  -- Enum + snapshot, NO una tabla de 4 filas: hoy la alícuota es una elección
  -- del operador, no una regla. Cuando dependa del cliente, de la provincia o
  -- del producto, se agrega tax_id y se pobla desde acá.
  tax_treatment         text not null default 'vat_21'
                        check (tax_treatment in
                          ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot     numeric(6,3) not null default 21,
  kit_components_snapshot jsonb,                -- congelado al crear, como el legacy
  line_type             text not null default 'item'
                        check (line_type in ('item','service','chapter')),
  notes                 text,
  unique (quote_id, line_no)
);

create index idx_quote_lines on sales_quote_lines (company_id, quote_id, line_no);
create index idx_quote_lines_product on sales_quote_lines (company_id, product_id)
  where product_id is not null;


-- ────────────────────────────────────────────────────────────────────────────
-- 3 · OC del cliente — entidad propia
--     Hoy el legacy la importa COMO cotización: el número, la fecha, el centro
--     de costo y el PDF del cliente no tienen dónde vivir.
-- ────────────────────────────────────────────────────────────────────────────

create table customer_purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  customer_id         uuid not null references customers(id),
  po_number           text not null,           -- el número DEL CLIENTE
  po_date             date,
  quote_id            uuid references sales_quotes(id),
  currency_code       text references currencies(code),
  exchange_rate       numeric(18,6),
  payment_terms       text,
  cost_center         text,
  shipping_address_id uuid references customer_addresses(id),
  contact_id          uuid references customer_contacts(id),
  received_at         timestamptz,
  received_by         uuid references profiles(id),
  raw_text            text,                    -- el texto tal como llegó
  match_status        text not null default 'unmatched'
                      check (match_status in ('unmatched','match','difference','missing','extra')),
  notes               text,
  needs_review        boolean not null default false,
  review_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Dos clientes distintos PUEDEN mandar el mismo número de OC: eso no es
  -- un conflicto. Por eso customer_id entra en la clave.
  unique (company_id, customer_id, po_number)
);

create table customer_purchase_order_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  po_id                uuid not null references customer_purchase_orders(id) on delete cascade,
  line_no              int  not null check (line_no > 0),
  product_id           uuid references products(id),
  -- EXACTO como lo mandó el cliente. No se normaliza ni se corrige.
  customer_product_code text,
  customer_description  text,
  quantity             numeric(18,4),
  unit_price           numeric(18,4),
  discount_pct         numeric(6,3) default 0,
  match_status         text not null default 'unmatched'
                       check (match_status in ('unmatched','match','difference','missing','extra')),
  match_confidence     numeric(4,3),
  matched_by           uuid references profiles(id),
  matched_at           timestamptz,
  quote_line_id        uuid references sales_quote_lines(id),
  unique (po_id, line_no)
);

-- QUÉ cambió el cliente, con el valor de cada lado. Sin esto, "explicar la
-- diferencia" es volver a comparar los documentos y adivinar.
create table purchase_order_discrepancies (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  po_id           uuid not null references customer_purchase_orders(id) on delete cascade,
  po_line_id      uuid references customer_purchase_order_lines(id) on delete cascade,
  quote_line_id   uuid references sales_quote_lines(id),
  field           text not null,               -- unit_price|quantity|currency|discount_pct|…
  quote_value     text,
  po_value        text,
  severity        text not null default 'info' check (severity in ('info','warning','blocking')),
  resolved_at     timestamptz,
  resolved_by     uuid references profiles(id),
  resolution_note text,
  created_at      timestamptz not null default now()
);

create index idx_po_disc on purchase_order_discrepancies (company_id, po_id)
  where resolved_at is null;

-- Candidatos de OC extraídos del texto histórico. NINGUNO se convierte solo:
-- entre los 142 detectados hay "CESAR", "EMILIANO" y "xxxx".
create table customer_po_candidates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  customer_id  uuid references customers(id),
  source_type  text not null check (source_type in ('quote','order','delivery')),
  source_ref   text not null,                  -- ref legacy del documento
  source_field text not null check (source_field in ('titulo','item_description')),
  raw_text     text not null,
  candidate    text not null,
  confidence   text not null check (confidence in ('high','medium','low')),
  doc_count    int  not null default 1,
  status       text not null default 'pending'
               check (status in ('pending','confirmed','rejected')),
  po_id        uuid references customer_purchase_orders(id),
  reviewed_by  uuid references profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);


-- ────────────────────────────────────────────────────────────────────────────
-- 4 · Equivalencias producto ↔ cliente
--     Migra la memoria del legacy (4 clientes, 15 alias) cambiando la clave de
--     "nombre de cliente normalizado" a customer_id.
-- ────────────────────────────────────────────────────────────────────────────

create table customer_product_aliases (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  customer_id          uuid not null references customers(id) on delete cascade,
  customer_code        text,
  customer_description text,
  normalized_key       text not null,
  product_id           uuid not null references products(id),
  status               text not null default 'suggested'
                       check (status in ('suggested','confirmed','rejected')),
  confidence           numeric(4,3),
  source               text check (source in ('manual','import','ai','legacy')),
  times_used           int not null default 0,
  last_used_at         timestamptz,
  created_by           uuid references profiles(id) default auth.uid(),
  confirmed_by         uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- customer_id EN LA CLAVE: un alias nunca cruza clientes. Que "ABC-001928"
  -- sea el TE.9322 de Nordex no dice nada sobre qué es para SIMPA.
  unique (company_id, customer_id, normalized_key)
);


-- ────────────────────────────────────────────────────────────────────────────
-- 5 · Pedido de venta
-- ────────────────────────────────────────────────────────────────────────────

create table sales_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  number              text not null,
  external_number     text,
  external_source     text,
  customer_id         uuid not null references customers(id),
  contact_id          uuid references customer_contacts(id),
  salesperson_id      uuid references profiles(id),
  order_date          date not null,
  quote_id            uuid references sales_quotes(id),
  po_id               uuid references customer_purchase_orders(id),
  origin              text not null default 'manual'
                      check (origin in ('quote_po','po_only','direct','manual','migration')),
  currency_code       text references currencies(code),
  exchange_rate       numeric(18,6),
  payment_terms       text,
  cost_center         text,
  shipping_address_id uuid references customer_addresses(id),
  billing_address_id  uuid references customer_addresses(id),
  -- CUATRO estados independientes: son cuatro preguntas distintas que se
  -- responden en momentos distintos. Los tres últimos se DERIVAN de las
  -- líneas; guardarlos es sólo caché.
  commercial_status   text not null default 'draft'
                      check (commercial_status in ('draft','confirmed','cancelled')),
  fulfillment_status  text not null default 'pending'
                      check (fulfillment_status in
                        ('pending','partially_reserved','reserved','partially_delivered','delivered')),
  invoicing_status    text not null default 'not_invoiced'
                      check (invoicing_status in ('not_invoiced','partially_invoiced','invoiced')),
  payment_status      text not null default 'unpaid'
                      check (payment_status in ('unpaid','partially_paid','paid','overdue')),
  notes               text,
  needs_review        boolean not null default false,
  review_reason       text,
  -- El número ORIGINAL del legacy, tal como aparece. Nunca se reemplaza ni se
  -- corrige: es lo que hace trazable el documento contra el sistema viejo.
  -- Para los documentos migrados, `number` guarda este mismo valor.
  original_number text,
  -- Dato AUXILIAR de revisión, nunca de uso. Los 9 "PDV11xxx" parecen el
  -- número correcto con un 1 de más: siete de los ocho huecos de la serie los
  -- llena exactamente uno de ellos. Se deja la sospecha registrada para que
  -- una persona decida, sin tocar el número real.
  --   original_number             = 'PDV11157'
  --   suspected_normalized_number = 'PDV1157'
  suspected_normalized_number text,
  number_outlier  boolean not null default false,
  created_by          uuid references profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id),
  updated_at          timestamptz not null default now(),
  unique (company_id, number)
);

create table sales_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  order_id              uuid not null references sales_orders(id) on delete cascade,
  line_no               int  not null check (line_no > 0),
  product_id            uuid references products(id),
  quote_line_id         uuid references sales_quote_lines(id),
  po_line_id            uuid references customer_purchase_order_lines(id),
  sku_snapshot          text,
  name_snapshot         text,
  description_snapshot  text,
  customer_product_code text,
  customer_description  text,
  quantity_ordered      numeric(18,4) not null check (quantity_ordered > 0),
  unit_price            numeric(18,4) not null,
  list_price_snapshot   numeric(18,4),
  discount_pct          numeric(6,3) not null default 0 check (discount_pct between 0 and 100),
  tax_treatment         text not null default 'vat_21'
                        check (tax_treatment in
                          ('vat_21','vat_105','vat_0','exempt','not_taxed','other')),
  tax_rate_snapshot     numeric(6,3) not null default 21,
  kit_components_snapshot jsonb,
  line_type             text not null default 'item'
                        check (line_type in ('item','service','chapter')),
  notes                 text,
  unique (order_id, line_no)
);
-- Las cantidades reservada / entregada / pendiente NO son columnas: se
-- derivan de stock_reservations y delivery_lines. Guardarlas sería tener dos
-- verdades.

create index idx_order_lines on sales_order_lines (company_id, order_id, line_no);
create index idx_orders_customer on sales_orders (company_id, customer_id, order_date desc);
create index idx_orders_pendientes on sales_orders (company_id, fulfillment_status)
  where commercial_status = 'confirmed';


-- ────────────────────────────────────────────────────────────────────────────
-- 6 · Entrega / remito
--     La entrega ES el remito: en el legacy las notas de entrega ya se numeran
--     RT0000001242…RT0000001423. Numeración propia y estable, no una tabla más.
-- ────────────────────────────────────────────────────────────────────────────

create table deliveries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  number              text not null,
  external_number     text,                    -- si STEL pasa a ser la fuente
  external_source     text,
  -- NULL a propósito: 42 de 182 remitos históricos no tienen pedido. Forzarlo
  -- obligaría a inventar el vínculo.
  order_id            uuid references sales_orders(id),
  customer_id         uuid not null references customers(id),
  delivery_date       date not null,
  shipping_address_id uuid references customer_addresses(id),
  contact_id          uuid references customer_contacts(id),
  carrier             text,
  tracking            text,
  status              text not null default 'draft'
                      check (status in ('draft','shipped','delivered','cancelled')),
  notes               text,
  needs_review        boolean not null default false,
  review_reason       text,
  -- El número ORIGINAL del legacy, tal como aparece. Nunca se reemplaza ni se
  -- corrige: es lo que hace trazable el documento contra el sistema viejo.
  -- Para los documentos migrados, `number` guarda este mismo valor.
  original_number text,
  -- Dato AUXILIAR de revisión, nunca de uso. Los 9 "PDV11xxx" parecen el
  -- número correcto con un 1 de más: siete de los ocho huecos de la serie los
  -- llena exactamente uno de ellos. Se deja la sospecha registrada para que
  -- una persona decida, sin tocar el número real.
  --   original_number             = 'PDV11157'
  --   suspected_normalized_number = 'PDV1157'
  suspected_normalized_number text,
  number_outlier  boolean not null default false,
  created_by          uuid references profiles(id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id),
  updated_at          timestamptz not null default now(),
  unique (company_id, number)
);

create table delivery_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  delivery_id   uuid not null references deliveries(id) on delete cascade,
  -- La FK a la línea del pedido es lo que reemplaza al `entregado[idx]` del
  -- legacy. 100 pedidas, 30 + 40 entregadas, 30 pendientes, sin ambigüedad y
  -- sin que insertar una línea corra las entregas.
  order_line_id uuid references sales_order_lines(id),
  product_id    uuid references products(id),
  sku_snapshot  text,
  name_snapshot text,
  quantity      numeric(18,4) not null check (quantity > 0),
  warehouse_id  uuid not null references warehouses(id),
  notes         text,
  created_at    timestamptz not null default now()
);

create index idx_delivery_lines on delivery_lines (company_id, delivery_id);
create index idx_delivery_lines_order on delivery_lines (company_id, order_line_id)
  where order_line_id is not null;

create table delivery_serials (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  delivery_line_id uuid not null references delivery_lines(id) on delete cascade,
  product_id       uuid not null references products(id),
  serial_number    text not null,
  customer_id      uuid not null references customers(id),
  delivery_date    date not null,
  notes            text,
  created_at       timestamptz not null default now(),
  unique (company_id, product_id, serial_number)
);

-- Qué productos exigen número de serie. Por producto, configurable, sin
-- reglas por categoría: no hay evidencia para marcar puntas ni balanceadores.
alter table products add column is_serialized boolean not null default false;


-- ────────────────────────────────────────────────────────────────────────────
-- 7 · Factura y cobranza
-- ────────────────────────────────────────────────────────────────────────────

-- ── Factura ────────────────────────────────────────────────────────────────
-- IDENTIDAD INTERNA y NUMERACIÓN FISCAL son dos cosas distintas:
--
--   id      · UUID, siempre presente. Es lo que referencian las líneas, los
--             pagos y la trazabilidad. Existe desde el borrador.
--   number  · el número FISCAL, y por eso es NULLABLE: un borrador o una
--             solicitud de facturación todavía no tiene uno.
--
-- El número puede venir de tres orígenes y el modelo no privilegia ninguno:
-- STEL, una función futura de la web, o una importación histórica. Cuando
-- viene de afuera, 'number' es copia de 'external_number': se duplica a
-- propósito para que toda consulta y todo índice usen 'number' igual que en
-- los demás documentos, y el CHECK impide que se desincronicen.
create table sales_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  number          text,
  -- Procedencia. Sólo estos cinco campos: no se duplica el documento externo
  -- entero, sólo lo que hace falta para identificarlo y reconciliarlo.
  external_source text check (external_source in ('stel','web','import')),
  external_id     text,          -- id del documento en el sistema externo
  external_number text,          -- número fiscal tal como lo asignó ese sistema
  external_status text,          -- su estado, sin traducir
  synced_at       timestamptz,
  customer_id     uuid not null references customers(id),
  order_id        uuid references sales_orders(id),
  invoice_date    date not null,
  due_date        date,
  currency_code   text references currencies(code),
  exchange_rate   numeric(18,6),
  subtotal        numeric(18,4),
  tax_amount      numeric(18,4),
  total           numeric(18,4),
  status          text not null default 'draft'
                  check (status in ('draft','issued','paid','cancelled')),
  notes           text,
  needs_review    boolean not null default false,
  -- Para una importación histórica futura: el número tal como venía en su
  -- sistema de origen. No hay facturas legacy que migrar hoy, así que no se
  -- agregan acá las columnas de sospecha de numeración que sí llevan los
  -- documentos que sí tienen histórico.
  original_number text,
  created_by      uuid references profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now(),
  -- Si el número vino de afuera, el nuestro tiene que ser ese y no otro.
  constraint chk_invoice_numero_externo
    check (external_number is null or number is not distinct from external_number)
);

-- Índices únicos PARCIALES: el número fiscal puede faltar (borradores), y dos
-- facturas sin número no colisionan entre sí.
-- OJO: un índice parcial NO se puede inferir desde ON CONFLICT. El importador
-- y el sincronizador leen e insertan, no hacen upsert. Mismo caso que el
-- índice de apertura de stock en la Fase 3.5.
create unique index uq_invoice_number
  on sales_invoices (company_id, number) where number is not null;

create unique index uq_invoice_external
  on sales_invoices (company_id, external_source, external_id)
  where external_id is not null;

-- Para encontrar lo que falta sincronizar contra el sistema externo.
create index idx_invoices_sync
  on sales_invoices (company_id, external_source, synced_at)
  where external_source is not null;

create table sales_invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  invoice_id        uuid not null references sales_invoices(id) on delete cascade,
  order_line_id     uuid references sales_order_lines(id),
  -- ESTA columna es la que rompe la limitación del legacy (una factura por
  -- remito): una factura puede juntar líneas de varias entregas, y una
  -- entrega puede repartirse en varias facturas.
  delivery_line_id  uuid references delivery_lines(id),
  product_id        uuid references products(id),
  sku_snapshot      text,
  name_snapshot     text,
  quantity          numeric(18,4) not null check (quantity > 0),
  unit_price        numeric(18,4) not null,
  discount_pct      numeric(6,3) not null default 0,
  tax_treatment     text not null default 'vat_21',
  tax_rate_snapshot numeric(6,3) not null default 21
);

-- Los pagos existen por necesidad funcional, no porque haya histórico local.
-- Se alimentan de STEL, de carga manual, de la web o de una integración
-- bancaria futura. Misma procedencia que la factura, pero SIN external_number:
-- un pago no tiene numeración fiscal, así que ese campo no se duplica.
create table payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  external_source text check (external_source in ('stel','web','import','bank')),
  external_id     text,
  synced_at       timestamptz,
  customer_id   uuid not null references customers(id),
  payment_date  date not null,
  amount        numeric(18,4) not null check (amount > 0),
  currency_code text references currencies(code),
  exchange_rate numeric(18,6),
  method        text,
  reference     text,
  notes         text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create unique index uq_payment_external
  on payments (company_id, external_source, external_id) where external_id is not null;

-- La pieza que el legacy no tiene. Sin ella, un cheque que paga tres facturas
-- no se puede representar.
create table payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references sales_invoices(id) on delete cascade,
  amount     numeric(18,4) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- 8 · Adjuntos y auditoría
-- ────────────────────────────────────────────────────────────────────────────

create table attachments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  -- Supabase Storage. NUNCA base64 en Postgres: el legacy guarda los logos
  -- como data:image/png;base64 en localStorage y eso se rompe solo.
  storage_path text not null,
  file_name   text,
  mime_type   text,
  bytes       bigint,
  kind        text check (kind in
              ('customer_po','quote_pdf','remito','invoice','receipt','photo','other')),
  uploaded_by uuid references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index idx_attachments on attachments (company_id, entity_type, entity_id);

-- NO es un audit_logs. Se escribe SÓLO desde funciones de negocio: no hay
-- ningún trigger de UPDATE. El legacy llegó a 984 MB registrando cada UPDATE;
-- esto son ~20 filas por pedido, ~1 MB al año al ritmo actual.
create table sales_audit (
  id          bigserial primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  -- Diff ACOTADO, sólo para campos sensibles: {"unit_price":{"from":100,"to":90}}
  -- Nunca old_data/new_data de la fila entera.
  diff        jsonb,
  actor_id    uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create index idx_sales_audit on sales_audit (company_id, entity_type, entity_id, created_at desc);


-- ────────────────────────────────────────────────────────────────────────────
-- 9 · Reglas que NO pueden ser un CHECK
--     Un CHECK no puede mirar otras filas. Van en las funciones que registran
--     la operación, no en la UI.
-- ────────────────────────────────────────────────────────────────────────────
--
--   1. sum(delivery_lines.quantity) por order_line_id <= quantity_ordered
--   2. sum(sales_invoice_lines.quantity) por delivery_line_id <= quantity
--   3. sum(payment_allocations.amount) por payment_id <= payments.amount
--   4. sum(payment_allocations.amount) por invoice_id  <= sales_invoices.total
--
-- Y una advertencia que ya nos mordió en la Fase 3.5: el trigger de stock es
-- AFTER INSERT, así que BORRAR un movimiento NO revierte el saldo. Cancelar
-- una entrega tiene que generar un movimiento compensatorio, nunca un DELETE.


-- ────────────────────────────────────────────────────────────────────────────
-- 10 · RLS — el patrón, una vez; se repite igual en las 20 tablas
-- ────────────────────────────────────────────────────────────────────────────

alter table sales_orders enable row level security;

create policy sales_orders_select on sales_orders for select to authenticated
using (
  company_id in (select unnest(app.current_company_ids()))
  and (
    company_id in (select unnest(app.current_internal_company_ids()))
    or customer_id in (select unnest(app.current_customer_ids()))
  )
);

create policy sales_orders_write on sales_orders for all to authenticated
using      (company_id in (select unnest(app.current_writer_company_ids())))
with check (company_id in (select unnest(app.current_writer_company_ids())));

-- Las tablas de línea delegan en su cabecera, para no tener dos definiciones
-- de visibilidad que se puedan desincronizar. La referencia va CALIFICADA:
-- sin `sales_order_lines.order_id` resolvería contra sales_orders y sería una
-- tautología — el bug que cometí en la N:N de la Fase 3.5.
alter table sales_order_lines enable row level security;

create policy sales_order_lines_select on sales_order_lines for select to authenticated
using (
  exists (
    select 1 from sales_orders o
    where o.id = sales_order_lines.order_id
      and o.company_id = sales_order_lines.company_id
  )
);


-- ────────────────────────────────────────────────────────────────────────────
-- 11 · Lo que NO se crea, y por qué
-- ────────────────────────────────────────────────────────────────────────────
--
-- credit_notes / credit_note_allocations
--   El legacy las tiene (erp_notas_credito) pero no apareció ni un registro en
--   los dos navegadores auditados, así que no conozco su forma ni su
--   numeración. Crearlas hoy sería inventar una tabla sobre una suposición.
--
--   Cuando STEL las exponga o el flujo las necesite, entran con la misma forma
--   que ya está probada acá:
--     credit_notes            (id, company_id, number, external_*, customer_id,
--                              invoice_id, date, currency_code, total, status)
--     credit_note_allocations (id, company_id, credit_note_id, invoice_id, amount)
--   igual que payment_allocations. No hay que rediseñar nada para sumarlas.
--
-- secuencia fiscal de invoice
--   Ver la nota en document_sequences.
--
-- secuencia interna de borradores
--   Posible, sin caso de uso hoy. El UUID alcanza para identificar un borrador.
