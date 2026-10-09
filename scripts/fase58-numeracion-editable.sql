-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fase 58 · E3 — Numeración editable                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EL PEDIDO. «Lo de numeración hacerlo más acotado y hacer que yo lo pueda
-- modificar, que pueda agregar otras numeraciones si quiero, si quiero
-- modificar las que están ya».
--
-- POR QUÉ ERA DE SÓLO LECTURA Y POR QUÉ YA NO TIENE QUE SERLO. La pantalla se
-- escribió cuando STEL emitía: con `authority = 'STEL'` la base bloquea la
-- emisión desde el ERP y alinear la numeración era una decisión de cutover, no
-- un formulario. Hoy las 25 secuencias de las dos empresas están en ERP —ni una
-- fila dice STEL— así que el cartel «sólo lectura» quedó viejo.
--
-- Igual la autoridad se sigue respetando: si alguna vez vuelve a haber un tipo
-- en STEL, estas funciones lo rechazan. Editar el próximo número de algo que
-- numera otro sistema no sirve de nada y confundiría.
--
-- EL GUARDA QUE IMPORTA. El próximo número no puede quedar en o por debajo del
-- mayor ya emitido con ese prefijo: emitiría un número repetido. Se calcula con
-- el mismo criterio que el diagnóstico —`^prefijo[0-9]+$` sobre la tabla del
-- tipo de documento— para que la pantalla y la validación no puedan discrepar.
--
-- `document_sequences` NO TIENE POLÍTICAS RLS: sólo se llega por funciones
-- SECURITY DEFINER. Así que estas dos son la única puerta de escritura.

begin;

-- ── El registro ────────────────────────────────────────────────────────────
--
-- Tabla propia: la numeración es justo el dato donde uno quiere poder
-- reconstruir «quién movió el próximo número y a qué», y guarda la fila entera
-- antes y después en vez de una diferencia.

create table if not exists public.document_sequences_audit (
  id          bigserial primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  doc_type    text not null,
  series_code text not null,
  action      text not null check (action in ('CREATED', 'UPDATED', 'DELETED')),
  before      jsonb,
  after       jsonb,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists document_sequences_audit_company_idx
  on public.document_sequences_audit (company_id, created_at desc);

alter table public.document_sequences_audit enable row level security;

drop policy if exists document_sequences_audit_select on public.document_sequences_audit;
create policy document_sequences_audit_select on public.document_sequences_audit
  for select to authenticated
  using (company_id = any (app.current_admin_company_ids()));

grant select on public.document_sequences_audit to authenticated;

-- ── El mayor número ya emitido con un prefijo ──────────────────────────────
--
-- La misma cuenta que hace `config_numeracion_diagnostico`, extraída para que
-- la validación y lo que se muestra no puedan divergir. Si divergieran, la
-- pantalla diría que un número está libre y la base lo rechazaría.

create or replace function app.mayor_numero_emitido(
  p_company uuid, p_doc_type text, p_prefix text
)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_patron text := '^' || p_prefix || '[0-9]{1,18}$';
  v_max bigint;
begin
  with docs as (
    select q.number n from sales_quotes q where q.company_id = p_company and p_doc_type = 'quote'
    union all select o.number from sales_orders o where o.company_id = p_company and p_doc_type = 'sales_order'
    union all select d.number from deliveries d where d.company_id = p_company and p_doc_type = 'delivery'
    union all select cu.legacy_ref from customers cu where cu.company_id = p_company and p_doc_type = 'customer'
    union all select su.legacy_ref from suppliers su where su.company_id = p_company and p_doc_type = 'supplier'
    union all select po.number from purchase_orders po where po.company_id = p_company and p_doc_type = 'purchase_order'
    union all select gr.number from goods_receipts gr where gr.company_id = p_company and p_doc_type = 'goods_receipt'
    union all select si.number from supplier_invoices si where si.company_id = p_company and p_doc_type = 'supplier_invoice'
    union all select ma.reference from maintenance_assets ma where ma.company_id = p_company and p_doc_type = 'maintenance_asset'
    union all select mo.number from maintenance_orders mo where mo.company_id = p_company and p_doc_type = 'maintenance_order'
  )
  select max(substring(d.n from length(p_prefix) + 1)::bigint) into v_max
  from docs d where d.n ~ v_patron;

  return v_max;
end;
$function$;

comment on function app.mayor_numero_emitido(uuid, text, text) is
  'Fase 58 E3: el mayor número ya emitido con ese prefijo. La misma cuenta que el diagnóstico, para que la validación no pueda discrepar de lo que se muestra.';

-- ── Guardar una serie (alta o edición) ─────────────────────────────────────

create or replace function public.config_numeracion_guardar(
  p_company      uuid,
  p_doc_type     text,
  p_series_code  text,
  p_prefix       text,
  p_padding      integer,
  p_next_number  bigint,
  p_is_default   boolean,
  p_is_selectable boolean default true
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_antes jsonb;
  v_mayor bigint;
  v_autoridad text;
  v_accion text;
  v_serie text := upper(btrim(coalesce(p_series_code, '')));
  v_prefijo text := upper(btrim(coalesce(p_prefix, '')));
begin
  if not app.es_admin_activo(auth.uid(), p_company) then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;

  -- Los diez tipos que el diagnóstico sabe contar. Uno fuera de la lista se
  -- guardaría y después nadie podría decir si su próximo número está bien.
  if p_doc_type not in ('quote', 'sales_order', 'delivery', 'customer', 'supplier',
                        'purchase_order', 'goods_receipt', 'supplier_invoice',
                        'maintenance_asset', 'maintenance_order') then
    raise exception 'tipo_invalido' using errcode = 'P0001';
  end if;

  -- La autoridad se sigue respetando aunque hoy todo sea ERP.
  select authority into v_autoridad
  from document_numbering_authority
  where company_id = p_company and doc_type = p_doc_type;

  if coalesce(v_autoridad, 'ERP') <> 'ERP' then
    raise exception 'autoridad_externa' using errcode = 'P0001';
  end if;

  if v_serie = '' or length(v_serie) > 20 then
    raise exception 'serie_invalida' using errcode = 'P0001';
  end if;

  -- Mayúsculas, números y guión: es lo que son las 25 series que ya existen
  -- (CLI, RT-ERP, COT-BTS, FAC-BTS…). Un espacio o un acento dentro de un
  -- prefijo rompería el patrón con el que se reconocen los números emitidos.
  if v_prefijo = '' or length(v_prefijo) > 20 or v_prefijo !~ '^[A-Z0-9][A-Z0-9-]*$' then
    raise exception 'prefijo_invalido' using errcode = 'P0001';
  end if;

  if p_padding is null or p_padding < 0 or p_padding > 20 then
    raise exception 'relleno_invalido' using errcode = 'P0001';
  end if;

  if p_next_number is null or p_next_number < 1 then
    raise exception 'numero_invalido' using errcode = 'P0001';
  end if;

  select to_jsonb(s) into v_antes
  from document_sequences s
  where s.company_id = p_company and s.doc_type = p_doc_type and s.series_code = v_serie;

  v_accion := case when v_antes is null then 'CREATED' else 'UPDATED' end;

  /*
   * EL GUARDA QUE IMPORTA: el próximo número tiene que estar por ENCIMA del
   * mayor ya emitido con ese prefijo, o el ERP emitiría un repetido. Se compara
   * contra el prefijo NUEVO, no el viejo: cambiar el prefijo cambia qué
   * documentos cuentan.
   */
  v_mayor := app.mayor_numero_emitido(p_company, p_doc_type, v_prefijo);

  if v_mayor is not null and p_next_number <= v_mayor then
    raise exception 'numero_ocupado:%', v_mayor using errcode = 'P0001';
  end if;

  -- Primero se desmarca el anterior: el índice único parcial
  -- `uq_document_sequences_default` no admite dos a la vez ni por un instante.
  if p_is_default then
    update document_sequences
       set is_default = false
     where company_id = p_company and doc_type = p_doc_type
       and series_code <> v_serie and is_default;
  end if;

  insert into document_sequences
    (company_id, doc_type, series_code, prefix, padding, next_number, is_default, is_selectable)
  values (p_company, p_doc_type, v_serie, v_prefijo, p_padding, p_next_number,
          p_is_default, coalesce(p_is_selectable, true))
  on conflict (company_id, doc_type, series_code) do update
    set prefix = excluded.prefix,
        padding = excluded.padding,
        next_number = excluded.next_number,
        is_default = excluded.is_default,
        is_selectable = excluded.is_selectable;

  -- Un tipo sin predeterminada dejaría a quien emite sin saber qué serie usar.
  if not exists (select 1 from document_sequences
                  where company_id = p_company and doc_type = p_doc_type and is_default) then
    raise exception 'sin_predeterminada' using errcode = 'P0001';
  end if;

  insert into public.document_sequences_audit
    (company_id, doc_type, series_code, action, before, after, actor_id)
  select p_company, p_doc_type, v_serie, v_accion, v_antes, to_jsonb(s), auth.uid()
  from document_sequences s
  where s.company_id = p_company and s.doc_type = p_doc_type and s.series_code = v_serie;

  return v_accion;
end;
$function$;

revoke all on function public.config_numeracion_guardar(uuid, text, text, text, integer, bigint, boolean, boolean) from public;
grant execute on function public.config_numeracion_guardar(uuid, text, text, text, integer, bigint, boolean, boolean) to authenticated;

-- ── Eliminar una serie ─────────────────────────────────────────────────────

create or replace function public.config_numeracion_eliminar(
  p_company     uuid,
  p_doc_type    text,
  p_series_code text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_antes jsonb;
  v_mayor bigint;
begin
  if not app.es_admin_activo(auth.uid(), p_company) then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;

  select to_jsonb(s) into v_antes
  from document_sequences s
  where s.company_id = p_company and s.doc_type = p_doc_type and s.series_code = p_series_code;

  if v_antes is null then
    raise exception 'no_encontrado' using errcode = 'P0001';
  end if;

  if (v_antes->>'is_default')::boolean then
    raise exception 'es_predeterminada' using errcode = 'P0001';
  end if;

  -- Una serie con documentos emitidos NO se borra: su prefijo es lo que permite
  -- reconocer esos números, y sin la fila nadie podría decir de qué serie son.
  v_mayor := app.mayor_numero_emitido(p_company, p_doc_type, v_antes->>'prefix');
  if v_mayor is not null then
    raise exception 'serie_con_documentos:%', v_mayor using errcode = 'P0001';
  end if;

  delete from document_sequences
  where company_id = p_company and doc_type = p_doc_type and series_code = p_series_code;

  insert into public.document_sequences_audit
    (company_id, doc_type, series_code, action, before, after, actor_id)
  values (p_company, p_doc_type, p_series_code, 'DELETED', v_antes, null, auth.uid());
end;
$function$;

revoke all on function public.config_numeracion_eliminar(uuid, text, text) from public;
grant execute on function public.config_numeracion_eliminar(uuid, text, text) to authenticated;

commit;
