-- ---------------------------------------------------------------------------
-- FASE 15 · VENTAS — Entrega 6: cierre de la experiencia diaria
-- ---------------------------------------------------------------------------
--
-- E6 es sobre todo frontend. En la base cambian tres cosas, y ninguna toca
-- stock, numeración ni autoridad:
--
--   1. `deliveries.delivery_address_snapshot` — el gap que dejó E5. El remito
--      mostraba la dirección VIVA del cliente: si el cliente se muda, el
--      remito ya emitido «cambiaba» de domicilio. Ahora se copia al crearlo.
--   2. `attachments`: una validación que faltaba (el documento tiene que
--      existir y ser de la misma empresa, y la ruta tiene que caer en su
--      carpeta) y la auditoría de lo que se sube y se borra.
--   3. La política de lectura del bucket `ventas` pide además que la carpeta
--      sea de una empresa del actor. Antes se apoyaba sólo en que se pudiera
--      ver la fila de `attachments`; sigue siendo cierto, pero ahora hay dos
--      cerraduras en vez de una.
--
-- Lo que NO se hizo, con su motivo, está en la documentación: no hay backend
-- de envío por email (no se agrega un botón que no manda nada) ni generación
-- de PDF (la impresión A4 del navegador ya existe y se reutiliza).

-- ---------------------------------------------------------------------------
-- 1 · El domicilio de entrega, congelado
-- ---------------------------------------------------------------------------
-- jsonb y no columnas sueltas: es un SNAPSHOT, no un domicilio editable. Nadie
-- va a filtrar remitos por ciudad; lo que hace falta es que diga lo mismo
-- dentro de tres años. Nullable y SIN BACKFILL: de los 193 remitos históricos
-- no sabemos a qué dirección fueron —hoy no hay ni una fila en
-- `customer_addresses`—, y copiarles la dirección de hoy sería inventarla.

alter table deliveries add column if not exists delivery_address_snapshot jsonb;

comment on column deliveries.delivery_address_snapshot is
  'Domicilio de entrega tal como estaba al crear el remito. Snapshot: no cambia si el cliente se muda. NULL = no se registró.';

-- De dónde sale el domicilio, en orden: el que eligió el pedido y, si no tiene,
-- el domicilio de envío por defecto del cliente. Si no hay ninguno, NULL —que
-- es la verdad, y la pantalla la dice.
create or replace function app.domicilio_para_remito(
  p_company  uuid,
  p_order    uuid,
  p_customer uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid; v jsonb;
begin
  if p_order is not null then
    select shipping_address_id into v_id from sales_orders where id = p_order;
  end if;

  if v_id is null then
    select id into v_id
      from customer_addresses
     where company_id = p_company and customer_id = p_customer
       and kind in ('shipping', 'both')
     order by is_default desc, created_at
     limit 1;
  end if;

  if v_id is null then
    return null;
  end if;

  select jsonb_strip_nulls(jsonb_build_object(
           'street', street, 'city', city, 'state', state,
           'postal_code', postal_code, 'country_code', country_code,
           'notes', notes, 'address_id', id))
    into v
    from customer_addresses
   where id = v_id and company_id = p_company;

  return v;
end $$;

revoke execute on function app.domicilio_para_remito(uuid, uuid, uuid) from public, anon;
grant  execute on function app.domicilio_para_remito(uuid, uuid, uuid) to authenticated, service_role;

-- `crear_remito_desde_pedido` guarda el snapshot al insertar la cabecera.
-- (El parche real se aplicó con un DO que reescribe la función; acá queda la
-- línea que cambió, para que se lea.)
--
--   insert into deliveries (..., status, delivery_address_snapshot)
--   values (..., 'draft', app.domicilio_para_remito(v_company, p_order, v_customer));

-- ---------------------------------------------------------------------------
-- 2 · Adjuntos: que el documento exista y la ruta caiga donde debe
-- ---------------------------------------------------------------------------
-- La tabla ya tenía RLS por empresa. Lo que no tenía es que `entity_id`
-- apuntara a algo real: se podía registrar un adjunto de un documento de otra
-- empresa —o de ninguno— y quedaba colgado, invisible pero ocupando lugar.

create or replace function app.validar_adjunto()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existe int; v_prefijo text;
begin
  if new.entity_type in ('quote', 'order', 'delivery') then
    if new.entity_type = 'quote' then
      select count(*) into v_existe from sales_quotes
       where id = new.entity_id and company_id = new.company_id;
    elsif new.entity_type = 'order' then
      select count(*) into v_existe from sales_orders
       where id = new.entity_id and company_id = new.company_id;
    else
      select count(*) into v_existe from deliveries
       where id = new.entity_id and company_id = new.company_id;
    end if;

    if v_existe = 0 then
      raise exception 'DOCUMENTO_INEXISTENTE'
        using errcode = '42501',
              detail = 'El adjunto apunta a un documento que no existe en esta empresa.';
    end if;

    -- La ruta vive bajo <empresa>/<tipo>/<documento>/…: una ruta que apunte a
    -- otra carpeta haría que el archivo y su metadata se contradigan.
    v_prefijo := new.company_id || '/' || new.entity_type || '/' || new.entity_id || '/';
    if position(v_prefijo in new.storage_path) <> 1 then
      raise exception 'RUTA_INVALIDA'
        using errcode = '42501',
              detail = 'La ruta del archivo no corresponde a este documento.';
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

drop trigger if exists trg_00_validar_adjunto on attachments;
create trigger trg_00_validar_adjunto
  before insert on attachments
  for each row execute function app.validar_adjunto();

-- ---------------------------------------------------------------------------
-- 3 · Adjuntos: qué se subió y qué se borró
-- ---------------------------------------------------------------------------
-- Sólo de los documentos de venta, y sólo altas y bajas. Las lecturas NO se
-- auditan: llenarían la tabla de ruido y no responden ninguna pregunta que
-- alguien vaya a hacer.

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

drop trigger if exists trg_90_auditar_adjunto on attachments;
create trigger trg_90_auditar_adjunto
  after insert or delete on attachments
  for each row execute function app.auditar_adjunto();

-- ---------------------------------------------------------------------------
-- 4 · Storage: la carpeta es la cerradura
-- ---------------------------------------------------------------------------
-- La política anterior decía «podés leer el objeto si podés ver su fila de
-- attachments». Era cierta —la fila la filtra su propio RLS— pero tenía un
-- efecto que encontró la prueba: al borrar un adjunto, que va primero la fila
-- y después el archivo (el orden seguro), el usuario perdía la visibilidad del
-- objeto en el paso 2 y el borrado del archivo **no hacía nada y no avisaba**.
-- Quedaban huérfanos en el bucket.
--
-- La ruta ya empieza con el `company_id`, así que la carpeta dice de quién es
-- el archivo. Se exige pertenencia INTERNA a esa empresa: la misma regla que
-- tiene la metadata para los documentos de venta, y el cliente del portal
-- —que nunca vio estos adjuntos— sigue afuera.

drop policy if exists ventas_objects_select on storage.objects;
create policy ventas_objects_select on storage.objects for select
  using (
    bucket_id = 'ventas'
    and (storage.foldername(name))[1] in (
      select (unnest(app.current_internal_company_ids()))::text
    )
  );

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- Nada de esto borra datos: la columna se agregó vacía y los triggers son
-- nuevos. Volver atrás deja el remito mostrando la dirección viva del cliente,
-- que es el problema que E6 vino a cerrar.
--
-- drop trigger if exists trg_90_auditar_adjunto on attachments;
-- drop function if exists app.auditar_adjunto();
-- drop trigger if exists trg_00_validar_adjunto on attachments;
-- drop function if exists app.validar_adjunto();
-- drop function if exists app.domicilio_para_remito(uuid, uuid, uuid);
-- alter table deliveries drop column if exists delivery_address_snapshot;
-- drop policy if exists ventas_objects_select on storage.objects;
-- create policy ventas_objects_select on storage.objects for select
--   using (bucket_id = 'ventas'
--          and exists (select 1 from attachments a where a.storage_path = objects.name));
-- (y volver a poner en `crear_remito_desde_pedido` el insert sin
--  `delivery_address_snapshot`)
