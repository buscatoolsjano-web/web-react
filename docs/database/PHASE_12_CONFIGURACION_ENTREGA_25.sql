-- =============================================================================
-- Fase 12 · Configuración · Entrega 2.5 — Guardrail de convivencia con STEL
--
-- Mientras STEL sea la autoridad de numeración de un tipo de documento de una
-- empresa, el ERP no emite ese tipo: no consume la secuencia, no crea el
-- documento y no le da efectos productivos (despacho → stock).
--
-- Qué NO hace esta migración:
--   · no toca `document_sequences` (ni valores, ni prefijos, ni padding);
--   · no toca documentos existentes;
--   · no implementa el cutover STEL → ERP (queda diseñado en el doc).
--
-- Aplicada como migración `fase12_config_e25_stel_guard`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuración explícita de autoridad
--
-- Tabla propia y no una columna de `document_sequences`: la autoridad es de
-- (empresa, tipo), no de cada serie, y así el guardrail no toca la tabla de
-- secuencias. Sin fila = el ERP numera (comportamiento previo, sin cambios).
-- -----------------------------------------------------------------------------
create table public.document_numbering_authority (
  company_id  uuid        not null references public.companies (id) on delete cascade,
  doc_type    text        not null,
  authority   text        not null check (authority in ('STEL', 'ERP')),
  reason      text        not null check (length(btrim(reason)) between 3 and 500),
  updated_at  timestamptz not null default now(),
  updated_by  uuid                 default auth.uid(),
  primary key (company_id, doc_type)
);

comment on table public.document_numbering_authority is
  'Quién numera cada tipo de documento de cada empresa (STEL o ERP). Sin fila = ERP. Sólo lectura desde la app; se cambia por migración/cutover auditado.';

alter table public.document_numbering_authority enable row level security;
-- Sin políticas: nadie la lee ni la escribe por PostgREST. Se lee por RPC.
revoke all on public.document_numbering_authority from public, anon, authenticated;

create table public.document_numbering_authority_audit (
  id             bigint generated always as identity primary key,
  company_id     uuid        not null,
  doc_type       text        not null,
  operation      text        not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  old_authority  text,
  new_authority  text,
  reason         text,
  changed_at     timestamptz not null default now(),
  changed_by     uuid                 default auth.uid(),
  db_role        text        not null default current_user,
  jwt_role       text                 default auth.role()
);

comment on table public.document_numbering_authority_audit is
  'Historial de cambios de autoridad de numeración. Los intentos de emisión bloqueados NO se registran acá.';

alter table public.document_numbering_authority_audit enable row level security;
revoke all on public.document_numbering_authority_audit from public, anon, authenticated;

create or replace function app.auditar_autoridad_numeracion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.authority is not distinct from old.authority
     and new.reason is not distinct from old.reason then
    return new;
  end if;

  insert into document_numbering_authority_audit
    (company_id, doc_type, operation, old_authority, new_authority, reason)
  values (
    coalesce(new.company_id, old.company_id),
    coalesce(new.doc_type, old.doc_type),
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

revoke all on function app.auditar_autoridad_numeracion() from public, anon, authenticated;

-- BEFORE para UPDATE (sella updated_at/updated_by), AFTER para INSERT/DELETE.
create trigger trg_autoridad_numeracion_audit_upd
  before update on public.document_numbering_authority
  for each row execute function app.auditar_autoridad_numeracion();
create trigger trg_autoridad_numeracion_audit_ins_del
  after insert or delete on public.document_numbering_authority
  for each row execute function app.auditar_autoridad_numeracion();

-- Estado acordado hoy. Torquetools NO tiene filas: no tiene documentos de venta
-- ni importación de STEL en esta base; queda como decisión pendiente (doc, §B).
insert into public.document_numbering_authority (company_id, doc_type, authority, reason)
select c.id, t.doc_type, 'STEL',
       'Fase 12 E2.5: STEL Order sigue emitiendo este tipo; el ERP no numera hasta el cutover.'
  from public.companies c
 cross join (values ('quote'), ('sales_order'), ('delivery')) as t (doc_type)
 where c.slug = 'buscatools';

-- -----------------------------------------------------------------------------
-- 2. Guarda central
--
-- FOR SHARE sobre la fila de autoridad: un cutover concurrente (UPDATE de la
-- fila) espera a que terminen las emisiones en curso, y una emisión que llega
-- durante el cutover espera y relee el valor ya confirmado. Sin TOCTOU.
-- -----------------------------------------------------------------------------
create or replace function app.exigir_emision_erp(p_company uuid, p_doc_type text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_autoridad text;
begin
  select a.authority into v_autoridad
    from document_numbering_authority a
   where a.company_id = p_company and a.doc_type = p_doc_type
     for share;

  if v_autoridad = 'STEL' then
    raise exception 'external_numbering_authority'
      using detail = 'La numeración de este documento todavía está administrada por STEL. No se puede emitir desde el ERP hasta completar la migración.',
            hint   = p_doc_type;
  end if;
end $$;

revoke all on function app.exigir_emision_erp(uuid, text) from public, anon, authenticated;

-- ¿Es la vía de importación? Documento marcado como importado y escrito por un
-- proceso de servidor (service role o conexión directa), nunca por una sesión
-- de usuario: un usuario no puede "importar" poniendo imported_at a mano.
create or replace function app.es_importacion_externa(p_imported_at timestamptz)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select p_imported_at is not null
     and coalesce(auth.role(), '') not in ('authenticated', 'anon')
$$;

revoke all on function app.es_importacion_externa(timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Punto 1: la numeración. Se corta ANTES del UPDATE de la secuencia.
--    Aplica a todos los llamadores, service role incluido.
-- -----------------------------------------------------------------------------
create or replace function public.next_document_number(p_company uuid, p_doc_type text, p_series text default '')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_prefix text; v_padding int; v_num bigint; v_rol text; v_puede boolean;
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

  -- Fase 12 E2.5: si STEL numera este tipo, no se consume la secuencia.
  perform app.exigir_emision_erp(p_company, p_doc_type);

  -- p_series = '' significa "la serie por defecto de este tipo", no "la serie
  -- cuyo código es la cadena vacía".
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
end $function$;

-- -----------------------------------------------------------------------------
-- 4. Punto 2: el documento. Triggers BEFORE en las tres tablas.
--    · INSERT: sólo la vía de importación.
--    · UPDATE: bloquea el paso a un estado emitido (enviada/aceptada,
--      confirmado, despachada/entregada) y el cambio de empresa hacia una
--      empresa con autoridad STEL. Editar borradores y cancelar sigue igual.
--    Nombre `trg_00_…`: los BEFORE corren por orden alfabético, este va primero.
-- -----------------------------------------------------------------------------
create or replace function app.guardar_autoridad_numeracion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- (Migraciones `fase12_config_e25_stel_guard_rls_primero` y
  -- `fase12_config_e25_stel_guard_anon_rls_primero`, halladas por la suite.)
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform app.exigir_emision_erp(new.company_id, v_doc_type);
  elsif new.company_id is distinct from old.company_id then
    perform app.exigir_emision_erp(new.company_id, v_doc_type);
  elsif v_estado_nuevo = any (v_emitidos) and v_estado_nuevo is distinct from v_estado_viejo then
    perform app.exigir_emision_erp(new.company_id, v_doc_type);
  end if;

  return new;
end $$;

revoke all on function app.guardar_autoridad_numeracion() from public, anon, authenticated;

create trigger trg_00_autoridad_numeracion
  before insert or update on public.sales_quotes
  for each row execute function app.guardar_autoridad_numeracion();
create trigger trg_00_autoridad_numeracion
  before insert or update on public.sales_orders
  for each row execute function app.guardar_autoridad_numeracion();
create trigger trg_00_autoridad_numeracion
  before insert or update on public.deliveries
  for each row execute function app.guardar_autoridad_numeracion();

-- -----------------------------------------------------------------------------
-- 5. Punto 3: el despacho. Chequeo temprano en `confirmar_entrega`, después del
--    lock y del permiso y ANTES de cualquier movimiento de stock, reserva o
--    evento. (El trigger del punto 4 igual lo bloquearía, pero recién al final.)
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_entrega(p_delivery uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_company uuid; v_status text; v_order uuid; v_number text; v_warehouse uuid;
  v_movs int := 0; v_libera int := 0; v_cumplimiento text; l record; r record;
  v_restante numeric;
begin
  -- FOR UPDATE: el segundo que llegue espera y encuentra el estado ya
  -- cambiado. Sin esto, dos confirmaciones simultáneas descuentan dos veces.
  select company_id, status, order_id, number
    into v_company, v_status, v_order, v_number
    from deliveries where id = p_delivery for update;

  if v_company is null then
    raise exception 'La entrega no existe' using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;

  -- Fase 12 E2.5: si STEL numera los remitos de esta empresa, no se despacha
  -- desde el ERP. Antes de todo efecto: 0 movimientos, 0 reservas, 0 eventos.
  perform app.exigir_emision_erp(v_company, 'delivery');

  if v_status = 'cancelled' then
    raise exception 'El remito % está cancelado', v_number using errcode = 'restrict_violation';
  end if;

  -- La guarda de idempotencia: ya estaba despachado, no se repite nada.
  if v_status <> 'draft' then
    return jsonb_build_object('ya_confirmada', true, 'status', v_status,
                              'movimientos', 0, 'reservas_liberadas', 0);
  end if;

  select id into v_warehouse from warehouses where company_id = v_company limit 1;

  for l in
    select dl.id, dl.product_id, dl.quantity, dl.warehouse_id, dl.order_line_id
      from delivery_lines dl
     where dl.delivery_id = p_delivery and dl.product_id is not null
  loop
    -- La cantidad va en NEGATIVO: el trigger de stock suma lo que reciba.
    insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                                 quantity, source_type, source_id, notes)
    values (v_company, l.product_id, coalesce(l.warehouse_id, v_warehouse),
            'sale_delivery', -l.quantity, 'delivery', p_delivery,
            'Remito ' || v_number);
    v_movs := v_movs + 1;

    -- Reservas del pedido para ese producto: se consumen hasta la cantidad
    -- entregada. Se BORRA y, si sobra, se vuelve a insertar el resto: el
    -- trigger de reservas sólo entiende INSERT y DELETE.
    if v_order is not null then
      v_restante := l.quantity;
      for r in
        select id, quantity, warehouse_id, notes
          from stock_reservations
         where company_id = v_company and product_id = l.product_id
           and source_type = 'sales_order' and source_id = v_order
         order by created_at
      loop
        exit when v_restante <= 0;
        delete from stock_reservations where id = r.id;
        v_libera := v_libera + 1;
        if r.quantity > v_restante then
          insert into stock_reservations (company_id, product_id, warehouse_id,
                                          quantity, source_type, source_id, notes)
          values (v_company, l.product_id, r.warehouse_id, r.quantity - v_restante,
                  'sales_order', v_order, r.notes);
        end if;
        v_restante := v_restante - r.quantity;
      end loop;
    end if;
  end loop;

  update deliveries set status = 'shipped' where id = p_delivery;

  if v_order is not null then
    v_cumplimiento := app.derivar_cumplimiento(v_order);
  end if;

  insert into sales_audit (company_id, entity_type, entity_id, action,
                           from_status, to_status, diff, actor_id)
  values (v_company, 'delivery', p_delivery, 'shipped', 'draft', 'shipped',
          jsonb_build_object('movimientos', v_movs, 'reservas_liberadas', v_libera),
          auth.uid());

  if v_movs > 0 then
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'delivery', p_delivery, 'stock_consumed',
            jsonb_build_object('lineas', v_movs), auth.uid());
  end if;

  if v_libera > 0 then
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'delivery', p_delivery, 'reservation_released',
            jsonb_build_object('reservas', v_libera), auth.uid());
  end if;

  return jsonb_build_object('ya_confirmada', false, 'status', 'shipped',
                            'movimientos', v_movs, 'reservas_liberadas', v_libera,
                            'cumplimiento', v_cumplimiento);
end $function$;

-- -----------------------------------------------------------------------------
-- 6. Lectura para la UI (Ventas): autoridad por tipo, sólo miembros internos.
-- -----------------------------------------------------------------------------
create or replace function public.autoridad_numeracion_empresa(p_company uuid)
returns table (doc_type text, authority text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  return query
  select a.doc_type, a.authority
    from document_numbering_authority a
   where a.company_id = p_company
   order by a.doc_type;
end $$;

revoke all on function public.autoridad_numeracion_empresa(uuid) from public, anon;
grant execute on function public.autoridad_numeracion_empresa(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Diagnóstico de Numeración (E2): la autoridad sale de la tabla, no del slug.
--    Cambia el tipo de retorno (+ autoridad_configurada) → drop + create.
-- -----------------------------------------------------------------------------
drop function public.config_numeracion_diagnostico(uuid);

create function public.config_numeracion_diagnostico(p_company uuid)
returns table (doc_type text, series_code text, prefix text, padding integer, is_default boolean,
               next_number bigint, proximo text, documentos bigint, con_patron bigint, fuera_patron bigint,
               max_numero bigint, max_numero_sin_atipicos bigint, atipicos_por_encima bigint, estado text,
               autoridad text, autoridad_configurada boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_rol text := app.current_role(p_company);
begin
  if p_company is null or v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  return query
  with docs as (
    select 'quote'::text t, q.number n, coalesce(q.number_outlier, false) r from sales_quotes q where q.company_id = p_company
    union all select 'sales_order', o.number, coalesce(o.number_outlier, false) from sales_orders o where o.company_id = p_company
    union all select 'delivery', d.number, coalesce(d.number_outlier, false) from deliveries d where d.company_id = p_company
    union all select 'customer', cu.legacy_ref, false from customers cu where cu.company_id = p_company
    union all select 'supplier', su.legacy_ref, false from suppliers su where su.company_id = p_company
    union all select 'purchase_order', po.number, false from purchase_orders po where po.company_id = p_company
    union all select 'goods_receipt', gr.number, false from goods_receipts gr where gr.company_id = p_company
    union all select 'supplier_invoice', si.number, false from supplier_invoices si where si.company_id = p_company
    union all select 'maintenance_asset', ma.reference, false from maintenance_assets ma where ma.company_id = p_company
    union all select 'maintenance_order', mo.number, false from maintenance_orders mo where mo.company_id = p_company
  ),
  medida as (
    select s.doc_type, s.series_code, s.prefix, s.padding, s.is_default, s.next_number,
           (select count(*) from docs d where d.t = s.doc_type) as documentos,
           (select count(*) from docs d where d.t = s.doc_type and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as con_patron,
           (select count(*) from docs d where d.t = s.doc_type and d.n is not null and d.n !~ ('^' || s.prefix || '[0-9]{1,18}$')) as fuera_patron,
           (select max(substring(d.n from length(s.prefix) + 1)::bigint) from docs d
             where d.t = s.doc_type and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as max_numero,
           (select max(substring(d.n from length(s.prefix) + 1)::bigint) from docs d
             where d.t = s.doc_type and not d.r and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')) as max_confiable,
           (select count(*) from docs d where d.t = s.doc_type and d.r and d.n ~ ('^' || s.prefix || '[0-9]{1,18}$')
               and substring(d.n from length(s.prefix) + 1)::bigint >= s.next_number) as atipicos_encima,
           s.doc_type in ('quote', 'sales_order', 'delivery', 'customer', 'supplier', 'purchase_order',
                          'goods_receipt', 'supplier_invoice', 'maintenance_asset', 'maintenance_order') as mapeado
      from document_sequences s
     where s.company_id = p_company
  )
  select m.doc_type, m.series_code, m.prefix, m.padding, m.is_default, m.next_number,
         m.prefix || lpad(m.next_number::text, m.padding, '0'),
         m.documentos, m.con_patron, m.fuera_patron, m.max_numero, m.max_confiable, m.atipicos_encima,
         case
           when not m.mapeado then 'UNKNOWN'
           when m.max_confiable is null then 'SIN_DOCUMENTOS'
           when m.next_number <= m.max_confiable then 'BEHIND'
           when m.next_number = m.max_confiable + 1 then 'OK'
           else 'AHEAD'
         end,
         coalesce(a.authority, 'ERP'),
         a.authority is not null
    from medida m
    left join document_numbering_authority a
      on a.company_id = p_company and a.doc_type = m.doc_type
   order by m.doc_type, m.series_code;
end
$function$;

revoke all on function public.config_numeracion_diagnostico(uuid) from public, anon;
grant execute on function public.config_numeracion_diagnostico(uuid) to authenticated;
