-- =====================================================================
--  BUSCATOOLS — Schema propuesto (Fase 2)
--
--  ####################################################################
--  ##                 DRAFT — NOT EXECUTED                           ##
--  ##  Este archivo NO fue ejecutado contra ningún proyecto Supabase. ##
--  ##  El proyecto uaxcfufvapzulqvynanp sigue con el schema public    ##
--  ##  VACÍO. Es documentación de diseño, pendiente de aprobación.    ##
--  ##  Las políticas RLS están DISEÑADAS pero NO ESCRITAS acá:        ##
--  ##  ver RLS_MATRIX.md. Se implementan en Fase 2B.                  ##
--  ####################################################################
--
--  Referencias: PHASE_2_SCHEMA_DESIGN.md · DATA_DICTIONARY.md
--  PostgreSQL 17.6 (Supabase)
--
--  ⚠ SUPERSEDIDO PARCIALMENTE. Este archivo son las 58 tablas de la
--  propuesta original y se conserva como registro. La revisión de
--  simplificación (PHASE_2B_STAGE_1.md § 1) eliminó 7 tablas:
--    roles, permissions, role_permissions, membership_permissions,
--    customer_sales_reps, wa_message_files, wa_conversation_assignments
--  El DDL vigente y ejecutable es STAGE_1_SCHEMA.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONES
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsqueda difusa de SKU y nombres
CREATE EXTENSION IF NOT EXISTS unaccent;   -- "balanceadór" encuentra "balanceador"
-- pgvector: NO. Ver sección R del diseño.

CREATE SCHEMA IF NOT EXISTS app;           -- funciones auxiliares de RLS


-- ---------------------------------------------------------------------
-- 1. CORE — identidad, empresas, permisos
-- ---------------------------------------------------------------------

CREATE TABLE currencies (
  code       text PRIMARY KEY,             -- ARS, USD, EUR
  name       text NOT NULL,
  symbol     text NOT NULL,
  decimals   smallint NOT NULL DEFAULT 2
);

CREATE TABLE companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  legal_name       text,
  tax_id           text,
  address          text,
  phone            text,
  email            text,
  website          text,
  logo_path        text,                   -- Storage, no base64
  brand_color      text,
  default_currency text NOT NULL REFERENCES currencies(code) DEFAULT 'ARS',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 1:1 con auth.users. Sin contraseñas ni hashes: eso vive en Supabase Auth.
CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  avatar_path text,
  phone       text,
  locale      text NOT NULL DEFAULT 'es-AR',
  theme       text CHECK (theme IN ('light','dark')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_profiles_name_trgm ON profiles USING gin (full_name gin_trgm_ops);

CREATE TABLE roles (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  is_internal boolean NOT NULL,
  rank        smallint NOT NULL
);
INSERT INTO roles (code, label, is_internal, rank) VALUES
  ('admin',       'Administrador', true,  100),
  ('employee',    'Empleado',      true,   80),
  ('salesperson', 'Vendedor',      true,   60),
  ('technician',  'Técnico',       true,   60),
  ('distributor', 'Distribuidor',  false,  40),
  ('customer',    'Cliente',       false,  20),
  ('supplier',    'Proveedor',     false,  20);   -- preparado, inactivo

CREATE TABLE permissions (
  code   text PRIMARY KEY,                 -- 'sales.quote.create'
  module text NOT NULL,
  label  text NOT NULL
);

CREATE TABLE role_permissions (
  role       text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission)
);

CREATE TABLE company_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        text NOT NULL REFERENCES roles(code),
  customer_id uuid,                        -- FK agregada más abajo (customers aún no existe)
  supplier_id uuid,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id),
  -- Un usuario externo DEBE estar ligado a la entidad que representa.
  -- Sin esto, "un cliente ve sólo sus pedidos" no se puede escribir.
  CONSTRAINT chk_external_link CHECK (
    (role IN ('customer','distributor') AND customer_id IS NOT NULL) OR
    (role = 'supplier'                  AND supplier_id IS NOT NULL) OR
    (role IN ('admin','employee','salesperson','technician')
       AND customer_id IS NULL AND supplier_id IS NULL)
  )
);
CREATE INDEX idx_memberships_company_role ON company_memberships (company_id, role);
-- Índice más caliente del sistema: lo usa app.current_company_ids() en CADA consulta.
CREATE INDEX idx_memberships_user_active  ON company_memberships (user_id)
  WHERE status = 'active';

CREATE TABLE membership_permissions (
  membership_id uuid NOT NULL REFERENCES company_memberships(id) ON DELETE CASCADE,
  permission    text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  granted       boolean NOT NULL,          -- true = suma, false = quita
  PRIMARY KEY (membership_id, permission)
);


-- ---------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES DE RLS
--    STABLE: Postgres las evalúa una vez por consulta, no por fila.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_company_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(company_id), '{}')
  FROM company_memberships
  WHERE user_id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION app.has_role(p_company uuid, p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_memberships
    WHERE user_id = auth.uid() AND company_id = p_company
      AND role = p_role AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION app.has_permission(p_company uuid, p_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  WITH m AS (
    SELECT id, role FROM company_memberships
    WHERE user_id = auth.uid() AND company_id = p_company AND status = 'active'
  )
  SELECT COALESCE(
    -- una revocación explícita gana sobre el permiso del rol
    (SELECT mp.granted FROM membership_permissions mp
      JOIN m ON m.id = mp.membership_id WHERE mp.permission = p_perm),
    EXISTS (SELECT 1 FROM role_permissions rp
             JOIN m ON m.role = rp.role WHERE rp.permission = p_perm),
    false
  );
$$;

CREATE OR REPLACE FUNCTION app.current_customer_id(p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT customer_id FROM company_memberships
  WHERE user_id = auth.uid() AND company_id = p_company
    AND role IN ('customer','distributor') AND status = 'active'
  LIMIT 1;
$$;

-- updated_at automático (nunca lo escribe la aplicación)
CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


-- ---------------------------------------------------------------------
-- 3. ARCHIVOS Y AUDITORÍA
-- ---------------------------------------------------------------------

CREATE TABLE files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  bucket          text NOT NULL,
  path            text NOT NULL,
  original_name   text,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL,
  checksum_sha256 text,
  external_url    text,                    -- imágenes que aún viven en buscatool.com
  uploaded_by     uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (bucket, path)
);
CREATE INDEX idx_files_company ON files (company_id, created_at DESC);

-- Append-only. Sólo escriben triggers SECURITY DEFINER.
CREATE TABLE audit_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES companies(id),
  actor_id     uuid REFERENCES profiles(id),
  entity_type  text NOT NULL,
  entity_id    uuid,
  entity_label text,                       -- 'PED00123', legible sin join
  action       text NOT NULL CHECK (action IN
                 ('create','update','delete','status_change','approve',
                  'convert','send','login_failed','permission_change')),
  changes      jsonb,                      -- diff por campo, NO la fila entera
  ip_address   inet,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_events (company_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_actor  ON audit_events (company_id, actor_id, occurred_at DESC);
-- Futuro: PARTITION BY RANGE (occurred_at) cuando el volumen lo pida.


-- ---------------------------------------------------------------------
-- 4. CATÁLOGO
-- ---------------------------------------------------------------------

CREATE TABLE brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name       text NOT NULL,
  logo_path  text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE product_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  parent_id  uuid REFERENCES product_categories(id),
  name       text NOT NULL,
  slug       text NOT NULL,
  position   smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);

-- Lo que impide que `attributes` se convierta en un vertedero:
-- toda clave usada tiene que estar declarada acá.
CREATE TABLE product_attribute_definitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  key                    text NOT NULL,       -- 'encastre', 'largo', 'rpm'
  label                  text NOT NULL,
  data_type              text NOT NULL CHECK (data_type IN ('text','number','boolean')),
  unit                   text,                -- 'mm', 'kg', 'Nm'
  applies_to_category_id uuid REFERENCES product_categories(id),
  is_filterable          boolean NOT NULL DEFAULT false,
  position               smallint NOT NULL DEFAULT 0,
  UNIQUE (company_id, key)
);

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  sku              text NOT NULL,                          -- 100%, 0 duplicados
  name             text NOT NULL,                          -- 100%
  model_code       text,                                   -- legacy 'base', 100%
  brand_id         uuid REFERENCES brands(id),              -- 74,9% → NULLABLE
  category_id      uuid NOT NULL REFERENCES product_categories(id),
  product_type     text,                                   -- 42,2%, filtro principal
  series           text,                                   -- 41,7%, filtro principal
  description      text,                                   -- 100%
  description_long text,                                   -- 99,7%
  origin_country   text,                                   -- 40,5%
  ncm_code         text,                                   -- 24,5%
  weight_g         integer,                                -- 100%
  volume_cm3       integer,                                -- 100%
  attributes       jsonb NOT NULL DEFAULT '{}',            -- cola larga (30 campos <10%)
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','discontinued','draft')),
  is_kit           boolean NOT NULL DEFAULT false,
  search_vector    tsvector GENERATED ALWAYS AS (
                     setweight(to_tsvector('spanish', coalesce(sku,'')),        'A') ||
                     setweight(to_tsvector('spanish', coalesce(name,'')),       'A') ||
                     setweight(to_tsvector('spanish', coalesce(model_code,'')), 'B') ||
                     setweight(to_tsvector('spanish', coalesce(description,'')),'C')
                   ) STORED,
  legacy_ref       text,
  created_by       uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (company_id, sku)
);
CREATE INDEX idx_products_brand    ON products (company_id, brand_id);
CREATE INDEX idx_products_category ON products (company_id, category_id);
CREATE INDEX idx_products_search   ON products USING gin (search_vector);
CREATE INDEX idx_products_attrs    ON products USING gin (attributes);
CREATE INDEX idx_products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_products_touch BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE product_components (              -- kits
  parent_product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES products(id),
  quantity             numeric(14,3) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (parent_product_id, component_product_id)
);

CREATE TABLE product_equivalences (            -- legacy sim_sp / sim_tc / sim_cp / sim_ir
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_brand text NOT NULL,
  competitor_sku   text NOT NULL,
  UNIQUE (product_id, competitor_brand, competitor_sku)
);
CREATE INDEX idx_equiv_sku ON product_equivalences (competitor_sku);

CREATE TABLE product_files (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id)    ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'image' CHECK (role IN ('image','datasheet','manual')),
  position   smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, file_id)
);


-- ---------------------------------------------------------------------
-- 5. STOCK
-- ---------------------------------------------------------------------

CREATE TABLE warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code       text NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

-- Append-only: la fuente de verdad del stock. Sin UPDATE ni DELETE.
CREATE TABLE stock_movements (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  movement_type text NOT NULL CHECK (movement_type IN
                  ('purchase_receipt','sale_delivery','adjustment',
                   'transfer_in','transfer_out','return_in','return_out',
                   'opening_balance','production_in','production_out')),
  quantity      numeric(14,3) NOT NULL CHECK (quantity <> 0),  -- con signo
  source_type   text,
  source_id     uuid,
  notes         text,
  created_by    uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stockmov_product ON stock_movements (company_id, product_id, warehouse_id, created_at DESC);
CREATE INDEX idx_stockmov_source  ON stock_movements (source_type, source_id);

-- Derivada: sólo la escribe el trigger de abajo. Arranca con ~378 filas.
CREATE TABLE stock_balances (
  company_id   uuid NOT NULL REFERENCES companies(id),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand      numeric(14,3) NOT NULL DEFAULT 0,
  reserved     numeric(14,3) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE OR REPLACE FUNCTION app.apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO stock_balances (company_id, product_id, warehouse_id, on_hand)
  VALUES (NEW.company_id, NEW.product_id, NEW.warehouse_id, NEW.quantity)
  ON CONFLICT (product_id, warehouse_id) DO UPDATE
    SET on_hand    = stock_balances.on_hand + EXCLUDED.on_hand,
        updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_stock_apply AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();

CREATE TABLE stock_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  source_type  text NOT NULL,
  source_id    uuid NOT NULL,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- disponible = on_hand - reserved  (reemplaza el par sr/sv del legacy)


-- ---------------------------------------------------------------------
-- 6. PRECIOS
-- ---------------------------------------------------------------------

CREATE TABLE price_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  name          text NOT NULL,
  currency_code text NOT NULL REFERENCES currencies(code),
  is_default    boolean NOT NULL DEFAULT false,
  valid_from    date,
  valid_to      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE product_prices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount        numeric(14,4) NOT NULL CHECK (amount >= 0),
  valid_from    date NOT NULL DEFAULT current_date,
  valid_to      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id, valid_from)   -- valid_from/to = historial
);
CREATE INDEX idx_prices_product ON product_prices (product_id);

-- Tabla separada de products POR SEGURIDAD: distribuidores y clientes
-- tienen SELECT denegado acá (ver RLS_MATRIX.md).
CREATE TABLE product_costs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id    uuid,                     -- FK agregada tras crear suppliers
  cost           numeric(14,4) NOT NULL,
  currency_code  text NOT NULL REFERENCES currencies(code),
  effective_date date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- 7. CLIENTES
-- ---------------------------------------------------------------------

CREATE TABLE customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  legal_name            text NOT NULL,          -- legacy 'nj' (hoy PK de facto)
  trade_name            text,                   -- legacy 'nc' (97%)
  tax_id                text,                   -- legacy 'cif' (60%)
  email_domains         text[] NOT NULL DEFAULT '{}',  -- legacy 'doms'
  phone                 text,
  customer_type         text NOT NULL DEFAULT 'business'
                          CHECK (customer_type IN ('business','individual')),
  payment_terms         text,
  default_price_list_id uuid REFERENCES price_lists(id),
  default_currency      text REFERENCES currencies(code),
  discount_pct          numeric(5,2) DEFAULT 0,
  credit_limit          numeric(14,2),
  notes                 text,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive')),
  legacy_ref            text,                   -- 'CLI00719'
  created_by            uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX idx_customers_taxid ON customers (company_id, tax_id)
  WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_legal_trgm ON customers USING gin (legal_name gin_trgm_ops);
CREATE INDEX idx_customers_trade_trgm ON customers USING gin (trade_name gin_trgm_ops);
CREATE INDEX idx_customers_domains    ON customers USING gin (email_domains);

-- FKs diferidas de company_memberships y product_costs
ALTER TABLE company_memberships
  ADD CONSTRAINT fk_membership_customer FOREIGN KEY (customer_id) REFERENCES customers(id);

CREATE TABLE customer_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  role_title  text,
  email       text,
  phone       text,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_customer ON customer_contacts (customer_id);

CREATE TABLE customer_addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_type text NOT NULL CHECK (address_type IN ('billing','shipping')),
  street       text, city text, state text, postal_code text,
  country      text NOT NULL DEFAULT 'AR',
  is_default   boolean NOT NULL DEFAULT false
);

CREATE TABLE customer_sales_reps (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (customer_id, profile_id)
);


-- ---------------------------------------------------------------------
-- 8. VENTAS
-- ---------------------------------------------------------------------

CREATE TABLE quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  doc_number         text NOT NULL,
  customer_id        uuid NOT NULL REFERENCES customers(id),   -- FK REAL (legacy: texto)
  contact_id         uuid REFERENCES customer_contacts(id),
  salesperson_id     uuid REFERENCES profiles(id),
  issue_date         date NOT NULL DEFAULT current_date,
  valid_until        date,
  title              text,
  currency_code      text NOT NULL REFERENCES currencies(code),
  exchange_rate      numeric(14,6),
  payment_terms      text,
  discount_pct       numeric(5,2) NOT NULL DEFAULT 0,          -- legacy dtoGlobal
  subtotal           numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount         numeric(14,2) NOT NULL DEFAULT 0,
  total              numeric(14,2) NOT NULL DEFAULT 0,
  total_units        numeric(14,3) NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN
                       ('draft','sent','accepted','rejected','expired','converted')),
  notes              text,
  customer_reference text,
  legacy_ref         text,
  created_by         uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (company_id, doc_number)
);
CREATE INDEX idx_quotes_customer ON quotes (company_id, customer_id, issue_date DESC);
CREATE INDEX idx_quotes_status   ON quotes (company_id, status);
CREATE INDEX idx_quotes_seller   ON quotes (company_id, salesperson_id);

CREATE TABLE quote_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id              uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position              integer NOT NULL,             -- orden ESTABLE
  line_type             text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item','chapter')),
  product_id            uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot          text,      -- congelados al emitir: el documento
  name_snapshot         text,      -- impreso debe reproducirse años después
  description_snapshot  text,
  quantity              numeric(14,3),
  unit_price            numeric(14,4),
  discount_pct          numeric(5,2) DEFAULT 0,
  tax_rate              numeric(5,2),
  line_total            numeric(14,2),
  UNIQUE (quote_id, position),
  -- una línea de capítulo es sólo un separador de sección
  CONSTRAINT chk_chapter CHECK (
    line_type = 'item' OR (quantity IS NULL AND unit_price IS NULL AND product_id IS NULL)
  )
);
CREATE INDEX idx_quote_items_product ON quote_items (product_id);

CREATE TABLE sales_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  doc_number     text NOT NULL,
  quote_id       uuid REFERENCES quotes(id),           -- legacy fromCotizacion
  customer_id    uuid NOT NULL REFERENCES customers(id),
  contact_id     uuid REFERENCES customer_contacts(id),
  salesperson_id uuid REFERENCES profiles(id),
  issue_date     date NOT NULL DEFAULT current_date,
  promised_date  date,
  title          text,
  currency_code  text NOT NULL REFERENCES currencies(code),
  exchange_rate  numeric(14,6),
  payment_terms  text,
  discount_pct   numeric(5,2) NOT NULL DEFAULT 0,
  subtotal       numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount     numeric(14,2) NOT NULL DEFAULT 0,
  total          numeric(14,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN
                   ('pending','partial','delivered','cancelled')),
  cost_center    text,
  notes          text,
  legacy_ref     text,
  created_by     uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (company_id, doc_number)
);
CREATE INDEX idx_orders_customer ON sales_orders (company_id, customer_id, issue_date DESC);
CREATE INDEX idx_orders_status   ON sales_orders (company_id, status);

CREATE TABLE sales_order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  quote_item_id  uuid REFERENCES quote_items(id),
  position       integer NOT NULL,
  line_type      text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item','chapter')),
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot   text,
  name_snapshot  text,
  description_snapshot text,
  quantity       numeric(14,3),
  -- Reemplaza ped.entregado[idx] del legacy, que indexaba por POSICIÓN en el array.
  delivered_qty  numeric(14,3) NOT NULL DEFAULT 0,
  unit_price     numeric(14,4),
  discount_pct   numeric(5,2) DEFAULT 0,
  tax_rate       numeric(5,2),
  line_total     numeric(14,2),
  UNIQUE (sales_order_id, position),
  CONSTRAINT chk_delivered CHECK (delivered_qty >= 0 AND (quantity IS NULL OR delivered_qty <= quantity))
);
CREATE INDEX idx_order_items_product ON sales_order_items (product_id);

CREATE TABLE delivery_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  doc_number          text NOT NULL,
  sales_order_id      uuid REFERENCES sales_orders(id),
  customer_id         uuid NOT NULL REFERENCES customers(id),
  shipping_address_id uuid REFERENCES customer_addresses(id),
  warehouse_id        uuid REFERENCES warehouses(id),
  issue_date          date NOT NULL DEFAULT current_date,
  currency_code       text NOT NULL REFERENCES currencies(code),
  subtotal            numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount          numeric(14,2) NOT NULL DEFAULT 0,
  total               numeric(14,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','delivered','invoiced','cancelled')),
  notes               text,
  legacy_ref          text,
  created_by          uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number)
);

CREATE TABLE delivery_note_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id     uuid NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  -- ★ La corrección del bug del índice: la parcial se liga a SU línea de pedido.
  sales_order_item_id  uuid REFERENCES sales_order_items(id),
  position             integer NOT NULL,
  line_type            text NOT NULL DEFAULT 'item' CHECK (line_type IN ('item','chapter')),
  product_id           uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot         text,
  name_snapshot        text,
  quantity             numeric(14,3),
  unit_price           numeric(14,4),
  line_total           numeric(14,2),
  UNIQUE (delivery_note_id, position)
);
CREATE INDEX idx_dn_items_order_item ON delivery_note_items (sales_order_item_id);

-- Mantiene delivered_qty y el estado del pedido. Sin arrays, sin índices frágiles.
CREATE OR REPLACE FUNCTION app.sync_delivered_qty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_item uuid; v_order uuid;
BEGIN
  v_item := COALESCE(NEW.sales_order_item_id, OLD.sales_order_item_id);
  IF v_item IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE sales_order_items soi
     SET delivered_qty = COALESCE(
           (SELECT sum(dni.quantity) FROM delivery_note_items dni
             WHERE dni.sales_order_item_id = soi.id), 0)
   WHERE soi.id = v_item
   RETURNING soi.sales_order_id INTO v_order;

  UPDATE sales_orders so
     SET status = CASE
       WHEN NOT EXISTS (SELECT 1 FROM sales_order_items i
                         WHERE i.sales_order_id = so.id
                           AND i.line_type = 'item'
                           AND i.delivered_qty < i.quantity) THEN 'delivered'
       WHEN EXISTS (SELECT 1 FROM sales_order_items i
                     WHERE i.sales_order_id = so.id AND i.delivered_qty > 0) THEN 'partial'
       ELSE 'pending' END
   WHERE so.id = v_order AND so.status <> 'cancelled';

  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_dn_items_sync
  AFTER INSERT OR UPDATE OR DELETE ON delivery_note_items
  FOR EACH ROW EXECUTE FUNCTION app.sync_delivered_qty();

CREATE TABLE sales_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  doc_number       text NOT NULL,
  delivery_note_id uuid REFERENCES delivery_notes(id),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  issue_date       date NOT NULL DEFAULT current_date,
  due_date         date,
  paid_date        date,
  currency_code    text NOT NULL REFERENCES currencies(code),
  exchange_rate    numeric(14,6),
  subtotal         numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount       numeric(14,2) NOT NULL DEFAULT 0,
  total            numeric(14,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN
                     ('pending','paid','overdue','cancelled')),
  legacy_ref       text,
  created_by       uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number)
  -- Documento legal: NO tiene deleted_at. Se cancela, no se borra.
);

CREATE TABLE sales_invoice_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_invoice_id      uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  delivery_note_item_id uuid REFERENCES delivery_note_items(id),
  position              integer NOT NULL,
  line_type             text NOT NULL DEFAULT 'item',
  product_id            uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot          text,
  name_snapshot         text,
  quantity              numeric(14,3),
  unit_price            numeric(14,4),
  tax_rate              numeric(5,2),
  line_total            numeric(14,2),
  UNIQUE (sales_invoice_id, position)
);


-- ---------------------------------------------------------------------
-- 9. COMPRAS   (estructura simétrica a ventas — resumida)
-- ---------------------------------------------------------------------

CREATE TABLE suppliers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  legal_name       text NOT NULL,          -- legacy 'nj'
  trade_name       text,                   -- legacy 'nc'
  tax_id           text,                   -- legacy 'cif'
  email text, phone text, address text,
  activity         text,                   -- legacy 'actividad'
  agent            text,                   -- legacy 'agente'
  payment_terms    text,                   -- legacy 'formaPago' ('FOB 180 DIAS')
  default_currency text REFERENCES currencies(code),
  country          text,
  notes            text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  legacy_ref       text,                   -- 'PROV00008'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
ALTER TABLE company_memberships
  ADD CONSTRAINT fk_membership_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE product_costs
  ADD CONSTRAINT fk_cost_supplier      FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

CREATE TABLE purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  doc_number    text NOT NULL,
  supplier_id   uuid NOT NULL REFERENCES suppliers(id),
  issue_date    date NOT NULL DEFAULT current_date,
  eta_date      date,
  confirmed_at  timestamptz,
  incoterm      text,
  currency_code text NOT NULL REFERENCES currencies(code),
  exchange_rate numeric(14,6),
  payment_terms text,
  subtotal      numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(14,2) NOT NULL DEFAULT 0,
  total         numeric(14,2) NOT NULL DEFAULT 0,
  freight_cost  numeric(14,2) DEFAULT 0,
  customs_cost  numeric(14,2) DEFAULT 0,
  other_costs   numeric(14,2) DEFAULT 0,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN
                  ('draft','sent','confirmed','partial','received','cancelled')),
  notes         text,
  legacy_ref    text,
  created_by    uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (company_id, doc_number)
);

CREATE TABLE purchase_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  line_type         text NOT NULL DEFAULT 'item',
  product_id        uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot      text,
  name_snapshot     text,
  supplier_sku      text,
  quantity          numeric(14,3),
  received_qty      numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost         numeric(14,4),
  discount_pct      numeric(5,2) DEFAULT 0,
  line_total        numeric(14,2),
  landed_unit_cost  numeric(14,4),          -- con flete y aduana prorrateados
  UNIQUE (purchase_order_id, position)
);

CREATE TABLE purchase_receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  doc_number        text NOT NULL,
  purchase_order_id uuid REFERENCES purchase_orders(id),
  supplier_id       uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id      uuid NOT NULL REFERENCES warehouses(id),
  receipt_date      date NOT NULL DEFAULT current_date,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  notes             text,
  created_by        uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_number)
);

CREATE TABLE purchase_receipt_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id    uuid NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id uuid REFERENCES purchase_order_items(id),
  position               integer NOT NULL,
  product_id             uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_snapshot           text,
  quantity               numeric(14,3) NOT NULL,
  unit_cost              numeric(14,4),
  UNIQUE (purchase_receipt_id, position)
);

CREATE TABLE supplier_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  doc_number          text NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES suppliers(id),
  purchase_receipt_id uuid REFERENCES purchase_receipts(id),
  issue_date          date NOT NULL,
  due_date            date,
  currency_code       text NOT NULL REFERENCES currencies(code),
  exchange_rate       numeric(14,6),
  subtotal            numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount          numeric(14,2) NOT NULL DEFAULT 0,
  total               numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount         numeric(14,2) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','partial','paid','overdue','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supplier_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  supplier_invoice_id uuid NOT NULL REFERENCES supplier_invoices(id),
  payment_date        date NOT NULL DEFAULT current_date,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code       text NOT NULL REFERENCES currencies(code),
  method              text CHECK (method IN ('transfer','check','cash','other')),
  reference           text,
  created_by          uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- 10. MANTENIMIENTO
-- ---------------------------------------------------------------------

CREATE TABLE assets (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES companies(id),
  customer_id                uuid NOT NULL REFERENCES customers(id),  -- FK REAL
  product_id                 uuid REFERENCES products(id),
  brand_id                   uuid REFERENCES brands(id),
  identifier                 text,
  model                      text,
  serial_number              text,
  asset_type                 text,
  location_city              text,
  location_state             text,
  warranty_start             date,
  warranty_end               date,
  under_maintenance_contract boolean NOT NULL DEFAULT false,
  next_preventive_date       date,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  notes                      text,
  legacy_ref                 text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz
);
CREATE INDEX idx_assets_customer ON assets (company_id, customer_id);
CREATE UNIQUE INDEX idx_assets_serial ON assets (company_id, serial_number)
  WHERE serial_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE maintenance_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  doc_number             text NOT NULL,
  asset_id               uuid NOT NULL REFERENCES assets(id),
  customer_id            uuid NOT NULL REFERENCES customers(id),  -- denormalizado para filtrar
  service_type           text NOT NULL DEFAULT 'corrective'
                           CHECK (service_type IN ('corrective','preventive','warranty')),
  assigned_technician_id uuid REFERENCES profiles(id),
  received_by            uuid REFERENCES profiles(id),
  received_date          date,
  repaired_date          date,
  delivered_date         date,
  current_step           text NOT NULL DEFAULT 'diagnosis' CHECK (current_step IN
                           ('diagnosis','quote','repair','torque','closing')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN
                           ('open','paused','waiting_approval','waiting_parts',
                            'repaired','closed','cancelled')),
  entry_reason           text,
  visual_condition       text,
  diagnosis_notes        text,
  work_performed         text,
  pending_parts          text,
  quote_id               uuid REFERENCES quotes(id),
  quote_status           text CHECK (quote_status IN ('pending','approved','rejected')),
  approved_by            uuid REFERENCES profiles(id),
  approved_at            date,
  actual_hours           numeric(8,2),
  overall_efficiency     numeric(5,2),
  torque_nominal         numeric(10,3),
  torque_lcl             numeric(10,3),
  torque_ucl             numeric(10,3),
  final_notes            text,
  next_preventive_date   date,
  legacy_ref             text,
  created_by             uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  UNIQUE (company_id, doc_number)
);
CREATE INDEX idx_mo_asset ON maintenance_orders (company_id, asset_id, created_at DESC);
CREATE INDEX idx_mo_tech  ON maintenance_orders (assigned_technician_id) WHERE status <> 'closed';

CREATE TABLE maintenance_order_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_order_id uuid NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  step                 text NOT NULL CHECK (step IN ('diagnosis','quote','repair','torque','closing')),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','in_progress','done','skipped')),
  performed_by         uuid REFERENCES profiles(id),
  started_at           timestamptz,
  completed_at         timestamptz,
  notes                text,
  data                 jsonb NOT NULL DEFAULT '{}',   -- campos propios de la etapa
  UNIQUE (maintenance_order_id, step)
);

CREATE TABLE maintenance_parts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_order_id uuid NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  product_id           uuid REFERENCES products(id),
  sku_snapshot         text,
  name_snapshot        text,
  phase                text NOT NULL CHECK (phase IN ('diagnosis','repair')),
  quantity             numeric(14,3) NOT NULL DEFAULT 1,
  unit_price           numeric(14,4),
  replaced             boolean NOT NULL DEFAULT false,
  notes                text
);

-- Reemplaza el array fijo de 10 posiciones del legacy (torqueMediciones).
CREATE TABLE maintenance_measurements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_order_id uuid NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  position             smallint NOT NULL,
  measurement_type     text NOT NULL DEFAULT 'torque',
  target_value         numeric(10,3),
  min_value            numeric(10,3),
  max_value            numeric(10,3),
  measured_value       numeric(10,3),
  passed               boolean,
  measured_at          timestamptz,
  UNIQUE (maintenance_order_id, position)
);

CREATE TABLE maintenance_files (
  maintenance_order_id uuid NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  file_id              uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role                 text NOT NULL DEFAULT 'document'
                         CHECK (role IN ('before','after','diagnosis','document','video')),
  position             smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (maintenance_order_id, file_id)
);


-- ---------------------------------------------------------------------
-- 11. COMUNICACIONES
-- ---------------------------------------------------------------------

CREATE TABLE wa_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  label        text NOT NULL,
  phone_number text,
  provider     text NOT NULL DEFAULT 'baileys',
  is_connected boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_conversations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  wa_account_id           uuid NOT NULL REFERENCES wa_accounts(id),
  chat_id                 text NOT NULL,       -- 5491100000000@s.whatsapp.net
  phone                   text NOT NULL,
  display_name            text,
  customer_id             uuid REFERENCES customers(id),   -- legacy: cli_ref texto
  supplier_id             uuid REFERENCES suppliers(id),
  assigned_to             uuid REFERENCES profiles(id),    -- legacy: asignado texto
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived')),
  ai_mode                 text NOT NULL DEFAULT 'off' CHECK (ai_mode IN ('off','draft','auto')),
  tags                    text[] NOT NULL DEFAULT '{}',
  notes                   text,
  unread_count            integer NOT NULL DEFAULT 0,      -- por trigger
  last_message_at         timestamptz,
  last_message_preview    text,
  last_message_direction  text CHECK (last_message_direction IN ('in','out')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wa_account_id, chat_id)
);
CREATE INDEX idx_wa_conv_inbox    ON wa_conversations (company_id, status, last_message_at DESC);
CREATE INDEX idx_wa_conv_assigned ON wa_conversations (assigned_to) WHERE status = 'open';
CREATE INDEX idx_wa_conv_customer ON wa_conversations (customer_id);

CREATE TABLE wa_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies(id),
  conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  external_id     text,                      -- id de Baileys: evita duplicados
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  body            text,
  message_type    text NOT NULL DEFAULT 'text' CHECK (message_type IN
                    ('text','image','audio','video','document','location','sticker')),
  is_read         boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'delivered' CHECK (status IN
                    ('queued','sent','delivered','read','failed','draft')),
  error           text,
  sent_by         uuid REFERENCES profiles(id),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_id)
  -- Sin columna de media: los archivos van a Storage (wa_message_files).
);
CREATE INDEX idx_wa_msg_conv ON wa_messages (conversation_id, sent_at DESC);

CREATE TABLE wa_message_files (
  message_id bigint NOT NULL REFERENCES wa_messages(id) ON DELETE CASCADE,
  file_id    uuid   NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role       text   NOT NULL DEFAULT 'media',
  PRIMARY KEY (message_id, file_id)
);

CREATE TABLE wa_conversation_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES profiles(id),
  assigned_by     uuid REFERENCES profiles(id),
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz
);

CREATE TABLE email_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  address      text NOT NULL,
  display_name text,
  provider     text NOT NULL DEFAULT 'gmail',
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, address)
);

CREATE TABLE email_threads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  email_account_id   uuid NOT NULL REFERENCES email_accounts(id),
  external_thread_id text NOT NULL,
  subject            text,
  customer_id        uuid REFERENCES customers(id),
  assigned_to        uuid REFERENCES profiles(id),
  status             text NOT NULL DEFAULT 'new' CHECK (status IN
                       ('new','assigned','in_progress','answered','archived')),
  labels             text[] NOT NULL DEFAULT '{}',
  message_count      integer NOT NULL DEFAULT 0,
  last_message_at    timestamptz,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_account_id, external_thread_id)
);
CREATE INDEX idx_email_threads_inbox ON email_threads (company_id, status, last_message_at DESC);

CREATE TABLE email_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      uuid NOT NULL REFERENCES companies(id),
  thread_id       uuid NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  external_id     text UNIQUE,               -- gmail_id
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  from_email      text NOT NULL,
  from_name       text,
  to_emails       text[],
  cc_emails       text[],
  reply_to        text,
  subject         text,
  snippet         text,                      -- <=300 chars: lo único que lee la bandeja
  body_text       text,
  body_html       text,                      -- SÓLO si <= 64KB, ya sanitizado
  body_html_path  text,                      -- Storage si es mayor
  has_attachments boolean NOT NULL DEFAULT false,
  sent_at         timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_html_size CHECK (body_html IS NULL OR octet_length(body_html) <= 65536)
);
CREATE INDEX idx_email_msg_thread ON email_messages (thread_id, sent_at DESC);

CREATE TABLE email_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  file_id          uuid NOT NULL REFERENCES files(id),   -- Storage, NUNCA base64
  filename         text NOT NULL,
  mime_type        text,
  size_bytes       bigint
);


-- =====================================================================
--  PENDIENTE PARA FASE 2B (no incluido acá a propósito)
--
--  · ALTER TABLE ... ENABLE ROW LEVEL SECURITY  en todas las tablas
--  · Las políticas CREATE POLICY según RLS_MATRIX.md
--  · Triggers de auditoría con lista blanca de campos
--  · Secuencias de doc_number por empresa y tipo de documento
--  · Triggers touch_updated_at en el resto de las tablas
--  · Trigger de unread_count en wa_conversations
--  · Seeds: currencies, permissions, role_permissions
--
--  ####################################################################
--  ##                  FIN — DRAFT, NOT EXECUTED                     ##
--  ####################################################################
-- =====================================================================
