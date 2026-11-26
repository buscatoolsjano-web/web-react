-- Importar OC rápido (2026-11): con RLS, el motor no puede usar los índices
-- sobre app.normalizar_texto_oc() ni el trigram del nombre (las funciones no son
-- LEAKPROOF), y cada línea recorría el catálogo entero: ~0,85 s por línea y las
-- OCs largas se cortaban por el statement_timeout de 8 s.
-- La función pasa a SECURITY DEFINER y valida ella misma la membresía: todo lo
-- que lee ya está filtrado por p_company.
do $$
declare v_def text; v_nueva text;
begin
  v_def := pg_get_functiondef('public.emparejar_lineas_de_oc(uuid,uuid,jsonb)'::regprocedure);
  v_nueva := replace(v_def,
    E'begin\n  perform set_config(''pg_trgm.similarity_threshold'', ''0.35'', true);',
    E'begin\n'
    || E'  -- SECURITY DEFINER: la membresía se valida acá, no con RLS.\n'
    || E'  if not exists (select 1 from company_memberships cm\n'
    || E'                  where cm.user_id = auth.uid() and cm.company_id = p_company\n'
    || E'                    and cm.status = ''active'') then\n'
    || E'    raise exception ''SIN_PERMISO'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'  if p_customer is not null\n'
    || E'     and not exists (select 1 from customers c where c.id = p_customer and c.company_id = p_company) then\n'
    || E'    raise exception ''CLIENTE_INVALIDO'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || E'  perform set_config(''pg_trgm.similarity_threshold'', ''0.35'', true);');
  if v_nueva = v_def then
    raise exception 'emparejar_lineas_de_oc: el parche no entró';
  end if;
  execute v_nueva;
end $$;

alter function public.emparejar_lineas_de_oc(uuid, uuid, jsonb) security definer;
