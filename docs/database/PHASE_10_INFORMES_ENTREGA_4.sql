-- ===========================================================================
-- FASE 10 · INFORMES — ENTREGA 4 · stock físico, movimientos y kardex
-- ===========================================================================
--
-- Migraciones (en este orden):
--   fase10_informes_entrega4_stock              primera versión (4 funciones)
--   fase10_informes_entrega4_stock_rendimiento  el conteo del catálogo sale del
--       resumen a informe_stock_catalogo; joins a products por id (LATERAL)
--   fase10_informes_entrega4_stock_lecturas     DEFINITIVA: una sola lectura de
--       stock_movements en el resumen y depósitos leídos una vez (la RLS cuesta
--       por fila leída; medido en el doc, sección L)
--
-- Sin tablas, columnas, vistas, índices ni cambios de RLS. Cuatro funciones de
-- lectura, SECURITY INVOKER, sólo admin y employee (validado antes de leer:
-- la RLS de stock deja leer a todo interno, incluidos salesperson y
-- technician). NINGUNA toca stock: no hay valuación, costo, margen ni stock
-- crítico.
--
-- Fuentes (y nada más):
--   stock_balances      on_hand, reserved (los mantienen los triggers
--                       app.apply_stock_movement / app.apply_stock_reservation)
--   stock_movements     append-only; quantity <> 0 por CHECK
--   stock_reservations  hoy 0 filas
--   warehouses, products
--
-- Reglas:
--   disponible   = on_hand − reserved (derivado; no se guarda)
--   estado       negativo (on_hand < 0) · cero (= 0) · con_stock (> 0);
--                disponible_negativo (on_hand − reserved < 0) es aparte: otro problema
--   entrada/salida por el SIGNO de quantity, nunca por movement_type
--   fecha del movimiento = created_at en hora de Argentina
--   mes          = el tramo de ?mes= (1 → hoy en el mes en curso), igual que Informes
--   kardex       saldo = Σ quantity por depósito en orden (created_at, id);
--                se devuelve SÓLO si la suma total del depósito coincide con
--                stock_balances.on_hand (saldo_verificado). Si no, saldo = null.
--
-- Funciones:
--   informe_stock_resumen(company, mes)          KPIs por depósito y total, último
--                                                movimiento, movimientos del mes por
--                                                tipo y origen
--   informe_stock_catalogo(company)              productos del catálogo sin movimientos
--                                                y sin saldo (única que recorre el catálogo)
--   informe_stock_actual(company, búsqueda,      saldos paginados con filtros
--        depósito, estado, límite, desplazamiento)
--   informe_movimientos_stock(company, mes,      movimientos del mes paginados
--        depósito, tipo, sentido, producto, límite, desplazamiento)
--   informe_kardex_producto(company, producto,   movimientos de UN producto con saldo
--        depósito, orden, límite, desplazamiento)
-- ===========================================================================

-- ── resumen ────────────────────────────────────────────────────────────────
create or replace function public.informe_stock_resumen(p_company uuid, p_mes date default null)
returns table (
  seccion      text,
  warehouse_id uuid,
  codigo       text,
  deposito     text,
  activo       boolean,
  categoria    text,
  cantidad     bigint,
  desde        date,
  hasta        date
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hoy     date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes_hoy date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_mes     date;
  v_hasta   date;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  if v_mes > v_mes_hoy then
    raise exception 'mes_futuro' using errcode = 'invalid_parameter_value';
  end if;
  v_hasta := case when v_mes = v_mes_hoy then v_hoy else ((v_mes + interval '1 month')::date - 1) end;

  return query
  with
  dep as (
    select w.id, w.code, w.name, w.is_active from warehouses w where w.company_id = p_company
  ),
  bal as materialized (
    select b.product_id, b.warehouse_id, b.on_hand, b.reserved
      from stock_balances b where b.company_id = p_company
  ),
  estados as (
    select x.wid, x.cat, count(*) as n
      from (
        select b.warehouse_id as wid, unnest(array[
                 'balances',
                 case when b.on_hand > 0 then 'con_stock' when b.on_hand = 0 then 'en_cero' else 'negativo' end,
                 case when b.on_hand - b.reserved < 0 then 'disponible_negativo' end,
                 case when b.reserved > 0 then 'con_reservas' end]) as cat
          from bal b
      ) x
     where x.cat is not null
     group by grouping sets ((x.wid, x.cat), (x.cat))
  ),
  cats(cat) as (values ('balances'), ('con_stock'), ('en_cero'), ('negativo'), ('disponible_negativo'), ('con_reservas')),
  -- UNA lectura de stock_movements: la RLS evalúa app.is_internal() por fila
  -- (SECURITY DEFINER, no se inlinea) y es lo que cuesta, no el cálculo.
  movs as materialized (
    select s.product_id, s.warehouse_id, s.quantity, s.movement_type, s.source_type, s.source_id,
           (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date as dia
      from stock_movements s where s.company_id = p_company
  ),
  mov as (
    select m.product_id, max(m.dia) as ult from movs m group by m.product_id
  ),
  balp as (
    select b.product_id, bool_and(b.on_hand = 0) as todo_cero from bal b group by b.product_id
  ),
  mes as (
    select m.* from movs m where m.dia between v_mes and v_hasta
  )
  select 'rango'::text, null::uuid, null::text, null::text, null::boolean, null::text, 0::bigint, v_mes, v_hasta

  union all
  select 'deposito', d.id, d.code, d.name, d.is_active, null,
         (select count(*) from bal b where b.warehouse_id = d.id), null, null
    from dep d

  union all
  select 'estado', d.id, d.code, d.name, d.is_active, c.cat,
         coalesce((select e.n from estados e where e.wid = d.id and e.cat = c.cat), 0), null, null
    from dep d cross join cats c
  union all
  select 'estado', null, null, 'TODOS', null, c.cat,
         coalesce((select e.n from estados e where e.wid is null and e.cat = c.cat), 0), null, null
    from cats c

  -- Sólo sobre productos con saldo o movimiento. El conteo del catálogo entero
  -- (sin movimientos) está aparte, en informe_stock_catalogo: barrer 21.772
  -- productos bajo la RLS de products cuesta ~500 ms y no debe frenar el resto.
  union all
  select 'productos', null, null, null, null, x.cat, x.n, null, null
    from (
      select 'con_balance' as cat, count(*) as n from balp
      union all select 'con_movimientos', count(*) from mov
      union all select 'movido_hoy_en_cero', count(*) from balp bp join mov m on m.product_id = bp.product_id where bp.todo_cero
    ) x

  union all
  select 'ultimo_movimiento', null, null, null, null, b.cat,
         (select count(*) from mov m
           where case when v_hoy - m.ult <= 30 then '0_30'
                      when v_hoy - m.ult <= 90 then '31_90'
                      when v_hoy - m.ult <= 180 then '91_180'
                      when v_hoy - m.ult <= 365 then '181_365'
                      else 'mas_365' end = b.cat), null, null
    from (values ('0_30'), ('31_90'), ('91_180'), ('181_365'), ('mas_365')) b(cat)

  union all
  select 'mes', null, null, null, null, x.cat, x.n, v_mes, v_hasta
    from (
      select 'movimientos' as cat, count(*) as n from mes
      union all select 'entradas', count(*) filter (where quantity > 0) from mes
      union all select 'salidas', count(*) filter (where quantity < 0) from mes
      union all select 'productos', count(distinct product_id) from mes
      union all select 'depositos', count(distinct warehouse_id) from mes
      union all select 'sin_documento', count(*) filter (where source_id is null) from mes
    ) x

  union all
  select 'mes_tipo', null, null, null, null, m.movement_type, count(*), v_mes, v_hasta
    from mes m group by m.movement_type
  union all
  select 'mes_origen', null, null, null, null, coalesce(m.source_type, 'sin_origen'), count(*), v_mes, v_hasta
    from mes m group by coalesce(m.source_type, 'sin_origen');
end
$$;

-- ── catálogo sin movimientos ────────────────────────────────────────────────
-- Aparte del resumen a propósito: es la única cifra que necesita recorrer el
-- catálogo entero, y bajo la RLS de products (app.is_internal por fila, ver
-- docs/performance/RLS_COUNT_ANALISIS.md) eso cuesta ~500 ms. La pantalla la
-- pide en paralelo y la cachea más tiempo: el catálogo no cambia de un minuto
-- a otro.
create or replace function public.informe_stock_catalogo(p_company uuid)
returns table (categoria text, cantidad bigint)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  return query
  with prod as (
    select p.id,
           exists (select 1 from stock_movements s where s.company_id = p_company and s.product_id = p.id) as movido,
           exists (select 1 from stock_balances b where b.company_id = p_company and b.product_id = p.id) as con_balance
      from products p
     where p.company_id = p_company and p.deleted_at is null
  )
  select 'catalogo'::text, count(*) from prod
  union all select 'sin_movimientos', count(*) filter (where not movido) from prod
  union all select 'sin_balance', count(*) filter (where not con_balance) from prod
  union all select 'sin_movimientos_con_balance', count(*) filter (where not movido and con_balance) from prod;
end
$$;

-- ── stock actual ───────────────────────────────────────────────────────────
create or replace function public.informe_stock_actual(
  p_company        uuid,
  p_busqueda       text    default null,
  p_deposito       uuid    default null,
  p_estado         text    default null,
  p_limite         integer default 50,
  p_desplazamiento integer default 0
)
returns table (
  posicion            bigint,
  total_filas         bigint,
  producto_id         uuid,
  sku                 text,
  producto            text,
  producto_activo     boolean,
  warehouse_id        uuid,
  deposito_codigo     text,
  deposito            text,
  on_hand             numeric,
  reserved            numeric,
  available           numeric,
  estado              text,
  disponible_negativo boolean,
  ultimo_movimiento   timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(coalesce(p_busqueda, '')), '');
  v_patron text;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if (p_estado is not null and p_estado not in ('con_stock', 'cero', 'negativo', 'disponible_negativo', 'reservado'))
     or p_limite is null or p_limite < 1 or p_limite > 500
     or p_desplazamiento is null or p_desplazamiento < 0
     or length(coalesce(p_busqueda, '')) > 100 then
    raise exception 'parametro_invalido' using errcode = 'invalid_parameter_value';
  end if;

  -- Búsqueda literal: % y _ del usuario no son comodines.
  if v_q is not null then
    v_patron := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with dep as materialized (
    -- Los depósitos se leen UNA vez (son pocos), no uno por saldo.
    select w.id, w.code, w.name from warehouses w where w.company_id = p_company
  ),
  filas as (
    select b.product_id as pid, b.warehouse_id as wid, b.on_hand as oh, b.reserved as rs,
           p.sku as psku, p.name as pnom, (p.deleted_at is null and p.status = 'active') as pact,
           w.code as wcod, w.name as wnom
      from stock_balances b
      -- LATERAL: una búsqueda por id por saldo. Un join común deja al planner
      -- barrer products entero y evaluar su RLS fila por fila.
      join lateral (select p.sku, p.name, p.deleted_at, p.status from products p
                     where p.id = b.product_id and p.company_id = p_company) p on true
      join dep w on w.id = b.warehouse_id
     where b.company_id = p_company
       and (p_deposito is null or b.warehouse_id = p_deposito)
       and (v_patron is null or p.sku ilike v_patron or p.name ilike v_patron)
       and (p_estado is null
            or (p_estado = 'con_stock' and b.on_hand > 0)
            or (p_estado = 'cero' and b.on_hand = 0)
            or (p_estado = 'negativo' and b.on_hand < 0)
            or (p_estado = 'disponible_negativo' and b.on_hand - b.reserved < 0)
            or (p_estado = 'reservado' and b.reserved > 0))
  ),
  ord as (
    select f.*,
           row_number() over (order by f.psku collate "C", f.wcod collate "C", f.pid, f.wid) as pos,
           count(*) over () as tot
      from filas f
  ),
  pagina as (
    select * from ord o order by o.pos limit p_limite offset p_desplazamiento
  )
  select g.pos, g.tot, g.pid, g.psku, g.pnom, g.pact, g.wid, g.wcod, g.wnom,
         g.oh, g.rs, g.oh - g.rs,
         case when g.oh < 0 then 'negativo' when g.oh = 0 then 'cero' else 'con_stock' end,
         (g.oh - g.rs) < 0,
         (select max(s.created_at) from stock_movements s
           where s.company_id = p_company and s.product_id = g.pid and s.warehouse_id = g.wid)
    from pagina g
   order by g.pos;
end
$$;

-- ── movimientos ────────────────────────────────────────────────────────────
create or replace function public.informe_movimientos_stock(
  p_company        uuid,
  p_mes            date    default null,
  p_deposito       uuid    default null,
  p_tipo           text    default null,
  p_sentido        text    default null,
  p_producto       uuid    default null,
  p_limite         integer default 50,
  p_desplazamiento integer default 0
)
returns table (
  posicion        bigint,
  total_filas     bigint,
  movimiento_id   bigint,
  fecha           timestamptz,
  dia             date,
  producto_id     uuid,
  sku             text,
  producto        text,
  producto_activo boolean,
  warehouse_id    uuid,
  deposito_codigo text,
  deposito        text,
  movement_type   text,
  sentido         text,
  quantity        numeric,
  source_type     text,
  source_id       uuid,
  referencia      text,
  notas           text,
  desde           date,
  hasta           date
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_hoy     date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_mes_hoy date := date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date;
  v_mes     date;
  v_hasta   date;
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if (p_tipo is not null and p_tipo not in ('opening_balance', 'purchase_receipt', 'sale_delivery', 'adjustment',
                                            'transfer_in', 'transfer_out', 'return_in', 'return_out', 'service_consumption'))
     or (p_sentido is not null and p_sentido not in ('entrada', 'salida'))
     or p_limite is null or p_limite < 1 or p_limite > 500
     or p_desplazamiento is null or p_desplazamiento < 0 then
    raise exception 'parametro_invalido' using errcode = 'invalid_parameter_value';
  end if;

  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  if v_mes > v_mes_hoy then
    raise exception 'mes_futuro' using errcode = 'invalid_parameter_value';
  end if;
  v_hasta := case when v_mes = v_mes_hoy then v_hoy else ((v_mes + interval '1 month')::date - 1) end;

  return query
  with dep as materialized (
    select w.id, w.code, w.name from warehouses w where w.company_id = p_company
  ),
  filas as (
    select s.id as mid, s.created_at as ts, s.product_id as pid, s.warehouse_id as wid,
           s.movement_type as mt, s.quantity as q, s.source_type as st, s.source_id as sid, s.notes as nt
      from stock_movements s
     where s.company_id = p_company
       and (s.created_at at time zone 'America/Argentina/Buenos_Aires')::date between v_mes and v_hasta
       and (p_deposito is null or s.warehouse_id = p_deposito)
       and (p_tipo is null or s.movement_type = p_tipo)
       and (p_sentido is null or (p_sentido = 'entrada' and s.quantity > 0) or (p_sentido = 'salida' and s.quantity < 0))
       and (p_producto is null or s.product_id = p_producto)
  ),
  ord as (
    select f.*, row_number() over (order by f.ts desc, f.mid desc) as pos, count(*) over () as tot
      from filas f
  ),
  pagina as (
    select * from ord o order by o.pos limit p_limite offset p_desplazamiento
  )
  select g.pos, g.tot, g.mid, g.ts, (g.ts at time zone 'America/Argentina/Buenos_Aires')::date,
         g.pid, p.sku, p.name, (p.deleted_at is null and p.status = 'active'),
         g.wid, w.code, w.name, g.mt,
         case when g.q > 0 then 'entrada' else 'salida' end,
         g.q, g.st, g.sid,
         case g.st
           when 'delivery'          then (select d.number from deliveries d where d.id = g.sid and d.company_id = p_company)
           when 'goods_receipt'     then (select r.number from goods_receipts r where r.id = g.sid and r.company_id = p_company)
           when 'maintenance_order' then (select m.number from maintenance_orders m where m.id = g.sid and m.company_id = p_company)
         end,
         g.nt, v_mes, v_hasta
    from pagina g
    left join lateral (select p.sku, p.name, p.deleted_at, p.status from products p
                        where p.id = g.pid and p.company_id = p_company) p on true
    left join dep w on w.id = g.wid
   order by g.pos;
end
$$;

-- ── kardex ─────────────────────────────────────────────────────────────────
create or replace function public.informe_kardex_producto(
  p_company        uuid,
  p_producto       uuid,
  p_deposito       uuid    default null,
  p_orden          text    default 'desc',
  p_limite         integer default 50,
  p_desplazamiento integer default 0
)
returns table (
  posicion            bigint,
  total_filas         bigint,
  movimiento_id       bigint,
  fecha               timestamptz,
  dia                 date,
  warehouse_id        uuid,
  deposito_codigo     text,
  deposito            text,
  movement_type       text,
  sentido             text,
  quantity            numeric,
  saldo               numeric,
  saldo_verificado    boolean,
  inicia_con_apertura boolean,
  saldo_actual        numeric,
  source_type         text,
  source_id           uuid,
  referencia          text,
  notas               text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if p_company is null or app.current_role(p_company) is null
     or app.current_role(p_company) not in ('admin', 'employee') then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;
  if p_producto is null
     or p_orden is null or p_orden not in ('asc', 'desc')
     or p_limite is null or p_limite < 1 or p_limite > 500
     or p_desplazamiento is null or p_desplazamiento < 0 then
    raise exception 'parametro_invalido' using errcode = 'invalid_parameter_value';
  end if;

  return query
  with movs as (
    select s.id as mid, s.created_at as ts, s.warehouse_id as wid, s.movement_type as mt, s.quantity as q,
           s.source_type as st, s.source_id as sid, s.notes as nt,
           sum(s.quantity) over w_acum as acum,
           sum(s.quantity) over w_total as total_dep,
           first_value(s.movement_type) over w_acum as primero
      from stock_movements s
     where s.company_id = p_company and s.product_id = p_producto
       and (p_deposito is null or s.warehouse_id = p_deposito)
    window w_acum as (partition by s.warehouse_id order by s.created_at, s.id rows between unbounded preceding and current row),
           w_total as (partition by s.warehouse_id)
  ),
  con_balance as (
    select m.*, b.on_hand as saldo_bal, (b.on_hand is not null and b.on_hand = m.total_dep) as ok
      from movs m
      left join stock_balances b on b.product_id = p_producto and b.warehouse_id = m.wid and b.company_id = p_company
  ),
  ord as (
    select c.*,
           row_number() over (order by
             case when p_orden = 'asc' then c.ts end asc,  case when p_orden = 'asc' then c.mid end asc,
             case when p_orden = 'desc' then c.ts end desc, case when p_orden = 'desc' then c.mid end desc) as pos,
           count(*) over () as tot
      from con_balance c
  ),
  pagina as (
    select * from ord o order by o.pos limit p_limite offset p_desplazamiento
  )
  select g.pos, g.tot, g.mid, g.ts, (g.ts at time zone 'America/Argentina/Buenos_Aires')::date,
         g.wid, w.code, w.name, g.mt,
         case when g.q > 0 then 'entrada' else 'salida' end,
         g.q,
         case when g.ok then g.acum end,
         g.ok, g.primero = 'opening_balance', g.saldo_bal,
         g.st, g.sid,
         case g.st
           when 'delivery'          then (select d.number from deliveries d where d.id = g.sid and d.company_id = p_company)
           when 'goods_receipt'     then (select r.number from goods_receipts r where r.id = g.sid and r.company_id = p_company)
           when 'maintenance_order' then (select m.number from maintenance_orders m where m.id = g.sid and m.company_id = p_company)
         end,
         g.nt
    from pagina g
    left join warehouses w on w.id = g.wid and w.company_id = p_company
   order by g.pos;
end
$$;

revoke all on function public.informe_stock_resumen(uuid, date) from public, anon;
revoke all on function public.informe_stock_catalogo(uuid) from public, anon;
revoke all on function public.informe_stock_actual(uuid, text, uuid, text, integer, integer) from public, anon;
revoke all on function public.informe_movimientos_stock(uuid, date, uuid, text, text, uuid, integer, integer) from public, anon;
revoke all on function public.informe_kardex_producto(uuid, uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.informe_stock_resumen(uuid, date) to authenticated;
grant execute on function public.informe_stock_catalogo(uuid) to authenticated;
grant execute on function public.informe_stock_actual(uuid, text, uuid, text, integer, integer) to authenticated;
grant execute on function public.informe_movimientos_stock(uuid, date, uuid, text, text, uuid, integer, integer) to authenticated;
grant execute on function public.informe_kardex_producto(uuid, uuid, uuid, text, integer, integer) to authenticated;
