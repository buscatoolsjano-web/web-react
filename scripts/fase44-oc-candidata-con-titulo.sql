-- Fase 44 · La candidata se muestra con su título
--
-- APLICADO el 2026-10-15 como migración `fase44_candidata_con_titulo`.
--
-- QUÉ SE PIDIÓ
--
-- «Si coincide con una cotización quiero que, si esa coti tiene cargado un
--  número de OC o un cliente, que se muestre para saber si realmente es esa y
--  coincide.»
--
-- POR QUÉ NO ALCANZABA LO QUE HABÍA
--
-- El paso 4 del importador listaba las candidatas con número, fecha y «3 de 3
-- productos en común». Con dos cotizaciones del MISMO cliente por los MISMOS
-- productos —que es el caso frecuente: se cotiza, el cliente pide revisión, se
-- vuelve a cotizar— las dos dicen «3 de 3» y ese número no distingue ninguna.
--
-- El dato que sí distingue ya estaba cargado y no viajaba: el título, que es
-- donde se escribe el número de orden del cliente («OC 4800027334»). El
-- cliente no hace falta agregarlo: las candidatas se buscan POR cliente, así
-- que todas son del mismo y repetirlo en cada renglón no informa nada.
--
-- QUÉ CAMBIA
--
-- `cotizaciones_para_oc` agrega `'titulo', c.title` al objeto que devuelve, y
-- `c.title` al `select` y al `group by` del CTE. Nada más: ni el orden ni el
-- filtro ni la cobertura se tocan.
--
-- Se reescribe completa y no con un `create or replace` parcial porque la
-- firma no cambia: mismos cuatro parámetros, mismo tipo de retorno. Si la
-- firma cambiara haría falta el `drop` explícito, porque `create or replace`
-- con otra firma deja DOS funciones y rompe las llamadas.

create or replace function public.cotizaciones_para_oc(
  p_company uuid,
  p_customer uuid,
  p_productos uuid[],
  p_meses integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with pedidos as (
    select distinct x as product_id
      from unnest(p_productos) as x
     where x is not null
  ),
  candidatas as (
    select q.id, q.number, q.title, q.quote_date, q.status, q.total, q.currency_code,
           count(distinct l.product_id) filter (where l.product_id in (select product_id from pedidos)) as en_comun
      from sales_quotes q
      left join sales_quote_lines l
        on l.quote_id = q.id and l.product_id is not null
     where q.company_id = p_company
       and q.customer_id = p_customer
       and q.quote_date >= (current_date - make_interval(months => greatest(p_meses, 1)))
     group by q.id, q.number, q.title, q.quote_date, q.status, q.total, q.currency_code
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'quote_id',        c.id,
      'numero',          c.number,
      'titulo',          c.title,
      'fecha',           c.quote_date,
      'estado',          c.status,
      'total',           c.total,
      'moneda',          c.currency_code,
      'lineas_en_comun', c.en_comun,
      'lineas_oc',       (select count(*) from pedidos),
      -- Qué proporción de lo que pide la OC estaba en esa cotización. Es la
      -- confianza, sin inflar: 0,5 quiere decir la mitad, y se ve.
      'cobertura', case when (select count(*) from pedidos) = 0 then 0
                        else round(c.en_comun::numeric / (select count(*) from pedidos), 2) end
    ) order by
      c.en_comun desc,
      -- A igual cobertura, la que ya se mandó antes que un borrador: a un
      -- borrador el cliente no pudo responderle.
      (c.status = 'draft'),
      c.quote_date desc
    ) filter (where c.en_comun > 0),
    '[]'::jsonb
  )
  from candidatas c;
$function$;

-- VERIFICACIÓN
--
-- Contra datos reales, con los productos de COTI02543:
--
--   candidatas devueltas ......... 5
--   lineas_en_comun / lineas_oc .. 5 de 5
--   cobertura .................... 1.00
--   titulo ....................... null (esas cinco no lo tienen cargado)
--
-- El `null` es el resultado correcto y no un fallo: la pantalla no muestra
-- nada cuando no hay título. Un «sin título» sería un renglón más para leer
-- que no dice nada, y un hueco es más honesto.
