-- Fase 187 — alta de empresas desde la interfaz (botón del selector, sólo admins)
--
-- POR QUÉ UNA RPC Y NO INSERTS SUELTOS
--
-- Crear una empresa no es una fila: es la empresa, su juego de series de
-- numeración, una lista de precios por defecto, un depósito y la membresía de
-- quien la crea. Todo eso tiene que pasar junto o no pasar: media empresa (sin
-- series, sin depósito) rompe en cuanto alguien intenta cotizar o mover stock.
-- Por eso va en una sola función transaccional.
--
-- Además, el navegador NO puede escribir estas tablas: la RLS no deja insertar
-- en `companies`, `document_sequences`, etc. Esta función es SECURITY DEFINER
-- —corre como dueña, saltea RLS— y por eso hace su propio control de permiso
-- ANTES de tocar nada: sólo un administrador activo (de cualquier empresa) crea
-- empresas. El mismo criterio que muestra el botón en el frontend, pero acá es
-- el que manda.
--
-- EL MOLDE ES TORQUETOOLS. Las 11 series (CLI, PROV, COTI, PDV, RT, FAC, PC,
-- NTEP, FP, OS, EQ), la lista «Lista base» y el «Depósito principal / PRIN» son
-- los que ya tienen Buscatools y Torquetools. La única diferencia a propósito:
-- la serie de facturas arranca en `FAC` y no en `FAC-BTS` (ese sufijo era un
-- resto del clon de Torquetools, no algo deseado).
--
-- LO QUE NO SE SIEMBRA, Y POR QUÉ. Nada de productos, rubros ni atributos: son
-- empresas nuevas, su catálogo lo arma cada una. Nada de `document_numbering_
-- authority`: sin fila, `app.autoridad_efectiva` ya devuelve 'ERP', que es lo
-- correcto para una empresa que nace en el ERP. Nada de `role_capabilities`: el
-- admin tiene todo siempre; los permisos de los demás roles se configuran
-- cuando se suman.

create or replace function public.config_crear_empresa(p_nombre text, p_moneda text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_moneda text := upper(btrim(coalesce(p_moneda, '')));
  v_base   text;
  v_slug   text;
  v_n      int := 1;
  v_company uuid;
begin
  -- 1 · identidad
  if v_actor is null then
    raise exception 'sesion_invalida';
  end if;

  -- 2 · permiso: sólo un administrador activo crea empresas. Ser admin en UNA
  --     empresa alcanza —crear una empresa no es una acción de ninguna empresa
  --     en particular—, pero algo hay que ser.
  if not exists (
    select 1 from company_memberships
    where user_id = v_actor and role = 'admin' and status = 'active'
  ) then
    raise exception 'sin_permiso';
  end if;

  -- 3 · datos
  if v_nombre = '' or length(v_nombre) > 120 then
    raise exception 'nombre_invalido';
  end if;
  if v_moneda not in ('ARS', 'USD', 'EUR') then
    raise exception 'moneda_invalida';
  end if;

  -- 4 · slug único (el nombre se conserva tal cual; sólo el slug se desambigua)
  v_base := app.slugificar(v_nombre);
  if v_base = '' then
    raise exception 'nombre_invalido';
  end if;
  v_slug := v_base;
  while exists (select 1 from companies where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  -- 5 · la empresa (catálogo público apagado; apariencia por defecto)
  insert into companies (slug, name, default_currency, is_active, catalogo_publico)
  values (v_slug, v_nombre, v_moneda, true, false)
  returning id into v_company;

  -- 6 · numeración: el mismo juego de series que las demás empresas, desde 1
  insert into document_sequences (company_id, doc_type, prefix, padding, next_number, series_code, is_default, is_selectable)
  values
    (v_company, 'customer',          'CLI',  5,  1, 'CLI',  true, true),
    (v_company, 'supplier',          'PROV', 5,  1, 'PROV', true, true),
    (v_company, 'quote',             'COTI', 5,  1, 'COTI', true, true),
    (v_company, 'sales_order',       'PDV',  5,  1, 'PDV',  true, true),
    (v_company, 'delivery',          'RT',   10, 1, 'RT',   true, true),
    (v_company, 'sales_invoice',     'FAC',  5,  1, 'FAC',  true, true),
    (v_company, 'purchase_order',    'PC',   5,  1, 'PC',   true, true),
    (v_company, 'goods_receipt',     'NTEP', 5,  1, 'NTEP', true, true),
    (v_company, 'supplier_invoice',  'FP',   5,  1, 'FP',   true, true),
    (v_company, 'maintenance_order', 'OS',   5,  1, 'OS',   true, true),
    (v_company, 'maintenance_asset', 'EQ',   5,  1, 'EQ',   true, true);

  -- 7 · lista de precios por defecto, en la moneda de la empresa
  insert into price_lists (company_id, name, currency_code, is_default)
  values (v_company, 'Lista base', v_moneda, true);

  -- 8 · depósito por defecto (stock, remitos y recepciones lo esperan)
  insert into warehouses (company_id, code, name, is_default, is_active)
  values (v_company, 'PRIN', 'Depósito principal', true, true);

  -- 9 · quien la crea queda como administrador activo
  insert into company_memberships (user_id, company_id, role, status)
  values (v_actor, v_company, 'admin', 'active');

  return jsonb_build_object('company_id', v_company, 'slug', v_slug, 'name', v_nombre, 'moneda', v_moneda);
end;
$$;

revoke all on function public.config_crear_empresa(text, text) from public;
grant execute on function public.config_crear_empresa(text, text) to authenticated;
