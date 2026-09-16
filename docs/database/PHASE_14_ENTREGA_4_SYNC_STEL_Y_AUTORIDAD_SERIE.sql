-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 14 · ENTREGA 4 — excepciones autorizadas, sync STEL y autoridad por serie
--
-- Migraciones (en este orden):
--   fase14_e4_excepciones_autorizadas     § 1-3
--   fase14_e4_sync_stel                   § 4-6
--   fase14_e4_autoridad_por_serie         § 7-9
--
-- Nada de esto cambia datos productivos por sí solo: agrega dos tablas vacías,
-- funciones nuevas y tres puertas más en funciones que ya existían. Con la tabla
-- de series vacía, la autoridad se resuelve exactamente como antes.
--
-- Reglas que se mantienen: sólo service_role escribe por estas RPC; anon y
-- authenticated no reciben EXECUTE de nada nuevo salvo la consulta de estado de
-- sync, que es de lectura y sólo para admin de la propia empresa; el esquema
-- `app` no está expuesto por PostgREST.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Bitácora: clientes y tipo de corrida ─────────────────────────────────
alter table public.stel_reconciliation_runs
  add column if not exists kind text not null default 'reconciliation';
alter table public.stel_reconciliation_runs drop constraint if exists stel_reconciliation_runs_kind_check;
alter table public.stel_reconciliation_runs
  add constraint stel_reconciliation_runs_kind_check check (kind in ('reconciliation', 'product_sync', 'document_delta'));

-- `customer` y `price_list` entran como entidades auditables de la reconciliación.
alter table public.stel_reconciliation_log drop constraint if exists stel_reconciliation_log_entity_type_check;
alter table public.stel_reconciliation_log
  add constraint stel_reconciliation_log_entity_type_check check (entity_type in (
    'quote', 'order', 'delivery', 'quote_line', 'order_line', 'delivery_line',
    'product', 'product_price', 'product_category', 'customer'));

-- ── 2. Identidad fuerte de cliente (CUIT desde STEL) ────────────────────────
/**
 * Carga en un cliente de React el CUIT que STEL tiene para su cuenta. Sólo eso:
 * no cambia razón social, ni email, ni vínculos. Condiciones (todas server-side):
 *   · el cliente no tiene CUIT cargado;
 *   · el número tiene forma de CUIT (11 dígitos);
 *   · ningún otro cliente de la empresa usa ese CUIT.
 * p: { customer_id, stel_account_id, tax_id }
 */
create or replace function public.stel_reconciliar_cliente(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_cli record; v_cuit text := regexp_replace(coalesce(p ->> 'tax_id', ''), '\D', '', 'g');
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_cuit !~ '^[0-9]{11}$' then
    raise exception 'cuit_invalido';
  end if;
  select * into v_cli from public.customers where id = (p ->> 'customer_id')::uuid and company_id = v_company for update;
  if v_cli.id is null then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  if v_cli.tax_id is not null then
    if regexp_replace(v_cli.tax_id, '\D', '', 'g') = v_cuit then
      return jsonb_build_object('customer_id', v_cli.id, 'cambios', 0);
    end if;
    raise exception 'cliente_con_otro_cuit' using errcode = 'restrict_violation';
  end if;
  if exists (
    select 1 from public.customers c
     where c.company_id = v_company and c.id <> v_cli.id
       and regexp_replace(coalesce(c.tax_id, ''), '\D', '', 'g') = v_cuit
  ) then
    raise exception 'cuit_en_conflicto' using errcode = 'unique_violation';
  end if;

  perform app.stel_ctx_on(p_run);
  update public.customers set tax_id = p ->> 'tax_id' where id = v_cli.id;
  perform app.stel_log(p_run, v_company, 'customer', v_cli.id, nullif(p ->> 'stel_account_id', ''), 'update', 'tax_id',
    'null'::jsonb, to_jsonb(p ->> 'tax_id'), jsonb_build_object('origen', 'STEL identidad fuerte'));
  perform app.stel_ctx_off();
  return jsonb_build_object('customer_id', v_cli.id, 'cambios', 1);
end $$;

-- `customers.tax_id` es lo único que la reconciliación puede escribir de un cliente.
create or replace function app.stel_campos(p_tabla text, p_op text)
returns text[] language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_tabla || ':' || p_op
    when 'sales_quotes:insert' then array['customer_id', 'quote_date', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'perception_pct', 'series_code', 'status', 'needs_review', 'review_reason']
    when 'sales_quotes:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'status', 'customer_id', 'external_source', 'external_id']
    when 'sales_orders:insert' then array['customer_id', 'order_date', 'quote_id', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'perception_pct', 'series_code', 'commercial_status', 'fulfillment_status', 'needs_review', 'review_reason']
    when 'sales_orders:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'discount_pct', 'quote_id', 'customer_id', 'external_source', 'external_id']
    when 'deliveries:insert' then array['customer_id', 'delivery_date', 'order_id', 'source_quote_id', 'currency_code', 'title', 'subtotal', 'tax_amount', 'total', 'series_code', 'needs_review', 'review_reason']
    when 'deliveries:update' then array['currency_code', 'subtotal', 'tax_amount', 'total', 'order_id', 'source_quote_id', 'customer_id', 'external_source', 'external_id']
    when 'sales_quote_lines:insert' then array['line_no', 'product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'line_type']
    when 'sales_quote_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct']
    when 'sales_order_lines:insert' then array['line_no', 'product_id', 'sku_snapshot', 'name_snapshot', 'quantity_ordered', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'line_type']
    when 'sales_order_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity_ordered', 'unit_price', 'discount_pct']
    when 'delivery_lines:insert' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct', 'tax_treatment', 'tax_rate_snapshot', 'warehouse_id']
    when 'delivery_lines:update' then array['product_id', 'sku_snapshot', 'name_snapshot', 'quantity', 'unit_price', 'discount_pct']
    when 'products:update' then array['name', 'description', 'status']
    -- Fase 14 E4: sync de catálogo (sólo productos vinculados a STEL) y cliente.
    when 'products:sync' then array['name', 'description', 'status', 'product_type']
    when 'customers:update' then array['tax_id']
    else array[]::text[]
  end
$$;

-- ── 3. Estado regresivo: sólo con aprobación explícita y sin derivados ──────
/**
 * Cambia respecto de E2:
 *   · `aprobar_estado_regresivo: true` habilita accepted/rejected → sent, y aun
 *     así la base exige que el documento no tenga pedidos ni remitos colgando;
 *   · al insertar, si la serie ya la emite el ERP, se rechaza: después del corte
 *     un documento nuevo de STEL en esa serie es una colisión, no una importación.
 */
create or replace function public.stel_reconciliar_documento(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_tipo text := p ->> 'tipo';
  v_stel text := p ->> 'stel_id';
  v_numero text := p ->> 'numero';
  v_tabla text; v_lineas text; v_fk text; v_entidad text; v_entidad_linea text; v_col_estado text;
  v_doc uuid; v_fila jsonb := '{}'::jsonb; v_campo text; v_valor jsonb; v_actual jsonb;
  v_linea jsonb; v_linea_id uuid; v_cambios int := 0; v_estado_nuevo text; v_estado_mapeado text;
  v_ref_tabla text; v_existente record; v_old_row jsonb; v_proximo int;
  v_doc_type text; v_serie text; v_derivados int;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_stel is null or v_stel !~ '^[0-9]{1,18}$' then
    raise exception 'stel_id_invalido';
  end if;
  if v_numero is null or v_numero !~ '^[A-Z][A-Z-]*[0-9]+$' then
    raise exception 'numero_invalido';
  end if;
  case v_tipo
    when 'quote' then v_tabla := 'sales_quotes'; v_lineas := 'sales_quote_lines'; v_fk := 'quote_id'; v_entidad := 'quote'; v_entidad_linea := 'quote_line'; v_col_estado := 'status'; v_doc_type := 'quote';
    when 'order' then v_tabla := 'sales_orders'; v_lineas := 'sales_order_lines'; v_fk := 'order_id'; v_entidad := 'order'; v_entidad_linea := 'order_line'; v_col_estado := 'commercial_status'; v_doc_type := 'sales_order';
    when 'delivery' then v_tabla := 'deliveries'; v_lineas := 'delivery_lines'; v_fk := 'delivery_id'; v_entidad := 'delivery'; v_entidad_linea := 'delivery_line'; v_col_estado := 'status'; v_doc_type := 'delivery';
    else raise exception 'tipo_invalido';
  end case;
  v_estado_mapeado := app.stel_estado_react(v_tipo, p ->> 'estado_stel');

  perform app.stel_ctx_on(p_run);

  if p ->> 'operacion' = 'insert' then
    execute format('select id from public.%I where company_id = $1 and (number = $2 or (external_source = ''stel'' and external_id = $3)) limit 1', v_tabla)
      into v_doc using v_company, v_numero, v_stel;
    if v_doc is not null then
      raise exception 'documento_ya_existe:%', v_numero using errcode = 'unique_violation';
    end if;
    -- Guard de post-freeze: la serie que ya emite el ERP no recibe documentos de STEL.
    v_serie := coalesce(p #>> '{cabecera,series_code}', regexp_replace(v_numero, '[0-9]+$', ''));
    if app.autoridad_efectiva(v_company, v_doc_type, v_serie) = 'ERP' then
      raise exception 'serie_emitida_por_el_erp:%:%', v_doc_type, v_serie using errcode = 'restrict_violation';
    end if;
    for v_campo, v_valor in select * from jsonb_each(p -> 'cabecera') loop
      if not (v_campo = any (app.stel_campos(v_tabla, 'insert'))) then
        raise exception 'campo_no_permitido:%.%', v_tabla, v_campo;
      end if;
      v_ref_tabla := case v_campo when 'customer_id' then 'customers' when 'quote_id' then 'sales_quotes' when 'order_id' then 'sales_orders' when 'source_quote_id' then 'sales_quotes' end;
      if v_ref_tabla is not null then
        v_valor := coalesce(to_jsonb(app.stel_ref(v_company, v_ref_tabla, v_valor)), 'null'::jsonb);
      end if;
      v_fila := v_fila || jsonb_build_object(v_campo, v_valor);
    end loop;
    if v_fila ->> v_col_estado is distinct from v_estado_mapeado and v_tipo <> 'delivery' then
      raise exception 'estado_no_corresponde_a_stel:%', v_numero;
    end if;
    if v_tipo = 'delivery' then
      v_fila := v_fila || jsonb_build_object('status', coalesce(v_estado_mapeado, 'delivered'));
    end if;
    if v_tipo = 'order' then
      v_fila := v_fila || jsonb_build_object('origin', 'migration');
    end if;
    v_fila := v_fila || jsonb_build_object('company_id', v_company, 'number', v_numero, 'original_number', v_numero,
      'imported_at', now(), 'external_source', 'stel', 'external_id', v_stel, 'legacy_source', 'stel_reconciliation');
    v_doc := app.stel_insertar(v_tabla, v_fila);
    perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'insert', null, null, v_fila - 'imported_at');
    v_cambios := 1;

  elsif p ->> 'operacion' = 'update' then
    execute format('select id, number, external_source, external_id, imported_at from public.%I where id = $1 and company_id = $2 for update', v_tabla)
      into v_existente using (p ->> 'react_id')::uuid, v_company;
    if v_existente.id is null then
      raise exception 'documento_inexistente:%', v_numero using errcode = 'P0002';
    end if;
    if v_existente.number is distinct from v_numero then
      raise exception 'numero_no_coincide:%', v_numero;
    end if;
    if v_existente.external_id is not null and (v_existente.external_source <> 'stel' or v_existente.external_id <> v_stel) then
      raise exception 'id_externo_no_coincide:%', v_numero using errcode = 'restrict_violation';
    end if;
    if v_existente.imported_at is null then
      raise exception 'documento_no_historico:%', v_numero using errcode = 'restrict_violation';
    end if;
    v_doc := v_existente.id;
    for v_campo, v_valor in select * from jsonb_each(p -> 'cabecera') loop
      if not (v_campo = any (app.stel_campos(v_tabla, 'update'))) then
        raise exception 'campo_no_permitido:%.%', v_tabla, v_campo;
      end if;
      v_actual := app.stel_valor(v_tabla, v_campo, v_doc);
      if v_actual is distinct from coalesce(v_valor -> 'old', 'null'::jsonb) then
        raise exception 'conflicto:%.%', v_numero, v_campo using errcode = 'serialization_failure';
      end if;
      if v_campo = 'external_source' and (v_valor ->> 'new') is distinct from 'stel' then
        raise exception 'fuente_invalida';
      end if;
      if v_campo = 'external_id' and (v_valor ->> 'new') is distinct from v_stel then
        raise exception 'id_externo_invalido';
      end if;
      if v_campo = v_col_estado then
        -- El estado sólo puede pasar al que corresponde al estado STEL.
        if (v_valor ->> 'new') is distinct from v_estado_mapeado then
          raise exception 'estado_no_corresponde_a_stel:%', v_numero;
        end if;
        if (v_actual #>> '{}') in ('accepted', 'rejected') and (v_valor ->> 'new') = 'sent' then
          -- Volver atrás necesita autorización explícita Y que no haya nada colgando.
          if (p ->> 'aprobar_estado_regresivo') is distinct from 'true' then
            raise exception 'estado_regresivo:%', v_numero using errcode = 'restrict_violation';
          end if;
          if v_tipo <> 'quote' then
            raise exception 'estado_regresivo_solo_cotizaciones:%', v_numero using errcode = 'restrict_violation';
          end if;
          select count(*) into v_derivados from public.sales_orders where quote_id = v_doc;
          select v_derivados + count(*) into v_derivados from public.deliveries where source_quote_id = v_doc;
          if v_derivados > 0 then
            raise exception 'estado_regresivo_con_derivados:%:%', v_numero, v_derivados using errcode = 'restrict_violation';
          end if;
          perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'note', v_col_estado, v_actual, v_valor -> 'new',
            jsonb_build_object('excepcion', 'estado_regresivo_aprobado', 'derivados', v_derivados));
        end if;
        continue; -- se aplica al final, después de las líneas
      end if;
      v_ref_tabla := case v_campo when 'customer_id' then 'customers' when 'quote_id' then 'sales_quotes' when 'order_id' then 'sales_orders' when 'source_quote_id' then 'sales_quotes' end;
      if v_ref_tabla is not null then
        v_valor := jsonb_build_object('old', v_valor -> 'old', 'new', coalesce(to_jsonb(app.stel_ref(v_company, v_ref_tabla, v_valor -> 'new')), 'null'::jsonb));
      end if;
      if v_actual is distinct from coalesce(v_valor -> 'new', 'null'::jsonb) then
        perform app.stel_poner(v_tabla, v_campo, v_doc, v_valor -> 'new');
        perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'update', v_campo, v_actual, v_valor -> 'new');
        v_cambios := v_cambios + 1;
      end if;
    end loop;
  else
    raise exception 'operacion_invalida';
  end if;

  -- Líneas: insertar
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,insertar}', '[]'::jsonb)) loop
    v_fila := jsonb_build_object('company_id', v_company, v_fk, v_doc);
    for v_campo, v_valor in select * from jsonb_each(v_linea) loop
      if not (v_campo = any (app.stel_campos(v_lineas, 'insert'))) then
        raise exception 'campo_no_permitido:%.%', v_lineas, v_campo;
      end if;
      if v_campo = 'product_id' then
        v_valor := coalesce(to_jsonb(app.stel_ref(v_company, 'products', v_valor)), 'null'::jsonb);
      elsif v_campo = 'warehouse_id' then
        v_valor := to_jsonb(app.stel_ref(v_company, 'warehouses', v_valor));
      end if;
      v_fila := v_fila || jsonb_build_object(v_campo, v_valor);
    end loop;
    if v_tipo = 'delivery' and not (v_fila ? 'warehouse_id') then
      v_fila := v_fila || jsonb_build_object('warehouse_id',
        (select id from public.warehouses where company_id = v_company and is_default limit 1));
    end if;
    if v_tipo <> 'delivery' and not (v_fila ? 'line_no') then
      execute format('select coalesce(max(line_no), 0) + 1 from public.%I where %I = $1', v_lineas, v_fk) into v_proximo using v_doc;
      v_fila := v_fila || jsonb_build_object('line_no', v_proximo);
    end if;
    v_linea_id := app.stel_insertar(v_lineas, v_fila);
    perform app.stel_log(p_run, v_company, v_entidad_linea, v_linea_id, v_stel, 'insert', null, null, v_fila);
    v_cambios := v_cambios + 1;
  end loop;

  -- Líneas: actualizar campo por campo
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,actualizar}', '[]'::jsonb)) loop
    execute format('select id from public.%I where id = $1 and %I = $2 and company_id = $3 for update', v_lineas, v_fk)
      into v_linea_id using (v_linea ->> 'id')::uuid, v_doc, v_company;
    if v_linea_id is null then
      raise exception 'linea_no_pertenece:%', v_numero;
    end if;
    for v_campo, v_valor in select * from jsonb_each(v_linea -> 'campos') loop
      if not (v_campo = any (app.stel_campos(v_lineas, 'update'))) then
        raise exception 'campo_no_permitido:%.%', v_lineas, v_campo;
      end if;
      v_actual := app.stel_valor(v_lineas, v_campo, v_linea_id);
      if v_actual is distinct from coalesce(v_valor -> 'old', 'null'::jsonb) then
        raise exception 'conflicto:%.linea.%', v_numero, v_campo using errcode = 'serialization_failure';
      end if;
      if v_campo = 'product_id' then
        v_valor := jsonb_build_object('old', v_valor -> 'old', 'new', coalesce(to_jsonb(app.stel_ref(v_company, 'products', v_valor -> 'new')), 'null'::jsonb));
      end if;
      if v_actual is distinct from coalesce(v_valor -> 'new', 'null'::jsonb) then
        perform app.stel_poner(v_lineas, v_campo, v_linea_id, v_valor -> 'new');
        perform app.stel_log(p_run, v_company, v_entidad_linea, v_linea_id, v_stel, 'update', v_campo, v_actual, v_valor -> 'new');
        v_cambios := v_cambios + 1;
      end if;
    end loop;
  end loop;

  -- Líneas: borrar SÓLO con aprobación explícita; la fila entera queda en la bitácora.
  for v_linea in select * from jsonb_array_elements(coalesce(p #> '{lineas,borrar}', '[]'::jsonb)) loop
    if (v_linea ->> 'aprobado') is distinct from 'true' then
      raise exception 'borrado_sin_aprobacion:%', v_numero using errcode = 'restrict_violation';
    end if;
    execute format('select to_jsonb(t) from public.%I t where t.id = $1 and t.%I = $2 and t.company_id = $3 for update', v_lineas, v_fk)
      into v_old_row using (v_linea ->> 'id')::uuid, v_doc, v_company;
    if v_old_row is null then
      raise exception 'linea_no_pertenece:%', v_numero;
    end if;
    execute format('delete from public.%I where id = $1', v_lineas) using (v_linea ->> 'id')::uuid;
    perform app.stel_log(p_run, v_company, v_entidad_linea, (v_linea ->> 'id')::uuid, v_stel, 'delete', null, v_old_row, null);
    v_cambios := v_cambios + 1;
  end loop;

  -- Estado al final
  if p ->> 'operacion' = 'update' and (p -> 'cabecera') ? v_col_estado then
    v_actual := app.stel_valor(v_tabla, v_col_estado, v_doc);
    v_valor := p #> array['cabecera', v_col_estado, 'new'];
    if v_actual is distinct from v_valor then
      perform app.stel_poner(v_tabla, v_col_estado, v_doc, v_valor);
      perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'update', v_col_estado, v_actual, v_valor);
      v_cambios := v_cambios + 1;
    end if;
  end if;

  if p ? 'auditoria' and v_cambios > 0 then
    perform app.stel_log(p_run, v_company, v_entidad, v_doc, v_stel, 'note', null, null, null, p -> 'auditoria');
  end if;

  perform app.stel_ctx_off();
  return jsonb_build_object('document_id', v_doc, 'cambios', v_cambios);
end $$;

-- ── 4. Estado del sync: checkpoint + candado ────────────────────────────────
create table if not exists public.stel_sync_state (
  company_id uuid not null references public.companies (id) on delete cascade,
  entity text not null check (entity in ('products', 'documents')),
  -- Checkpoint: hasta dónde llegó el incremental (fecha de modificación de STEL).
  cursor_modified_at timestamptz,
  cursor_external_id text,
  last_run_id uuid references public.stel_reconciliation_runs (id),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text not null default 'idle' check (last_status in ('idle', 'running', 'finished', 'failed')),
  last_error text,
  last_calls int not null default 0,
  last_summary jsonb not null default '{}'::jsonb,
  -- Candado con dueño y vencimiento: dos sync a la vez no arrancan.
  locked_at timestamptz,
  locked_by text,
  primary key (company_id, entity)
);
alter table public.stel_sync_state enable row level security;
revoke all on table public.stel_sync_state from public, anon, authenticated;

-- ── 5. RPC de sync (service_role) ───────────────────────────────────────────
/** Toma el candado y abre la corrida. Devuelve el checkpoint desde el que seguir. */
create or replace function public.stel_sync_tomar(p_company uuid, p_entidad text, p_owner text, p_ttl interval default interval '30 minutes')
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_st record; v_run uuid; v_kind text;
begin
  perform app.stel_exigir_servicio();
  if p_entidad not in ('products', 'documents') then
    raise exception 'entidad_invalida';
  end if;
  if coalesce(btrim(p_owner), '') = '' then
    raise exception 'owner_requerido';
  end if;
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'empresa_inexistente' using errcode = 'P0002';
  end if;
  v_kind := case p_entidad when 'products' then 'product_sync' else 'document_delta' end;

  insert into public.stel_sync_state (company_id, entity) values (p_company, p_entidad)
  on conflict (company_id, entity) do nothing;
  select * into v_st from public.stel_sync_state where company_id = p_company and entity = p_entidad for update;
  if v_st.locked_at is not null and v_st.locked_at > now() - p_ttl then
    raise exception 'sync_en_curso:%:%', p_entidad, v_st.locked_by using errcode = 'lock_not_available';
  end if;

  insert into public.stel_reconciliation_runs (company_id, plan_hash, stel_read_at, kind)
  values (p_company, encode(sha256(convert_to(p_company::text || p_entidad || clock_timestamp()::text, 'UTF8')), 'hex'), now(), v_kind)
  returning id into v_run;

  update public.stel_sync_state
     set locked_at = now(), locked_by = p_owner, last_run_id = v_run, last_started_at = now(),
         last_status = 'running', last_error = null, last_calls = 0
   where company_id = p_company and entity = p_entidad;

  return jsonb_build_object('run', v_run, 'cursor_modified_at', v_st.cursor_modified_at, 'cursor_external_id', v_st.cursor_external_id);
end $$;

/** Cierra la corrida y libera el candado. El checkpoint sólo avanza si terminó bien. */
create or replace function public.stel_sync_cerrar(p_run uuid, p_estado text, p_cursor timestamptz, p_cursor_id text, p_llamadas int, p_resumen jsonb, p_error text default null)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_company uuid; v_entidad text;
begin
  perform app.stel_exigir_servicio();
  if p_estado not in ('finished', 'failed') then
    raise exception 'estado_invalido';
  end if;
  select company_id into v_company from public.stel_reconciliation_runs where id = p_run and status = 'running';
  if v_company is null then
    raise exception 'run_no_activo' using errcode = 'P0002';
  end if;
  select entity into v_entidad from public.stel_sync_state where last_run_id = p_run;
  if v_entidad is null then
    raise exception 'run_sin_sync' using errcode = 'P0002';
  end if;
  update public.stel_reconciliation_runs
     set status = p_estado, finished_at = now(), summary = coalesce(p_resumen, '{}'::jsonb)
   where id = p_run;
  update public.stel_sync_state
     set last_status = p_estado, last_finished_at = now(), last_error = left(p_error, 500),
         last_calls = coalesce(p_llamadas, 0), last_summary = coalesce(p_resumen, '{}'::jsonb),
         cursor_modified_at = case when p_estado = 'finished' and p_cursor is not null then p_cursor else cursor_modified_at end,
         cursor_external_id = case when p_estado = 'finished' and p_cursor is not null then p_cursor_id else cursor_external_id end,
         locked_at = null, locked_by = null
   where company_id = v_company and entity = v_entidad;
end $$;

/**
 * Un producto de STEL. Identidad: external_id (nunca el SKU una vez vinculado).
 * p: { stel_id, sku, name, description, status, product_type, crear: bool, category_id }
 * Campos que NO toca: sku, categoría, marca, atributos, stock, precios de documentos.
 */
create or replace function public.stel_sync_producto(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_stel text := p ->> 'stel_id'; v_prod record; v_cat record; v_id uuid;
  v_campo text; v_nuevo jsonb; v_actual jsonb; v_cambios int := 0;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_stel is null or v_stel !~ '^[0-9]{1,18}$' then
    raise exception 'stel_id_invalido';
  end if;
  if coalesce(p ->> 'status', '') not in ('active', 'discontinued') then
    raise exception 'estado_producto_invalido';
  end if;

  select * into v_prod from public.products
   where company_id = v_company and external_source = 'stel' and external_id = v_stel for update;

  if v_prod.id is null then
    if (p ->> 'crear') is distinct from 'true' then
      return jsonb_build_object('product_id', null, 'cambios', 0, 'resultado', 'nuevo_no_creado');
    end if;
    if exists (select 1 from public.products where company_id = v_company and sku = p ->> 'sku') then
      -- Un SKU que ya existe con otro id STEL (o sin vincular) no se toca: es revisión humana.
      return jsonb_build_object('product_id', null, 'cambios', 0, 'resultado', 'sku_existente');
    end if;
    select * into v_cat from public.product_categories where id = (p ->> 'category_id')::uuid and company_id = v_company;
    if v_cat.id is null or v_cat.needs_review is distinct from true then
      raise exception 'categoria_no_es_de_revision';
    end if;
    perform app.stel_ctx_on(p_run);
    insert into public.products (company_id, sku, name, description, product_type, status, category_id, needs_review, external_source, external_id)
    values (v_company, p ->> 'sku', p ->> 'name', nullif(p ->> 'description', ''), nullif(p ->> 'product_type', ''), p ->> 'status', v_cat.id, true, 'stel', v_stel)
    returning id into v_id;
    perform app.stel_log(p_run, v_company, 'product', v_id, v_stel, 'insert', null, null,
      jsonb_build_object('sku', p ->> 'sku', 'name', p ->> 'name', 'status', p ->> 'status', 'origen', 'stel_sync'));
    perform app.stel_ctx_off();
    return jsonb_build_object('product_id', v_id, 'cambios', 1, 'resultado', 'creado');
  end if;

  perform app.stel_ctx_on(p_run);
  foreach v_campo in array app.stel_campos('products', 'sync') loop
    -- Un campo que el sync no manda no se toca (omitir ≠ vaciar).
    if not (p ? v_campo) then
      continue;
    end if;
    v_nuevo := case
      when v_campo in ('name', 'status') then to_jsonb(p ->> v_campo)
      else coalesce(to_jsonb(nullif(p ->> v_campo, '')), 'null'::jsonb)
    end;
    if v_campo in ('name', 'status') and (v_nuevo is null or v_nuevo = 'null'::jsonb) then
      continue;
    end if;
    v_actual := app.stel_valor('products', v_campo, v_prod.id);
    if v_actual is distinct from v_nuevo then
      perform app.stel_poner('products', v_campo, v_prod.id, v_nuevo);
      perform app.stel_log(p_run, v_company, 'product', v_prod.id, v_stel, 'update', v_campo, v_actual, v_nuevo);
      v_cambios := v_cambios + 1;
    end if;
  end loop;
  perform app.stel_ctx_off();
  return jsonb_build_object('product_id', v_prod.id, 'cambios', v_cambios, 'resultado', case when v_cambios > 0 then 'actualizado' else 'sin_cambios' end);
end $$;

/**
 * Precio de catálogo de un producto vinculado, en UNA lista de React.
 * No toca precios de líneas de documentos: eso es historia, no catálogo.
 * p: { stel_id, price_list_id, amount }
 */
create or replace function public.stel_sync_precio(p_run uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_stel text := p ->> 'stel_id'; v_prod uuid; v_lista record; v_precio record;
  v_monto numeric := (p ->> 'amount')::numeric; v_id uuid;
begin
  perform app.stel_exigir_servicio();
  v_company := app.stel_run_activo(p_run);
  if v_monto is null or v_monto <= 0 then
    raise exception 'monto_invalido';
  end if;
  select id into v_prod from public.products
   where company_id = v_company and external_source = 'stel' and external_id = v_stel;
  if v_prod is null then
    return jsonb_build_object('cambios', 0, 'resultado', 'producto_no_vinculado');
  end if;
  select * into v_lista from public.price_lists where id = (p ->> 'price_list_id')::uuid and company_id = v_company;
  if v_lista.id is null then
    raise exception 'lista_de_precios_invalida';
  end if;
  select * into v_precio from public.product_prices
   where company_id = v_company and price_list_id = v_lista.id and product_id = v_prod and valid_to is null
   order by valid_from desc limit 1 for update;

  perform app.stel_ctx_on(p_run);
  if v_precio.id is null then
    insert into public.product_prices (company_id, price_list_id, product_id, amount)
    values (v_company, v_lista.id, v_prod, v_monto) returning id into v_id;
    perform app.stel_log(p_run, v_company, 'product_price', v_id, v_stel, 'insert', null, null,
      jsonb_build_object('price_list_id', v_lista.id, 'amount', v_monto, 'origen', 'stel_sync'));
    perform app.stel_ctx_off();
    return jsonb_build_object('cambios', 1, 'resultado', 'creado');
  end if;
  if v_precio.amount = v_monto then
    perform app.stel_ctx_off();
    return jsonb_build_object('cambios', 0, 'resultado', 'sin_cambios');
  end if;
  update public.product_prices set amount = v_monto where id = v_precio.id;
  perform app.stel_log(p_run, v_company, 'product_price', v_precio.id, v_stel, 'update', 'amount',
    to_jsonb(v_precio.amount), to_jsonb(v_monto));
  perform app.stel_ctx_off();
  return jsonb_build_object('cambios', 1, 'resultado', 'actualizado');
end $$;

-- ── 6. Observabilidad para administradores (sólo lectura) ───────────────────
/** Estado del sync para la empresa: nunca expone la clave de STEL ni datos de negocio. */
create or replace function public.stel_sync_estado(p_company uuid)
returns table (
  entity text, last_status text, last_started_at timestamptz, last_finished_at timestamptz,
  cursor_modified_at timestamptz, cursor_external_id text, last_calls int, last_error text, last_summary jsonb,
  locked boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_company is null or app."current_role"(p_company) is distinct from 'admin' then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.entity, s.last_status, s.last_started_at, s.last_finished_at,
         s.cursor_modified_at, s.cursor_external_id, s.last_calls, s.last_error, s.last_summary,
         s.locked_at is not null
    from public.stel_sync_state s
   where s.company_id = p_company
   order by s.entity;
end $$;

-- ── 7. Autoridad por serie (tabla aparte: no toca el modelo existente) ──────
/**
 * Excepción por serie dentro de un tipo de documento. Vacía = todo se resuelve
 * como siempre, por tipo. Sirve para el caso RT-ML: el ERP pasa a emitir la serie
 * RT mientras STEL sigue siendo autoridad de RT-ML.
 */
create table if not exists public.document_numbering_authority_series (
  company_id uuid not null references public.companies (id) on delete cascade,
  doc_type text not null check (doc_type in ('quote', 'sales_order', 'delivery', 'customer')),
  series_code text not null check (btrim(series_code) <> ''),
  authority text not null check (authority in ('STEL', 'ERP')),
  reason text not null check (length(btrim(reason)) >= 3 and length(btrim(reason)) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (company_id, doc_type, series_code)
);
alter table public.document_numbering_authority_series enable row level security;
revoke all on table public.document_numbering_authority_series from public, anon, authenticated;

alter table public.document_numbering_authority_audit add column if not exists series_code text;

create or replace function app.auditar_autoridad_serie()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.authority is not distinct from old.authority
     and new.reason is not distinct from old.reason then
    return new;
  end if;
  insert into document_numbering_authority_audit
    (company_id, doc_type, series_code, operation, old_authority, new_authority, reason)
  values (
    coalesce(new.company_id, old.company_id),
    coalesce(new.doc_type, old.doc_type),
    coalesce(new.series_code, old.series_code),
    tg_op,
    case when tg_op <> 'INSERT' then old.authority end,
    case when tg_op <> 'DELETE' then new.authority end,
    case when tg_op <> 'DELETE' then new.reason else old.reason end
  );
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_autoridad_serie_audit_ins_del on public.document_numbering_authority_series;
create trigger trg_autoridad_serie_audit_ins_del
  after insert or delete on public.document_numbering_authority_series
  for each row execute function app.auditar_autoridad_serie();
drop trigger if exists trg_autoridad_serie_audit_upd on public.document_numbering_authority_series;
create trigger trg_autoridad_serie_audit_upd
  before update on public.document_numbering_authority_series
  for each row execute function app.auditar_autoridad_serie();

-- ── 8. Resolución: serie primero, tipo después, ERP por defecto ─────────────
create or replace function app.autoridad_efectiva(p_company uuid, p_doc_type text, p_series text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_autoridad text;
begin
  if coalesce(btrim(p_series), '') <> '' then
    select s.authority into v_autoridad
      from document_numbering_authority_series s
     where s.company_id = p_company and s.doc_type = p_doc_type and s.series_code = btrim(p_series)
       for share;
    if v_autoridad is not null then
      return v_autoridad;
    end if;
  end if;
  select a.authority into v_autoridad
    from document_numbering_authority a
   where a.company_id = p_company and a.doc_type = p_doc_type
     for share;
  return coalesce(v_autoridad, 'ERP');
end $$;

create or replace function app.exigir_emision_erp(p_company uuid, p_doc_type text, p_series text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.autoridad_efectiva(p_company, p_doc_type, p_series) = 'STEL' then
    raise exception 'external_numbering_authority'
      using detail = 'La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.',
            hint   = p_doc_type;
  end if;
end $$;

-- La versión de dos argumentos sigue existiendo y ahora delega (misma semántica
-- cuando la tabla de series está vacía).
create or replace function app.exigir_emision_erp(p_company uuid, p_doc_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.exigir_emision_erp(p_company, p_doc_type, null::text);
end $$;

-- ── 9. Puertas que ahora conocen la serie ──────────────────────────────────
create or replace function public.next_document_number(p_company uuid, p_doc_type text, p_series text default ''::text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefix text; v_padding int; v_num bigint; v_rol text; v_puede boolean; v_serie text;
begin
  if auth.uid() is not null then
    if p_company is null then
      raise exception 'Sin permiso para numerar documentos de esa empresa'
        using errcode = 'insufficient_privilege';
    end if;

    if p_doc_type = 'customer' then
      -- Los mismos roles que `customers_insert`.
      v_rol := app."current_role"(p_company);
      v_puede := v_rol in ('admin', 'employee', 'salesperson');
    else
      -- Los mismos que `quotes_write` / `orders_write` / `deliveries_write`.
      v_puede := p_company = any (app.current_writer_company_ids());
    end if;

    if not coalesce(v_puede, false) then
      raise exception 'Sin permiso para numerar documentos de esa empresa'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Qué serie se va a consumir: p_series = '' significa "la serie por defecto de
  -- este tipo", no "la serie cuyo código es la cadena vacía".
  select series_code into v_serie
    from document_sequences
   where company_id = p_company and doc_type = p_doc_type
     and case when coalesce(p_series, '') = '' then is_default else series_code = p_series end;

  -- Fase 12 E2.5 + Fase 14 E4: si STEL numera este tipo (o esta serie), no se
  -- consume la secuencia.
  perform app.exigir_emision_erp(p_company, p_doc_type, v_serie);

  update document_sequences
     set next_number = next_number + 1
   where company_id = p_company and doc_type = p_doc_type
     and case when coalesce(p_series, '') = '' then is_default
              else series_code = p_series end
  returning prefix, padding, next_number - 1
       into v_prefix, v_padding, v_num;

  if not found then
    raise exception 'No hay secuencia para % / % / %', p_company, p_doc_type,
      coalesce(nullif(p_series, ''), '(por defecto)')
      using errcode = 'no_data_found';
  end if;

  return v_prefix || lpad(v_num::text, v_padding, '0');
end $$;

create or replace function app.guardar_autoridad_numeracion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc_type text;
  v_estado_nuevo text;
  v_estado_viejo text;
  v_emitidos text[];
begin
  case tg_table_name
    when 'sales_quotes' then
      v_doc_type := 'quote';
      v_emitidos := array['sent', 'accepted'];
      v_estado_nuevo := new.status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.status end;
    when 'sales_orders' then
      v_doc_type := 'sales_order';
      v_emitidos := array['confirmed'];
      v_estado_nuevo := new.commercial_status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.commercial_status end;
    when 'deliveries' then
      v_doc_type := 'delivery';
      v_emitidos := array['shipped', 'delivered'];
      v_estado_nuevo := new.status;
      v_estado_viejo := case when tg_op = 'UPDATE' then old.status end;
    else
      raise exception 'guardar_autoridad_numeracion: tabla no soportada %', tg_table_name;
  end case;

  if app.es_importacion_externa(new.imported_at) then
    return new;
  end if;

  -- Una sesión (anon o usuario) que no escribe en esa empresa no llega a
  -- enterarse de su autoridad: los BEFORE corren antes del WITH CHECK de RLS,
  -- así que se la deja pasar y la rechaza la política, como siempre.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  elsif new.company_id is distinct from old.company_id then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  elsif v_estado_nuevo = any (v_emitidos) and v_estado_nuevo is distinct from v_estado_viejo then
    perform app.exigir_emision_erp(new.company_id, v_doc_type, new.series_code);
  end if;

  return new;
end $$;

/** Autoridad por serie de la empresa (para el panel de administración). */
create or replace function public.autoridad_numeracion_series(p_company uuid)
returns table (doc_type text, series_code text, authority text, reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.doc_type, s.series_code, s.authority, s.reason
    from document_numbering_authority_series s
   where s.company_id = p_company
   order by s.doc_type, s.series_code;
end $$;

-- ── 10. Permisos ────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.stel_reconciliar_cliente(uuid, jsonb)',
    'public.stel_sync_tomar(uuid, text, text, interval)',
    'public.stel_sync_cerrar(uuid, text, timestamptz, text, int, jsonb, text)',
    'public.stel_sync_producto(uuid, jsonb)',
    'public.stel_sync_precio(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Lectura de estado: admin de la propia empresa (la función lo verifica).
revoke all on function public.stel_sync_estado(uuid) from public;
grant execute on function public.stel_sync_estado(uuid) to authenticated, service_role;
revoke all on function public.autoridad_numeracion_series(uuid) from public;
grant execute on function public.autoridad_numeracion_series(uuid) to authenticated, service_role;
revoke all on function app.autoridad_efectiva(uuid, text, text) from public;
grant execute on function app.autoridad_efectiva(uuid, text, text) to service_role;
revoke all on function app.exigir_emision_erp(uuid, text, text) from public;
grant execute on function app.exigir_emision_erp(uuid, text, text) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (en orden inverso; nada de esto borra datos de negocio)
--
--   -- 9/8: volver a las versiones de E2/E3
--   create or replace function public.next_document_number(...)  -- sin v_serie
--   create or replace function app.guardar_autoridad_numeracion() -- sin new.series_code
--   drop function if exists public.autoridad_numeracion_series(uuid);
--   drop function if exists app.exigir_emision_erp(uuid, text, text);
--   drop function if exists app.autoridad_efectiva(uuid, text, text);
--   -- 7:
--   drop table if exists public.document_numbering_authority_series;   -- vacía
--   drop function if exists app.auditar_autoridad_serie();
--   alter table public.document_numbering_authority_audit drop column if exists series_code;
--   -- 6/5/4:
--   drop function if exists public.stel_sync_estado(uuid);
--   drop function if exists public.stel_sync_precio(uuid, jsonb);
--   drop function if exists public.stel_sync_producto(uuid, jsonb);
--   drop function if exists public.stel_sync_cerrar(uuid, text, timestamptz, text, int, jsonb, text);
--   drop function if exists public.stel_sync_tomar(uuid, text, text, interval);
--   drop table if exists public.stel_sync_state;
--   -- 3/2/1:
--   create or replace function public.stel_reconciliar_documento(...)  -- versión de E2
--   drop function if exists public.stel_reconciliar_cliente(uuid, jsonb);
--   alter table public.stel_reconciliation_runs drop column if exists kind;
-- ═══════════════════════════════════════════════════════════════════════════
