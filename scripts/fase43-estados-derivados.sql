-- Fase 43 · El estado deja de ser algo que alguien marca
--
-- PENDIENTE DE APLICAR. No se pudo ejecutar en la sesión del 2026-10-15: el
-- conector de Supabase devolvía `MCP error -32600: no tenés permiso` y el
-- proyecto jiudqbusyknubonpedde ya no aparecía al listar. Hay que reautorizar
-- el conector y correr esto.
--
-- QUÉ SE PIDIÓ
--
-- «Una cotización tiene que dejar de ser Borrador cuando se guarda, y si se
-- genera un pedido sí o sí tiene que ser cerrada. Si se borra el pedido vuelve
-- a pendiente. Y lo mismo con todos los flujos.»
--
-- LA DECISIÓN DE FONDO, QUE SE DA VUELTA
--
-- Hoy `convertir_cotizacion_en_pedido` dice, textual:
--
--     «La cotización no se toca: no cambia de estado ni se marca. Si además
--      hay que darla por aceptada, es una acción aparte que decide la persona.»
--
-- Era deliberado. Y es lo que dejó COT-BTS00007 en «Borrador» con el pedido
-- PDV-ERP00003 colgando: nadie se acuerda de apretar el botón, y el listado
-- miente sobre su propio contenido.
--
-- La regla nueva es la misma que ya se aplicó en la Fase 40 con COTI02531: EL
-- PEDIDO ES EL HECHO, EL ESTADO ES SU CONSECUENCIA. Si existe el pedido, la
-- cotización está cerrada, y no hay nada que decidir.
--
-- EL VOCABULARIO YA EXISTE — esto cablea reglas, no inventa estados:
--
--   cotización   draft «Borrador» · sent «Pendiente» · accepted «Cerrada»
--   pedido       comercial: draft · confirmed · cancelled
--                entrega:   pending · partially_delivered · delivered
--   remito       draft · shipped · delivered   (+ invoiced, que se agrega acá)
--
-- MEDIDO ANTES DE ESCRIBIR (2026-10-15, producción):
--
--   cotizaciones   draft 5 · sent 156 · accepted 180
--   pedidos        comercial draft 1 · confirmed 194
--                  entrega pending 33 · parcial 1 · delivered 161
--                  facturación: not_invoiced 195 — ninguno marcado nunca
--   remitos        draft 1 · shipped 1 · delivered 216
--   sales_invoices 0 filas: la facturación todavía no se usa

begin;

-- ── 1 · La cotización deja de nacer y quedarse en Borrador ──────────────────
--
-- Al guardar pasa a `sent` («Pendiente»). El botón «Marcar como enviada» de la
-- ficha pierde sentido y se saca de la pantalla: guardar YA la deja pendiente.
--
-- Sólo sube de draft. Una cotización cerrada o rechazada que se edita no
-- vuelve atrás por guardarla: eso sería perder una decisión que alguien tomó.

create or replace function app.cotizacion_sale_de_borrador()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'draft' then
    new.status := 'sent';
  end if;
  return new;
end
$$;

-- En INSERT y en UPDATE. Crear una cotización ES guardarla —el alta escribe el
-- documento entero de una vez, no hay un «a medias»— así que si sólo mirara el
-- update quedaría una puerta por la que una cotización nace Borrador y se
-- queda ahí para siempre, que es exactamente el caso que se vino a arreglar.
--
-- Sólo actúa si el estado que llega es `draft`: el importador de STEL escribe
-- `sent` o `accepted` explícitos y no se los toca.

drop trigger if exists cotizacion_sale_de_borrador on public.sales_quotes;
create trigger cotizacion_sale_de_borrador
  before insert or update on public.sales_quotes
  for each row
  when (new.status = 'draft')
  execute function app.cotizacion_sale_de_borrador();

-- ── 2 · Con pedido, cerrada. Sin pedido, pendiente. ────────────────────────
--
-- Va por trigger sobre `sales_orders` y no dentro de la RPC de conversión, a
-- propósito: un pedido puede nacer por la conversión, por una importación de
-- STEL o por una pantalla que todavía no existe. La regla tiene que valer
-- venga de donde venga, y un trigger es el único lugar donde eso es cierto.
--
-- `rejected` no se pisa: si alguien rechazó la cotización y después apareció
-- un pedido, eso es una contradicción que tiene que mirar una persona, no algo
-- que el sistema resuelva solo por el camino más cómodo.

create or replace function app.cotizacion_sigue_a_su_pedido()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_quote uuid := coalesce(new.quote_id, old.quote_id);
  v_quedan int;
begin
  if v_quote is null then
    return coalesce(new, old);
  end if;

  select count(*) into v_quedan
    from public.sales_orders o
   where o.quote_id = v_quote
     and (tg_op <> 'DELETE' or o.id <> old.id);

  update public.sales_quotes q
     set status = case when v_quedan > 0 then 'accepted' else 'sent' end,
         updated_at = now()
   where q.id = v_quote
     and q.status not in ('rejected')
     and q.status is distinct from (case when v_quedan > 0 then 'accepted' else 'sent' end);

  return coalesce(new, old);
end
$$;

drop trigger if exists cotizacion_sigue_a_su_pedido_ins on public.sales_orders;
create trigger cotizacion_sigue_a_su_pedido_ins
  after insert on public.sales_orders
  for each row execute function app.cotizacion_sigue_a_su_pedido();

drop trigger if exists cotizacion_sigue_a_su_pedido_upd on public.sales_orders;
create trigger cotizacion_sigue_a_su_pedido_upd
  after update of quote_id on public.sales_orders
  for each row execute function app.cotizacion_sigue_a_su_pedido();

drop trigger if exists cotizacion_sigue_a_su_pedido_del on public.sales_orders;
create trigger cotizacion_sigue_a_su_pedido_del
  after delete on public.sales_orders
  for each row execute function app.cotizacion_sigue_a_su_pedido();

-- ── 3 · Poner al día lo que ya está ────────────────────────────────────────
--
-- Sin esto la regla vale sólo para lo que pase de ahora en más, y los
-- documentos de hoy —COT-BTS00007 entre ellos— siguen mintiendo.

update public.sales_quotes q
   set status = 'accepted', updated_at = now()
 where q.status in ('draft', 'sent')
   and exists (select 1 from public.sales_orders o where o.quote_id = q.id);

update public.sales_quotes q
   set status = 'sent', updated_at = now()
 where q.status = 'draft'
   and not exists (select 1 from public.sales_orders o where o.quote_id = q.id);

-- ── 4 · El remito: «Facturada» es un estado MÁS, al final ──────────────────
--
-- Lo pedido era «pendiente hasta que se facture». Aplicado tal cual HOY sería
-- peor que lo que hay: `sales_invoices` tiene 0 filas, así que los 216 remitos
-- entregados pasarían a «Pendiente» y no los cerraría nunca nadie.
--
-- Entonces `delivered` sigue siendo «Entregada» y se agrega `invoiced`
-- («Facturada») como cierre. Hoy se ve igual que ahora y mejora solo el día
-- que empiecen a facturar. Decidido con el usuario el 2026-10-15.

-- El CHECK se busca por su definición, no por su nombre.
--
-- Escribirlo como `drop constraint if exists deliveries_status_check` era una
-- trampa: si el nombre real fuera otro, el drop no haría nada —el `if exists`
-- lo silencia— y el check viejo seguiría rechazando `invoiced`. El resultado
-- sería una restricción que bloquea el estado nuevo sin que nada falle al
-- aplicar. Se busca cuál es y se lo reemplaza.

do $$
declare r record;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.deliveries'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.deliveries drop constraint %I', r.conname);
  end loop;

  execute $ck$
    alter table public.deliveries add constraint deliveries_status_check
      check (status in ('draft', 'shipped', 'delivered', 'invoiced', 'cancelled'))
  $ck$;
end $$;

create or replace function app.remito_sigue_a_su_factura()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.deliveries d
     set status = 'invoiced', updated_at = now()
   where d.id = new.delivery_id
     and d.status = 'delivered';
  return new;
end
$$;

-- El trigger queda PREPARADO pero sin crear: `sales_invoice_lines` todavía no
-- tiene la columna que ata una línea de factura a un remito, y no se inventa
-- un vínculo antes de que exista el circuito de facturación. Cuando exista:
--
--   create trigger remito_sigue_a_su_factura
--     after insert on public.sales_invoice_lines
--     for each row execute function app.remito_sigue_a_su_factura();

-- ── 5 · Comprobaciones ─────────────────────────────────────────────────────

do $$
declare v_mal int;
begin
  select count(*) into v_mal
    from public.sales_quotes q
   where q.status in ('draft', 'sent')
     and exists (select 1 from public.sales_orders o where o.quote_id = q.id);
  if v_mal > 0 then
    raise exception 'quedaron % cotizaciones con pedido y sin cerrar', v_mal;
  end if;

  select count(*) into v_mal from public.sales_quotes where status = 'draft';
  raise notice 'cotizaciones en borrador después del arreglo: % (esperado 0)', v_mal;
end $$;

commit;

-- ── 6 · Lo que va en la pantalla, y no acá ─────────────────────────────────
--
-- · El botón «Marcar como enviada» se saca: guardar ya la deja Pendiente.
-- · La columna Estado del PEDIDO pasa a mostrar el avance de entrega
--   («Sin entregar» / «Entrega parcial» / «Entregado»), que es lo que se pidió.
--   Hoy muestra el comercial y por eso se ve «Borrador» en vez del avance. El
--   comercial queda como chip aparte sólo cuando dice algo distinto.
-- · El Vendedor: `salesperson_id` está vacío en los 751 documentos y
--   `created_by` sólo lo traen los nacidos en el ERP. Se muestra quien creó
--   donde existe, y «Importado de STEL» donde no — en vez de un guión mudo que
--   se lee como «nadie».
