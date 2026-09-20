-- =====================================================================
-- Fase 19 · E3 — Serie explícita en `crear_cotizacion`
--
--   *** PREPARADO, NO EJECUTADO. Requiere aprobación. ***
--
-- Qué habilita: `crear_cotizacion(..., p_cabecera = {..., "series_code": "COT-ERP"})`.
--
-- Qué NO cambia: nada del comportamiento cuando `series_code` no viene, ni los
-- permisos, ni la autoridad, ni `is_default`, ni las secuencias, ni ninguna de
-- las dos tablas de autoridad.
--
-- Contexto: `public.crear_cotizacion` (el prompt la llamó `app.crear_cotizacion`;
-- vive en `public`, con `search_path = public, app, pg_temp`).
-- =====================================================================


-- ── PASO 0 · INVARIANTES PREVIAS (correr ANTES; si alguna falla, STOP) ──
--
-- Esperado: STEL · sin fila (cae a STEL) · ERP · 2630 · 1

select 'authority general quote' k,
       (select authority from document_numbering_authority
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and doc_type='quote') v
union all select 'serie quote/COTI',
       coalesce((select authority from document_numbering_authority_series
                  where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
                    and doc_type='quote' and series_code='COTI'),
                'sin fila: cae a la general (STEL)')
union all select 'serie quote/COT-ERP',
       (select authority from document_numbering_authority_series
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
           and doc_type='quote' and series_code='COT-ERP')
union all select 'secuencia COTI',
       (select next_number::text from document_sequences
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
           and doc_type='quote' and series_code='COTI')
union all select 'secuencia COT-ERP',
       (select next_number::text from document_sequences
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c'
           and doc_type='quote' and series_code='COT-ERP');


-- ── EL DIFF, EN PALABRAS ────────────────────────────────────────────────
--
-- Son tres puntos y nada más. Todo el resto de la función queda IDÉNTICO.
--
-- 1. `k_permitidos` suma 'series_code'.
--
-- 2. Se declara `v_serie_pedida text;` y el bloque que resolvía la serie:
--
--      select ds.series_code into v_serie
--        from document_sequences ds
--       where ds.company_id = p_company and ds.doc_type = 'quote' and ds.is_default;
--      if v_serie is null then
--        raise exception 'SIN_SERIE' using errcode = '42704';
--      end if;
--
--    pasa a distinguir los dos casos, PINCHANDO SIEMPRE empresa y doc_type
--    en el `where` —que es lo que hace imposible tomar una serie de otra
--    empresa o de otro tipo de documento—.
--
-- 3. `next_document_number(p_company, 'quote', '')`
--    pasa a `next_document_number(p_company, 'quote', v_serie)`.
--
--    Esto además corrige una inconsistencia que ya existía: hoy el NÚMERO lo
--    da la serie que `next_document_number` resuelve por `is_default`, y el
--    `series_code` que se GUARDA lo resolvió antes esta función por su cuenta.
--    Son dos lecturas distintas de lo mismo; pasando la serie ya resuelta,
--    el número y lo guardado salen por fuerza de la misma serie.


-- ── PASO 1 · LA FUNCIÓN PROPUESTA, COMPLETA ─────────────────────────────

create or replace function public.crear_cotizacion(
  p_company uuid,
  p_cabecera jsonb,
  p_lineas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $fn$
declare
  k_permitidos constant text[] := array[
    'customer_id', 'contact_id', 'quote_date', 'title', 'salesperson_id',
    'payment_terms', 'currency_code', 'price_list_id', 'notes',
    'valid_until', 'exchange_rate', 'discount_pct', 'perception_pct',
    -- Fase 19 · E3: la serie se puede pedir explícitamente. Si no viene, se
    -- usa la de siempre y no cambia nada.
    'series_code'
  ];

  v_rol           text;
  v_campo         text;
  v_customer      uuid;
  v_contact       uuid;
  v_moneda        text;
  v_lista         uuid;
  v_vendedor      uuid;
  v_lista_moneda  text;
  v_fecha         date;
  v_serie_pedida  text;
  v_serie         text;
  v_numero        text;
  v_q             sales_quotes%rowtype;
  v_l             jsonb;
  v_n             int := 0;
  v_lineas        jsonb := '[]'::jsonb;
begin
  if p_company is null then
    raise exception 'EMPRESA_REQUERIDA' using errcode = '22023';
  end if;
  select cm.role into v_rol
    from company_memberships cm
   where cm.user_id = auth.uid()
     and cm.company_id = p_company
     and cm.status = 'active'
   limit 1;
  if v_rol is null or v_rol not in ('admin', 'employee') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if p_cabecera is null or jsonb_typeof(p_cabecera) <> 'object' then
    raise exception 'CABECERA_INVALIDA' using errcode = '22023';
  end if;
  for v_campo in select jsonb_object_keys(p_cabecera) loop
    if not (v_campo = any (k_permitidos)) then
      raise exception 'CAMPO_NO_PERMITIDO' using errcode = '42501', detail = v_campo;
    end if;
  end loop;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'LINEAS_INVALIDAS' using errcode = '22023';
  end if;

  v_customer := nullif(p_cabecera->>'customer_id', '')::uuid;
  v_contact  := nullif(p_cabecera->>'contact_id', '')::uuid;
  v_moneda   := nullif(p_cabecera->>'currency_code', '');
  v_lista    := nullif(p_cabecera->>'price_list_id', '')::uuid;
  v_vendedor := nullif(p_cabecera->>'salesperson_id', '')::uuid;
  if v_moneda is null then
    raise exception 'DOCUMENT_CURRENCY_REQUIRED' using errcode = '22023';
  end if;
  if v_customer is null then
    raise exception 'CLIENTE_REQUERIDO' using errcode = '22023';
  end if;
  v_fecha := coalesce(nullif(p_cabecera->>'quote_date', '')::date,
                      (now() at time zone 'America/Argentina/Buenos_Aires')::date);

  if not exists (select 1 from customers c
                  where c.id = v_customer and c.company_id = p_company and c.deleted_at is null) then
    raise exception 'CLIENTE_INVALIDO' using errcode = '42501';
  end if;

  if v_contact is not null
     and not exists (select 1 from customer_contacts cc
                      where cc.id = v_contact
                        and cc.customer_id = v_customer
                        and cc.company_id = p_company) then
    raise exception 'CONTACTO_DE_OTRO_CLIENTE' using errcode = '42501';
  end if;

  if v_vendedor is not null
     and not exists (select 1 from company_memberships cm
                      where cm.user_id = v_vendedor
                        and cm.company_id = p_company
                        and cm.status = 'active') then
    raise exception 'VENDEDOR_INVALIDO' using errcode = '42501';
  end if;

  if v_lista is not null then
    select pl.currency_code into v_lista_moneda
      from price_lists pl where pl.id = v_lista and pl.company_id = p_company;
    if v_lista_moneda is null then
      raise exception 'TARIFA_INVALIDA' using errcode = '42501';
    end if;
    if v_lista_moneda is distinct from v_moneda then
      raise exception 'TARIFA_OTRA_MONEDA' using errcode = '42501',
        detail = format('la lista esta en %s y el documento en %s', v_lista_moneda, v_moneda);
    end if;
  end if;

  -- ── Serie ──────────────────────────────────────────────────────────────
  -- Sin `series_code`: exactamente lo de antes, la serie marcada por defecto.
  -- Con `series_code`: esa y sólo esa, y tiene que existir PARA ESTA EMPRESA
  -- y PARA ESTE TIPO — las dos condiciones van en el `where`, así que una
  -- serie de otra empresa o de otro doc_type simplemente no aparece y cae en
  -- SERIE_INVALIDA.
  --
  -- Lo que esto NO hace: no crea series, no cambia `is_default` y no mira la
  -- autoridad. La autoridad la siguen exigiendo `next_document_number` y el
  -- trigger `guardar_autoridad_numeracion`, cada uno por su lado.
  v_serie_pedida := nullif(btrim(coalesce(p_cabecera->>'series_code', '')), '');

  if v_serie_pedida is null then
    select ds.series_code into v_serie
      from document_sequences ds
     where ds.company_id = p_company and ds.doc_type = 'quote' and ds.is_default;
    if v_serie is null then
      raise exception 'SIN_SERIE' using errcode = '42704';
    end if;
  else
    select ds.series_code into v_serie
      from document_sequences ds
     where ds.company_id = p_company
       and ds.doc_type = 'quote'
       and ds.series_code = v_serie_pedida;
    if v_serie is null then
      raise exception 'SERIE_INVALIDA' using errcode = '42501', detail = v_serie_pedida;
    end if;
  end if;

  -- La serie YA resuelta, no la cadena vacía: así el número y el `series_code`
  -- que se guarda salen por fuerza de la misma serie.
  v_numero := next_document_number(p_company, 'quote', v_serie);

  insert into sales_quotes (
    company_id, number, series_code, status,
    customer_id, contact_id, salesperson_id, price_list_id,
    quote_date, valid_until, title, currency_code, exchange_rate,
    payment_terms, notes, discount_pct, perception_pct, created_by, updated_by
  ) values (
    p_company, v_numero, v_serie, 'draft',
    v_customer, v_contact, v_vendedor, v_lista,
    v_fecha, nullif(p_cabecera->>'valid_until', '')::date,
    nullif(btrim(coalesce(p_cabecera->>'title', '')), ''), v_moneda,
    nullif(p_cabecera->>'exchange_rate', '')::numeric,
    nullif(btrim(coalesce(p_cabecera->>'payment_terms', '')), ''),
    nullif(btrim(coalesce(p_cabecera->>'notes', '')), ''),
    coalesce(nullif(p_cabecera->>'discount_pct', '')::numeric, 0),
    coalesce(nullif(p_cabecera->>'perception_pct', '')::numeric, 0),
    auth.uid(), auth.uid()
  ) returning * into v_q;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_n := v_n + 1;

    if coalesce((v_l->>'quantity')::numeric, 0) = 0 then
      raise exception 'CANTIDAD_INVALIDA' using errcode = '22023';
    end if;
    if coalesce((v_l->>'discount_pct')::numeric, 0) < 0
       or coalesce((v_l->>'discount_pct')::numeric, 0) > 100 then
      raise exception 'DESCUENTO_INVALIDO' using errcode = '22023';
    end if;
    if coalesce((v_l->>'unit_price')::numeric, 0) < 0 then
      raise exception 'PRECIO_INVALIDO' using errcode = '22023';
    end if;
    if nullif(v_l->>'product_id', '') is not null
       and not exists (select 1 from products p
                        where p.id = (v_l->>'product_id')::uuid and p.company_id = p_company) then
      raise exception 'PRODUCTO_INVALIDO' using errcode = '42501';
    end if;

    insert into sales_quote_lines (
      company_id, quote_id, line_no, line_type, product_id,
      sku_snapshot, name_snapshot, description_snapshot, brand_snapshot,
      quantity, unit_price, list_price_snapshot, discount_pct,
      tax_treatment, tax_rate_snapshot
    ) values (
      p_company, v_q.id, v_n,
      coalesce(v_l->>'line_type', 'item'),
      nullif(v_l->>'product_id', '')::uuid,
      nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''),
      nullif(v_l->>'description_snapshot', ''), nullif(v_l->>'brand_snapshot', ''),
      (v_l->>'quantity')::numeric,
      coalesce((v_l->>'unit_price')::numeric, 0),
      nullif(v_l->>'list_price_snapshot', '')::numeric,
      coalesce((v_l->>'discount_pct')::numeric, 0),
      coalesce(v_l->>'tax_treatment', 'vat_21'),
      coalesce((v_l->>'tax_rate_snapshot')::numeric, 0)
    );

    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'accion', 'agregada', 'linea', v_n,
      'producto', coalesce(nullif(v_l->>'sku_snapshot', ''), nullif(v_l->>'name_snapshot', ''), 's/d'),
      'cantidad', (v_l->>'quantity')::numeric,
      'precio', coalesce((v_l->>'unit_price')::numeric, 0)));
  end loop;

  select * into v_q from sales_quotes where id = v_q.id;

  perform registrar_evento_venta(
    'sales_quote', v_q.id, 'created', null, v_q.status,
    jsonb_build_object(
      'numero', v_q.number,
      'customer_id', v_q.customer_id,
      'contact_id', v_q.contact_id,
      'salesperson_id', v_q.salesperson_id,
      'price_list_id', v_q.price_list_id,
      'quote_date', v_q.quote_date,
      'valid_until', v_q.valid_until,
      'title', v_q.title,
      'currency_code', v_q.currency_code,
      'exchange_rate', v_q.exchange_rate,
      'payment_terms', v_q.payment_terms,
      'discount_pct', v_q.discount_pct,
      'perception_pct', v_q.perception_pct,
      -- Fase 19 · E3: la serie queda en la traza del alta. Antes no estaba
      -- porque no se podía elegir.
      'series_code', v_q.series_code,
      'lineas', v_lineas,
      'total', v_q.total));

  return jsonb_build_object(
    'id', v_q.id,
    'number', v_q.number,
    'total', v_q.total,
    'updated_at', v_q.updated_at,
    'lineas', v_n
  );
end;
$fn$;


-- ── PASO 2 · LA LECTURA PARA EL SELECTOR (objeto NUEVO, a decidir) ──────
--
-- OJO: esto NO es parte de «las tres líneas». Es un segundo objeto, y hace
-- falta porque `document_sequences` **no es legible desde el navegador**: no
-- tiene grant para `authenticated` ni ninguna policy. Sin esto no hay forma de
-- listar las series en la pantalla.
--
-- Se modela exactamente igual que las dos RPC de autoridad que ya existen
-- (`autoridad_numeracion_empresa`, `autoridad_numeracion_series`): sólo
-- lectura, `security definer`, con la MISMA puerta —`current_internal_company_ids()`—
-- y `execute` sólo para `authenticated`. No amplía lo que alguien puede ver:
-- devuelve la configuración de SU empresa, que esas dos ya devuelven en parte.

create or replace function public.series_de_documento(p_company uuid, p_doc_type text)
returns table (series_code text, is_default boolean, authority text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  return query
  select ds.series_code,
         ds.is_default,
         -- La autoridad EFECTIVA de esa serie: la de la serie si tiene fila,
         -- si no la general, y si no hay ninguna, ERP. Es la misma regla que
         -- `app.autoridad_efectiva`, que no se puede llamar desde acá porque
         -- toma `for share` y esta función es `stable`.
         coalesce(s.authority, a.authority, 'ERP') as authority
    from document_sequences ds
    left join document_numbering_authority_series s
           on s.company_id = ds.company_id
          and s.doc_type = ds.doc_type
          and s.series_code = ds.series_code
    left join document_numbering_authority a
           on a.company_id = ds.company_id
          and a.doc_type = ds.doc_type
   where ds.company_id = p_company
     and ds.doc_type = p_doc_type
   order by ds.is_default desc, ds.series_code;
end;
$fn$;

comment on function public.series_de_documento(uuid, text) is
  'Las series configuradas para un tipo de documento, con su autoridad efectiva. Solo lectura, para el selector de serie del alta. Misma puerta que autoridad_numeracion_series: roles internos de la propia empresa.';

revoke all on function public.series_de_documento(uuid, text) from public, anon;
grant execute on function public.series_de_documento(uuid, text) to authenticated;


-- ── PASO 3 · VERIFICACIÓN POSTERIOR (sin crear ningún documento) ────────

-- a) Lo que no se tocó
select 'authority general quote' k,
       (select authority from document_numbering_authority
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and doc_type='quote') v
union all select 'secuencia COTI',
       (select next_number::text from document_sequences
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and doc_type='quote' and series_code='COTI')
union all select 'secuencia COT-ERP',
       (select next_number::text from document_sequences
         where company_id='bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c' and doc_type='quote' and series_code='COT-ERP')
union all select 'cotizaciones', (select count(*)::text from sales_quotes)
union all select 'permisos de crear_cotizacion',
       (select proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='crear_cotizacion');

-- b) La whitelist quedó con series_code y con nada más
select array_length(regexp_split_to_array(
         substring(prosrc from 'k_permitidos constant text\[\] := array\[(.*?)\]'), ','), 1) as campos_permitidos
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='crear_cotizacion';


-- ── ROLLBACK ────────────────────────────────────────────────────────────
--
-- 1. `series_de_documento`: `drop function public.series_de_documento(uuid, text);`
--    Sin riesgo mientras la interfaz no la use.
--
-- 2. `crear_cotizacion`: volver a la versión de hoy. Este archivo conserva el
--    cuerpo actual completo en `docs/AUDITORIA_VENTAS.md` §11, y el `create or
--    replace` de vuelta es inmediato. Los documentos ya creados con una serie
--    explícita NO se ven afectados: la serie quedó guardada en la fila.
--
-- Importante: si se revierte la RPC con la interfaz todavía mandando
-- `series_code`, el alta falla con CAMPO_NO_PERMITIDO. Primero la interfaz,
-- después la función.
