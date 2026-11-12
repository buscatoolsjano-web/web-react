-- Fase 248: fotos de producto por el MCP, en masa.
--
-- «Quiero que vía MCP se puedan adjuntar bien las imágenes y estén bien
-- colocadas, así mi agente Grok lo puede hacer masivamente.»
--
-- El reparto es el mismo que el correo y el WhatsApp: la BASE resuelve (SKU →
-- producto, permisos, orden) y la Edge Function hace lo que la base no puede
-- —bajar la imagen de la URL y subirla al bucket—. Al registrar, la base vuelve
-- a mandar: el orden, la principal única (`uq_product_images_primary`) y no
-- repetir una foto que el producto ya tiene.
--
-- Las fotos que sube el MCP van al bucket público `catalogo-publico`, bajo
-- `productos/<empresa>/mcp/<sha256>.<ext>`: la MISMA foto para veinte productos
-- es UN archivo. Por eso la fila no lleva `storage_path` —es compartida—: quitarla
-- de un producto nunca borra el archivo de los otros.

-- ── 1. Preparar: qué producto es cada SKU, y si se puede ────────────────────
create or replace function public.asistente_preparar_fotos(p_company uuid, p_fotos jsonb)
returns jsonb language plpgsql stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_item jsonb; v_n int := 0; v_pid uuid; v_sku text; v_url text; v_ok jsonb := '[]'::jsonb; v_mal jsonb := '[]'::jsonb;
begin
  if app."current_role"(p_company) not in ('admin', 'employee') then
    return jsonb_build_object('error', 'Tu rol no carga fotos de productos en esta empresa.');
  end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) = 0 then
    return jsonb_build_object('error', 'Faltan las fotos: una lista de {producto, url, principal}.');
  end if;
  if jsonb_array_length(p_fotos) > 40 then
    return jsonb_build_object('error', 'Como mucho 40 fotos por llamada. Partilas en tandas de 40.');
  end if;

  for v_item in select value from jsonb_array_elements(p_fotos) loop
    v_n := v_n + 1;
    v_sku := btrim(coalesce(v_item ->> 'producto', v_item ->> 'sku', ''));
    v_url := btrim(coalesce(v_item ->> 'url', ''));
    v_pid := app.producto_por_sku_exacto(p_company, v_sku);
    if v_pid is null then
      v_mal := v_mal || jsonb_build_object('n', v_n, 'producto', v_sku, 'error', 'No existe ese SKU en esta empresa.');
    elsif v_url !~* '^https?://' then
      v_mal := v_mal || jsonb_build_object('n', v_n, 'producto', v_sku, 'error', 'La url tiene que empezar con http:// o https://');
    else
      v_ok := v_ok || jsonb_build_object('n', v_n, 'producto', (select sku from products where id = v_pid),
        'product_id', v_pid, 'url', v_url, 'principal', coalesce((v_item ->> 'principal')::boolean, false));
    end if;
  end loop;

  return jsonb_build_object('fotos', jsonb_build_object('items', v_ok, 'empresa', p_company), 'rechazadas', v_mal);
end $function$;

-- ── 2. Registrar una foto ya subida (lo llama el ejecutor, no el modelo) ─────
-- Al final, o primera y principal. Si el producto ya tiene esa foto, no la
-- repite: si pidieron que sea la principal, la pasa adelante.
create or replace function public.asistente_registrar_foto(
  p_company uuid, p_producto uuid, p_url text, p_principal boolean default false, p_bytes integer default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_existe uuid; v_max int;
begin
  if app."current_role"(p_company) not in ('admin', 'employee') then
    return jsonb_build_object('error', 'Tu rol no carga fotos de productos en esta empresa.');
  end if;
  if not exists (select 1 from products where id = p_producto and company_id = p_company and deleted_at is null) then
    return jsonb_build_object('error', 'Ese producto no es de esta empresa.');
  end if;

  select id into v_existe from product_images where product_id = p_producto and source_url = p_url limit 1;
  if v_existe is not null and not p_principal then
    return jsonb_build_object('ya_estaba', true);
  end if;

  if p_principal then
    -- Primero se desmarca la principal (índice único) y se corre todo uno.
    update product_images set is_primary = false where product_id = p_producto and is_primary;
    update product_images set position = position + 1 where product_id = p_producto and (v_existe is null or id <> v_existe);
    if v_existe is not null then
      update product_images set position = 0, is_primary = true where id = v_existe;
    else
      insert into product_images (company_id, product_id, source_url, storage_path, kind, position, is_primary, bytes)
      values (p_company, p_producto, p_url, null, 'product_image', 0, true, p_bytes);
    end if;
  else
    select coalesce(max(position), -1) into v_max from product_images where product_id = p_producto;
    insert into product_images (company_id, product_id, source_url, storage_path, kind, position, is_primary, bytes)
    values (p_company, p_producto, p_url, null, 'product_image', v_max + 1,
            not exists (select 1 from product_images where product_id = p_producto and is_primary), p_bytes);
  end if;

  -- Posiciones 0..n, la principal primero.
  with o as (select id, row_number() over (order by is_primary desc, position, created_at, id) - 1 pos
               from product_images where product_id = p_producto)
  update product_images i set position = o.pos from o where o.id = i.id and i.position <> o.pos;

  return jsonb_build_object('agregada', v_existe is null,
    'principal', (select is_primary from product_images where product_id = p_producto and source_url = p_url limit 1));
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

-- ── 3. Ver las fotos de un producto ─────────────────────────────────────────
create or replace function public.asistente_ver_fotos(p_company uuid, p_sku text)
returns jsonb language plpgsql stable
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_pid uuid;
begin
  v_pid := app.producto_por_sku_exacto(p_company, p_sku);
  if v_pid is null then return jsonb_build_object('error', 'No existe el SKU «' || coalesce(p_sku, '') || '» en esta empresa.'); end if;
  return jsonb_build_object(
    'producto', (select sku from products where id = v_pid),
    'fotos', coalesce((select jsonb_agg(jsonb_build_object('numero', rn, 'principal', is_primary, 'url', source_url) order by rn)
                         from (select i.*, row_number() over (order by i.is_primary desc, i.position, i.created_at, i.id) rn
                                 from product_images i where i.product_id = v_pid and i.kind in ('product_image', 'unknown')
                                  and i.source_url is not null) x), '[]'::jsonb),
    'nota', 'La 1 es la principal: la que se ve en el catálogo, los documentos y la web.');
end $function$;

-- ── 4. Elegir la principal / 5. Quitar una ──────────────────────────────────
create or replace function public.asistente_ordenar_foto(p_company uuid, p_sku text, p_numero integer, p_accion text)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare v_pid uuid; v_id uuid; v_total int;
begin
  if app."current_role"(p_company) not in ('admin', 'employee') then
    return jsonb_build_object('error', 'Tu rol no cambia fotos de productos en esta empresa.');
  end if;
  v_pid := app.producto_por_sku_exacto(p_company, p_sku);
  if v_pid is null then return jsonb_build_object('error', 'No existe el SKU «' || coalesce(p_sku, '') || '» en esta empresa.'); end if;
  select count(*) into v_total from product_images where product_id = v_pid and kind in ('product_image', 'unknown') and source_url is not null;
  select id into v_id from (select i.id, row_number() over (order by i.is_primary desc, i.position, i.created_at, i.id) rn
                              from product_images i where i.product_id = v_pid and i.kind in ('product_image', 'unknown')
                               and i.source_url is not null) x where rn = p_numero;
  if v_id is null then
    return jsonb_build_object('error', 'Ese producto tiene ' || v_total || ' foto(s): elegí un número del 1 al ' || v_total || '. Miralas con ver_fotos_producto.');
  end if;

  if p_accion = 'quitar' then
    delete from product_images where id = v_id;
    -- Si era la principal, pasa a serlo la que queda primera.
    if not exists (select 1 from product_images where product_id = v_pid and is_primary) then
      update product_images set is_primary = true
       where id = (select id from product_images where product_id = v_pid order by position, created_at, id limit 1);
    end if;
  else
    -- La principal se desmarca ANTES (índice único) y `position` no admite
    -- negativos: se corren las demás y la elegida queda en 0.
    update product_images set is_primary = false where product_id = v_pid and is_primary and id <> v_id;
    update product_images set position = position + 1 where product_id = v_pid and id <> v_id;
    update product_images set is_primary = true, position = 0 where id = v_id;
  end if;

  with o as (select id, row_number() over (order by is_primary desc, position, created_at, id) - 1 pos
               from product_images where product_id = v_pid)
  update product_images i set position = o.pos from o where o.id = i.id and i.position <> o.pos;

  return public.asistente_ver_fotos(p_company, p_sku) || jsonb_build_object('hecho', case p_accion when 'quitar' then 'quitada' else 'ahora es la principal' end);
exception when others then
  return jsonb_build_object('error', app.asistente_error(sqlerrm));
end $function$;

create or replace function public.asistente_foto_principal(p_company uuid, p_sku text, p_numero integer)
returns jsonb language sql set search_path to 'public', 'pg_temp'
as $$ select public.asistente_ordenar_foto(p_company, p_sku, p_numero, 'principal') $$;

create or replace function public.asistente_quitar_foto(p_company uuid, p_sku text, p_numero integer)
returns jsonb language sql set search_path to 'public', 'pg_temp'
as $$ select public.asistente_ordenar_foto(p_company, p_sku, p_numero, 'quitar') $$;

grant execute on function
  public.asistente_preparar_fotos(uuid, jsonb),
  public.asistente_registrar_foto(uuid, uuid, text, boolean, integer),
  public.asistente_ver_fotos(uuid, text),
  public.asistente_ordenar_foto(uuid, text, integer, text),
  public.asistente_foto_principal(uuid, text, integer),
  public.asistente_quitar_foto(uuid, text, integer)
to authenticated, service_role;
revoke execute on function
  public.asistente_preparar_fotos(uuid, jsonb),
  public.asistente_registrar_foto(uuid, uuid, text, boolean, integer),
  public.asistente_ver_fotos(uuid, text),
  public.asistente_ordenar_foto(uuid, text, integer, text),
  public.asistente_foto_principal(uuid, text, integer),
  public.asistente_quitar_foto(uuid, text, integer)
from anon, public;
