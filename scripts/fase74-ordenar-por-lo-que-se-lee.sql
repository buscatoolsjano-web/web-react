-- Fase 74 · La columna Estado ordena por lo que dice, no por lo que guarda
--
-- QUÉ SE PIDIÓ
--
-- «Título y estado no filtran bien a-z / z-a.»
--
--
-- ERAN DOS COSAS, Y LA SEGUNDA ES LA DE ACÁ
--
-- La primera era de la URL: `titulo` y `estado` no estaban en la lista de
-- claves de orden válidas, así que al releer la dirección volvían a Fecha.
-- Arreglado en el frontend (Fase 73), sin pasar por la base.
--
-- La segunda es ésta: aunque la clave viaje bien, ordenar la columna Estado
-- ordenaba por el CÓDIGO guardado y no por la palabra que está escrita en la
-- pantalla. Y las dos cosas no se parecen en nada:
--
--   código a-z ..... accepted · draft · expired · rejected · sent
--   lo que se lee ... Cerrada · Borrador · Vencida · Rechazada · Pendiente
--
-- Quien toca «a-z» espera la lista de la derecha ordenada alfabéticamente. Lo
-- que veía era la de la izquierda, que de alfabético no tiene nada.
--
--
-- Y EN PEDIDOS NI SIQUIERA ERA LA MISMA COLUMNA
--
-- Desde la Fase 43 el chip de un pedido muestra el AVANCE DE ENTREGA —«Sin
-- entregar», «Entrega parcial», «Entregado»— y sólo cae al estado comercial
-- cuando éste dice algo que el avance no puede decir: borrador o cancelado.
-- Pero el orden seguía pidiendo `commercial_status`, que en 166 de los 195
-- pedidos vale lo mismo: `confirmed`. O sea que ordenar por Estado no
-- ordenaba nada, y no por un error de alfabeto: ordenaba por otra columna.
--
--
-- LA SOLUCIÓN, Y SU PRECIO
--
-- Una columna calculada por documento, `estado_visible`, que devuelve la
-- MISMA palabra que dibuja el chip. PostgREST las expone como una columna más
-- y se puede ordenar por ellas, igual que `abierta(sales_quotes)`.
--
-- El precio es que las etiquetas quedan escritas en dos lados: acá y en
-- `src/modules/ventas/lib/estados.ts`. No hay forma de evitarlo —el orden lo
-- hace la base, que es la que pagina, y la palabra la elige la pantalla—, así
-- que se hace explícito: si se renombra un estado allá, hay que renombrarlo
-- acá. Lo custodia `estadoVisible.test.ts`, que tiene la lista de las dos
-- fuentes y falla si se separan.

create or replace function public.estado_visible(q sales_quotes)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select case q.status
    when 'draft'    then 'Borrador'
    when 'sent'     then 'Pendiente'
    when 'accepted' then 'Cerrada'
    when 'rejected' then 'Rechazada'
    when 'expired'  then 'Vencida'
    else q.status
  end;
$function$;

create or replace function public.estado_visible(o sales_orders)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  -- El comercial sólo gana cuando dice algo que el avance no puede decir. Es
  -- la regla de `presentarEstadoPedido`, escrita igual.
  select case
    when o.commercial_status = 'draft'     then 'Borrador'
    when o.commercial_status = 'cancelled' then 'Cancelado'
    else case o.fulfillment_status
      when 'pending'             then 'Sin entregar'
      when 'partially_reserved'  then 'Reserva parcial'
      when 'reserved'            then 'Reservado'
      when 'partially_delivered' then 'Entrega parcial'
      when 'delivered'           then 'Entregado'
      else o.fulfillment_status
    end
  end;
$function$;

create or replace function public.estado_visible(d deliveries)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select case d.status
    when 'draft'     then 'Borrador'
    when 'shipped'   then 'Despachada'
    when 'delivered' then 'Entregada'
    when 'cancelled' then 'Cancelada'
    else d.status
  end;
$function$;

-- VERIFICACIÓN
--
-- APLICADO el 2026-10-15 como `fase74_estado_visible`.
--
-- Contra datos reales, ordenando por la columna nueva (a-z):
--
--   pedidos ....... Borrador · Cancelado · Entrega parcial · Entregado ·
--                   Sin entregar
--   cotizaciones .. Borrador · Cerrada · Pendiente · Rechazada · Vencida
--
-- Y que no se haya roto el chip: para cada pedido, `estado_visible` dice lo
-- mismo que `presentarEstadoPedido(commercial_status, fulfillment_status)`
-- —comprobado sobre los 195, sin una sola diferencia—.
