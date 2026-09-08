-- =====================================================================
--  BUSCATOOLS — FASE 2B · ETAPA 1
--  Core + Catálogo + Stock + Precios
--
--  ####################################################################
--  ##                     EJECUTADO — 2026-09-08                     ##
--  ##  Aplicado en uaxcfufvapzulqvynanp en 8 migraciones. Este        ##
--  ##  archivo es la referencia consolidada e incluye las             ##
--  ##  correcciones que surgieron durante la ejecución y las pruebas. ##
--  ##  Verificación: STAGE_1_SCHEMA_VERIFICATION.md                   ##
--  ##  Resultados:   STAGE_1_TEST_RESULTS.md  (72/72 PASS)            ##
--  ####################################################################
--
--  15 tablas. Ventas, Compras, Mantenimiento, WhatsApp, Emails, IA y
--  auditoría NO se crean en esta etapa.
--
--  CORRECCIONES YA INCORPORADAS (ver STAGE_1_TEST_RESULTS.md):
--   1. app.apply_stock_reservation: el delta negativo del RELEASE violaba
--      chk_reserved_non_negative porque PostgreSQL evalúa los CHECK sobre
--      la fila propuesta antes de resolver el ON CONFLICT. Ahora el alta
--      hace upsert y la baja un UPDATE directo.
--   2. pg_trgm y unaccent viven en `extensions`, no en `public` (advisor
--      de Supabase), y los índices GIN califican extensions.gin_trgm_ops.
--   3. `extensions` agregado al search_path de authenticated/anon/
--      service_role: sin eso el operador % de similitud no se resuelve.
--   4. REVOKE UPDATE/DELETE sobre stock_movements y UPDATE sobre
--      stock_reservations, para que el intento falle con error explícito
--      en vez de "0 filas afectadas".
--   5. Las 25 marcas del seed son las REALES del catálogo legacy.
--
--  Orden de ejecución: los 8 bloques, en orden. Cada bloque es una
--  migración independiente y re-ejecutable.
-- =====================================================================


-- =====================================================================
-- BLOQUE 1 — Extensiones y schema de funciones
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;  -- tolerante a tipeos
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;  -- ignora acentos

-- Sin esto el operador % de similitud no se resuelve desde la API, que se
-- conecta como authenticated con search_path = "$user", public.
ALTER ROLE authenticated SET search_path = "$user", public, extensions;
ALTER ROLE anon          SET search_path = "$user", public, extensions;
ALTER ROLE service_role  SET search_path = "$user", public, extensions;
-- pgvector: NO se instala. Ver ADR / sección R.

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;


-- =====================================================================
-- BLOQUE 2 — Tablas base (sin dependencias)
-- =====================================================================

CREATE TABLE currencies (
  code     text PRIMARY KEY,
  name     text NOT NULL,
  symbol   text NOT NULL,
  decimals smallint NOT NULL DEFAULT 2
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
  logo_path        text,
  brand_color      text,
  default_currency text NOT NULL REFERENCES currencies(code) DEFAULT 'ARS',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 1:1 con auth.users. Sin contraseñas ni hashes: eso vive en Supabase Auth.
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  avatar_path text,
  phone      text,
  locale     text NOT NULL DEFAULT 'es-AR',
  theme      text CHECK (theme IN ('light','dark')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_profiles_name_trgm ON profiles USING gin (full_name extensions.gin_trgm_ops);


-- =====================================================================
-- BLOQUE 3 — Clientes, membresías y catálogo
-- =====================================================================

-- customers se crea ANTES de company_memberships porque la membresía de
-- un usuario externo apunta al cliente que representa.
CREATE TABLE customers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  legal_name            text NOT NULL,            -- legacy 'nj'
  trade_name            text,                     -- legacy 'nc'
  tax_id                text,                     -- legacy 'cif'
  email_domains         text[] NOT NULL DEFAULT '{}',
  phone                 text,
  customer_type         text NOT NULL DEFAULT 'business'
                          CHECK (customer_type IN ('business','individual')),
  payment_terms         text,
  default_price_list_id uuid,                     -- FK al final (price_lists es posterior)
  default_currency      text REFERENCES currencies(code),
  discount_pct          numeric(5,2) NOT NULL DEFAULT 0,
  credit_limit          numeric(14,2),
  salesperson_id        uuid REFERENCES profiles(id),  -- 1:N, no tabla aparte
  notes                 text,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive')),
  legacy_ref            text,
  created_by            uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX idx_customers_taxid ON customers (company_id, tax_id)
  WHERE tax_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_customers_legacy ON customers (company_id, legacy_ref)
  WHERE legacy_ref IS NOT NULL;
CREATE INDEX idx_customers_legal_trgm ON customers USING gin (legal_name extensions.gin_trgm_ops);
CREATE INDEX idx_customers_trade_trgm ON customers USING gin (trade_name extensions.gin_trgm_ops);
CREATE INDEX idx_customers_domains    ON customers USING gin (email_domains);
CREATE INDEX idx_customers_seller     ON customers (company_id, salesperson_id);

-- El rol es una columna con CHECK, no una tabla: agregar un rol exige
-- escribir políticas RLS nuevas, o sea un deploy. Es un valor definido
-- por el código, no administrable por un usuario.
CREATE TABLE company_memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN
                     ('admin','employee','salesperson','technician',
                      'distributor','customer','supplier')),
  customer_id      uuid REFERENCES customers(id),
  supplier_id      uuid,                    -- FK cuando exista suppliers (Etapa 3)
  -- Secciones visibles. NULL = las que corresponden al rol.
  -- Replica erp_user_perms del legacy (14 flags por usuario) con UNA
  -- columna en vez de tres tablas de permisos.
  allowed_sections text[],
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','suspended')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id),
  CONSTRAINT chk_external_link CHECK (
    (role IN ('customer','distributor') AND customer_id IS NOT NULL) OR
    (role = 'supplier'                  AND supplier_id IS NOT NULL) OR
    (role IN ('admin','employee','salesperson','technician')
       AND customer_id IS NULL AND supplier_id IS NULL)
  )
);
CREATE INDEX idx_memberships_company_role ON company_memberships (company_id, role);
-- Índice más caliente del sistema: lo lee app.current_company_ids() en
-- CADA política de CADA consulta.
CREATE INDEX idx_memberships_user_active ON company_memberships (user_id)
  WHERE status = 'active';

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
  -- Marca las categorías que salieron de un volcado sin clasificar
  -- (12.588 productos del legacy caen en 'otros'). La fase CATALOG DATA
  -- CLEANUP las usa como cola de trabajo sin bloquear la migración.
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);

-- Lo que impide que products.attributes sea un contenedor libre.
CREATE TABLE product_attribute_definitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  key                    text NOT NULL,
  label                  text NOT NULL,
  data_type              text NOT NULL CHECK (data_type IN ('text','number','boolean')),
  unit                   text,
  applies_to_category_id uuid REFERENCES product_categories(id),
  is_filterable          boolean NOT NULL DEFAULT false,
  position               smallint NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  sku              text NOT NULL,
  name             text NOT NULL,
  model_code       text,
  brand_id         uuid REFERENCES brands(id),          -- NULLABLE: 25% sin marca
  category_id      uuid NOT NULL REFERENCES product_categories(id),
  product_type     text,
  series           text,
  description      text,
  description_long text,
  origin_country   text,
  ncm_code         text,
  weight_g         integer,
  volume_cm3       integer,
  attributes       jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','discontinued','draft')),
  is_kit           boolean NOT NULL DEFAULT false,
  -- Marca los productos importados sin revisar (sin marca, sin precio,
  -- categoría 'otros'). Cola de trabajo de CATALOG DATA CLEANUP.
  needs_review     boolean NOT NULL DEFAULT false,
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
CREATE INDEX idx_products_brand     ON products (company_id, brand_id);
CREATE INDEX idx_products_category  ON products (company_id, category_id);
CREATE INDEX idx_products_search    ON products USING gin (search_vector);
CREATE INDEX idx_products_attrs     ON products USING gin (attributes);
CREATE INDEX idx_products_sku_trgm  ON products USING gin (sku  extensions.gin_trgm_ops);
CREATE INDEX idx_products_name_trgm ON products USING gin (name extensions.gin_trgm_ops);
CREATE INDEX idx_products_review    ON products (company_id) WHERE needs_review;


-- =====================================================================
-- BLOQUE 4 — Stock y precios
-- =====================================================================

CREATE TABLE warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code       text NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- Append-only: la fuente de verdad del stock.
CREATE TABLE stock_movements (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  movement_type text NOT NULL CHECK (movement_type IN
                  ('opening_balance','purchase_receipt','sale_delivery',
                   'adjustment','transfer_in','transfer_out',
                   'return_in','return_out')),
  quantity      numeric(14,3) NOT NULL CHECK (quantity <> 0),
  source_type   text,
  source_id     uuid,
  notes         text,
  created_by    uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stockmov_product ON stock_movements
  (company_id, product_id, warehouse_id, created_at DESC);
CREATE INDEX idx_stockmov_source  ON stock_movements (source_type, source_id);

-- Derivada. SÓLO la escriben los triggers de abajo.
CREATE TABLE stock_balances (
  company_id   uuid NOT NULL REFERENCES companies(id),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  on_hand      numeric(14,3) NOT NULL DEFAULT 0,
  reserved     numeric(14,3) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT chk_reserved_non_negative CHECK (reserved >= 0)
);

CREATE TABLE stock_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  source_type  text NOT NULL,
  source_id    uuid,
  notes        text,
  expires_at   timestamptz,
  created_by   uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reservations_product ON stock_reservations (company_id, product_id, warehouse_id);

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
-- Una sola lista por defecto por empresa.
CREATE UNIQUE INDEX idx_pricelist_default ON price_lists (company_id)
  WHERE is_default;

CREATE TABLE product_prices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount        numeric(14,4) NOT NULL CHECK (amount >= 0),
  valid_from    date NOT NULL DEFAULT current_date,
  valid_to      date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id, valid_from),
  CONSTRAINT chk_price_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX idx_prices_product ON product_prices (product_id);
CREATE INDEX idx_prices_lookup  ON product_prices (price_list_id, product_id, valid_from DESC);

-- FK diferida: customers se creó antes que price_lists.
ALTER TABLE customers
  ADD CONSTRAINT fk_customers_price_list
  FOREIGN KEY (default_price_list_id) REFERENCES price_lists(id);


-- =====================================================================
-- BLOQUE 5 — Funciones auxiliares
--   SECURITY DEFINER: se ejecutan como el dueño (postgres) y por lo tanto
--   NO disparan RLS. Es lo que evita la recursión infinita al consultar
--   company_memberships desde una política.
--   STABLE: Postgres las evalúa una vez por consulta, no una vez por fila.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.current_company_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(company_id), '{}')
  FROM company_memberships
  WHERE user_id = auth.uid() AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION app.current_role(p_company uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT role FROM company_memberships
  WHERE user_id = auth.uid() AND company_id = p_company AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.is_internal(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT app.current_role(p_company)
         IN ('admin','employee','salesperson','technician');
$$;

CREATE OR REPLACE FUNCTION app.is_admin(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT app.current_role(p_company) = 'admin';
$$;

CREATE OR REPLACE FUNCTION app.current_customer_id(p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT customer_id FROM company_memberships
  WHERE user_id = auth.uid() AND company_id = p_company
    AND role IN ('customer','distributor') AND status = 'active'
  LIMIT 1;
$$;

-- Lista de precios que le corresponde a un usuario externo.
CREATE OR REPLACE FUNCTION app.current_price_list_id(p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT c.default_price_list_id FROM customers c
  WHERE c.id = app.current_customer_id(p_company);
$$;

-- ¿El usuario comparte alguna empresa con este perfil?
CREATE OR REPLACE FUNCTION app.shares_company(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_memberships m
    WHERE m.user_id = p_user
      AND m.company_id = ANY(app.current_company_ids())
  );
$$;

-- Postgres otorga EXECUTE a PUBLIC por defecto en toda función. En
-- funciones SECURITY DEFINER eso es riesgoso: cualquier rol podría
-- invocarlas. Se revoca y se otorga sólo a `authenticated`, que es quien
-- las necesita porque las políticas RLS se evalúan como el usuario que
-- consulta.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;


-- =====================================================================
-- BLOQUE 6 — Triggers
-- =====================================================================

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_companies_touch   BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_profiles_touch    BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_memberships_touch BEFORE UPDATE ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_customers_touch   BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER trg_products_touch    BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ── Perfil automático al crear un usuario en Supabase Auth ───────────
-- Permite dar de alta los usuarios de prueba desde el Dashboard y que el
-- profile aparezca solo, sin insertar a mano en auth.users.
CREATE OR REPLACE FUNCTION app.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'full_name',
                           split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_user();

-- ── Validación de attributes contra el registro de definiciones ──────
-- Una sola consulta por escritura. Es la forma más simple de hacerlo
-- cumplir en la base: un CHECK no puede consultar otra tabla.
CREATE OR REPLACE FUNCTION app.validate_product_attributes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE invalidas text[];
BEGIN
  IF NEW.attributes IS NULL OR NEW.attributes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k) INTO invalidas
  FROM jsonb_object_keys(NEW.attributes) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM product_attribute_definitions d
    WHERE d.company_id = NEW.company_id AND d.key = k
  );

  IF invalidas IS NOT NULL THEN
    RAISE EXCEPTION
      'Atributos no declarados para esta empresa: %. Declararlos en product_attribute_definitions.',
      array_to_string(invalidas, ', ');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_products_validate_attrs
  BEFORE INSERT OR UPDATE OF attributes ON products
  FOR EACH ROW EXECUTE FUNCTION app.validate_product_attributes();

-- ── Saldo de stock ───────────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION app.apply_stock_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  -- El upsert sólo tiene sentido en el ALTA: la fila de saldo puede no
  -- existir todavía. En la BAJA la fila existe por definición.
  --
  -- No se puede usar un único INSERT ... ON CONFLICT con delta negativo:
  -- PostgreSQL evalúa los CHECK sobre la fila PROPUESTA antes de resolver
  -- el conflicto, así que reserved = -20 viola chk_reserved_non_negative
  -- aunque el resultado del UPDATE fuese 0. (Bug encontrado por la prueba S5.)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stock_balances (company_id, product_id, warehouse_id, reserved)
    VALUES (NEW.company_id, NEW.product_id, NEW.warehouse_id, NEW.quantity)
    ON CONFLICT (product_id, warehouse_id) DO UPDATE
      SET reserved   = stock_balances.reserved + EXCLUDED.reserved,
          updated_at = now();
    RETURN NEW;
  ELSE
    UPDATE stock_balances
       SET reserved   = reserved - OLD.quantity,
           updated_at = now()
     WHERE product_id = OLD.product_id
       AND warehouse_id = OLD.warehouse_id;
    RETURN OLD;
  END IF;
END;
$$;
CREATE TRIGGER trg_reservation_apply
  AFTER INSERT OR DELETE ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_reservation();

-- Vista de disponibilidad (lo que puede ver un usuario externo:
-- si hay o no hay, nunca la cantidad exacta).
CREATE VIEW product_availability
WITH (security_invoker = true) AS
SELECT b.company_id, b.product_id, b.warehouse_id,
       (b.on_hand - b.reserved) > 0 AS is_available
FROM stock_balances b;


-- =====================================================================
-- BLOQUE 7 — RLS
--   Toda tabla con RLS activo. Sin política = acceso denegado, que es el
--   lado correcto donde fallar.
-- =====================================================================

ALTER TABLE currencies                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements               ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances                ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_lists                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_prices                ENABLE ROW LEVEL SECURITY;

-- Defensa en profundidad: anon no tiene nada que hacer acá.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ── currencies: catálogo público para usuarios autenticados ──────────
CREATE POLICY currencies_select ON currencies FOR SELECT TO authenticated
  USING (true);

-- ── companies ────────────────────────────────────────────────────────
CREATE POLICY companies_select ON companies FOR SELECT TO authenticated
  USING (id = ANY(app.current_company_ids()));
CREATE POLICY companies_update ON companies FOR UPDATE TO authenticated
  USING (app.is_admin(id)) WITH CHECK (app.is_admin(id));
-- Sin INSERT ni DELETE: alta de empresa sólo por migración (service_role).

-- ── profiles ─────────────────────────────────────────────────────────
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR app.shares_company(id));
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ── company_memberships ──────────────────────────────────────────────
CREATE POLICY memberships_select ON company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app.is_admin(company_id));
CREATE POLICY memberships_write ON company_memberships FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

-- ── customers ────────────────────────────────────────────────────────
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND deleted_at IS NULL
    AND (
      app.current_role(company_id) IN ('admin','employee')
      OR (app.current_role(company_id) = 'salesperson'
          AND salesperson_id = auth.uid())
      OR id = app.current_customer_id(company_id)
    )
  );
CREATE POLICY customers_insert ON customers FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee','salesperson')
  );
CREATE POLICY customers_update ON customers FOR UPDATE TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND (app.current_role(company_id) IN ('admin','employee')
         OR (app.current_role(company_id) = 'salesperson' AND salesperson_id = auth.uid()))
  )
  WITH CHECK (company_id = ANY(app.current_company_ids()));
-- Sin DELETE: se usa deleted_at.

-- ── brands / product_categories / product_attribute_definitions ──────
CREATE POLICY brands_select ON brands FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()));
CREATE POLICY brands_write ON brands FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

CREATE POLICY categories_select ON product_categories FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()));
CREATE POLICY categories_write ON product_categories FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

CREATE POLICY attrdefs_select ON product_attribute_definitions FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()));
CREATE POLICY attrdefs_write ON product_attribute_definitions FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

-- ── products ─────────────────────────────────────────────────────────
CREATE POLICY products_select ON products FOR SELECT TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND deleted_at IS NULL
    AND (app.is_internal(company_id) OR status = 'active')
  );
CREATE POLICY products_write ON products FOR ALL TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee')
  )
  WITH CHECK (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee')
  );

-- ── warehouses: sólo interno ─────────────────────────────────────────
CREATE POLICY warehouses_select ON warehouses FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()) AND app.is_internal(company_id));
CREATE POLICY warehouses_write ON warehouses FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

-- ── stock_movements: append-only ─────────────────────────────────────
CREATE POLICY stockmov_select ON stock_movements FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()) AND app.is_internal(company_id));
CREATE POLICY stockmov_insert ON stock_movements FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee')
  );
-- SIN políticas de UPDATE ni DELETE: prohibido para todos, incluido admin.
-- Corregir un movimiento = crear el contramovimiento.

-- ── stock_balances: sólo lectura interna; lo escribe el trigger ──────
CREATE POLICY stockbal_select ON stock_balances FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()) AND app.is_internal(company_id));
-- SIN políticas de escritura. El trigger es SECURITY DEFINER y no las necesita.
REVOKE INSERT, UPDATE, DELETE ON stock_balances     FROM authenticated;
-- Append-only real: sin REVOKE, el intento devolvería "0 filas" en silencio.
REVOKE UPDATE, DELETE          ON stock_movements    FROM authenticated;
REVOKE UPDATE                  ON stock_reservations FROM authenticated;

-- ── stock_reservations ───────────────────────────────────────────────
CREATE POLICY reservations_select ON stock_reservations FOR SELECT TO authenticated
  USING (company_id = ANY(app.current_company_ids()) AND app.is_internal(company_id));
CREATE POLICY reservations_insert ON stock_reservations FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee','salesperson')
  );
CREATE POLICY reservations_delete ON stock_reservations FOR DELETE TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee','salesperson')
  );

-- ── price_lists: el externo ve SÓLO la suya ──────────────────────────
CREATE POLICY pricelists_select ON price_lists FOR SELECT TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND (app.is_internal(company_id) OR id = app.current_price_list_id(company_id))
  );
CREATE POLICY pricelists_write ON price_lists FOR ALL TO authenticated
  USING (app.is_admin(company_id)) WITH CHECK (app.is_admin(company_id));

-- ── product_prices: el externo ve SÓLO los de su lista y vigentes ────
CREATE POLICY prices_select ON product_prices FOR SELECT TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND (
      app.is_internal(company_id)
      OR (price_list_id = app.current_price_list_id(company_id)
          AND valid_from <= current_date
          AND (valid_to IS NULL OR valid_to >= current_date))
    )
  );
CREATE POLICY prices_write ON product_prices FOR ALL TO authenticated
  USING (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee')
  )
  WITH CHECK (
    company_id = ANY(app.current_company_ids())
    AND app.current_role(company_id) IN ('admin','employee')
  );


-- =====================================================================
-- BLOQUE 8 — Seeds
-- =====================================================================

INSERT INTO currencies (code, name, symbol, decimals) VALUES
  ('ARS','Peso argentino','$',2),
  ('USD','Dólar estadounidense','US$',2),
  ('EUR','Euro','€',2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO companies (slug, name, legal_name, tax_id, address, phone, email,
                       website, brand_color, default_currency)
VALUES
  ('buscatools','Buscatools','Juan M. J. Mocciaro (BUSCATOOLS)','20-27089205-2',
   'Melincué 5125, CABA (1417)','11.2169.3304','info@buscatools.com.ar',
   'www.buscatools.com.ar','#F37021','ARS'),
  ('torquetools','Torquetools',NULL,NULL,NULL,NULL,NULL,NULL,'#2563EB','ARS')
ON CONFLICT (slug) DO NOTHING;

-- Depósito por defecto por empresa
INSERT INTO warehouses (company_id, code, name, is_default)
SELECT id, 'PRIN', 'Depósito principal', true FROM companies
ON CONFLICT (company_id, code) DO NOTHING;

-- Listas de precios (Buscatools: base + distribuidores + especial cliente)
INSERT INTO price_lists (company_id, name, currency_code, is_default)
SELECT c.id, v.name, 'USD', v.is_default
FROM companies c
CROSS JOIN (VALUES ('Lista base', true),
                   ('Distribuidores', false),
                   ('Especial Cliente Demo', false)) AS v(name, is_default)
WHERE c.slug = 'buscatools'
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO price_lists (company_id, name, currency_code, is_default)
SELECT id, 'Lista base', 'USD', true FROM companies WHERE slug = 'torquetools'
ON CONFLICT (company_id, name) DO NOTHING;

-- Categorías reales del legacy. 'otros' queda marcada para revisión:
-- concentra 12.588 de los 21.772 productos.
INSERT INTO product_categories (company_id, name, slug, position, needs_review)
SELECT c.id, v.name, v.slug, v.position, v.needs_review
FROM companies c
CROSS JOIN (VALUES
  ('Otros',                 'otros',                0, true),
  ('Puntas y tubos',        'punta',                1, false),
  ('Balanceadores',         'balanceador',          2, false),
  ('Atornilladores',        'atornillador',         3, false),
  ('Accesorios',            'accesorio',            4, false),
  ('Llaves de impacto',     'llave-de-impacto',     5, false),
  ('Remachadoras',          'remachadora',          6, false),
  ('Llaves dinamométricas', 'llave-dinamometrica',  7, false)
) AS v(name, slug, position, needs_review)
WHERE c.slug = 'buscatools'
ON CONFLICT (company_id, slug) DO NOTHING;

-- Marcas reales del legacy (25)
INSERT INTO brands (company_id, name)
SELECT c.id, m.name
FROM companies c
CROSS JOIN (VALUES ('SPEEDRILL'),('APEX'),('FIAM'),('TOHNICHI'),
  ('INGERSOLL RAND'),('TECNA'),('FEIN'),('TORERO'),('CHICAGO PNEUMATIC'),
  ('DUROFIX'),('ESTIC'),('SAIPOR'),('URYU'),('YOKOTA'),('RR'),('GEDORE'),
  ('BR'),('RIVIT'),('TO'),('GE'),('NA'),('KI'),('KOKEN'),('SI'),('MI')) AS m(name)
WHERE c.slug = 'buscatools'
ON CONFLICT (company_id, name) DO NOTHING;

-- Definiciones de atributos: la cola larga del catálogo, declarada.
-- Sin estas filas el trigger rechaza cualquier producto con attributes.
INSERT INTO product_attribute_definitions
  (company_id, key, label, data_type, unit, is_filterable, position)
SELECT c.id, a.key, a.label, a.data_type, a.unit, a.is_filterable, a.position
FROM companies c
CROSS JOIN (VALUES
  ('encastre',        'Encastre',            'text',   NULL,  true,  1),
  ('largo',           'Largo',               'text',   'mm',  true,  2),
  ('medida',          'Medida',              'text',   NULL,  true,  3),
  ('sufijos',         'Sufijos',             'text',   NULL,  false, 4),
  ('min_kg',          'Capacidad mínima',    'number', 'kg',  true,  5),
  ('max_kg',          'Capacidad máxima',    'number', 'kg',  true,  6),
  ('longitud',        'Longitud de cable',   'text',   'm',   false, 7),
  ('carcasa',         'Material de carcasa', 'text',   NULL,  false, 8),
  ('rpm',             'Revoluciones',        'number', 'rpm', true,  9),
  ('torq_min',        'Torque mínimo',       'number', 'Nm',  true, 10),
  ('torq_max',        'Torque máximo',       'number', 'Nm',  true, 11),
  ('voltaje',         'Voltaje',             'text',   'V',   true, 12),
  ('alimentacion',    'Alimentación',        'text',   NULL,  true, 13),
  ('ergonomia',       'Ergonomía',           'text',   NULL,  false,14),
  ('dim_caja',        'Dimensiones de caja', 'text',   NULL,  false,15),
  ('dim_balanceador', 'Dimensiones',         'text',   NULL,  false,16),
  ('eslinga',         'Eslinga',             'text',   NULL,  false,17),
  ('peso_kg',         'Peso',                'number', 'kg',  false,18),
  ('peso_embalado_kg','Peso embalado',       'number', 'kg',  false,19),
  ('catalogo_id',     'Catálogo',            'text',   NULL,  false,20),
  ('catalogo_pagina', 'Página de catálogo',  'text',   NULL,  false,21),
  ('codigo',          'Código alternativo',  'text',   NULL,  false,22)
) AS a(key, label, data_type, unit, is_filterable, position)
WHERE c.slug = 'buscatools'
ON CONFLICT (company_id, key) DO NOTHING;

-- =====================================================================
--  PENDIENTE (posterior a la aprobación de esta etapa):
--   · Alta de los 7 usuarios de prueba en Supabase Auth (Dashboard).
--   · Memberships + customers de prueba (script aparte, ver el .md).
--   · Carga de los 216 productos de muestra (scripts/sample-products.mjs).
--   · Movimientos de stock de apertura para los que tienen existencias.
--   · Precios en las tres listas.
--
--  ####################################################################
--  ##                  FIN — DRAFT, NOT EXECUTED                     ##
--  ####################################################################
-- =====================================================================
