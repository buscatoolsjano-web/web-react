-- Tipos de producto partidos por mayúsculas: «EMBOCADURA»/«Embocadura»,
-- «TORX»/«Torx», «PUNTA»/«Punta», «ADAPTADOR»/«Adaptador», y
-- «Llave Dinamométrica»/«Llave dinamométrica». En la guía aparecían como dos
-- botones para lo mismo. Queda la forma correcta en castellano (mayúscula sólo
-- al principio, salvo marcas como Torx). Todas las empresas.
create table if not exists app.respaldo_tipos_de_producto (
  id uuid primary key,
  company_id uuid not null,
  product_type text,
  respaldado_en timestamptz not null default now()
);

with mapa(desde, hasta) as (values
  ('EMBOCADURA', 'Embocadura'),
  ('TORX', 'Torx'),
  ('PUNTA', 'Punta'),
  ('ADAPTADOR', 'Adaptador'),
  ('Llave Dinamométrica', 'Llave dinamométrica')
),
respaldo as (
  insert into app.respaldo_tipos_de_producto (id, company_id, product_type)
  select p.id, p.company_id, p.product_type
  from public.products p join mapa m on m.desde = p.product_type
  where p.deleted_at is null
  on conflict (id) do nothing
  returning id
)
update public.products p
set product_type = m.hasta
from mapa m
where p.product_type = m.desde and p.deleted_at is null;
