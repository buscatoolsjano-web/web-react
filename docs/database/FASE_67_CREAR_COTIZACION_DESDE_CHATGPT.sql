-- Fase 67 · E3: crear una cotización desde ChatGPT.
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- `asistente_preparar_cotizacion` arma el borrador y nada más; crearla es un
-- botón que aprieta la persona en la web. Desde ChatGPT no hay botón, así que
-- hace falta una función que la cree — y es la PRIMERA escritura del asistente.
--
-- ── Las cuatro decisiones ───────────────────────────────────────────────────
--
-- 1. SECURITY INVOKER. Corre como quien pregunta, así que la RLS sigue
--    mandando y `auth.uid()` es quien de verdad está del otro lado. Hacerla
--    DEFINER habría sido más cómodo —para escribir una tabla de idempotencia—
--    y habría abierto un agujero: `asistente_preparar_cotizacion`, llamada
--    desde una DEFINER, correría con privilegios de la dueña y se podría
--    cotizar para una empresa ajena.
--
-- 2. EL BORRADOR SE VUELVE A RESOLVER ACÁ. No se recibe hecho. El modelo manda
--    lo mismo que le manda a `preparar_cotizacion` —un nombre de cliente y una
--    lista de «producto, cantidad»— y la resolución es la misma función, así
--    que lo que se crea es lo que se mostró. El modelo NUNCA manda un
--    `product_id`, ni un precio, ni un total: no puede alterarlos aunque
--    quiera.
--
-- 3. SI FALTA RESOLVER UN RENGLÓN, NO CREA NADA. Devuelve cuáles y por qué.
--    Un renglón mal resuelto es mercadería equivocada enviada a un cliente.
--
-- 4. IDEMPOTENCIA POR HUELLA, no por una clave que manda el modelo. Una clave
--    que genera el modelo no sirve: en un reintento genera otra. La huella es
--    empresa + cliente + moneda + autor + subtotal + cantidad de renglones
--    dentro de los últimos 10 minutos, que es exactamente lo que repite un
--    reintento de transporte. Si la encuentra, devuelve la que ya existe en vez
--    de crear una segunda.
--
--    Se usa `subtotal` y no `total` porque no son el mismo número: el ERP le
--    suma el 21 % al crear (medido: total = subtotal × 1,21). El `subtotal` de
--    lo que creamos sí coincide con el total del borrador, porque nuestras
--    líneas van sin descuento.
--
--    El sesgo es deliberado: ante la duda NO crea. Una cotización duplicada
--    enviada a un cliente es peor que un «ya existía» con el número a la vista.
--
-- ── El rol ──────────────────────────────────────────────────────────────────
--
-- `crear_cotizacion` exige `admin` o `employee` y levanta 42501 si no. El
-- clasificador del asistente traduce 42501 como «no tenés permiso para LEER
-- esto», que para una escritura es un mensaje equivocado y confuso. Así que el
-- rol se comprueba acá antes y se devuelve un texto que dice lo que pasa de
-- verdad: un vendedor puede pedir el borrador, no crearla.

create or replace function public.asistente_crear_cotizacion(
  p_company  uuid,
  p_cliente  text,
  p_productos jsonb,
  p_moneda   text default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_rol     text;
  v_borr    jsonb;
  v_cli     uuid;
  v_nombre  text;
  v_moneda  text;
  v_total   numeric;
  v_l       jsonb;
  v_lineas  jsonb := '[]'::jsonb;
  v_n       int := 0;
  v_previa  record;
  v_res     jsonb;
begin
  -- 1. ¿Puede esta persona crear cotizaciones en esta empresa?
  select cm.role into v_rol
    from public.company_memberships cm
   where cm.user_id = auth.uid()
     and cm.company_id = p_company
     and cm.status = 'active'
   limit 1;

  if v_rol is null then
    return jsonb_build_object('error', 'Esa empresa no es tuya.');
  end if;

  -- Los roles que crean son `admin` y `employee`. Los otros que existen de
  -- verdad en la base son `salesperson`, `customer` y `distributor`: decirle a
  -- un salesperson que «le pida a alguien de ventas» no significaría nada,
  -- porque es de ventas. Se nombran los roles que sí pueden.
  if v_rol not in ('admin', 'employee') then
    return jsonb_build_object('error',
      'Tu rol en el ERP no crea cotizaciones. Podés armar el borrador con '
      || 'preparar_cotizacion, mostrárselo, y pedir que la confirme alguien con rol de '
      || 'administrador o de empleado.');
  end if;

  -- 2. El borrador, resuelto de nuevo acá con la misma función que la pantalla.
  v_borr := public.asistente_preparar_cotizacion(p_company, p_cliente, p_productos, p_moneda);

  if v_borr ? 'error' then
    return v_borr;
  end if;

  -- 3. Si falta resolver algo, no se crea nada y se dice qué falta.
  if not coalesce((v_borr ->> 'listo_para_confirmar')::boolean, false) then
    return jsonb_build_object(
      'error', 'No la creé: hay renglones sin resolver.',
      'sin_resolver', v_borr -> 'sin_resolver',
      'lineas', v_borr -> 'lineas',
      'nota', 'Decile a la persona CUÁLES son y pedile el SKU o un nombre más preciso. '
              || 'No elijas un producto parecido para completar.');
  end if;

  v_cli    := (v_borr -> 'cliente' ->> 'id')::uuid;
  v_nombre := v_borr -> 'cliente' ->> 'nombre';
  v_moneda := v_borr ->> 'moneda';
  v_total  := (v_borr ->> 'total')::numeric;

  -- 4. Las líneas, con la misma forma que arma la tarjeta de la pantalla.
  for v_l in select value from jsonb_array_elements(v_borr -> 'lineas')
  loop
    if coalesce((v_l ->> 'resuelto')::boolean, false) then
      v_n := v_n + 1;
      v_lineas := v_lineas || jsonb_build_object(
        'line_no',           v_n,
        'line_type',         'item',
        'product_id',        v_l ->> 'product_id',
        'sku_snapshot',      v_l ->> 'sku',
        'name_snapshot',     v_l ->> 'nombre',
        'quantity',          (v_l ->> 'cantidad')::numeric,
        'unit_price',        coalesce((v_l ->> 'precio')::numeric, 0),
        'discount_pct',      0,
        'tax_treatment',     'vat_21',
        'tax_rate_snapshot', 21);
    end if;
  end loop;

  if v_n = 0 then
    return jsonb_build_object('error', 'El borrador quedó sin ningún renglón para cotizar.');
  end if;

  -- 5. ¿Ya existe una igual, recién creada? Entonces era un reintento.
  select q.id, q.number, q.total, q.created_at
    into v_previa
    from public.sales_quotes q
   where q.company_id = p_company
     and q.customer_id = v_cli
     and q.currency_code = v_moneda
     and q.created_by = auth.uid()
     and q.subtotal = v_total
     and q.created_at > now() - interval '10 minutes'
     and (select count(*) from public.sales_quote_lines l where l.quote_id = q.id) = v_n
   order by q.created_at desc
   limit 1;

  if v_previa.id is not null then
    return jsonb_build_object(
      'ya_existia', true,
      'id',       v_previa.id,
      'numero',   v_previa.number,
      'cliente',  v_nombre,
      'moneda',   v_moneda,
      'total',    v_previa.total,
      'renglones', v_n,
      'nota', 'Esta cotización ya estaba creada hace un momento, así que NO se creó una '
              || 'segunda. Decile el número. Si de verdad quería otra igual, que la haga '
              || 'desde el ERP.');
  end if;

  -- 6. Crear. `crear_cotizacion` valida cliente, moneda, tarifa, numeración y
  --    permisos de nuevo, y le suma el IVA.
  v_res := public.crear_cotizacion(
    p_company,
    jsonb_build_object(
      'customer_id',   v_cli,
      'currency_code', v_moneda,
      'title',         'Cotización para ' || v_nombre,
      'notes',         'Creada con el asistente desde ChatGPT.'),
    v_lineas);

  return jsonb_build_object(
    'creada',   true,
    'id',       v_res ->> 'id',
    'numero',   v_res ->> 'number',
    'cliente',  v_nombre,
    'moneda',   v_moneda,
    'neto',     v_total,
    'total',    (v_res ->> 'total')::numeric,
    'renglones', v_n,
    'nota', 'Creada. «neto» es sin IVA y «total» ya lo incluye. Decile el número y el '
            || 'total, y que puede abrirla en el ERP para revisarla o enviarla.');
end
$$;

comment on function public.asistente_crear_cotizacion(uuid, text, jsonb, text) is
  'Fase 67 E3. Crea una cotizacion desde el asistente externo (ChatGPT). Resuelve el borrador de nuevo del lado del servidor, se niega si falta resolver algun renglon, y no crea una segunda si detecta que fue un reintento. SECURITY INVOKER: la RLS manda.';

-- Quien puede llamarla es quien puede usar el asistente. El rol lo vuelve a
-- comprobar la función, y `crear_cotizacion` por tercera vez.
revoke all on function public.asistente_crear_cotizacion(uuid, text, jsonb, text) from public;
grant execute on function public.asistente_crear_cotizacion(uuid, text, jsonb, text) to authenticated;
