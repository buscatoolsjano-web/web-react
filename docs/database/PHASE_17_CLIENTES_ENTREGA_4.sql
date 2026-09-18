-- ============================================================================
-- Fase 17 · Clientes · Entrega 4 — Ficha completa: adjuntos, trazabilidad,
-- historial paginado y qué compra el cliente
--
-- Proyecto: uaxcfufvapzulqvynanp. Aplicado el 2026-09-18.
--
-- 0 tablas nuevas, 0 columnas nuevas, 0 buckets nuevos. Todo se apoya en lo que
-- ya existía: `attachments` —cuyo CHECK ya aceptaba `entity_type = 'customer'`
-- desde Stage 1—, el bucket privado `ventas` de la Fase 15 · E6, y `sales_audit`,
-- la tabla genérica de auditoría.
--
-- Lo que sí cambia, y es lo importante: **quién ve y quién escribe un adjunto de
-- cliente**. `attachments_select` miraba la EMPRESA, pero `customers_select`
-- deja al vendedor ver sólo sus clientes y al técnico ninguno. El día que
-- existiera el primer adjunto de cliente, se habría visto desde donde el cliente
-- no se ve.
-- ============================================================================

begin;

-- ── 1 · Validación de la fila del adjunto ──────────────────────────────────
-- Antes, un adjunto cuyo `entity_type` no fuera de Ventas pasaba **sin ninguna
-- validación**: ni que la entidad existiera, ni que la ruta le correspondiera.
create or replace function app.validar_adjunto()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existe int; v_prefijo text; v_carpeta text;
begin
  if new.entity_type in ('quote', 'order', 'delivery', 'customer') then
    if new.entity_type = 'quote' then
      select count(*) into v_existe from sales_quotes
       where id = new.entity_id and company_id = new.company_id;
    elsif new.entity_type = 'order' then
      select count(*) into v_existe from sales_orders
       where id = new.entity_id and company_id = new.company_id;
    elsif new.entity_type = 'customer' then
      select count(*) into v_existe from customers
       where id = new.entity_id and company_id = new.company_id;
    else
      select count(*) into v_existe from deliveries
       where id = new.entity_id and company_id = new.company_id;
    end if;

    if v_existe = 0 then
      raise exception 'DOCUMENTO_INEXISTENTE'
        using errcode = '42501',
              detail = 'El adjunto apunta a algo que no existe en esta empresa.';
    end if;

    -- La carpeta es la del tipo de entidad: un adjunto de cliente no puede
    -- escribirse dentro de la carpeta de un documento, ni al revés.
    v_carpeta := new.entity_type;
    v_prefijo := new.company_id || '/' || v_carpeta || '/' || new.entity_id || '/';
    if position(v_prefijo in new.storage_path) <> 1 then
      raise exception 'RUTA_INVALIDA'
        using errcode = '42501',
              detail = 'La ruta del archivo no corresponde a esta entidad.';
    end if;
    if new.storage_path like '%..%' then
      raise exception 'RUTA_INVALIDA' using errcode = '42501', detail = 'Ruta con salto de carpeta.';
    end if;
  end if;

  if new.bytes is not null and new.bytes > 20971520 then
    raise exception 'ARCHIVO_DEMASIADO_GRANDE'
      using errcode = '22023', detail = 'El máximo es 20 MB.';
  end if;

  return new;
end $$;

-- ── 2 · Auditoría del adjunto ──────────────────────────────────────────────
-- Un adjunto de cliente se audita contra el CLIENTE, igual que sus contactos y
-- sus direcciones (E3): la trazabilidad del cliente es una sola. **No se audita
-- leer ni descargar**: un registro de lecturas es vigilancia, y además taparía
-- los cambios, que es lo que hay que poder ver.
create or replace function app.auditar_adjunto()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tipo text; v_fila record; v_accion text;
begin
  v_fila := coalesce(new, old);
  v_tipo := case v_fila.entity_type
              when 'quote' then 'sales_quote'
              when 'order' then 'sales_order'
              when 'delivery' then 'delivery'
              when 'customer' then 'customer'
            end;
  if v_tipo is null then
    return v_fila;
  end if;

  v_accion := case when tg_op = 'INSERT' then 'attachment_added' else 'attachment_deleted' end;

  insert into sales_audit (company_id, entity_type, entity_id, action, diff, actor_id)
  values (v_fila.company_id, v_tipo, v_fila.entity_id, v_accion,
          jsonb_build_object('archivo', v_fila.file_name, 'tipo', v_fila.mime_type,
                             'bytes', v_fila.bytes, 'clase', v_fila.kind),
          auth.uid());

  return v_fila;
end $$;

-- ── 3 · Ver el adjunto es poder ver el cliente ─────────────────────────────
-- El `exists` sobre `customers` corre con los permisos de quien llama, así que
-- hereda `customers_select` tal cual. No hay una segunda copia de la regla que
-- pueda quedar desincronizada.
drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments
  for select to authenticated
  using (
    case
      when entity_type = 'customer'
        then exists (select 1 from customers c where c.id = entity_id)
      when entity_type in ('supplier', 'purchase_order', 'goods_receipt',
                           'supplier_invoice', 'maintenance_asset', 'maintenance_order')
        then company_id in (select unnest(app.current_writer_company_ids()))
      else company_id in (select unnest(app.current_internal_company_ids()))
    end
  );

-- Escribir un adjunto de cliente es administrar ese cliente (E3): admin,
-- employee, o el vendedor que lo tiene asignado. Y sobre un cliente dado de
-- baja se LEE, pero no se sube ni se borra.
drop policy if exists attachments_write on attachments;
create policy attachments_write on attachments
  for all to authenticated
  using (
    case
      when entity_type = 'customer'
        then app.puede_administrar_cliente(entity_id)
             and not exists (select 1 from customers c
                              where c.id = entity_id and c.deleted_at is not null)
      else company_id in (select unnest(app.current_writer_company_ids()))
    end
  )
  with check (
    case
      when entity_type = 'customer'
        then app.puede_administrar_cliente(entity_id)
             and not exists (select 1 from customers c
                              where c.id = entity_id and c.deleted_at is not null)
      else company_id in (select unnest(app.current_writer_company_ids()))
    end
  );

-- ── 4 · El archivo, no sólo su fila ────────────────────────────────────────
-- Sin esto, un vendedor podía crear la fila del adjunto pero no subir el
-- archivo: `current_writer_company_ids()` es admin y employee.

-- Un segmento de ruta puede ser cualquier cosa: castear a uuid a ciegas rompería
-- la policy con un nombre de archivo raro en vez de rechazarlo.
create or replace function app.uuid_o_nulo(p_texto text)
returns uuid language plpgsql immutable set search_path = pg_temp as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end $$;

create or replace function app.carpeta_de_cliente_visible(p_nombre text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from customers c
     where c.id = app.uuid_o_nulo((storage.foldername(p_nombre))[3])
       and c.company_id::text = (storage.foldername(p_nombre))[1]
  );
$$;

create or replace function app.carpeta_de_cliente_editable(p_nombre text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select app.puede_administrar_cliente(app.uuid_o_nulo((storage.foldername(p_nombre))[3]))
     and not exists (
       select 1 from customers c
        where c.id = app.uuid_o_nulo((storage.foldername(p_nombre))[3])
          and c.deleted_at is not null
     );
$$;

revoke execute on function app.uuid_o_nulo(text) from public, anon;
revoke execute on function app.carpeta_de_cliente_visible(text) from public, anon;
revoke execute on function app.carpeta_de_cliente_editable(text) from public, anon;
-- Las policies de Storage corren con los permisos de quien sube el archivo: sin
-- estos grants, subir falla con «permission denied for function».
grant execute on function app.uuid_o_nulo(text) to authenticated;
grant execute on function app.carpeta_de_cliente_visible(text) to authenticated;
grant execute on function app.carpeta_de_cliente_editable(text) to authenticated;
grant execute on function app.puede_administrar_cliente(uuid) to authenticated;

drop policy if exists ventas_objects_select on storage.objects;
create policy ventas_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ventas'
    and case
      when (storage.foldername(name))[2] = 'customer'
        then app.carpeta_de_cliente_visible(name)
      else (storage.foldername(name))[1] in (select (unnest(app.current_internal_company_ids()))::text)
    end
  );

drop policy if exists ventas_objects_insert on storage.objects;
create policy ventas_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ventas'
    and case
      when (storage.foldername(name))[2] = 'customer'
        then app.carpeta_de_cliente_editable(name)
      else (storage.foldername(name))[1] in (select (unnest(app.current_writer_company_ids()))::text)
    end
  );

drop policy if exists ventas_objects_delete on storage.objects;
create policy ventas_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ventas'
    and case
      when (storage.foldername(name))[2] = 'customer'
        then app.carpeta_de_cliente_editable(name)
      else (storage.foldername(name))[1] in (select (unnest(app.current_writer_company_ids()))::text)
    end
  );

-- ── 5 · El historial documental, paginado del lado del servidor ────────────
-- Antes eran TRES consultas desde el navegador con `limit 200` cada una, unidas
-- y ordenadas en memoria: los 258 documentos de Grupo Mirgor viajaban al abrir
-- la ficha aunque nadie mirara la pestaña.
--
-- El `visible` es el mismo gate que ya tenía `precios_historicos_cliente`: leer
-- las tablas de Ventas directamente daría la visibilidad de Ventas —por
-- empresa—, y la pregunta de acá es sobre el CLIENTE.
create or replace function public.documentos_del_cliente(
  p_customer uuid,
  p_tipo text default null,
  p_limit int default 25,
  p_offset int default 0
) returns table (
  tipo text, documento_id uuid, numero text, fecha date, estado text,
  moneda text, total numeric, total_filas bigint
) language sql stable security invoker set search_path = public, pg_temp as $$
  with visible as (
    select 1 from customers c where c.id = p_customer
  ), todo as (
    select 'cotizacion'::text as tipo, q.id, coalesce(q.original_number, q.number) as numero,
           q.quote_date as fecha, q.status as estado, q.currency_code as moneda, q.total
      from sales_quotes q where q.customer_id = p_customer and exists (select 1 from visible)
    union all
    select 'pedido', o.id, coalesce(o.original_number, o.number),
           o.order_date, o.commercial_status, o.currency_code, o.total
      from sales_orders o where o.customer_id = p_customer and exists (select 1 from visible)
    union all
    select 'entrega', d.id, coalesce(d.original_number, d.number),
           d.delivery_date, d.status, d.currency_code, d.total
      from deliveries d where d.customer_id = p_customer and exists (select 1 from visible)
  ), filtrado as (
    select * from todo where p_tipo is null or tipo = p_tipo
  )
  select f.tipo, f.id, f.numero, f.fecha, f.estado, f.moneda, f.total,
         count(*) over () as total_filas
    from filtrado f
   order by f.fecha desc nulls last, f.numero desc
   limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;

revoke execute on function public.documentos_del_cliente(uuid, text, int, int) from public, anon;
grant execute on function public.documentos_del_cliente(uuid, text, int, int) to authenticated;

-- ── 6 · «¿Qué compra este cliente?» ────────────────────────────────────────
-- Una fila por producto Y POR MONEDA, igual que `ultimo_precio_cliente`: un
-- producto cotizado en USD y en ARS son dos respuestas, no una mezclada.
--
-- Lo cotizado y lo pedido se cuentan POR SEPARADO y **nunca se suman**: una
-- cotización es una pregunta que el cliente hizo y un pedido es una compra.
-- Llamar «vendido» a lo primero sería inventar una venta.
--
-- El SKU y el nombre salen del CATÁLOGO, no del snapshot de la línea: la
-- respuesta se usa para ir a buscar ese producto, así que sirve el nombre que
-- tiene hoy. El snapshot sigue mandando dentro de cada documento —ahí está
-- congelado a propósito— y queda de reserva para los productos que ya no están.
create or replace function public.productos_del_cliente(
  p_customer uuid,
  p_texto text default null,
  p_limit int default 25,
  p_offset int default 0
) returns table (
  product_id uuid, sku text, nombre text, moneda text,
  cotizaciones bigint, pedidos bigint,
  cantidad_cotizada numeric, cantidad_pedida numeric,
  ultima_fecha date, ultimo_tipo text, ultimo_documento_id uuid, ultimo_numero text,
  ultima_cantidad numeric, ultimo_precio numeric,
  total_filas bigint
) language sql stable security invoker set search_path = public, pg_temp as $$
  with visible as (
    select 1 from customers c where c.id = p_customer
  ), lineas as (
    select 'cotizacion'::text as tipo, l.product_id,
           coalesce(p.sku, l.sku_snapshot) as sku,
           coalesce(p.name, l.name_snapshot) as nombre,
           q.currency_code as moneda,
           q.id as documento_id, coalesce(q.original_number, q.number) as numero,
           q.quote_date as fecha, l.quantity as cantidad, l.unit_price as precio
      from sales_quote_lines l
      join sales_quotes q on q.id = l.quote_id
      left join products p on p.id = l.product_id
     where q.customer_id = p_customer and l.product_id is not null
       and coalesce(l.line_type, 'item') = 'item'
       and exists (select 1 from visible)
    union all
    select 'pedido', l.product_id,
           coalesce(p.sku, l.sku_snapshot),
           coalesce(p.name, l.name_snapshot),
           o.currency_code,
           o.id, coalesce(o.original_number, o.number), o.order_date,
           l.quantity_ordered, l.unit_price
      from sales_order_lines l
      join sales_orders o on o.id = l.order_id
      left join products p on p.id = l.product_id
     where o.customer_id = p_customer and l.product_id is not null
       and coalesce(l.line_type, 'item') = 'item'
       and exists (select 1 from visible)
  ), filtradas as (
    select * from lineas
     where p_texto is null or btrim(p_texto) = ''
        or sku ilike '%' || btrim(p_texto) || '%'
        or nombre ilike '%' || btrim(p_texto) || '%'
  ), agregadas as (
    select f.product_id, f.moneda,
           max(f.sku) as sku, max(f.nombre) as nombre,
           count(distinct f.documento_id) filter (where f.tipo = 'cotizacion') as cotizaciones,
           count(distinct f.documento_id) filter (where f.tipo = 'pedido') as pedidos,
           sum(f.cantidad) filter (where f.tipo = 'cotizacion') as cantidad_cotizada,
           sum(f.cantidad) filter (where f.tipo = 'pedido') as cantidad_pedida,
           max(f.fecha) as ultima_fecha
      from filtradas f
     group by f.product_id, f.moneda
  ), ultima as (
    -- La última línea de ese producto en esa moneda: la más nueva, y ante dos
    -- del mismo día, la del pedido antes que la de la cotización —si el mismo
    -- día se cotizó y se pidió, lo que pasó es que se pidió—.
    select distinct on (f.product_id, f.moneda)
           f.product_id, f.moneda, f.tipo, f.documento_id, f.numero, f.cantidad, f.precio
      from filtradas f
     order by f.product_id, f.moneda, f.fecha desc nulls last,
              (f.tipo = 'pedido') desc, f.documento_id
  )
  select a.product_id, a.sku, a.nombre, a.moneda,
         a.cotizaciones, a.pedidos, a.cantidad_cotizada, a.cantidad_pedida,
         a.ultima_fecha, u.tipo, u.documento_id, u.numero, u.cantidad, u.precio,
         count(*) over () as total_filas
    from agregadas a
    join ultima u on u.product_id = a.product_id and u.moneda is not distinct from a.moneda
   order by a.pedidos desc, a.cotizaciones desc, a.ultima_fecha desc nulls last, a.sku
   limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;

revoke execute on function public.productos_del_cliente(uuid, text, int, int) from public, anon;
grant execute on function public.productos_del_cliente(uuid, text, int, int) to authenticated;

-- ── 7 · El «último precio» enlaza al documento ─────────────────────────────
-- La función devolvía el NÚMERO del documento pero no su id, así que el enlace
-- de la pantalla iba al listado. Hay que recrearla: cambiar el RETURNS TABLE no
-- se puede con OR REPLACE.
drop function if exists public.ultimo_precio_cliente(uuid, uuid);

create function public.ultimo_precio_cliente(p_customer uuid, p_product uuid default null)
returns table (
  product_id uuid, sku text, nombre text, moneda text,
  ultimo_precio numeric, ultima_fecha date,
  ultimo_documento text, ultimo_documento_id uuid, ultimo_tipo text,
  precio_anterior numeric, veces bigint
) language sql stable set search_path = public, pg_temp as $$
  with h as (
    -- Sin tope: el último precio se calcula sobre TODAS las líneas.
    select * from precios_historicos_cliente(p_customer, p_product, null, 0)
  ),
  ordenadas as (
    select h.*,
           coalesce(h.product_id::text, 'sku:' || coalesce(h.sku, '?')) clave,
           row_number() over (
             partition by coalesce(h.product_id::text, 'sku:' || coalesce(h.sku, '?')),
                          coalesce(h.moneda, '')
             order by h.fecha desc nulls last, h.numero desc
           ) rn,
           count(*) over (
             partition by coalesce(h.product_id::text, 'sku:' || coalesce(h.sku, '?')),
                          coalesce(h.moneda, '')
           ) veces
      from h
  )
  select a.product_id, a.sku, a.nombre, a.moneda,
         a.precio, a.fecha, a.numero, a.documento_id, a.tipo,
         (select b.precio from ordenadas b
           where b.clave = a.clave
             and coalesce(b.moneda, '') = coalesce(a.moneda, '')
             and b.rn = 2) precio_anterior,
         a.veces
    from ordenadas a
   where a.rn = 1
   order by a.fecha desc nulls last, a.sku;
$$;

revoke execute on function public.ultimo_precio_cliente(uuid, uuid) from public, anon;
grant execute on function public.ultimo_precio_cliente(uuid, uuid) to authenticated;

-- ── 8 · La trazabilidad se lee sin UUIDs ───────────────────────────────────
-- El diff de una EDICIÓN de contacto o dirección traía sólo el id: legible
-- mientras la fila exista, ilegible el día que se borre, que es justo cuando
-- hace falta. Se agrega la etiqueta humana; las altas y las bajas ya la traían.
do $patch$
declare v_def text; v_nuevo text;
begin
  v_def := pg_get_functiondef('public.guardar_contacto(uuid, uuid, timestamptz, jsonb)'::regprocedure);
  if position('''contacto'', n_nombre, ''contacto_id''' in v_def) > 0 then
    raise notice 'guardar_contacto ya estaba parcheada';
  else
    v_nuevo := replace(v_def,
      E'          v_diff || jsonb_build_object(''contacto_id'', v_id), auth.uid());',
      E'          v_diff || jsonb_build_object(''contacto'', n_nombre, ''contacto_id'', v_id), auth.uid());');
    if v_nuevo = v_def then raise exception 'ancla no encontrada en guardar_contacto'; end if;
    execute v_nuevo;
  end if;

  v_def := pg_get_functiondef('public.guardar_direccion(uuid, uuid, timestamptz, jsonb)'::regprocedure);
  if position('''direccion'', n_calle, ''tipo''' in v_def) > 0 then
    raise notice 'guardar_direccion ya estaba parcheada';
  else
    v_nuevo := replace(v_def,
      E'          v_diff || jsonb_build_object(''direccion_id'', v_id), auth.uid());',
      E'          v_diff || jsonb_build_object(''direccion'', n_calle, ''tipo'', n_tipo, ''direccion_id'', v_id), auth.uid());');
    if v_nuevo = v_def then raise exception 'ancla no encontrada en guardar_direccion'; end if;
    execute v_nuevo;
  end if;
end $patch$;

-- ── 9 · Cuatro lecturas que le sobraba `anon` ──────────────────────────────
-- Es el default del proyecto, no una decisión. Son `security invoker`, así que
-- anon no obtenía ni una fila —RLS lo frena igual— pero una función que no
-- debería poder llamarse no debería poder llamarse.
revoke execute on function public.resumen_cliente(uuid) from anon;
revoke execute on function public.totales_por_moneda_cliente(uuid) from anon;
revoke execute on function public.actividad_mensual_cliente(uuid, integer) from anon;
revoke execute on function public.precios_historicos_cliente(uuid, uuid, integer, integer) from anon;

commit;

-- ============================================================================
-- ROLLBACK
--
-- Devuelve el esquema al estado previo a E4. Los adjuntos de cliente que se
-- hubieran subido quedan: sus filas y sus archivos siguen ahí, sin UI que los
-- muestre. Borrarlos no es parte de deshacer un cambio de esquema.
-- ============================================================================
-- begin;
--
-- drop function if exists public.documentos_del_cliente(uuid, text, int, int);
-- drop function if exists public.productos_del_cliente(uuid, text, int, int);
--
-- -- `ultimo_precio_cliente`, sin el id del documento.
-- drop function if exists public.ultimo_precio_cliente(uuid, uuid);
-- -- … volver a crearla con el RETURNS TABLE de E0 (sin `ultimo_documento_id`).
--
-- -- Las policies, por empresa.
-- drop policy if exists attachments_select on attachments;
-- create policy attachments_select on attachments for select to authenticated
--   using (
--     case when entity_type in ('supplier', 'purchase_order', 'goods_receipt',
--                               'supplier_invoice', 'maintenance_asset', 'maintenance_order')
--       then company_id in (select unnest(app.current_writer_company_ids()))
--       else company_id in (select unnest(app.current_internal_company_ids()))
--     end
--   );
-- drop policy if exists attachments_write on attachments;
-- create policy attachments_write on attachments for all to authenticated
--   using (company_id in (select unnest(app.current_writer_company_ids())))
--   with check (company_id in (select unnest(app.current_writer_company_ids())));
--
-- drop policy if exists ventas_objects_select on storage.objects;
-- create policy ventas_objects_select on storage.objects for select to authenticated
--   using (bucket_id = 'ventas'
--     and (storage.foldername(name))[1] in (select (unnest(app.current_internal_company_ids()))::text));
-- drop policy if exists ventas_objects_insert on storage.objects;
-- create policy ventas_objects_insert on storage.objects for insert to authenticated
--   with check (bucket_id = 'ventas'
--     and (storage.foldername(name))[1] in (select (unnest(app.current_writer_company_ids()))::text));
-- drop policy if exists ventas_objects_delete on storage.objects;
-- create policy ventas_objects_delete on storage.objects for delete to authenticated
--   using (bucket_id = 'ventas'
--     and (storage.foldername(name))[1] in (select (unnest(app.current_writer_company_ids()))::text));
--
-- drop function if exists app.carpeta_de_cliente_visible(text);
-- drop function if exists app.carpeta_de_cliente_editable(text);
-- drop function if exists app.uuid_o_nulo(text);
--
-- -- `validar_adjunto` y `auditar_adjunto` vuelven a su versión de la Fase 15 · E6
-- -- (sin la rama `customer`). El resto de los tipos de entidad no cambia.
--
-- commit;
