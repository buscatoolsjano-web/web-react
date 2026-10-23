-- Fase 120 · Separar cliente y contacto en los documentos de Torquetools, y
-- linkear líneas históricas a sus productos. Aplicado con execute_sql el
-- 2026-10-23. Torquetools = 492a0ee9-220f-4dc8-9eaa-ec914ea10907.
--
-- Problema 1: el import de StelOrder metió el NOMBRE DEL CONTACTO (una persona)
-- en customers.trade_name, y como `nombreCliente` prefiere trade_name, el
-- documento mostraba la persona (ej. «Mariella Acuña») en vez de la empresa
-- («NORDEX S.A.»). Se detecta la persona (trade_name que no contiene al
-- legal_name ni viceversa y sin sufijo de empresa), se crea como contacto, se
-- pone en los documentos sin contacto, y se limpia el trade_name → el cliente
-- pasa a mostrar la empresa (legal_name) y el contacto, la persona.
--
-- Problema 2: ~398 líneas de documentos quedaron sin product_id (sólo
-- sku_snapshot), así que esos productos no mostraban su historial comercial. Se
-- linkean por sku_snapshot = products.sku.

-- ── Problema 2: linkear líneas al producto por SKU ──
update sales_quote_lines l set product_id = p.id from products p
 where l.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and l.product_id is null
   and p.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and p.deleted_at is null
   and upper(btrim(l.sku_snapshot)) = upper(p.sku) and coalesce(l.sku_snapshot,'')<>'';
update sales_order_lines l set product_id = p.id from products p
 where l.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and l.product_id is null
   and p.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and p.deleted_at is null
   and upper(btrim(l.sku_snapshot)) = upper(p.sku) and coalesce(l.sku_snapshot,'')<>'';
update delivery_lines l set product_id = p.id from products p
 where l.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and l.product_id is null
   and p.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and p.deleted_at is null
   and upper(btrim(l.sku_snapshot)) = upper(p.sku) and coalesce(l.sku_snapshot,'')<>'';

-- ── Problema 1 · Paso 1: crear el contacto desde el trade_name-persona ──
insert into customer_contacts (company_id, customer_id, full_name, is_default, active)
select c.company_id, c.id, btrim(c.trade_name), true, true
from customers c
where c.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907'
  and c.trade_name is not null and btrim(c.trade_name)<>'' and c.trade_name <> c.legal_name
  and c.trade_name not ilike '%'||c.legal_name||'%' and c.legal_name not ilike '%'||c.trade_name||'%'
  and c.trade_name !~* '\m(s\.?a\.?|s\.?r\.?l|s\.?l\.?|srl|saic|sacif|s\.?a\.?i|cia|ltda|ltd|inc|llc|group|argentina|industrial|comercial)\M'
  and not exists (select 1 from customer_contacts cc where cc.customer_id=c.id);

-- ── Paso 2: poner el contacto en los documentos sin contacto ──
update sales_quotes q set contact_id = cc.id from customer_contacts cc
 where q.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and q.contact_id is null
   and cc.customer_id=q.customer_id and cc.is_default and cc.active;
update sales_orders o set contact_id = cc.id from customer_contacts cc
 where o.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and o.contact_id is null
   and cc.customer_id=o.customer_id and cc.is_default and cc.active;
update deliveries d set contact_id = cc.id from customer_contacts cc
 where d.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and d.contact_id is null
   and cc.customer_id=d.customer_id and cc.is_default and cc.active;

-- ── Paso 3: limpiar el trade_name donde se volvió contacto ──
update customers c set trade_name = null
 where c.company_id='492a0ee9-220f-4dc8-9eaa-ec914ea10907' and c.trade_name is not null
   and exists (select 1 from customer_contacts cc where cc.customer_id=c.id and cc.is_default
               and upper(btrim(cc.full_name)) = upper(btrim(c.trade_name)));

-- ════════════════════════════════════════════════════════════════════════════
-- Problema 3: completar la MARCA (y algo de modelo) parseando las descripciones.
-- Ambas empresas. Objetivo: productos sin brand_id y sin marca_disp. Nunca se
-- inventa una marca: se asigna una que YA existe —fila en `brands` → brand_id;
-- marca de ferretería sin ficha → marca_disp (texto no-filtrable)—. Bajó el
-- «sin marca» de 7.740 a 3.484 (lo que queda es genérico real o marca no
-- escrita de forma inequívoca). Ver [[marca-disp-vs-brand-id]].
-- Nota: el trigger `products_slug_publico` es BEFORE INSERT, así que estos
-- UPDATE no regeneran public_slug ni re-publican nada oculto.
-- ════════════════════════════════════════════════════════════════════════════

-- Capa 1 · "Marca: <X>" en la descripción, X matchea una marca real → brand_id
with cand as (
  select p.id, p.company_id,
    upper(btrim((regexp_match(p.description, '(?in)marca\s*:\s*([^\n\r]{1,40})'))[1])) as cap
  from products p
  where p.deleted_at is null and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')=''
    and p.description ~* '(^|\n)\s*marca\s*:'
), m as (
  select distinct on (c.id) c.id, b.id as brand_id from cand c
  join brands b on b.company_id=c.company_id
   and ( (length(b.name)<=3 and c.cap = upper(b.name))
      or (length(b.name)>3 and (c.cap = upper(b.name) or c.cap ~ ('^'||upper(regexp_replace(b.name,'([.^$*+?()\[\]{}|\\-])','\\\1','g'))||'(\M| )'))) )
  order by c.id, length(b.name) desc
)
update products p set brand_id = m.brand_id from m where p.id=m.id and p.brand_id is null;

-- Capa 2 · la marca es el token inicial del nombre (incl. ~2.400 "FIAM Repuesto")
with cand as (
  select p.id, p.company_id, upper(p.name) as nm from products p
  where p.deleted_at is null and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')=''
), m as (
  select distinct on (c.id) c.id, b.id as brand_id from cand c
  join brands b on b.company_id=c.company_id and length(b.name)>=4
   and c.nm ~ ('^'||upper(regexp_replace(b.name,'([.^$*+?()\[\]{}|\\-])','\\\1','g'))||'(\M| )')
  order by c.id, length(b.name) desc
)
update products p set brand_id = m.brand_id from m where p.id=m.id and p.brand_id is null;

-- Capa 3a · "Marca:" con el valor limpio (sin "/ , O ...") re-matchea marca real
with cand as (
  select p.id, p.company_id,
    upper(btrim(split_part(split_part(split_part((regexp_match(p.description,'(?in)marca\s*:\s*([^\n\r]{1,40})'))[1],'/',1),',',1),' O ',1))) as cap
  from products p
  where p.deleted_at is null and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')=''
    and p.description ~* '(^|\n)\s*marca\s*:'
), m as (
  select distinct on (c.id) c.id, b.id as brand_id from cand c
  join brands b on b.company_id=c.company_id and c.cap = upper(b.name)
  order by c.id, length(b.name) desc
)
update products p set brand_id = m.brand_id from m where p.id=m.id and p.brand_id is null;

-- Capa 3b · "Marca:" limpio pero sin ficha en brands → marca_disp (ferretería)
with cand as (
  select p.id,
    btrim(split_part(split_part(split_part((regexp_match(p.description,'(?in)marca\s*:\s*([^\n\r]{1,40})'))[1],'/',1),',',1),' O ',1)) as cap
  from products p
  where p.deleted_at is null and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')=''
    and p.description ~* '(^|\n)\s*marca\s*:'
), ok as (
  select id, cap from cand
  where cap ~ '^[A-Za-zÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑ0-9 .&+-]{1,24}$' and length(cap) between 2 and 25
    and upper(cap) !~ '(SEGUN|DISPONIB|GENERIC|GENÉRIC|VARI|REPUESTO|IMPORTAD|NACIONAL|STORAGE|COMPAT|SELLADOR|MODELO|ORIGINAL|CONSULT|STOCK)'
)
update products p set attributes = coalesce(p.attributes,'{}'::jsonb) || jsonb_build_object('marca_disp', ok.cap)
from ok where p.id=ok.id and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')='';

-- Capa 4 · marca real (≥5 letras) como palabra completa en cualquier parte del nombre
with cand as (
  select p.id, p.company_id, upper(p.name) as nm from products p
  where p.deleted_at is null and p.brand_id is null and coalesce(p.attributes->>'marca_disp','')=''
), m as (
  select distinct on (c.id) c.id, b.id as brand_id from cand c
  join brands b on b.company_id=c.company_id and length(b.name)>=5 and b.name !~* '(generic|mercedes)'
   and c.nm ~ ('(^|\s|\()'||upper(regexp_replace(b.name,'([.^$*+?()\[\]{}|\\-])','\\\1','g'))||'(\M|$)')
  order by c.id, length(b.name) desc
)
update products p set brand_id = m.brand_id from m where p.id=m.id and p.brand_id is null;

-- Capa modelo · "Modelo: <código>" donde falta model_code (216 productos)
with cand as (
  select id, btrim(split_part(split_part((regexp_match(description,'(?in)modelo\s*:\s*([^\n\r]{1,30})'))[1],' +',1),' (',1)) as cap
  from products
  where deleted_at is null and coalesce(model_code,'')='' and description ~* '(^|\n)\s*modelo\s*:'
), ok as (
  select id, cap from cand
  where cap ~ '[A-Za-z0-9]' and length(cap) between 2 and 25
    and cap !~ '[?]' and upper(cap) !~ '(REPUESTO|VARIOS|SELLADOR|CONSULT|SEGUN|GENERIC|ORIGINAL|S/D|SIN )'
)
update products p set model_code = ok.cap from ok where p.id=ok.id and coalesce(p.model_code,'')='';

-- Capa serie · "Serie: <X>" donde falta series (sólo ~11 productos lo declaran)
with cand as (
  select id, btrim(split_part((regexp_match(description,'(?in)serie\s*:\s*([^\n\r]{1,30})'))[1],' (',1)) as cap
  from products
  where deleted_at is null and coalesce(series,'')='' and description ~* '(^|\n)\s*serie\s*:'
), ok as (
  select id, cap from cand
  where cap ~ '[A-Za-z0-9]' and length(cap) between 2 and 25
    and upper(cap) !~ '(VARI|CONSULT|SEGUN|GENERIC|S/D|SIN |NUMERO)'
)
update products p set series = ok.cap from ok where p.id=ok.id and coalesce(p.series,'')='';
