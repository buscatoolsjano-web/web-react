-- Fase 243: el MCP del ERP carga cotizaciones de verdad (Nordex desde Torquetools).
--
-- a. precio_unitario y descuento por renglón, que pisan el de lista / el último del cliente.
-- b. asistente_crear_producto: alta mínima con SKU único, marca y precio de lista.
-- c. 82 renglones sin timeout: el SKU exacto va por índice antes de la búsqueda difusa
--    (medido como authenticated: 20 renglones tardaban 22 s, ~1,1 s cada uno, contra
--    un statement_timeout de 8 s).
-- d. La cotización nace en borrador (`draft`, como siempre) y ver_documento la encuentra
--    también por su referencia externa.
-- e. referencia_externa («STEL COV00748»): no se crea dos veces, y la sync de STEL no la
--    vuelve a importar (ver scripts/lib/stel-reconciliacion.mjs).

-- ── e. La referencia externa ─────────────────────────────────────────────────
alter table public.sales_quotes add column if not exists external_ref text;
comment on column public.sales_quotes.external_ref is
  'Referencia a un documento de otro sistema (p. ej. COV00748 de STEL), normalizada en mayúsculas y sin el prefijo «STEL». Evita duplicar una cotización que también existe allá (Fase 243).';
create unique index if not exists sales_quotes_company_external_ref_key
  on public.sales_quotes (company_id, external_ref) where external_ref is not null;

-- «STEL COV00748», «stel:cov00748», « COV00748 » → «COV00748».
create or replace function app.normalizar_referencia(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(upper(regexp_replace(regexp_replace(btrim(coalesce(p, '')), '^\s*stel\s*[:#-]?\s*', '', 'i'), '\s+', '', 'g')), '')
$$;

-- ── c. El renglón por SKU exacto, por índice ─────────────────────────────────
-- Exacto primero (btree), después sin distinguir mayúsculas (trigram). Sólo si
-- ninguno da, el renglón va a la búsqueda difusa, que es la que tarda.
create or replace function app.producto_por_sku_exacto(p_company uuid, p_texto text)
returns uuid language plpgsql stable set search_path = public, pg_temp as $$
declare v uuid; t text := btrim(coalesce(p_texto, ''));
begin
  if t = '' then return null; end if;
  select id into v from products where company_id = p_company and deleted_at is null and sku = t limit 1;
  if v is null then
    select id into v from products
     where company_id = p_company and deleted_at is null
       and sku ilike replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')
     limit 2;  -- si hubiera dos que sólo difieren en mayúsculas, gana el primero
  end if;
  return v;
end $$;

-- ── a/c. preparar ────────────────────────────────────────────────────────────
create or replace function public.asistente_preparar_cotizacion(
  p_company uuid, p_cliente text, p_productos jsonb, p_moneda text default null)
returns jsonb language plpgsql stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_cli      uuid;
  v_cli_nom  text;
  -- Sin moneda: la de la lista por defecto de LA EMPRESA (EUR en Torquetools),
  -- no USD fijo.
  v_moneda   text := upper(coalesce(nullif(btrim(coalesce(p_moneda, '')), ''),
                      (select pl.currency_code from price_lists pl where pl.company_id = p_company and pl.is_default limit 1),
                      'USD'));
  v_l        jsonb;
  v_texto    text;
  v_cant     numeric;
  v_busq     jsonb;
  v_prod     jsonb;
  v_pid      uuid;
  v_sku      text;
  v_nombre   text;
  v_precio   numeric;
  v_lista    numeric;
  v_pedido   numeric;
  v_desc     numeric;
  v_origen   text;
  v_lineas   jsonb := '[]'::jsonb;
  v_faltan   int := 0;
  v_n        int := 0;
begin
  if coalesce(btrim(p_cliente), '') = '' then
    return jsonb_build_object('error', 'Falta el cliente. Preguntale a quién es la cotización.');
  end if;
  if p_productos is null or jsonb_typeof(p_productos) <> 'array'
     or jsonb_array_length(p_productos) = 0 then
    return jsonb_build_object('error', 'Falta qué cotizar. Preguntale qué productos y cuántos.');
  end if;

  v_cli := app.cliente_por_texto(p_company, p_cliente);
  if v_cli is null then
    return jsonb_build_object('error',
      'No encontré al cliente «' || p_cliente || '». Buscalo con buscar_cliente y confirmá cuál es.');
  end if;
  select legal_name into v_cli_nom from customers where id = v_cli;

  for v_l in select value from jsonb_array_elements(p_productos)
  loop
    v_n := v_n + 1;
    v_texto := btrim(coalesce(v_l ->> 'producto', ''));
    v_cant  := coalesce(nullif(v_l ->> 'cantidad', '')::numeric, 1);
    if v_cant <= 0 then v_cant := 1; end if;
    v_pedido := nullif(v_l ->> 'precio_unitario', '')::numeric;
    v_desc   := least(greatest(coalesce(nullif(v_l ->> 'descuento', '')::numeric, 0), 0), 100);

    v_pid := null; v_prod := null; v_precio := null; v_lista := null; v_sku := null; v_nombre := null;

    if v_texto <> '' then
      -- Rápido: el SKU tal cual (Fase 243).
      v_pid := app.producto_por_sku_exacto(p_company, v_texto);
      if v_pid is not null then
        select p.sku, p.name into v_sku, v_nombre from products p where p.id = v_pid;
        select importe into v_lista from app.precio_de_lista(p_company, v_pid);
      else
        v_busq := public.asistente_buscar_productos(p_company, v_texto, 3);
        v_prod := v_busq -> 'productos' -> 0;
        -- Sólo se da por bueno lo que coincide del todo o entró por código: un
        -- «parecido» acá es mercadería equivocada enviada a un cliente.
        if v_prod is not null
           and ((v_prod ->> 'encontrado_por') in ('sku', 'codigo', 'modelo')
                or (v_busq ->> 'coinciden_del_todo')::int >= 1) then
          select p.id, p.sku, p.name into v_pid, v_sku, v_nombre from products p
           where p.company_id = p_company and p.deleted_at is null
             and p.sku = v_prod ->> 'sku' limit 1;
          v_lista := (v_prod ->> 'precio')::numeric;
        end if;
      end if;
    end if;

    if v_pid is null then
      v_faltan := v_faltan + 1;
      v_lineas := v_lineas || jsonb_build_object(
        'n', v_n, 'pidio', v_texto, 'cantidad', v_cant, 'resuelto', false,
        'nota', case when v_texto = '' then 'La línea vino sin producto.'
                     else 'No encontré «' || v_texto || '» sin dudas. Si no existe, crealo con crear_producto o pedí el SKU.' end);
    else
      -- El precio: el que mandaron (del Excel, de la oferta) manda; si no, el
      -- que se le cobró a ESTE cliente; si nunca compró, el de lista.
      if v_pedido is not null and v_pedido >= 0 then
        v_precio := v_pedido; v_origen := 'indicado';
      else
        select ultimo_precio into v_precio from public.ultimo_precio_cliente(v_cli, v_pid) limit 1;
        if v_precio is not null then v_origen := 'último a este cliente';
        else v_precio := coalesce(v_lista, 0); v_origen := 'lista'; end if;
      end if;

      v_lineas := v_lineas || jsonb_build_object(
        'n', v_n, 'cantidad', v_cant, 'resuelto', true,
        'product_id', v_pid, 'sku', v_sku, 'nombre', v_nombre,
        'precio', v_precio, 'origen_precio', v_origen, 'descuento', v_desc,
        'disponible', coalesce((select disponible from app.stock_de(v_pid)), 0))
        || case when upper(v_texto) <> upper(coalesce(v_sku, '')) then jsonb_build_object('pidio', v_texto) else '{}'::jsonb end;
    end if;
  end loop;

  return jsonb_build_object(
    'listo_para_confirmar', v_faltan = 0,
    'cliente', jsonb_build_object('id', v_cli, 'nombre', v_cli_nom),
    'moneda', v_moneda,
    'lineas', v_lineas,
    'renglones', v_n,
    'sin_resolver', v_faltan,
    'total', (select coalesce(round(sum((x ->> 'cantidad')::numeric * (x ->> 'precio')::numeric
                                         * (1 - coalesce((x ->> 'descuento')::numeric, 0) / 100)), 2), 0)
                from jsonb_array_elements(v_lineas) x where (x ->> 'resuelto')::boolean),
    'nota', case
      when v_faltan > 0 then
        'NO está lista: ' || v_faltan || ' línea(s) sin resolver. Decile a la persona cuáles son y '
        || 'pedile el SKU, o creá el producto con crear_producto si no existe. No inventes el producto.'
      else
        'Está lista. «total» es neto, sin IVA. Resumí a quién es, cuántos renglones y el total, y '
        || 'pedí confirmación antes de crearla.' end);
end $function$;

-- ── a/d/e. crear (cambia la firma: drop explícito, si no queda una sobrecarga) ──
drop function if exists public.asistente_crear_cotizacion(uuid, text, jsonb, text);

create function public.asistente_crear_cotizacion(
  p_company uuid, p_cliente text, p_productos jsonb, p_moneda text default null,
  p_referencia_externa text default null, p_titulo text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $function$
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
  v_ref     text := app.normalizar_referencia(p_referencia_externa);
begin
  select cm.role into v_rol
    from public.company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = p_company and cm.status = 'active'
   limit 1;
  if v_rol is null then
    return jsonb_build_object('error', 'Esa empresa no es tuya.');
  end if;
  if v_rol not in ('admin', 'employee') then
    return jsonb_build_object('error',
      'Tu rol en el ERP no crea cotizaciones. Podés armar el borrador con '
      || 'preparar_cotizacion, mostrárselo, y pedir que la confirme alguien con rol de '
      || 'administrador o de empleado.');
  end if;

  -- e. La referencia ya está: ni se crea otra ni se resuelve nada. Puede ser
  -- una creada antes con esa referencia, o la misma que ya importó la sync.
  if v_ref is not null then
    select q.id, q.number, q.total, q.status into v_previa
      from public.sales_quotes q
     where q.company_id = p_company and (q.external_ref = v_ref or upper(q.number) = v_ref)
     order by (q.external_ref = v_ref) desc nulls last
     limit 1;
    if v_previa.id is not null then
      return jsonb_build_object(
        'ya_existia', true, 'id', v_previa.id, 'numero', v_previa.number,
        'estado', v_previa.status, 'total', v_previa.total, 'referencia_externa', v_ref,
        'nota', 'Ya hay una cotización para ' || v_ref || ' (' || v_previa.number || '), así que NO '
                || 'se creó otra. Abrila con ver_documento. Si de verdad hace falta otra, que se haga desde el ERP.');
    end if;
  end if;

  v_borr := public.asistente_preparar_cotizacion(p_company, p_cliente, p_productos, p_moneda);
  if v_borr ? 'error' then
    return v_borr;
  end if;
  if not coalesce((v_borr ->> 'listo_para_confirmar')::boolean, false) then
    return jsonb_build_object(
      'error', 'No la creé: hay renglones sin resolver.',
      'sin_resolver', v_borr -> 'sin_resolver',
      -- Sólo los que faltan: con 82 renglones, la lista entera no entra.
      'faltan', (select jsonb_agg(x) from jsonb_array_elements(v_borr -> 'lineas') x
                  where not coalesce((x ->> 'resuelto')::boolean, false)),
      'nota', 'Decile a la persona CUÁLES son y pedile el SKU, o creá el producto con '
              || 'crear_producto. No elijas un producto parecido para completar.');
  end if;

  v_cli    := (v_borr -> 'cliente' ->> 'id')::uuid;
  v_nombre := v_borr -> 'cliente' ->> 'nombre';
  v_moneda := v_borr ->> 'moneda';
  v_total  := (v_borr ->> 'total')::numeric;

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
        'discount_pct',      coalesce((v_l ->> 'descuento')::numeric, 0),
        'tax_treatment',     'vat_21',
        'tax_rate_snapshot', 21);
    end if;
  end loop;

  if v_n = 0 then
    return jsonb_build_object('error', 'El borrador quedó sin ningún renglón para cotizar.');
  end if;

  -- Sin referencia, la huella de siempre: un reintento en 10 minutos no crea otra.
  if v_ref is null then
    select q.id, q.number, q.total, q.status into v_previa
      from public.sales_quotes q
     where q.company_id = p_company and q.customer_id = v_cli and q.currency_code = v_moneda
       and q.created_by = auth.uid() and q.subtotal = v_total
       and q.created_at > now() - interval '10 minutes'
       and (select count(*) from public.sales_quote_lines l where l.quote_id = q.id) = v_n
     order by q.created_at desc
     limit 1;
    if v_previa.id is not null then
      return jsonb_build_object(
        'ya_existia', true, 'id', v_previa.id, 'numero', v_previa.number, 'estado', v_previa.status,
        'cliente', v_nombre, 'moneda', v_moneda, 'total', v_previa.total, 'renglones', v_n,
        'nota', 'Esta cotización ya estaba creada hace un momento, así que NO se creó una '
                || 'segunda. Decile el número.');
    end if;
  end if;

  v_res := public.crear_cotizacion(
    p_company,
    jsonb_build_object(
      'customer_id',   v_cli,
      'currency_code', v_moneda,
      'title',         coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), 'Cotización para ' || v_nombre),
      'notes',         'Creada con el asistente (MCP).'
                       || case when v_ref is not null then ' Referencia: ' || v_ref || '.' else '' end),
    v_lineas);

  if v_ref is not null then
    update public.sales_quotes set external_ref = v_ref where id = (v_res ->> 'id')::uuid;
  end if;

  return jsonb_build_object(
    'creada',   true,
    'id',       v_res ->> 'id',
    'numero',   v_res ->> 'number',
    -- d. Nace en borrador: no se envió a nadie.
    'estado',   'draft',
    'cliente',  v_nombre,
    'moneda',   v_moneda,
    'neto',     v_total,
    'total',    (v_res ->> 'total')::numeric,
    'renglones', v_n,
    'referencia_externa', v_ref,
    'nota', 'Creada en BORRADOR. «neto» es sin IVA y «total» ya lo incluye. Decile el número y el '
            || 'total; se puede revisar con ver_documento o abrir en el ERP para enviarla.');
end
$function$;

grant execute on function public.asistente_crear_cotizacion(uuid, text, jsonb, text, text, text) to authenticated, service_role;
revoke execute on function public.asistente_crear_cotizacion(uuid, text, jsonb, text, text, text) from anon, public;

-- ── d. ver_documento también por referencia externa ──────────────────────────
create or replace function public.asistente_ver_documento(p_company uuid, p_numero text)
returns jsonb language plpgsql stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_num text := upper(btrim(coalesce(p_numero, '')));
  v_id uuid; v_tipo text; v_cadena jsonb; v_cab jsonb; v_lin jsonb;
begin
  if v_num = '' then return jsonb_build_object('error', 'Falta el número del documento.'); end if;

  select id, tipo into v_id, v_tipo from (
    select id, 'cotizacion' as tipo, upper(number) as n from sales_quotes   where company_id = p_company
    union all select id, 'pedido',        upper(number) from sales_orders    where company_id = p_company
    union all select id, 'factura',       upper(number) from sales_invoices  where company_id = p_company
    union all select id, 'pedido_compra', upper(number) from purchase_orders where company_id = p_company
    union all select id, 'recepcion',     upper(number) from goods_receipts  where company_id = p_company
  ) t where n = v_num limit 1;

  -- Fase 243: «STEL COV00748» encuentra la cotización cargada con esa referencia.
  if v_id is null then
    select q.id, 'cotizacion' into v_id, v_tipo from sales_quotes q
     where q.company_id = p_company and q.external_ref = app.normalizar_referencia(p_numero) limit 1;
  end if;

  if v_id is null then
    return jsonb_build_object('error',
      'No existe ningún documento con el número «' || p_numero || '».');
  end if;

  if v_tipo = 'cotizacion' then
    select jsonb_build_object('numero', q.number, 'fecha', q.quote_date, 'estado', q.status,
             'moneda', q.currency_code, 'neto', q.subtotal, 'total', q.total, 'titulo', q.title,
             'referencia_externa', q.external_ref,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = q.customer_id))
      into v_cab from sales_quotes q where q.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price, 'descuento', l.discount_pct) order by l.line_no)
      into v_lin from sales_quote_lines l where l.quote_id = v_id;

  elsif v_tipo = 'pedido' then
    select jsonb_build_object('numero', o.number, 'fecha', o.order_date, 'estado', o.commercial_status,
             'moneda', o.currency_code, 'total', o.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = o.customer_id))
      into v_cab from sales_orders o where o.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity_ordered, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from sales_order_lines l where l.order_id = v_id;

  elsif v_tipo = 'factura' then
    select jsonb_build_object('numero', f.number, 'fecha', f.invoice_date, 'estado', f.status,
             'moneda', f.currency_code, 'total', f.total,
             'cliente', (select coalesce(c.trade_name, c.legal_name) from customers c where c.id = f.customer_id))
      into v_cab from sales_invoices f where f.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.created_at)
      into v_lin from sales_invoice_lines l where l.invoice_id = v_id;

  elsif v_tipo = 'pedido_compra' then
    select jsonb_build_object('numero', p.number) into v_cab from purchase_orders p where p.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity, 'precio_unitario', l.unit_price) order by l.line_no)
      into v_lin from purchase_order_lines l where l.purchase_order_id = v_id;

  else
    select jsonb_build_object('numero', g.number) into v_cab from goods_receipts g where g.id = v_id;
    select jsonb_agg(jsonb_build_object('sku', l.sku_snapshot, 'producto', l.name_snapshot,
             'cantidad', l.quantity) order by l.created_at)
      into v_lin from goods_receipt_lines l where l.goods_receipt_id = v_id;
  end if;

  begin
    v_cadena := public.cadena_de_documento(v_tipo, v_id);
  exception when others then v_cadena := null;
  end;

  return jsonb_build_object('tipo', v_tipo, 'numero', coalesce(v_cab ->> 'numero', v_num),
    'cabecera', v_cab, 'lineas', coalesce(v_lin, '[]'::jsonb), 'cadena', v_cadena);
end $function$;

-- ── b. crear_producto ────────────────────────────────────────────────────────
create or replace function public.asistente_crear_producto(
  p_company uuid, p_sku text, p_nombre text, p_marca text default null,
  p_precio_lista numeric default null, p_moneda text default null)
returns jsonb language plpgsql
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_rol    text;
  v_sku    text := btrim(coalesce(p_sku, ''));
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_marca  text := nullif(btrim(coalesce(p_marca, '')), '');
  v_previo record;
  v_cat    uuid;
  v_brand  uuid;
  v_lista_moneda text;
  v_moneda text := nullif(upper(btrim(coalesce(p_moneda, ''))), '');
  v_id     uuid;
begin
  select cm.role into v_rol from public.company_memberships cm
   where cm.user_id = auth.uid() and cm.company_id = p_company and cm.status = 'active' limit 1;
  if v_rol is null then return jsonb_build_object('error', 'Esa empresa no es tuya.'); end if;
  if v_rol not in ('admin', 'employee') then
    return jsonb_build_object('error', 'Tu rol en el ERP no da de alta productos.');
  end if;
  if v_sku = '' then return jsonb_build_object('error', 'Falta el SKU.'); end if;
  if v_nombre = '' then return jsonb_build_object('error', 'Falta el nombre del producto.'); end if;
  if p_precio_lista is not null and p_precio_lista <= 0 then
    return jsonb_build_object('error', 'El precio de lista tiene que ser mayor que cero.');
  end if;

  -- Duplicados por SKU, sin distinguir mayúsculas e incluyendo los dados de baja.
  select p.id, p.sku, p.name, p.deleted_at, (select importe from app.precio_de_lista(p_company, p.id)) as precio
    into v_previo
    from products p
   where p.company_id = p_company and upper(p.sku) = upper(v_sku)
   order by p.deleted_at nulls first
   limit 1;
  if v_previo.id is not null then
    return jsonb_build_object(
      'ya_existia', true, 'sku', v_previo.sku, 'nombre', v_previo.name, 'precio_lista', v_previo.precio,
      'dado_de_baja', v_previo.deleted_at is not null,
      'nota', case when v_previo.deleted_at is not null
                then 'Ese SKU existe pero está dado de baja: NO se creó otro. Que lo reactiven desde el ERP.'
                else 'Ese SKU ya existe: NO se creó otro. Usalo tal cual en la cotización.' end);
  end if;

  select pl.currency_code into v_lista_moneda from price_lists pl
   where pl.company_id = p_company and pl.is_default limit 1;
  if p_precio_lista is not null and v_moneda is not null and v_lista_moneda is distinct from v_moneda then
    return jsonb_build_object('error',
      'La lista de precios de esta empresa está en ' || coalesce(v_lista_moneda, '(sin lista)') || ', no en '
      || v_moneda || '. Pasá el precio en ' || coalesce(v_lista_moneda, 'la moneda de la lista') || ' o sin precio.');
  end if;

  -- Nace en el rubro de revisión, como lo que crea la sync: alguien lo clasifica después.
  select pc.id into v_cat from product_categories pc
   where pc.company_id = p_company and pc.name ilike 'Pendiente de clasificaci%' limit 1;
  if v_cat is null then
    return jsonb_build_object('error', 'Esta empresa no tiene el rubro «Pendiente de clasificación»: dalo de alta desde el ERP.');
  end if;

  -- La marca: si es una de las de herramienta, por id; si no, como texto (marca_disp).
  if v_marca is not null then
    select b.id into v_brand from brands b
     where b.company_id = p_company and upper(btrim(b.name)) = upper(v_marca) limit 1;
  end if;

  insert into products (company_id, sku, name, category_id, brand_id, attributes, status, needs_review)
  values (p_company, v_sku, v_nombre, v_cat, v_brand,
          case when v_marca is not null and v_brand is null then jsonb_build_object('marca_disp', v_marca) else '{}'::jsonb end,
          'active', true)
  returning id into v_id;

  if p_precio_lista is not null then
    perform public.erp_cargar_datos_comerciales(p_company, v_id, null, null, p_precio_lista, null);
  end if;

  return jsonb_build_object(
    'creado', true, 'sku', v_sku, 'nombre', v_nombre, 'marca', v_marca,
    'precio_lista', p_precio_lista, 'moneda', v_lista_moneda,
    'nota', 'Creado en el rubro «Pendiente de clasificación» y marcado para revisar. Ya se puede usar por su SKU en una cotización.');
end
$function$;

grant execute on function public.asistente_crear_producto(uuid, text, text, text, numeric, text) to authenticated, service_role;
revoke execute on function public.asistente_crear_producto(uuid, text, text, text, numeric, text) from anon, public;
