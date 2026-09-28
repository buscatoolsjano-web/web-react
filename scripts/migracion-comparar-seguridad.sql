-- Fase 29 · E3 — Comparación de seguridad origen vs destino (READ ONLY).
--
-- Que el restore no tire errores NO significa que la seguridad quedó igual.
-- Un `schema.sql` puede restaurar tablas y perder, en silencio:
--   · el `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` de alguna tabla,
--   · un GRANT a `anon` / `authenticated`,
--   · el `SET search_path` de una función `security definer`,
--   · el `EXECUTE` de una RPC.
--
-- Cualquiera de esas cuatro cosas abre la base sin que nada se vea roto. Por
-- eso esto se corre en las DOS bases y se comparan las salidas línea por
-- línea: lo que no coincide, se investiga antes de mandar tráfico.
--
-- No escribe nada.

set local timezone to 'UTC';

-- 1 · RLS por tabla: la lista completa, no el conteo. Un conteo igual con una
--     tabla distinta desprotegida daría "todo bien".
select 'RLS' as bloque,
       c.relname as objeto,
       case when c.relrowsecurity then 'enabled' else 'DISABLED' end as detalle,
       '' as extra
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'

union all

-- 2 · Políticas: nombre, comando y el texto normalizado de la condición.
select 'POLICY',
       tablename || '.' || policyname,
       cmd,
       md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || roles::text)
  from pg_policies
 where schemaname in ('public', 'app')

union all

-- 3 · Funciones: quién las ejecuta y con qué privilegio. `search_path` fijo es
--     obligatorio en una `security definer`; sin él, quien la llame puede
--     cambiarle el significado a las tablas que toca.
select 'FUNCTION',
       n.nspname || '.' || p.proname,
       case when p.prosecdef then 'definer' else 'invoker' end,
       case
         when not p.prosecdef then 'n/a'
         when p.proconfig is not null
              and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
           then 'search_path fijo'
         else 'SIN search_path'
       end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'app')

union all

-- 4 · GRANTs de EXECUTE sobre funciones, por rol. Es lo que decide si el
--     frontend puede llamar una RPC.
select 'EXEC_GRANT',
       n.nspname || '.' || p.proname,
       r.rolname,
       ''
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (select rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
 where n.nspname in ('public','app')
   and has_function_privilege(r.rolname, p.oid, 'EXECUTE')

union all

-- 5 · GRANTs sobre tablas: lo mismo, del lado de los datos.
--
--     Va por `aclexplode(relacl)` y NO por `information_schema.role_table_grants`:
--     esa vista filtra por el rol que consulta, y desde el MCP devolvía CERO
--     filas con los grants puestos. Comparar cero contra cero habría dado
--     "idéntico" y tapado justo lo que este bloque busca. Verificado: por acá
--     salen 776 entradas de service_role, 462 de authenticated, 368 de anon.
select 'TABLE_GRANT',
       c.relname,
       g.grantee::regrole::text,
       g.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) g
 where n.nspname = 'public'
   and c.relkind = 'r'
   and g.grantee::regrole::text in ('anon','authenticated','service_role')

order by 1, 2, 3, 4;
