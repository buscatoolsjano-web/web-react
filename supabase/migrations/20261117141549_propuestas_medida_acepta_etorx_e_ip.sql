-- app.propuestas_medida(): E-Torx (E14) es una medida válida para «Torx», e IP30
-- para «Torx Plus». Sin esto los marcaba como incorrectos.
do $do$
declare v_def text := pg_get_functiondef('app.propuestas_medida'::regproc);
begin
  v_def := replace(v_def,
    $a$b.medida !~* ('^' || b.prefijo || '[0-9]{1,2}$')$a$,
    $b$b.medida !~* ('^(' || b.prefijo || case b.prefijo when 'T' then '|E' when 'TP' then '|IP' else '' end || ')[0-9]{1,2}$')$b$);
  if v_def not like '%when ''TP'' then ''|IP''%' then
    raise exception 'no se encontró la regla a reemplazar';
  end if;
  execute v_def;
end $do$;
