-- Cliente vs. contacto en Buscatools (2026-11-26). Lo mismo que la fase 120 hizo
-- en Torquetools: el import de StelOrder metió el NOMBRE DEL CONTACTO (una
-- persona) en customers.trade_name, y como el ERP prefiere trade_name, los
-- documentos y el importador de OC mostraban la persona («SEBASTIAN BORRONE»)
-- en vez de la empresa («CIMET OPTEL»).
--
-- Criterio: trade_name distinto del legal_name, que no lo contiene ni está
-- contenido, sin sufijo de empresa, y que NO parece un negocio (insumos,
-- servicios, grupo, siglas de ≤3 letras, con números o «&»…). Quedan afuera 14
-- con nombre comercial real (Grupo Adami, Insumos GV, MR INSUMOS…).
--
-- Reversible: los nombres originales quedan en app.respaldo_trade_name_bts_202611.
--
-- APLICADO con execute_sql el 2026-11-26: 347 clientes, 346 contactos creados
-- (uno ya existía), contacto puesto en 112 cotizaciones, 39 pedidos y 39 remitos.

create table if not exists app.respaldo_trade_name_bts_202611 (
  customer_id uuid primary key,
  trade_name text not null,
  respaldado_en timestamptz not null default now()
);

do $$
declare
  v_co uuid;
  n_cli int; n_cont int; n_q int; n_o int; n_d int; n_limpios int;
begin
  select id into v_co from companies where name = 'Buscatools';

  create temp table _cand on commit drop as
  select c.id, btrim(c.trade_name) as persona
    from customers c
   where c.company_id = v_co and c.deleted_at is null
     and c.trade_name is not null and btrim(c.trade_name) <> '' and upper(c.trade_name) <> upper(c.legal_name)
     and c.trade_name not ilike '%' || c.legal_name || '%' and c.legal_name not ilike '%' || c.trade_name || '%'
     and c.trade_name !~* '\m(s\.?a\.?|s\.?r\.?l|s\.?l\.?|srl|saic|sacif|s\.?a\.?i|cia|ltda|ltd|inc|llc|group|argentina|industrial|comercial)\M'
     and not (c.trade_name ~* '\m(insumos|servicios|industrial|industriales|ferreteria|herramientas|taller|soluciones|distribuidora|comercial|tecnica|ingenieria|electricidad|metalurgica|construcciones|sistemas|importadora|grupo|centro|bulones|abrasivos|suministros|revestidos|albaugh)\M'
              or c.trade_name ~ '\d|&' or length(btrim(c.trade_name)) <= 3);
  select count(*) into n_cli from _cand;

  -- 0 · respaldo
  insert into app.respaldo_trade_name_bts_202611 (customer_id, trade_name)
  select c.id, c.trade_name from customers c join _cand k on k.id = c.id
  on conflict (customer_id) do nothing;

  -- 1 · la persona como contacto (principal sólo si el cliente no tiene uno)
  insert into customer_contacts (company_id, customer_id, full_name, is_default, active)
  select v_co, k.id, k.persona,
         not exists (select 1 from customer_contacts cc where cc.customer_id = k.id and cc.is_default),
         true
    from _cand k
   where not exists (select 1 from customer_contacts cc
                      where cc.customer_id = k.id and upper(btrim(cc.full_name)) = upper(k.persona));
  get diagnostics n_cont = row_count;

  -- 2 · esa persona en los documentos que no tienen contacto
  update sales_quotes q set contact_id = cc.id
    from _cand k join customer_contacts cc on cc.customer_id = k.id and upper(btrim(cc.full_name)) = upper(k.persona)
   where q.company_id = v_co and q.customer_id = k.id and q.contact_id is null;
  get diagnostics n_q = row_count;
  update sales_orders o set contact_id = cc.id
    from _cand k join customer_contacts cc on cc.customer_id = k.id and upper(btrim(cc.full_name)) = upper(k.persona)
   where o.company_id = v_co and o.customer_id = k.id and o.contact_id is null;
  get diagnostics n_o = row_count;
  update deliveries d set contact_id = cc.id
    from _cand k join customer_contacts cc on cc.customer_id = k.id and upper(btrim(cc.full_name)) = upper(k.persona)
   where d.company_id = v_co and d.customer_id = k.id and d.contact_id is null;
  get diagnostics n_d = row_count;

  -- 3 · el cliente vuelve a mostrar su razón social
  update customers c set trade_name = null from _cand k where c.id = k.id;
  get diagnostics n_limpios = row_count;

  if n_limpios <> n_cli then
    raise exception 'esperaba % clientes y limpié %', n_cli, n_limpios;
  end if;
  raise notice 'clientes % · contactos creados % · cotizaciones % · pedidos % · remitos %', n_cli, n_cont, n_q, n_o, n_d;
end $$;

-- Para deshacer:
-- update customers c set trade_name = r.trade_name
--   from app.respaldo_trade_name_bts_202611 r where c.id = r.customer_id;
