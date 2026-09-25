-- Fase 28 · E11 — la cotización del ERP sale en COT-BTS, y COTI deja de ofrecerse.
--
-- Tres cosas, y conviene entender por qué no son la misma:
--
-- 1 · **Renombrar** COT-ERP → COT-BTS. Es la serie que emite el ERP. La toca
--     una sola cotización, la piloto («PRUEBA PILOTO ERP - Fase 19 E3 - no
--     operativa», en borrador), así que su número se renumera con ella. Si
--     hubiera documentos operativos NO se renumerarían: el número de un
--     documento es con el que se emitió.
--
-- 2 · **Ponerla por defecto**. Desde acá, una cotización nueva sale en
--     COT-BTS y la numera el ERP. Como consecuencia desaparece el cartel de
--     autoridad en el alta: no hay nada que avisar.
--
-- 3 · **Dejar de ofrecer COTI** en el selector. NO se borra: 306 cotizaciones
--     la usan y STEL la sigue numerando allá. Lo que se saca es la opción de
--     elegirla para un documento nuevo, con un interruptor que se puede
--     volver a prender.
--
-- Sólo para Buscatools. Torquetools tiene COTI como única serie de cotización:
-- si se la sacáramos se quedaría sin ninguna.
--
-- Lo que NO cambia: las 306 cotizaciones COTI siguen como están, con su número
-- y su serie. En su ficha el cartel de autoridad sigue apareciendo, porque
-- sobre ESE documento sigue siendo cierto.

begin;

-- ── 1 · El interruptor ────────────────────────────────────────────────────

alter table document_sequences
  add column if not exists is_selectable boolean not null default true;

comment on column document_sequences.is_selectable is
  'Fase 28 E11: si se ofrece para documentos NUEVOS. Una serie que ya numeró documentos nunca se borra; se deja de ofrecer.';

-- ── 2 · COT-ERP pasa a llamarse COT-BTS ───────────────────────────────────

update sales_quotes q
   set series_code = 'COT-BTS',
       number = replace(q.number, 'COT-ERP', 'COT-BTS')
 where q.series_code = 'COT-ERP'
   and q.company_id = (select id from companies where name = 'Buscatools');

update document_sequences
   set series_code = 'COT-BTS', prefix = 'COT-BTS', is_default = true
 where doc_type = 'quote'
   and series_code = 'COT-ERP'
   and company_id = (select id from companies where name = 'Buscatools');

-- ── 3 · COTI deja de ofrecerse, y deja de ser la de por defecto ───────────

update document_sequences
   set is_default = false, is_selectable = false
 where doc_type = 'quote'
   and series_code = 'COTI'
   and company_id = (select id from companies where name = 'Buscatools');

-- ── 4 · El selector respeta el interruptor ────────────────────────────────

create or replace function public.series_de_documento(p_company uuid, p_doc_type text)
returns table (series_code text, is_default boolean, authority text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Aislamiento por empresa. Va primero y corta: `security definer` no puede
  -- convertirse en una puerta para mirar la configuración de otra empresa.
  if p_company is null or not (p_company = any (app.current_internal_company_ids())) then
    raise exception 'sin_permiso' using errcode = 'insufficient_privilege';
  end if;

  -- Sólo los documentos de Ventas. No se expone la numeración de compras,
  -- mantenimiento ni proveedores, que no tienen nada que hacer en este selector.
  if p_doc_type is null or p_doc_type not in ('quote', 'sales_order', 'delivery') then
    raise exception 'DOC_TYPE_INVALIDO' using errcode = '22023', detail = coalesce(p_doc_type, '(null)');
  end if;

  return query
  select ds.series_code,
         ds.is_default,
         -- La autoridad EFECTIVA: la de la serie si tiene fila, si no la
         -- general, y si no hay ninguna, ERP.
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
     -- Fase 28 E11: sólo las que se ofrecen para documentos nuevos…
     and (ds.is_selectable
          -- …salvo que no quede ninguna, y entonces se ofrecen todas. Un
          -- selector vacío no deja crear nada, que es peor que ofrecer una
          -- serie que alguien apagó por error.
          or not exists (select 1 from document_sequences d2
                          where d2.company_id = ds.company_id
                            and d2.doc_type = ds.doc_type
                            and d2.is_selectable))
   order by ds.is_default desc, ds.series_code;
end;
$function$;

commit;
