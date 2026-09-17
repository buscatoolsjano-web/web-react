-- ---------------------------------------------------------------------------
-- FASE 15 · VENTAS — Entrega 5: el remito al nivel del pedido
-- ---------------------------------------------------------------------------
--
-- Lo que cambia, y lo que NO cambia.
--
-- NO cambia la semántica de stock, que se auditó antes de tocar nada:
--
--   · crear un remito  → 0 movimientos, 0 reservas (nace `draft`);
--   · `confirmar_entrega` (draft → shipped) → descuenta stock y libera las
--     reservas del pedido, en una transacción, con la fila bloqueada y de
--     forma idempotente (si ya está despachado devuelve `ya_confirmada`).
--
-- Esa función ya existía y NO se toca. E5 no mueve stock desde ningún lugar
-- nuevo.
--
-- Cambia cómo se ARMA el remito. Hasta E4 el navegador hacía cinco viajes
-- (leer pedido, leer depósito, pedir número, insertar cabecera, insertar
-- líneas) y, si el trigger rechazaba una línea, borraba el remito a mano. Y el
-- pendiente se calculaba en el navegador: dos personas generando remitos del
-- mismo pedido al mismo tiempo podían sobreentregar, porque el trigger de cada
-- línea no ve las filas que la otra transacción todavía no confirmó.
--
--   · `crear_remito_desde_pedido` — una transacción, con el PEDIDO BLOQUEADO
--     (`for update`). Ese lock es lo que hace imposible la sobreentrega
--     concurrente: la segunda transacción espera y recalcula el pendiente.
--   · `guardar_remito` — editar un remito EN BORRADOR (cabecera y cantidades),
--     con el mismo contrato de concurrencia que `guardar_pedido`.
--
-- Y dos columnas que al remito le faltaban: `line_no` (el orden era el `id`,
-- o sea ninguno) y `description_snapshot` (el texto comercial del documento).
--
-- Invariantes existentes que NO se tocan, sólo se apoyan:
--   · `app.validar_cantidad_entregada`  — sobreentrega por línea;
--   · `app.proteger_estado_entrega`     — un remito nace en borrador y sólo
--     avanza por «Confirmar y despachar»;
--   · `app.bloquear_lineas_entrega_despachada` — líneas congeladas al despachar;
--   · `app.proteger_borrado_entrega`    — no se borra lo que movió stock;
--   · `app.guardar_autoridad_numeracion` — exige autoridad ERP por TIPO y por
--     SERIE en el insert: la serie RT-ML está marcada STEL y queda bloqueada.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1 · Lo que le faltaba a la línea de remito
-- ---------------------------------------------------------------------------
-- `line_no`: el detalle ordenaba por `id` (un uuid), así que el orden de las
-- líneas era aleatorio y cambiaba entre cargas.
--
-- `description_snapshot`: el texto comercial del documento, independiente del
-- catálogo. NO se rellena hacia atrás: de los remitos históricos no sabemos
-- qué decía el papel, y copiar la descripción de hoy sería inventarla.

alter table delivery_lines add column if not exists line_no integer;
alter table delivery_lines add column if not exists description_snapshot text;

-- Backfill determinista: el orden de la línea del pedido cuando existe y, si
-- no, el de creación. Es el mejor orden reconstruible, y queda fijo.
with numeradas as (
  select dl.id,
         row_number() over (
           partition by dl.delivery_id
           order by coalesce(sol.line_no, 2147483647), dl.created_at, dl.id
         ) as n
    from delivery_lines dl
    left join sales_order_lines sol on sol.id = dl.order_line_id
)
update delivery_lines d
   set line_no = numeradas.n
  from numeradas
 where numeradas.id = d.id and d.line_no is null;

-- El importador y la reconciliación insertan sin `line_no`; en vez de romperlos
-- con un NOT NULL, se lo asigna el servidor.
create or replace function app.numerar_linea_entrega()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no
      from delivery_lines where delivery_id = new.delivery_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_02_linea_entrega_numero on delivery_lines;
create trigger trg_02_linea_entrega_numero
  before insert on delivery_lines
  for each row execute function app.numerar_linea_entrega();

create unique index if not exists uq_delivery_lines_no
  on delivery_lines (delivery_id, line_no);

-- ---------------------------------------------------------------------------
-- 2 · Cuánto queda por entregar, según la base
-- ---------------------------------------------------------------------------
-- La misma cuenta que hacía el navegador, pero acá: pedida menos TODO lo ya
-- entregado en remitos no cancelados (incluidos los borradores, que ya
-- comprometieron esa cantidad).
--
-- `p_excluir` deja fuera un remito: al editar uno en borrador, sus propias
-- líneas no cuentan contra sí mismo.

create or replace function app.pendiente_de_pedido(p_order uuid, p_excluir uuid default null)
returns table (order_line_id uuid, pedida numeric, entregada numeric, pendiente numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select sol.id,
         sol.quantity_ordered,
         coalesce(ent.entregada, 0),
         greatest(sol.quantity_ordered - coalesce(ent.entregada, 0), 0)
    from sales_order_lines sol
    left join lateral (
      select sum(dl.quantity) as entregada
        from delivery_lines dl
        join deliveries d on d.id = dl.delivery_id
       where dl.order_line_id = sol.id
         and d.status <> 'cancelled'
         and (p_excluir is null or d.id <> p_excluir)
    ) ent on true
   where sol.order_id = p_order and sol.line_type <> 'chapter';
$$;

revoke execute on function app.pendiente_de_pedido(uuid, uuid) from public, anon;
grant  execute on function app.pendiente_de_pedido(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Pedido → remito, en UNA transacción
-- ---------------------------------------------------------------------------
-- `p_lineas`: [{ "order_line_id": uuid, "quantity": numeric }, ...]
--
-- El pedido se bloquea con `for update` ANTES de mirar el pendiente. Dos
-- pestañas —o dos personas— generando remitos del mismo pedido a la vez se
-- serializan: la segunda ve el pendiente ya consumido y falla con SOBREENTREGA
-- en vez de entregar dos veces lo mismo.

create or replace function public.crear_remito_desde_pedido(
  p_order    uuid,
  p_lineas   jsonb,
  p_fecha    date default null,
  p_esperado timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid; v_estado text; v_actualizado timestamptz; v_numero_pedido text;
  v_customer uuid; v_contacto uuid; v_titulo text; v_moneda text; v_tc numeric;
  v_deposito uuid; v_numero text; v_delivery uuid; v_serie text;
  v_fecha date := coalesce(p_fecha, current_date);
  v_total_pendiente numeric;
  v_l jsonb; v_ol uuid; v_cant numeric; v_pend numeric; v_sku text;
  v_n int := 0;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'SIN_LINEAS';
  end if;

  select company_id, commercial_status, updated_at, number,
         customer_id, contact_id, title, currency_code, exchange_rate
    into v_company, v_estado, v_actualizado, v_numero_pedido,
         v_customer, v_contacto, v_titulo, v_moneda, v_tc
    from sales_orders where id = p_order for update;

  if v_company is null then
    raise exception 'PEDIDO_INEXISTENTE';
  end if;

  if auth.uid() is not null and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;

  -- El testigo es opcional: quien no lo manda, no lo controla.
  if p_esperado is not null and v_actualizado is distinct from p_esperado then
    raise exception 'CONFLICTO_DE_EDICION';
  end if;

  if v_estado = 'cancelled' then
    raise exception 'PEDIDO_CANCELADO';
  end if;
  if v_estado <> 'confirmed' then
    raise exception 'PEDIDO_NO_CONFIRMADO';
  end if;

  -- La serie es la POR DEFECTO de la empresa (en Buscatools, RT). No se
  -- elige desde afuera: RT-ML no es la serie por defecto de nadie, así que el
  -- ERP no puede emitirla ni por accidente, y además está marcada STEL en
  -- `document_numbering_authority_series`.
  select series_code into v_serie from document_sequences
   where company_id = v_company and doc_type = 'delivery' and is_default;
  if v_serie is null then
    raise exception 'SIN_SERIE';
  end if;

  -- Autoridad de numeración, por TIPO y por SERIE.
  perform app.exigir_emision_erp(v_company, 'delivery', v_serie);

  select coalesce(sum(pendiente), 0) into v_total_pendiente
    from app.pendiente_de_pedido(p_order);
  if v_total_pendiente <= 0 then
    raise exception 'PEDIDO_TOTALMENTE_ENTREGADO';
  end if;

  select id into v_deposito from warehouses where company_id = v_company order by created_at limit 1;
  if v_deposito is null then
    raise exception 'SIN_DEPOSITO';
  end if;

  v_numero := next_document_number(v_company, 'delivery', v_serie);

  insert into deliveries (company_id, number, series_code, order_id, customer_id,
                          contact_id, title, delivery_date, currency_code,
                          exchange_rate, status)
  values (v_company, v_numero, v_serie, p_order, v_customer, v_contacto, v_titulo,
          v_fecha, v_moneda, v_tc, 'draft')
  returning id into v_delivery;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_ol := nullif(v_l->>'order_line_id', '')::uuid;
    v_cant := coalesce((v_l->>'quantity')::numeric, 0);

    if v_ol is null then
      raise exception 'LINEA_SIN_PEDIDO';
    end if;
    if v_cant is null or v_cant <= 0 then
      raise exception 'CANTIDAD_INVALIDA';
    end if;

    select pendiente into v_pend
      from app.pendiente_de_pedido(p_order) where order_line_id = v_ol;
    if v_pend is null then
      raise exception 'LINEA_DE_OTRO_PEDIDO';
    end if;
    if v_cant > v_pend then
      select sku_snapshot into v_sku from sales_order_lines where id = v_ol;
      raise exception 'SOBREENTREGA'
        using detail = format('%s tiene %s pendiente y se quiso entregar %s.',
                              coalesce(v_sku, 'La línea'), v_pend, v_cant);
    end if;

    v_n := v_n + 1;
    -- El snapshot sale de la LÍNEA DEL PEDIDO, no del catálogo: el precio y el
    -- texto que valen son los que se acordaron.
    insert into delivery_lines (company_id, delivery_id, order_line_id, line_no,
                                product_id, sku_snapshot, name_snapshot,
                                description_snapshot, quantity, warehouse_id,
                                unit_price, discount_pct, tax_treatment,
                                tax_rate_snapshot)
    select v_company, v_delivery, sol.id, v_n, sol.product_id, sol.sku_snapshot,
           sol.name_snapshot, sol.description_snapshot, v_cant, v_deposito,
           sol.unit_price, sol.discount_pct, sol.tax_treatment, sol.tax_rate_snapshot
      from sales_order_lines sol where sol.id = v_ol;
  end loop;

  insert into sales_audit (company_id, entity_type, entity_id, action,
                           from_status, to_status, diff, actor_id)
  values (v_company, 'delivery', v_delivery, 'created', null, 'draft',
          jsonb_build_object('pedido', v_numero_pedido, 'lineas', v_n), auth.uid());

  return jsonb_build_object('id', v_delivery, 'number', v_numero, 'lineas', v_n);
end $$;

revoke execute on function public.crear_remito_desde_pedido(uuid, jsonb, date, timestamptz) from public, anon;
grant  execute on function public.crear_remito_desde_pedido(uuid, jsonb, date, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · Guardar un remito EN BORRADOR
-- ---------------------------------------------------------------------------
-- `p_cabecera`: sólo los campos de la whitelist. Cualquier otra clave →
-- CAMPO_NO_EDITABLE. Número, serie, estado, empresa, pedido, cliente, importación
-- y totales NO se pueden mandar.
--
-- `p_lineas`: [{ "id": uuid?, "order_line_id": uuid?, "quantity": numeric,
--                "description_snapshot": text? }, ...]
-- Las que no vienen, se borran. Las nuevas tienen que pertenecer al pedido del
-- remito.
--
-- El orden de las escrituras no es casual: primero se borra, después se baja y
-- recién al final se sube. Si se subiera antes de bajar, el trigger de
-- sobreentrega se quejaría de un estado intermedio que nunca llega a existir.

create or replace function public.guardar_remito(
  p_delivery  uuid,
  p_esperado  timestamptz,
  p_cabecera  jsonb,
  p_lineas    jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k_permitidos constant text[] := array[
    'delivery_date', 'title', 'notes', 'contact_id', 'carrier', 'tracking'
  ];
  v_company uuid; v_status text; v_actualizado timestamptz; v_numero text;
  v_order uuid; v_customer uuid; v_importado timestamptz;
  v_clave text; v_sets text[] := '{}'; v_sql text;
  v_contacto uuid; v_de_otro int;
  v_l jsonb; v_id uuid; v_ol uuid; v_cant numeric; v_desc text;
  v_ids uuid[] := '{}'; v_n int := 0; v_tocadas int := 0;
  v_pend numeric; v_actual numeric; v_sku text;
  v_nuevo timestamptz; r record;
begin
  select company_id, status, updated_at, number, order_id, customer_id, imported_at
    into v_company, v_status, v_actualizado, v_numero, v_order, v_customer, v_importado
    from deliveries where id = p_delivery for update;

  if v_company is null then
    raise exception 'REMITO_INEXISTENTE';
  end if;

  if auth.uid() is not null and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'SIN_PERMISO_EMPRESA';
  end if;

  if v_actualizado is distinct from p_esperado then
    raise exception 'CONFLICTO_DE_EDICION';
  end if;

  if v_status = 'cancelled' then
    raise exception 'REMITO_CANCELADO';
  end if;
  if v_status <> 'draft' then
    raise exception 'REMITO_DESPACHADO';
  end if;
  if v_importado is not null then
    raise exception 'REMITO_HISTORICO';
  end if;

  -- El pedido se bloquea también: el pendiente que vamos a mirar tiene que
  -- seguir siendo el mismo mientras escribimos.
  if v_order is not null then
    perform 1 from sales_orders where id = v_order for update;
  end if;

  -- ── Cabecera
  for v_clave in select jsonb_object_keys(coalesce(p_cabecera, '{}'::jsonb)) loop
    if not (v_clave = any (k_permitidos)) then
      raise exception 'CAMPO_NO_EDITABLE' using detail = v_clave;
    end if;
  end loop;

  if p_cabecera ? 'contact_id' then
    v_contacto := nullif(p_cabecera->>'contact_id', '')::uuid;
    if v_contacto is not null then
      select count(*) into v_de_otro from customer_contacts
       where id = v_contacto and company_id = v_company and customer_id = v_customer;
      if v_de_otro = 0 then
        raise exception 'CONTACTO_DE_OTRO_CLIENTE';
      end if;
    end if;
  end if;

  if p_cabecera is not null and p_cabecera <> '{}'::jsonb then
    foreach v_clave in array k_permitidos loop
      if p_cabecera ? v_clave then
        v_sets := v_sets || format('%I = %L', v_clave, nullif(p_cabecera->>v_clave, ''));
      end if;
    end loop;
    if array_length(v_sets, 1) > 0 then
      v_sql := format('update deliveries set %s where id = %L',
                      array_to_string(v_sets, ', '), p_delivery);
      execute v_sql;
    end if;
  end if;

  -- ── Líneas
  if p_lineas is not null and jsonb_typeof(p_lineas) = 'array' then
    -- 1) las que ya no vienen, se borran
    for v_l in select * from jsonb_array_elements(p_lineas) loop
      v_id := nullif(v_l->>'id', '')::uuid;
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end loop;

    for r in select id, line_no, sku_snapshot, quantity from delivery_lines
              where delivery_id = p_delivery and not (id = any (v_ids)) loop
      if exists (select 1 from delivery_serials where delivery_line_id = r.id) then
        raise exception 'LINEA_CON_SERIES' using detail = coalesce(r.sku_snapshot, '');
      end if;
      if exists (select 1 from sales_invoice_lines where delivery_line_id = r.id) then
        raise exception 'LINEA_FACTURADA' using detail = coalesce(r.sku_snapshot, '');
      end if;
      delete from delivery_lines where id = r.id;
      v_tocadas := v_tocadas + 1;
      insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
      values (v_company, 'delivery', p_delivery, 'line_removed',
              jsonb_build_object('line_no', r.line_no, 'sku', r.sku_snapshot,
                                 'cantidad', r.quantity), auth.uid());
    end loop;

    -- 2) las que bajan de cantidad (o no cambian), antes de que nadie suba
    for v_l in select * from jsonb_array_elements(p_lineas) loop
      v_id := nullif(v_l->>'id', '')::uuid;
      v_cant := coalesce((v_l->>'quantity')::numeric, 0);
      if v_cant <= 0 then
        raise exception 'CANTIDAD_INVALIDA';
      end if;
      if v_id is not null then
        select quantity into v_actual from delivery_lines
         where id = v_id and delivery_id = p_delivery;
        if v_actual is null then
          raise exception 'LINEA_DE_OTRO_REMITO';
        end if;
        if v_cant <= v_actual then
          update delivery_lines
             set quantity = v_cant,
                 description_snapshot = case when v_l ? 'description_snapshot'
                                             then nullif(v_l->>'description_snapshot', '')
                                             else description_snapshot end
           where id = v_id;
          if v_cant <> v_actual then v_tocadas := v_tocadas + 1; end if;
        end if;
      end if;
    end loop;

    -- 3) las que suben y las nuevas
    v_n := 0;
    for v_l in select * from jsonb_array_elements(p_lineas) loop
      v_n := v_n + 1;
      v_id := nullif(v_l->>'id', '')::uuid;
      v_ol := nullif(v_l->>'order_line_id', '')::uuid;
      v_cant := coalesce((v_l->>'quantity')::numeric, 0);
      v_desc := nullif(v_l->>'description_snapshot', '');

      if v_id is not null then
        select quantity, order_line_id into v_actual, v_ol from delivery_lines where id = v_id;
        if v_cant > v_actual then
          if v_ol is not null then
            select pendiente into v_pend from app.pendiente_de_pedido(v_order, p_delivery)
             where order_line_id = v_ol;
            if v_cant > coalesce(v_pend, v_cant) then
              select sku_snapshot into v_sku from sales_order_lines where id = v_ol;
              raise exception 'SOBREENTREGA'
                using detail = format('%s tiene %s pendiente y se quiso entregar %s.',
                                      coalesce(v_sku, 'La línea'), v_pend, v_cant);
            end if;
          end if;
          update delivery_lines
             set quantity = v_cant,
                 description_snapshot = case when v_l ? 'description_snapshot'
                                             then v_desc else description_snapshot end
           where id = v_id;
          v_tocadas := v_tocadas + 1;
        end if;
      else
        -- Línea nueva: sólo del pedido del remito, y sólo contra su pendiente.
        if v_order is null or v_ol is null then
          raise exception 'LINEA_SIN_PEDIDO';
        end if;
        select pendiente into v_pend from app.pendiente_de_pedido(v_order, p_delivery)
         where order_line_id = v_ol;
        if v_pend is null then
          raise exception 'LINEA_DE_OTRO_PEDIDO';
        end if;
        if v_cant > v_pend then
          select sku_snapshot into v_sku from sales_order_lines where id = v_ol;
          raise exception 'SOBREENTREGA'
            using detail = format('%s tiene %s pendiente y se quiso entregar %s.',
                                  coalesce(v_sku, 'La línea'), v_pend, v_cant);
        end if;
        insert into delivery_lines (company_id, delivery_id, order_line_id, line_no,
                                    product_id, sku_snapshot, name_snapshot,
                                    description_snapshot, quantity, warehouse_id,
                                    unit_price, discount_pct, tax_treatment,
                                    tax_rate_snapshot)
        select v_company, p_delivery, sol.id,
               (select coalesce(max(line_no), 0) + 1 from delivery_lines where delivery_id = p_delivery),
               sol.product_id, sol.sku_snapshot, sol.name_snapshot,
               coalesce(v_desc, sol.description_snapshot), v_cant,
               (select warehouse_id from delivery_lines where delivery_id = p_delivery order by line_no limit 1),
               sol.unit_price, sol.discount_pct, sol.tax_treatment, sol.tax_rate_snapshot
          from sales_order_lines sol where sol.id = v_ol;
        v_tocadas := v_tocadas + 1;
      end if;
    end loop;

    if not exists (select 1 from delivery_lines where delivery_id = p_delivery) then
      raise exception 'SIN_LINEAS';
    end if;

    -- 4) renumerar 1..n en el orden recibido. El +1000 es por el índice único
    --    (delivery_id, line_no): sin el desplazamiento, reordenar choca.
    update delivery_lines set line_no = line_no + 1000 where delivery_id = p_delivery;
    v_n := 0;
    for v_l in select * from jsonb_array_elements(p_lineas) loop
      v_id := nullif(v_l->>'id', '')::uuid;
      if v_id is not null then
        v_n := v_n + 1;
        update delivery_lines set line_no = v_n where id = v_id;
      end if;
    end loop;
    -- Las que no tenían id (las nuevas) quedan al final, en su orden.
    for r in select id from delivery_lines
              where delivery_id = p_delivery and line_no > 1000 order by line_no loop
      v_n := v_n + 1;
      update delivery_lines set line_no = v_n where id = r.id;
    end loop;
  end if;

  update deliveries set updated_by = auth.uid() where id = p_delivery
  returning updated_at into v_nuevo;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_company, 'delivery', p_delivery, 'updated',
          jsonb_build_object('cabecera', coalesce(p_cabecera, '{}'::jsonb),
                             'lineas_tocadas', v_tocadas), auth.uid());

  return jsonb_build_object('actualizado_en', v_nuevo,
                            'cambios_cabecera', coalesce(array_length(v_sets, 1), 0),
                            'lineas_tocadas', v_tocadas);
end $$;

revoke execute on function public.guardar_remito(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant  execute on function public.guardar_remito(uuid, timestamptz, jsonb, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Nada de esto borra datos de negocio: las funciones son nuevas y las columnas
-- se agregaron vacías. Quitar `line_no` vuelve a dejar el detalle ordenado por
-- `id`, que era el problema.
--
-- drop function if exists public.guardar_remito(uuid, timestamptz, jsonb, jsonb);
-- drop function if exists public.crear_remito_desde_pedido(uuid, jsonb, date, timestamptz);
-- drop function if exists app.pendiente_de_pedido(uuid, uuid);
-- drop trigger if exists trg_02_linea_entrega_numero on delivery_lines;
-- drop function if exists app.numerar_linea_entrega();
-- drop index if exists uq_delivery_lines_no;
-- alter table delivery_lines drop column if exists line_no;
-- alter table delivery_lines drop column if exists description_snapshot;
