-- Fase 22 · Etapa B — Productos similares por familia técnica.
--
-- El problema: `relacionadosDe` en el front exigía misma marca + misma serie +
-- mismo tipo, y devolvía vacío si faltaba cualquiera de los tres. Para los
-- 12.637 productos sin datos técnicos eso es siempre; y para el resto sólo
-- encontraba hermanos de la misma serie de la misma marca — nunca la
-- alternativa de otra marca, que es justo lo que uno busca cuando compara.
--
-- Esto puntúa candidatos de la MISMA familia sobre todo el catálogo, con pesos
-- fijos. Determinista: las mismas entradas dan el mismo orden siempre. Sin ML,
-- sin embeddings, sin nada que no se pueda explicar leyendo esta función.
--
-- `security invoker` (el valor por omisión) a propósito: la RLS de `products`
-- decide qué ve cada rol. Una función `definer` acá sería una manera de
-- mostrarle a un cliente externo productos que su política le esconde.

-- Un texto a número, o null. `attributes` es jsonb de texto libre: un cast
-- directo revienta la consulta entera con el primer «1/4 HEX».
create or replace function public.numero_o_null(t text)
returns numeric language sql immutable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select case when t ~ '^\s*-?\d+(\.\d+)?\s*$' then btrim(t)::numeric else null end;
$fn$;

-- Proximidad relativa: 100 y 110 se parecen más que 1 y 11, aunque la resta
-- sea la misma. Sin dato en cualquiera de los dos suma 0; nunca resta.
create or replace function public.similitud_cercania(a numeric, b numeric, peso numeric)
returns numeric language sql immutable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when a is null or b is null then 0
    else greatest(0, peso * (1 - abs(a - b) / greatest(abs(a), abs(b), 1)))
  end;
$fn$;

create or replace function public.productos_similares(
  p_product_id uuid,
  p_limite integer default 6
)
returns table (id uuid, score numeric)
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  with base as (
    select p.*, c.slug as familia
      from products p
      join product_categories c on c.id = p.category_id
     where p.id = p_product_id and p.deleted_at is null
  ),
  -- Las familias sin atributos cargados no entran. «Otros» son 12.588
  -- productos sin un solo dato técnico: proponer similares ahí sería ofrecer
  -- cualquier cosa con cara de recomendación.
  comparable as (
    select * from base
     where familia in ('punta','balanceador','atornillador','accesorio',
                       'llave-de-impacto','remachadora','llave-dinamometrica')
  ),
  candidatos as (
    select q.id,
           -- Comunes a todas las familias.
             case when b.series is not null and upper(q.series) = upper(b.series) then 25 else 0 end
           + case when b.brand_id is not null and q.brand_id = b.brand_id then 10 else 0 end
           + case when b.origin_country is not null
                   and upper(q.origin_country) = upper(b.origin_country) then 5 else 0 end
           -- Y lo propio de cada una.
           + case b.familia
               when 'punta' then
                   case when b.product_type is not null
                         and upper(q.product_type) = upper(b.product_type) then 30 else 0 end
                 + case when b.attributes ? 'encastre'
                         and upper(q.attributes->>'encastre') = upper(b.attributes->>'encastre') then 25 else 0 end
                 + case when b.attributes ? 'medida'
                         and upper(q.attributes->>'medida') = upper(b.attributes->>'medida') then 20 else 0 end
                 + public.similitud_cercania(
                     public.numero_o_null(q.attributes->>'largo'),
                     public.numero_o_null(b.attributes->>'largo'), 10)
               when 'balanceador' then
                   case when b.attributes ? 'carcasa'
                         and upper(q.attributes->>'carcasa') = upper(b.attributes->>'carcasa') then 10 else 0 end
                 -- El punto medio del rango de carga: un balanceador de 0,4–1 kg
                 -- se parece a uno de 0,5–1,2, no a uno de 18–22.
                 + public.similitud_cercania(
                     (public.numero_o_null(q.attributes->>'min_kg') + public.numero_o_null(q.attributes->>'max_kg')) / 2,
                     (public.numero_o_null(b.attributes->>'min_kg') + public.numero_o_null(b.attributes->>'max_kg')) / 2, 30)
                 + public.similitud_cercania(
                     public.numero_o_null(q.attributes->>'longitud'),
                     public.numero_o_null(b.attributes->>'longitud'), 10)
               when 'atornillador' then
                   case when b.attributes ? 'ergonomia'
                         and upper(q.attributes->>'ergonomia') = upper(b.attributes->>'ergonomia') then 20 else 0 end
                 + case when b.attributes ? 'alimentacion'
                         and upper(q.attributes->>'alimentacion') = upper(b.attributes->>'alimentacion') then 15 else 0 end
                 + case when b.attributes ? 'encastre'
                         and upper(q.attributes->>'encastre') = upper(b.attributes->>'encastre') then 15 else 0 end
                 + public.similitud_cercania(
                     (public.numero_o_null(q.attributes->>'torq_min') + public.numero_o_null(q.attributes->>'torq_max')) / 2,
                     (public.numero_o_null(b.attributes->>'torq_min') + public.numero_o_null(b.attributes->>'torq_max')) / 2, 20)
               else
                 -- Accesorios, llaves y remachadoras: familias chicas donde lo
                 -- que distingue es el tipo y el encastre.
                   case when b.product_type is not null
                         and upper(q.product_type) = upper(b.product_type) then 25 else 0 end
                 + case when b.attributes ? 'encastre'
                         and upper(q.attributes->>'encastre') = upper(b.attributes->>'encastre') then 15 else 0 end
                 + case when b.attributes ? 'voltaje'
                         and upper(q.attributes->>'voltaje') = upper(b.attributes->>'voltaje') then 10 else 0 end
                 + public.similitud_cercania(
                     (public.numero_o_null(q.attributes->>'torq_min') + public.numero_o_null(q.attributes->>'torq_max')) / 2,
                     (public.numero_o_null(b.attributes->>'torq_min') + public.numero_o_null(b.attributes->>'torq_max')) / 2, 15)
             end as score
      from comparable b
      join products q
        on q.company_id = b.company_id
       and q.category_id = b.category_id
       and q.id <> b.id
       and q.deleted_at is null
      -- Un producto cuya marca está fuera del catálogo no se recomienda: se lo
      -- sacó a propósito (Fase 22 · A).
      left join brands mb on mb.id = q.brand_id
     where (q.brand_id is null or mb.is_active)
  )
  select id, score
    from candidatos
   where score > 0
   -- El id desempata para que el orden sea estable entre corridas. Sin esto,
   -- dos productos con el mismo score se turnan y la lista parpadea.
   order by score desc, id
   limit greatest(p_limite, 0);
$fn$;

comment on function public.productos_similares(uuid, integer) is
  'Fase 22 B: similares por familia tecnica, pesos fijos y deterministas. '
  'Unica fuente: la usan el hover del catalogo y los relacionados del modal.';

revoke all on function public.numero_o_null(text) from public;
revoke all on function public.similitud_cercania(numeric, numeric, numeric) from public;
revoke all on function public.productos_similares(uuid, integer) from public;
grant execute on function public.numero_o_null(text) to authenticated;
grant execute on function public.similitud_cercania(numeric, numeric, numeric) to authenticated;
grant execute on function public.productos_similares(uuid, integer) to authenticated;

-- ── Invariantes ────────────────────────────────────────────────────────────
do $inv$
declare
  n int; sin_permiso int; definer int;
begin
  -- 1. Ninguna de las tres puede ser `security definer`: la RLS manda.
  select count(*) into definer
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('productos_similares','similitud_cercania','numero_o_null')
     and p.prosecdef;
  if definer <> 0 then
    raise exception '% funcion(es) quedaron como security definer', definer;
  end if;

  -- 2. `anon` no ejecuta nada de esto.
  select count(*) into sin_permiso
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('productos_similares','similitud_cercania','numero_o_null')
     and has_function_privilege('anon', p.oid, 'execute');
  if sin_permiso <> 0 then
    raise exception 'anon puede ejecutar % funcion(es) de similares', sin_permiso;
  end if;

  -- 3. Un producto de «Otros» no devuelve similares: no hay con qué compararlo.
  select count(*) into n
    from products p join product_categories c on c.id = p.category_id
   where c.slug = 'otros' and p.deleted_at is null limit 1;
  if n > 0 then
    select count(*) into n from public.productos_similares(
      (select p.id from products p join product_categories c on c.id = p.category_id
        where c.slug = 'otros' and p.deleted_at is null limit 1), 6);
    if n <> 0 then
      raise exception 'un producto de Otros devolvio % similares', n;
    end if;
  end if;

  raise notice 'productos_similares(): OK';
end $inv$;
