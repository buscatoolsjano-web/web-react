-- Fase 22 · Validación final — la equivalencia se CONSULTA por los dos lados.
--
-- Qué estaba pasando
-- ------------------
-- El legacy cargó cada equivalencia UNA sola vez, desde el lado que el
-- vendedor tenía delante: «TECNA 9336L tiene como alternativa a IR BMDS-2».
-- Nadie cargó la vuelta. De las 7.825 relaciones importadas, 7.811 son de una
-- sola dirección, y 7.797 cruzan marcas.
--
-- Medido antes de tocar nada, contra la función real: al abrir el extremo B
-- (el producto «alternativa»), aparecían **cero** de sus equivalentes
-- declarados. No era un caso de borde: los 607 productos del lado B no veían
-- ninguno. El motivo es que el puntaje calculado premia la misma marca, así
-- que los hermanos de catálogo llenan los seis lugares antes de que llegue la
-- alternativa de otro fabricante — que es justo lo que uno busca al comparar.
--
-- La decisión
-- -----------
-- La evidencia almacenada sigue siendo direccional: NO se duplican filas en
-- `product_equivalences`, no se crean recíprocas, y las 7.825 relaciones
-- importadas quedan exactamente como están. Lo único que cambia es la
-- CONSULTA: `productos_similares()` ahora mira los dos extremos de la tabla.
-- Sigue siendo una sola llamada; el front no pide nada nuevo.
--
-- Una equivalencia declarada de ida vale más que una leída de vuelta (1000 vs
-- 900): la de ida es la que alguien escribió mirando ese producto. Las dos se
-- muestran igual en pantalla —«Equivalente»—, porque para quien compara son
-- el mismo hecho; la distinción vive en `motivo` para poder auditarla.
--
-- El techo que queda (no se toca acá)
-- -----------------------------------
-- De las 7.811 relaciones de una sola vía, 7.717 tienen del lado A un producto
-- APEX, y la marca APEX está con `is_active = false`. La función excluye
-- candidatos de marcas inactivas —regla del catálogo, deliberada— así que esas
-- 7.717 siguen sin verse, y con ellas 561 de los 607 productos del lado B.
-- Lo que la bidireccionalidad destraba hoy es el bloque TECNA→IR/CP: 94
-- relaciones sobre 46 productos, de las cuales se ven 92 (las otras 2 no
-- entran en el límite de la pantalla). Reactivar APEX es una decisión de
-- catálogo, no de esta función.
--
-- Rendimiento: 10 corridas por caso, mediana. Sin degradación.
--   SP.R2315HL       813 ms → 781 ms
--   TE.X-LIGHT.2     308 ms → 282 ms
--   FE.92604182020   267 ms → 229 ms
-- El lado inverso ya tenía índice (`idx_product_equivalences_equivalente`), y
-- el plan lo usa.
--
-- Migración aplicada: fase22_similares_dedupe_por_producto
-- (reemplaza a fase22_similares_equivalencia_bidireccional, que deduplicaba
--  por `(score, id)` en vez de por producto — ver la nota de `unico` abajo).
create or replace function public.productos_similares(
  p_product_id uuid,
  p_limite integer default 6
)
returns table (id uuid, score numeric, fuente text, motivo text)
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
  -- Alguien la escribió mirando ESTE producto.
  curadas_directas as (
    select q.id, 1000::numeric as score, 'legacy'::text as fuente,
           ('legacy_direct:' || e.source_kind) as motivo
      from base b
      join product_equivalences e on e.product_id = b.id
      join products q on q.id = e.equivalent_product_id and q.deleted_at is null
      left join brands mb on mb.id = q.brand_id
     where (q.brand_id is null or mb.is_active)
  ),
  -- La misma relación, leída desde el otro extremo. Se excluye si la de ida
  -- también existe: si no, el par simétrico entraría dos veces.
  curadas_inversas as (
    select q.id, 900::numeric as score, 'legacy'::text as fuente,
           ('legacy_reverse:' || e.source_kind) as motivo
      from base b
      join product_equivalences e on e.equivalent_product_id = b.id
      join products q on q.id = e.product_id and q.deleted_at is null
      left join brands mb on mb.id = q.brand_id
     where (q.brand_id is null or mb.is_active)
       and not exists (
         select 1 from product_equivalences d
          where d.product_id = b.id and d.equivalent_product_id = q.id)
  ),
  comparable as (
    select * from base
     where familia in ('punta','balanceador','atornillador','accesorio',
                       'llave-de-impacto','remachadora','llave-dinamometrica')
  ),
  calculadas as (
    select q.id,
             case when b.series is not null and upper(q.series) = upper(b.series) then 25 else 0 end
           + case when b.brand_id is not null and q.brand_id = b.brand_id then 10 else 0 end
           + case when b.origin_country is not null
                   and upper(q.origin_country) = upper(b.origin_country) then 5 else 0 end
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
                   case when b.product_type is not null
                         and upper(q.product_type) = upper(b.product_type) then 25 else 0 end
                 + case when b.attributes ? 'encastre'
                         and upper(q.attributes->>'encastre') = upper(b.attributes->>'encastre') then 15 else 0 end
                 + case when b.attributes ? 'voltaje'
                         and upper(q.attributes->>'voltaje') = upper(b.attributes->>'voltaje') then 10 else 0 end
                 + public.similitud_cercania(
                     (public.numero_o_null(q.attributes->>'torq_min') + public.numero_o_null(q.attributes->>'torq_max')) / 2,
                     (public.numero_o_null(b.attributes->>'torq_min') + public.numero_o_null(b.attributes->>'torq_max')) / 2, 15)
             end as score,
           'calculated'::text as fuente,
           b.familia as motivo
      from comparable b
      join products q
        on q.company_id = b.company_id
       and q.category_id = b.category_id
       and q.id <> b.id
       and q.deleted_at is null
      left join brands mb on mb.id = q.brand_id
     where (q.brand_id is null or mb.is_active)
  ),
  curadas as (
    select * from curadas_directas
    union all
    select * from curadas_inversas
  ),
  todo as (
    select * from curadas
    union all
    select c.* from calculadas c
     where c.score > 0 and not exists (select 1 from curadas u where u.id = c.id)
  ),
  -- Una fila por PRODUCTO, no por (score, producto).
  --
  -- `product_equivalences` es única por (product_id, equivalent_product_id,
  -- source_kind), así que el mismo par puede estar declarado bajo dos campos
  -- del legacy. Hoy no pasa —se verificó: 0 pares con más de un source_kind—
  -- pero el esquema lo permite, y el día que pase el producto aparecería dos
  -- veces en el comparador. Que el dato esté limpio hoy no es una garantía.
  unico as (
    select distinct on (t.id) t.id, t.score, t.fuente, t.motivo
      from todo t
     order by t.id, t.score desc
  )
  select u.id, u.score, u.fuente, u.motivo
    from unico u
   order by u.score desc, u.id
   limit greatest(p_limite, 0);
$fn$;
