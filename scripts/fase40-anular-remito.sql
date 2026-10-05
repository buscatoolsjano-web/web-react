-- Fase 40 · Anular un remito despachado (y recién entonces poder borrarlo)
--
-- POR QUÉ
--
-- RT-ERP00002 no se puede ni cancelar ni borrar. No es un bug: es la base
-- haciendo exactamente lo que se le pidió. Un remito despachado ya descontó
-- stock, y las dos protecciones dicen lo mismo con distintas palabras:
--
--   app.proteger_estado_entrega  → DELIVERY_ALREADY_DISPATCHED al cancelar
--   app.proteger_borrado_entrega → «ya movió stock: borrarlo no devolvería
--                                   las unidades»
--
-- Esa segunda frase es la clave, y tiene toda la razón. `app.apply_stock_
-- movement` es un trigger AFTER INSERT: suma al saldo cuando entra un
-- movimiento y no hace nada cuando sale. Borrar el remito dejaría cinco
-- unidades descontadas para siempre, sin ningún papel que diga por qué.
--
-- Lo que faltaba no era permitir el borrado: era la operación inversa del
-- despacho. `confirmar_entrega` descuenta; no había nada que devuelva.
--
-- QUÉ SE AGREGA
--
--   public.anular_entrega(uuid)
--     Inserta el contramovimiento (`return_in`) de lo que el remito descontó,
--     deja el remito en `cancelled` y recalcula el cumplimiento del pedido.
--     Después de esto el pedido vuelve a mostrar esas unidades como
--     pendientes de entrega, que es la verdad.
--
-- Y se relajan DOS protecciones, lo justo y nada más:
--
--   proteger_estado_entrega   acepta pasar a `cancelled` si viene de adentro
--                             de `anular_entrega` —el mismo mecanismo de
--                             `app.workflow_ctx` que usa el despacho—.
--
--   proteger_borrado_entrega  deja de preguntar «¿movió stock alguna vez?» y
--                             pregunta «¿queda stock afuera?»: lo que impide
--                             borrar no es el antecedente, son las unidades
--                             colgando. Un remito anulado tiene neto cero.
--
-- POR QUÉ CONTRAMOVIMIENTO Y NO BORRAR LOS MOVIMIENTOS
--
-- Porque borrarlos no devolvería nada: el trigger de saldos sólo corre al
-- insertar. Y porque la hoja de stock tiene que poder contar lo que pasó: la
-- mercadería salió el 5/10 y volvió el 5/10. Eso no es ruido, es el registro.
--
-- POR QUÉ EL NETO Y NO FILA POR FILA
--
-- `confirmar_entrega` explota los kits en sus componentes, así que un remito
-- de cuatro líneas puede haber generado doce movimientos. Agrupar por
-- (producto, depósito) y devolver el neto los cubre a todos sin repetir esa
-- lógica, y hace la función idempotente de arranque: anular dos veces no
-- devuelve el doble, porque la segunda vez el neto ya es cero.
--
-- LAS RESERVAS NO SE RECREAN
--
-- El despacho borró las reservas del pedido (`stock_reservations`). Anular no
-- las repone a propósito: no quedó registro del reparto original —qué reserva
-- cubría qué línea, con qué nota— y adivinarlo podría reservar dos veces la
-- misma unidad. El saldo real vuelve, que es lo que no se puede perder; la
-- reserva es una intención y se rehace sola al preparar la próxima entrega.
--
-- LOS HISTÓRICOS NO SE ANULAN
--
-- Un remito con `imported_at` vino de STEL: el documento es de allá y se
-- anula allá. Si se anulara acá, el próximo sync lo traería de vuelta vivo y
-- el contramovimiento quedaría colgado.

begin;

-- ── 1 · la operación inversa del despacho ──────────────────────────────────

create or replace function public.anular_entrega(p_delivery uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company uuid; v_status text; v_order uuid; v_number text; v_importado timestamptz;
  v_movs int := 0; v_unidades numeric := 0; v_cumplimiento text; r record;
begin
  select company_id, status, order_id, number, imported_at
    into v_company, v_status, v_order, v_number, v_importado
    from deliveries where id = p_delivery for update;

  if v_company is null then
    raise exception 'La entrega no existe' using errcode = 'no_data_found';
  end if;

  if auth.uid() is not null
     and v_company <> all (app.current_writer_company_ids()) then
    raise exception 'Sin permiso sobre esa empresa' using errcode = 'insufficient_privilege';
  end if;

  -- El documento es de STEL: allá se anula. Acá sólo volvería a entrar vivo
  -- en el próximo sync, con el contramovimiento ya hecho.
  if v_importado is not null then
    raise exception 'DELIVERY_IMPORTED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s vino de STEL: se anula en STEL.', v_number);
  end if;

  -- Idempotente: anular dos veces devuelve el mismo resultado y no duplica el
  -- contramovimiento. Pasa de verdad —doble click, dos pestañas, un reintento
  -- después de un timeout—.
  if v_status = 'cancelled' then
    return jsonb_build_object('ya_anulada', true, 'status', 'cancelled',
                              'movimientos', 0, 'unidades', 0);
  end if;

  if v_status = 'draft' then
    raise exception 'DELIVERY_NOT_DISPATCHED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s está en borrador: no movió stock, se cancela o se borra directamente.', v_number);
  end if;

  for r in
    select product_id, warehouse_id, sum(quantity) as neto
      from stock_movements
     where source_type = 'delivery' and source_id = p_delivery
     group by product_id, warehouse_id
    having sum(quantity) <> 0
  loop
    insert into stock_movements (company_id, product_id, warehouse_id, movement_type,
                                 quantity, source_type, source_id, notes)
    values (v_company, r.product_id, r.warehouse_id, 'return_in',
            -r.neto, 'delivery', p_delivery,
            'Anulación del remito ' || v_number);
    v_movs := v_movs + 1;
    v_unidades := v_unidades - r.neto;
  end loop;

  -- El mismo permiso acotado que usa el despacho: la protección de estado
  -- deja pasar este UPDATE y nada más, y el permiso se borra enseguida.
  insert into app.workflow_ctx (txid, accion, entity_id)
  values ((pg_current_xact_id())::text::bigint, 'anular_entrega', p_delivery)
  on conflict do nothing;
  update deliveries set status = 'cancelled' where id = p_delivery;
  delete from app.workflow_ctx
   where txid = (pg_current_xact_id())::text::bigint
     and accion = 'anular_entrega' and entity_id = p_delivery;

  -- `derivar_cumplimiento` sólo cuenta remitos shipped/delivered, así que al
  -- quedar cancelado el pedido vuelve solo a pending o partially_delivered.
  if v_order is not null then
    v_cumplimiento := app.derivar_cumplimiento(v_order);
  end if;

  insert into sales_audit (company_id, entity_type, entity_id, action,
                           from_status, to_status, diff, actor_id)
  values (v_company, 'delivery', p_delivery, 'cancelled', v_status, 'cancelled',
          jsonb_build_object('movimientos', v_movs, 'unidades_devueltas', v_unidades),
          auth.uid());

  if v_movs > 0 then
    insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
    values (v_company, 'delivery', p_delivery, 'stock_returned',
            jsonb_build_object('lineas', v_movs, 'unidades', v_unidades), auth.uid());
  end if;

  return jsonb_build_object('ya_anulada', false, 'status', 'cancelled',
                            'movimientos', v_movs, 'unidades', v_unidades,
                            'cumplimiento', v_cumplimiento);
end $function$;

revoke all on function public.anular_entrega(uuid) from public;
grant execute on function public.anular_entrega(uuid) to authenticated, service_role;

-- ── 2 · la protección de estado deja pasar la anulación ────────────────────
--
-- Cambia UNA rama: la de `old.status in ('shipped','delivered')`. Cancelar a
-- mano sigue estando prohibido —dejaría el stock descontado—; lo único que se
-- acepta es el UPDATE que hace `anular_entrega`, que ya devolvió las unidades
-- dos líneas antes.

create or replace function app.proteger_estado_entrega()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if app.en_reconciliacion_stel() then
    return new;
  end if;
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not (new.company_id = any (app.current_writer_company_ids())) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' and new.imported_at is null then
      raise exception 'DELIVERY_STATUS_REQUIRES_DISPATCH'
        using errcode = 'check_violation',
              detail = 'Un remito nuevo nace en borrador; se despacha con Confirmar y despachar.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('shipped', 'delivered') then
    -- Fase 40: la anulación ya insertó el contramovimiento. Es el único
    -- camino de vuelta, y pasa por `anular_entrega` justamente para que no
    -- pueda haber un remito cancelado con el stock todavía afuera.
    if new.status = 'cancelled' and app.en_workflow('anular_entrega', new.id) then
      return new;
    end if;
    raise exception 'DELIVERY_ALREADY_DISPATCHED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s ya descontó stock: para dejarlo sin efecto hay que anularlo, que devuelve las unidades.', old.number);
  end if;

  if old.status = 'cancelled' then
    raise exception 'DELIVERY_CANCELLED'
      using errcode = 'restrict_violation',
            detail = format('El remito %s está cancelado.', old.number);
  end if;

  if new.status = 'cancelled' then
    return new;
  end if;
  if new.status = 'shipped' and app.en_workflow('despachar_entrega', new.id) then
    return new;
  end if;
  raise exception 'DELIVERY_STATUS_REQUIRES_DISPATCH'
    using errcode = 'check_violation',
          detail = 'El estado de un remito sólo avanza con Confirmar y despachar, que descuenta el stock.';
end $function$;

-- ── 3 · borrar: la pregunta correcta es si queda stock afuera ──────────────
--
-- Antes preguntaba dos cosas que no son la misma:
--
--   count(movimientos) > 0   → «¿movió stock alguna vez?»
--   status <> 'draft'        → «¿salió del borrador alguna vez?»
--
-- Las dos son ciertas para un remito anulado, y ninguna de las dos es un
-- motivo para no borrarlo: las unidades volvieron y el documento está
-- cancelado. Lo que sí es motivo es que quede saldo afuera, y eso se mide con
-- el neto.
--
-- Los movimientos del remito se borran con él, y es seguro SÓLO porque el
-- neto es cero: sacar un par -5/+5 no mueve ningún saldo. Si quedara saldo,
-- el `raise` de arriba ya frenó todo.

create or replace function app.proteger_borrado_entrega()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_neto numeric; v_reconciliacion boolean := app.en_reconciliacion_stel();
begin
  if old.imported_at is not null and not v_reconciliacion then
    raise exception 'El remito % es histórico y no se borra', old.number
      using errcode = 'restrict_violation';
  end if;

  select coalesce(sum(quantity), 0) into v_neto from stock_movements
   where source_type = 'delivery' and source_id = old.id;
  if v_neto <> 0 then
    raise exception
      'El remito % todavía tiene stock afuera: anulalo primero, que devuelve las unidades', old.number
      using errcode = 'restrict_violation';
  end if;

  if old.status not in ('draft', 'cancelled')
     and not app.puede_borrar_por_mantenimiento(old.imported_at)
     and not v_reconciliacion then
    raise exception 'El remito % está despachado: anulalo antes de borrarlo', old.number
      using errcode = 'restrict_violation';
  end if;

  delete from stock_movements where source_type = 'delivery' and source_id = old.id;
  delete from sales_audit where entity_type = 'delivery' and entity_id = old.id;
  return old;
end $function$;

commit;
