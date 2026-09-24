-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 26 · E3 — Lo que falta para que el alta de producto esté completa   ║
-- ║                                                                          ║
-- ║                 ⚠  PREPARADO, NO APLICADO  ⚠                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- El alta de producto **ya funciona** sin nada de esto: `products` y
-- `product_images` tienen policy de escritura para admin y employee
-- (`products_write`, `product_images_write`), así que el formulario crea el
-- producto, sus atributos y su imagen por URL con el JWT de la persona.
--
-- Lo que este archivo agrega son las tres cosas que el formulario del legacy
-- pide y hoy **no se pueden guardar**. Cada una es una decisión distinta y se
-- puede aplicar por separado. Ninguna está aplicada.
--
-- Contexto que hace falta para decidir la A: `AUTORIDAD.listas` dice, en el
-- código y en la pantalla de Configuración, que «no está decidido quién es el
-- maestro de precios (STEL o el ERP)» y que hasta esa decisión las listas se
-- consultan pero no se editan desde el ERP. Poner un precio desde el alta de
-- producto cruza esa línea. No es un problema técnico: es la decisión.

-- ───────────────────────────────────────────────────────────────────────────
-- A · Poner el precio de un producto nuevo
-- ───────────────────────────────────────────────────────────────────────────
-- Una función y no una policy de escritura sobre `product_prices`: una policy
-- abierta deja cambiar cualquier precio de cualquier producto en cualquier
-- lista desde el navegador, y lo que hace falta es poder poner el precio
-- INICIAL de un producto. La función lo limita a eso —falla si ya hay uno
-- vigente— y deja rastro.
--
-- No inventa la lista: usa la que está por defecto para la empresa.

create or replace function public.catalogo_precio_inicial(
  p_company uuid, p_product uuid, p_importe numeric
)
returns table(price_id uuid, price_list_id uuid, amount numeric)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_lista uuid; v_existe uuid;
begin
  -- El mismo permiso que escribir el producto: admin o employee de la empresa.
  if p_company <> all(app.current_writer_company_ids()) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_product is null or p_importe is null or p_importe < 0 then
    raise exception 'datos_invalidos' using errcode = 'invalid_parameter_value';
  end if;
  -- El producto tiene que ser de la empresa: sin esto, con un uuid ajeno se le
  -- pondría precio a un producto de otra.
  if not exists (select 1 from products p where p.id = p_product and p.company_id = p_company) then
    raise exception 'no_encontrado' using errcode = 'no_data_found';
  end if;

  select l.id into v_lista
    from price_lists l
   where l.company_id = p_company and l.is_default
   limit 1;
  if v_lista is null then
    raise exception 'sin_lista_por_defecto' using errcode = 'no_data_found';
  end if;

  select pp.id into v_existe
    from product_prices pp
   where pp.product_id = p_product and pp.price_list_id = v_lista
     and pp.valid_from <= current_date
     and (pp.valid_to is null or pp.valid_to >= current_date)
   limit 1;
  if v_existe is not null then
    -- Cambiar un precio que ya existe es otra operación, con otra discusión
    -- (historial, vigencias, quién manda). Esta función no lo hace.
    raise exception 'ya_tiene_precio' using errcode = 'unique_violation';
  end if;

  insert into product_prices (company_id, price_list_id, product_id, amount, valid_from)
  values (p_company, v_lista, p_product, p_importe, current_date)
  returning id, price_list_id, amount into price_id, price_list_id, amount;

  return next;
end $function$;

revoke all on function public.catalogo_precio_inicial(uuid, uuid, numeric) from public;
grant execute on function public.catalogo_precio_inicial(uuid, uuid, numeric) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- B · Stock inicial
-- ───────────────────────────────────────────────────────────────────────────
-- **Propuesta, no implementación.** `stock_balances` es de sólo lectura a
-- propósito: el saldo sale de los movimientos, y escribirlo a mano lo
-- desincroniza del historial que la pantalla del producto muestra.
--
-- Lo correcto es un movimiento de tipo `opening_balance` —que ya existe como
-- tipo en `stock_movements`— y que el saldo lo recalcule lo que ya lo
-- recalcula. Eso necesita mirar cómo se mantiene hoy `stock_balances` (¿trigger,
-- vista materializada, un proceso?) antes de escribir una línea de SQL.
--
-- Queda anotado y sin código: un `insert` directo en `stock_balances` acá sería
-- exactamente el error que el modelo evita.

-- ───────────────────────────────────────────────────────────────────────────
-- C · Bucket de Storage para fotos de producto
-- ───────────────────────────────────────────────────────────────────────────
-- Hoy hay tres buckets —`empresa-logos`, `ventas`, `whatsapp`— y ninguno para
-- fotos de producto, así que el formulario acepta una URL pero no un archivo.
--
-- Va comentado porque crear un bucket y sus policies es una decisión de
-- infraestructura —cuánto pesa, qué tipos, quién lee— y porque el `insert` en
-- `storage.buckets` conviene hacerlo desde el panel o la CLI de Supabase, que
-- es de donde salieron los otros tres.
--
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('productos', 'productos', false, 5242880,
--           array['image/png','image/jpeg','image/webp']);
--
--   -- Leer: cualquiera de la empresa. Escribir: sólo quien escribe productos.
--   create policy productos_leer on storage.objects for select to authenticated
--     using (bucket_id = 'productos'
--            and (storage.foldername(name))[1] = any(
--              select c::text from unnest(app.current_company_ids()) c));
--
--   create policy productos_escribir on storage.objects for insert to authenticated
--     with check (bucket_id = 'productos'
--                 and (storage.foldername(name))[1] = any(
--                   select c::text from unnest(app.current_writer_company_ids()) c));
--
-- Con el bucket, `product_images.storage_path` pasa a tener sentido: la columna
-- ya está.
