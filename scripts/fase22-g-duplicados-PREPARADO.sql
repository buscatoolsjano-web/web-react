-- Fase 22 · Duplicados — SQL PREPARADO. **No ejecutado.**
--
-- Generado por scripts/fase22-g-generar-sql.mjs desde el análisis de los 92
-- candidatos. La whitelist de abajo son los 88 pares clasificados
-- SAFE_TO_MERGE en docs/fase22-g-duplicados-candidatos.csv, con sus UUID.
--
-- Qué hace y qué NO hace
-- ---------------------
-- Marca 88 productos como `merged` y registra a qué canónico fueron
-- absorbidos. No borra nada, no reescribe ninguna FK histórica, no toca
-- stock, no toca precios, no crea recíprocas.
--
-- La lista es EXPLÍCITA. La migración no vuelve a calcular candidatos: si se
-- recalcularan durante la migración, lo aprobado y lo aplicado podrían no ser
-- lo mismo.
--
-- Orden de ejecución: A, B, C, D, E, F. G es la vuelta atrás.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. `merged` como estado posible de un producto
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Un producto `merged` existió de verdad, puede tener historia, no se borra,
-- no es el registro que hay que usar hacia adelante, y tiene un canónico que
-- lo reemplaza. Es distinto de `discontinued` —ese se dejó de vender pero
-- sigue siendo él mismo— y de `deleted_at`, que es borrado.
alter table public.products
  drop constraint products_status_check;

alter table public.products
  add constraint products_status_check
  check (status = any (array['active', 'discontinued', 'draft', 'merged']));

-- ═══════════════════════════════════════════════════════════════════════════
-- B. `duplicate` como tipo de relación
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se reutiliza `product_equivalences` porque la forma es la misma: un
-- producto apunta a otro. Pero el significado NO es el mismo, y el nombre del
-- `source_kind` es lo único que los separa: los `sim_*` son equivalencias
-- comerciales —«en vez de esta, andá con esta otra»— y `duplicate` es
-- identidad: «esta ficha y aquélla son el mismo producto».
alter table public.product_equivalences
  drop constraint product_equivalences_kind_chk;

alter table public.product_equivalences
  add constraint product_equivalences_kind_chk
  check (source_kind = any (array['sim_sp', 'sim_tc', 'sim_cp', 'sim_ir', 'manual', 'duplicate']));

-- ═══════════════════════════════════════════════════════════════════════════
-- C. `en_catalogo`: una sola definición de qué se ve en el Catálogo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hoy la condición está escrita dentro de `search_products` y de
-- `catalog_facets`, repetida. Dos copias de una regla son dos reglas que van
-- a divergir: alcanza con que alguien arregle una.
--
-- Sobre el null de marca: un producto sin marca NO tiene quién lo oculte, así
-- que se ve. Escribirlo como `b.is_active` a secas lo escondería, porque el
-- LEFT JOIN da null y null no es true.
create or replace function public.en_catalogo(p public.products)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$
  select p.deleted_at is null
     and p.status not in ('discontinued', 'merged')
     and (p.brand_id is null
          or exists (select 1 from brands b where b.id = p.brand_id and b.is_active));
$fn$;

comment on function public.en_catalogo(public.products) is
  'Fase 22: única definición de visibilidad en el Catálogo. La usan search_products, catalog_facets y productos_similares.';

-- Las tres funciones pasan a usarla. (Los cuerpos completos se reemplazan en
-- la migración real; acá queda anotado cuál es el cambio en cada una.)
--
--   search_products      AND (NOT p_solo_catalogo OR public.en_catalogo(p))
--   catalog_facets       ídem
--   productos_similares  los candidatos deben cumplir public.en_catalogo(q),
--                        en lugar del filtro suelto de marca activa. Eso saca
--                        de similares a los merged y a los discontinued.
--
-- Y en productos_similares, además (§3): las relaciones con
-- source_kind = 'duplicate' NO son equivalencias comerciales y quedan
-- excluidas de `curadas_directas` y `curadas_inversas`:
--
--   where e.source_kind <> 'duplicate'
--
-- Un duplicado no es una alternativa: es el mismo producto.

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Los 88 productos que se retiran — lista explícita
-- ═══════════════════════════════════════════════════════════════════════════
create temporary table _merge_whitelist (
  duplicate_id uuid primary key,
  canonical_id uuid not null,
  check (duplicate_id <> canonical_id)
) on commit drop;

insert into _merge_whitelist (duplicate_id, canonical_id) values
    ('f6b8a4b5-4d7a-4915-8d37-4dcd543052e7', '96e81bcc-36a2-41eb-b06f-963363c1ae6e')  -- B2036LA-2 -> DU.B2036LA-2,
    ('6913cd70-26eb-4068-b2a1-55595b5b303c', 'cbb569a9-8b1f-4ec5-bdc5-6b598e9e35bf')  -- PRO00247 -> ET.EH2-CVS05-SS,
    ('17ec9daa-34f4-49d4-b81d-70f7935c1930', 'b8161057-7d3b-4368-97ed-34c12a1a12b5')  -- PRO00249 -> AP.EX-508-18,
    ('427d8397-e2f8-4480-9861-96747cd0798f', 'c3eb2e0e-415c-4241-88d0-735eafe403fd')  -- PRO00334 -> IR.QXX2PT500NPS12,
    ('91930103-11c6-4a93-9be9-d5761db5e9de', '00a1a0b9-6e46-4ec7-a550-6aaf32b46a9f')  -- PRO00336 -> IR.QXX5A45T0270PS12,
    ('b252e341-7ca8-42ad-8339-88483456e656', 'c1e56321-2251-4c94-8ee2-112f01dd8147')  -- PRO00337 -> IR.QXX2PT04PQ4,
    ('df9667e6-131b-4417-b3e5-29371d5a9b95', 'f10e04ba-4262-46b9-89c6-c5d435efb8b9')  -- PRO00338 -> IR.QXX2PT18PQ4,
    ('2a39a0a1-9930-4dd2-a2ce-6d6a6c2dfe0f', '5159b7a3-c4be-450c-b18f-a6b4d15888cd')  -- PRO00406 -> AP.315-6MM,
    ('ff8193ce-9ff5-46ba-98a6-c030399f8d3c', 'a3804dca-b2f0-46a5-9975-d2b2e5dd7b4c')  -- PRO00434 -> TC.CEM100N3X15D-G,
    ('68051f1a-0a5e-4881-b981-29180cabd064', '1244b3d3-a710-48bf-a03a-e27f025f1a93')  -- PRO03895 -> ET.EH2-R1016-S,
    ('f1029daf-9eeb-476c-83c5-7fb94d84501e', '7a8bf032-29fa-43cb-a280-cbf59faac4ef')  -- PRO03901 -> TC.PCL25NX10D,
    ('39b72018-11b3-42db-b326-c82e2b1654bb', 'abf38325-164b-4011-a659-afca857c4a9c')  -- PRO03921 -> AP.30MM15D,
    ('470af4d3-9a5d-42b8-9807-2661e337aa22', 'f5cd10e6-bf39-4608-a655-74b965c6185e')  -- PRO04059 -> TC.SH8DX17,
    ('3666f693-5931-417c-9146-0bfd9fb12eba', 'cf7106ea-abf4-4fbc-ab71-0c8953c71e7c')  -- PRO04635 -> TC.CEM10N3X8D-G,
    ('bede03ad-6e73-4dcf-b09c-3ecb9cf0ee28', 'f26c1220-e8f9-4f7d-be34-6b593806600d')  -- PRO04638 -> IR.QXC2PT500NPS12,
    ('2dc47053-7483-414f-9c5f-28214c26f41f', 'd9bb5219-b657-4852-9946-ac6d08d406c7')  -- PRO04779 -> TO.OBN-30PD,
    ('7f0ec2e5-8daf-44f0-8961-bb7c65daf441', '49b401c1-649c-43c8-9270-5e34cc21160d')  -- PRO04780 -> TO.OBN-50PH,
    ('4d7162f9-5f86-4d1e-87cb-32298cb41bac', '0dfbd74d-b7ac-40a2-9de8-870fdc101047')  -- PRO04782 -> TO.OBN-40PD,
    ('d5784a15-fe09-47b5-8b6b-24fc29114832', '7c31fd49-05a7-462b-bb6c-257ad6611145')  -- PRO04783 -> TO.OBN-50SD,
    ('1ae8206f-9ed4-42e1-bac5-f009cbf105d2', 'c3dd149d-7ede-4853-b4b5-0a62c3ec944e')  -- PRO04794 -> TO.OBN-50SH,
    ('9ca955cf-616a-4451-a4a9-00e7f86e5e05', 'ba9d7389-812f-420d-890f-9883b1be0cba')  -- PRO05214 -> TC.QH22D,
    ('3031f735-b484-4e3a-b04b-1035721be80d', '40352d16-9abc-4b81-b2f6-34ca351f061c')  -- PRO05219 -> TO.OBN-70PD,
    ('47c266db-0dcc-4bd2-8597-26eb10297e6f', 'd114fa17-62dd-40b8-a227-4ba959209ac4')  -- PRO05221 -> TC.SH10DX18,
    ('26043c7d-998e-4d98-ac9c-bd9ea30dcee1', '615f7fb8-c761-4b41-b01a-b0fd301dc13c')  -- PRO05223 -> TC.CSP100N3X15D,
    ('5fbf3da7-6915-41de-bf1e-5fa2dd2f3a89', '76bcb5dc-01c1-45b4-a1ea-2a38ae4e9791')  -- PRO05224 -> TC.SH15DX14,
    ('8342e495-8527-4ccd-9c2f-5d51d040073b', 'b384dfa5-091d-461c-99c0-4d1b174da29f')  -- PRO05225 -> TC.SH10DX10,
    ('7c69b61a-816b-45c4-9f6b-f5a338c60a41', '74b8e121-825f-4b61-ac76-21088d119fa5')  -- PRO05226 -> TC.RH19DX19,
    ('8ad69203-41c6-414e-ac99-ef16ca0007b8', '5a56a1d0-ece8-45f3-a515-1b20d2d83a1e')  -- PRO05272 -> TC.SH10DX11,
    ('266e821b-889e-4df5-b680-736923444765', 'fc802c3f-68b2-4c7f-a8b5-0c06a8e72ead')  -- PRO05273 -> TC.SH10DX13,
    ('9ca45516-0404-4b1c-a97d-e30246c3dd60', '610f1a84-889d-426c-98f4-471cb9962326')  -- PRO05299 -> TO.LTR-12SH-4,
    ('75992df6-390f-4815-a6f2-067ca9e0b266', 'f36ecb7b-157d-4a61-832e-11340c7f065a')  -- PRO05445 -> TOH.SP38NX19,
    ('909d3f6c-4d66-429b-90c9-2f537b838ab9', 'de60477e-0759-4a68-93e4-6b2a92596584')  -- PRO05512 -> AP.440-2X,
    ('eee82932-107d-4352-a1a8-d4455a88aae4', '63a54513-73ce-4015-bc3e-1ae325b7b84b')  -- PRO05687 -> AP.MB-13MM23,
    ('b13313e2-adb1-4856-97ff-6a3cad4a8b9c', '8bef4fc6-c8b9-4ba4-bbeb-af55b625cd72')  -- PRO05691 -> AP.21MM15,
    ('352d6db4-69a5-49b0-b841-a86d54baefa7', '73316893-956f-41c8-926b-8509975e7e29')  -- PRO05697 -> AP.50-TX-08,
    ('d9aade62-a86a-4cfe-978a-56dafb8c55c6', 'ed71f2ce-7c46-409c-8df7-3e50e01c3656')  -- PRO05699 -> AP.MDA-08,
    ('0594d4cc-1c14-4192-b9cb-6300056c6a28', '7da35686-79cd-4b84-ada6-c79a47c84a8a')  -- PRO05702 -> AP.M-490-4,
    ('62dde81f-81ca-42b5-9270-8acf28b2c6cc', '82a1f89e-b228-4839-a97e-9eb7a7bc3596')  -- PRO05708 -> AP.4930-AX,
    ('edc674a4-e6b4-450f-9fc7-589680c876d0', '4422de55-84b0-42a6-9549-6aa40908d041')  -- PRO05711 -> AP.EX-376-8,
    ('add40665-04bf-4c2a-95c3-1d9daa843d34', '417d9d7e-40d9-4d9d-91fa-e2cd701cb6fe')  -- PRO05712 -> AP.492-BX,
    ('cec2b668-658e-4ed6-9eef-f32ec9d0545f', '1c47b455-06f0-496f-bccc-ee79e2f619ce')  -- PRO05713 -> AP.15MM03,
    ('541ac02b-a53d-4639-8ddd-4f61412fb70d', 'abf7baf4-52ec-41f0-8a99-7b00becc86f8')  -- PRO05717 -> AP.491X,
    ('14beb1fc-7dbb-4bf5-a8dd-de192602e95c', '8946591c-5d79-4369-8813-34babf5d52a5')  -- PRO05719 -> AP.AM-6MM,
    ('f38492b1-56eb-48cc-94b8-b04e996605f5', 'dcb398bb-5664-48c2-8ecc-c2e4cf6c4656')  -- PRO05721 -> AP.MDA-10,
    ('f6bb2edc-a2d9-4d7a-b7a2-a669cdefd4ff', '36ad4b69-36d3-443f-b869-f65e6c9673e5')  -- PRO05726 -> AP.440-1X,
    ('4ba8ff58-e1a3-4d57-9699-3aae616e7708', 'd03ad342-e256-4beb-9b50-98d1b4395bbb')  -- PRO05810 -> TO.OBN-40SH,
    ('43144570-bc1f-422d-8cb4-1fa50ba8aad8', '0468e9cf-f873-4ceb-813c-14a921afecf6')  -- PRO05831 -> AP.13MM13,
    ('cb8dcbd6-b51f-48fb-bf82-c8901ca01bec', 'ec18ff51-bef0-40f4-bbc4-9ae4fa92227e')  -- PRO05838 -> AP.EX-376-12,
    ('04682fea-b046-4818-b534-b246ea513ecd', '66436ade-957f-48cc-9fb2-1f8c633123bb')  -- PRO05920 -> AP.10MM13,
    ('1498b718-757c-4152-9b9a-1d9a3539b5a0', 'e259d5f0-fc93-40ce-8cac-df859c31e85b')  -- PRO05992 -> TC.QL25N5,
    ('104bb220-fbc4-4891-a70f-d2e3ffa0e8b9', '63160800-91dd-4d13-b8b1-19a97f7f7a74')  -- PRO05993 -> TC.QL50N,
    ('340b4ef6-2e90-4277-9eff-a9970e99dc46', '43991452-8e0d-4261-a6c0-c003c01af6c1')  -- PRO05994 -> TC.QL100N4,
    ('e1703d98-5885-49e4-8267-e4f8da49c310', '8a4b6913-f70a-4b2d-95ec-57e9a7165c78')  -- PRO05995 -> TC.QL200N4,
    ('1bb14b53-3807-4eb7-83c8-d0efabf1a1db', 'd0e92374-80c2-41ad-a366-12eb921d2815')  -- PRO05996 -> TC.QL420N,
    ('e00883ca-05a8-47c2-992b-17bfdf09f6bc', '8ce9e53c-3c76-4493-a8a2-a567a92cf55f')  -- PRO07527 -> AP.492X,
    ('72c3557d-3c9d-4fe7-879e-94328f8d18d4', 'd4c8f47c-c3ca-4a30-9b7c-57ba6308581d')  -- PRO09603 -> TO.OBT-40SH,
    ('9333440d-23a2-41cc-a2ed-b2808236997b', '3d40c2cd-1738-4e1b-b738-95cf3911193e')  -- PRO09604 -> TO.OBT-50SH,
    ('a63e6192-2c08-4168-b776-f7deeaadeb22', 'b3ee57d5-61fb-4282-a1b7-2ae340da77d8')  -- PRO09605 -> TO.OBT-60SH,
    ('d1df3d4f-1e95-4fa9-b7ea-f64d0d8d560c', '078012fc-7775-4773-a844-8ab52c57f6ca')  -- PRO09901 -> DU.RV2052-WR8,
    ('ea63e2ea-78f5-421e-ae37-86965e19566b', '64cd859d-12b8-4b74-8d5b-85805924da23')  -- PRO09902 -> DU.RV2052-WR18,
    ('682c4889-8f24-4e52-b4a8-f836d3e26adf', 'a6253adf-d298-4e34-8001-a043cf135c4b')  -- PRO10042 -> TC.SH8DX21,
    ('30a0f89b-0dce-4f7b-9dd3-0f3859e2307a', 'f5227987-aad7-4d58-9120-3a4954501a1f')  -- PRO10115 -> TO.OBT-90PD,
    ('822b1e89-63d8-47a4-9e4c-94d64c0f8723', 'db6e7b08-3cb2-409f-9733-74a13641eb8a')  -- PRO10941 -> DU.DR001,
    ('697bd302-3e50-46d9-8276-4f8b722b713a', '7786cf42-2d2c-4d5c-92be-bdeecc319a26')  -- PRO11361 -> AP.EX-255-3,
    ('116cd5ca-fb29-465a-ad31-afff2e57c5b4', '4ecdf7f4-aa55-4272-ac73-f243b0ba8fda')  -- PRO11395 -> AP.27MM15-D,
    ('4d50013f-40f2-4304-aa99-facb79390db8', 'de1b2ec4-3831-44c4-ad23-de01d099026a')  -- PRO11403 -> DU.DR002,
    ('14eb8c2d-17c2-4bc1-b853-69781be45e0f', 'a164d443-8630-4ccf-86b4-73af72e27a24')  -- PRO11816 -> AP.491-PZDX,
    ('6319c7d2-ee41-4075-902f-988fd14d9890', '48532224-5f25-4553-a558-65f7b68653a4')  -- PRO12186 -> IR.47507874001,
    ('03d4bdf4-23c3-424a-a8f7-937595b50a0f', '1e602790-4081-43f5-86ca-8ad9d0632ba2')  -- PRO12190 -> IR.92073956,
    ('b52747bf-ce5c-4f49-af8a-7d0d3df6af9e', 'f03e1483-7f25-45e4-8cac-c9bf2525f2ad')  -- PRO12191 -> IR.92073964,
    ('5d943f05-454e-4c0e-9bbe-cb50bf729d85', 'd752b87d-07eb-4c1c-a9f0-49f6d66f8119')  -- PRO12192 -> IR.92073972,
    ('53ac71fe-5abb-4a16-88b8-39bb061ffecf', '66f7a4b7-0c49-4bbd-8300-6c0507ed35aa')  -- PRO12193 -> IR.IQI-CABLE-2M,
    ('006a35cc-ff8a-4340-a2a3-8354e504215f', '13d62414-feff-41ee-97d0-2c60cea8c8d0')  -- PRO12194 -> IR.IQI-CABLE-5M,
    ('ede3cdaa-c0e7-4dbb-aba7-e49d75f26956', 'b192577b-2c14-4358-b652-850448f43436')  -- PRO12195 -> IR.IQI-PS-1,
    ('2b329abe-818a-464e-aa44-a18c14a40019', 'f7118835-c5fa-40c5-8af7-80b1308df08a')  -- PRO12196 -> IR.IQI-PS-2,
    ('c01d1837-9403-41a0-8a22-8f2aeb14758c', '698b904c-b8dc-4074-9150-585753b77f85')  -- PRO12197 -> IR.IQI11-FM,
    ('74c216de-1222-444f-8258-dff2c96779ac', 'ba3d4b2b-8db8-4107-8c77-0dd16c7af049')  -- PRO12198 -> IR.IQI2LT0250PQ4,
    ('4bf920f2-eb7d-4bc1-aa6c-680223fe5659', 'b1571187-3f53-49cf-bfa8-533edfe25a6e')  -- PRO12199 -> IR.MTC-SW-BS-1-EU,
    ('67fbb239-0b57-4874-a0a6-8d17203c8aec', 'f1f87071-2c4c-4bb7-88e9-f6435625d723')  -- PRO12200 -> IR.MTC-SW-OPT4-EU,
    ('1e27fdba-f6bb-4b3e-ad1b-c13d9bc44b9e', '6abc834f-f4ba-4b24-99e1-59a64cfffe25')  -- PRO12201 -> IR.QA1L08C4LD,
    ('77e4ca91-7f83-4c88-bcbb-ec8845e8e648', 'c0ad1112-17bd-4944-b149-7cac0ccf7553')  -- PRO12202 -> IR.QCP2A30S6-K2-EU,
    ('f5cd77d8-b081-4a09-8890-a90fed7e5c4b', 'd83a55af-01a3-4e81-a348-92aebaafe108')  -- PRO12203 -> IR.QCP2P02Q4-K2-EU,
    ('deb775c3-a44f-4716-b06e-b0edd177c18f', 'f2fa910d-836a-456a-a01b-a02980477893')  -- PRO12204 -> IR.QCP2P04Q4-K2-EU,
    ('1419f7e0-2516-40a2-8e2b-28a19c6a893a', '6c9fcdf5-ad88-427e-955b-f6654cc57920')  -- PRO12205 -> IR.QCP2P12Q4-K2-EU,
    ('f9569d65-3ce2-4e4b-9cf9-c20bfc3ad8b7', 'da038d46-5225-44de-a764-b360daea6160')  -- PRO12209 -> IR.QXXD2AT027ES06,
    ('275ed4ce-b394-48b1-9197-f4d18a28511e', 'f1a00e6c-127c-4a85-8cd8-72ce6bc7c4cf')  -- PRO12211 -> IR.RTS025PQ4,
    ('87c35ac9-bb6e-4203-a2fa-5484a68e6eac', '7c5fd3a8-1399-4c3d-9a8a-a488975a9b59')  -- PRO12212 -> IR.RTS060PS6,
    ('cae9c345-a575-4a66-8af5-b116aaf4c871', '153d1450-8296-482a-8ba3-9cf2fc8053d8')  -- PRO12593 -> AP.MF-37;

-- Nada de esto puede fallar en silencio.
do $$
declare
  n integer;
begin
  select count(*) into n from _merge_whitelist;
  if n <> 88 then
    raise exception 'la whitelist tiene % filas, se esperaban 88', n;
  end if;

  -- Los dos lados tienen que existir y no estar borrados.
  select count(*) into n
    from _merge_whitelist w
   where not exists (select 1 from products p where p.id = w.duplicate_id and p.deleted_at is null)
      or not exists (select 1 from products p where p.id = w.canonical_id and p.deleted_at is null);
  if n > 0 then raise exception '% par(es) apuntan a un producto inexistente o borrado', n; end if;

  -- El canónico tiene que seguir activo: si dejó de estarlo desde el análisis,
  -- retirar el duplicado dejaría a los dos fuera.
  select count(*) into n
    from _merge_whitelist w join products p on p.id = w.canonical_id
   where p.status <> 'active';
  if n > 0 then raise exception '% canónico(s) ya no están activos', n; end if;

  -- Ningún duplicado puede tener saldo de stock. En el análisis eran 0; si
  -- alguno movió stock desde entonces, se frena todo.
  select count(*) into n
    from _merge_whitelist w join stock_balances s on s.product_id = w.duplicate_id
   where s.on_hand <> 0 or s.reserved <> 0;
  if n > 0 then raise exception '% duplicado(s) tienen saldo de stock: revisar antes de retirar', n; end if;
end $$;

-- El UPDATE. Idempotente: correrlo dos veces no cambia nada la segunda.
update public.products p
   set status = 'merged'
  from _merge_whitelist w
 where p.id = w.duplicate_id
   and p.status <> 'merged';

-- ═══════════════════════════════════════════════════════════════════════════
-- E. La evidencia: duplicado → canónico
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DIRECCIONAL, y en este sentido. El canónico no está fusionado con el viejo:
-- el viejo fue absorbido por el canónico. La recíproca sería falsa.
insert into public.product_equivalences
       (company_id, product_id, equivalent_product_id, source, source_kind)
select p.company_id, w.duplicate_id, w.canonical_id, 'manual', 'duplicate'
  from _merge_whitelist w
  join products p on p.id = w.duplicate_id
on conflict (product_id, equivalent_product_id, source_kind) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Invariantes — si alguna falla, la transacción no se confirma
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  n integer;
begin
  select count(*) into n from products p
    join _merge_whitelist w on w.duplicate_id = p.id
   where p.status <> 'merged';
  if n <> 0 then raise exception '% duplicado(s) no quedaron merged', n; end if;

  select count(*) into n from _merge_whitelist w
   where not exists (select 1 from product_equivalences e
                      where e.product_id = w.duplicate_id
                        and e.equivalent_product_id = w.canonical_id
                        and e.source_kind = 'duplicate');
  if n <> 0 then raise exception '% par(es) sin evidencia registrada', n; end if;

  -- Ninguna recíproca.
  select count(*) into n from product_equivalences e
    join _merge_whitelist w on w.duplicate_id = e.equivalent_product_id
                           and w.canonical_id = e.product_id
   where e.source_kind = 'duplicate';
  if n <> 0 then raise exception 'se crearon % recíproca(s)', n; end if;

  -- Los canónicos siguen visibles si su marca lo permite.
  select count(*) into n from products p
    join _merge_whitelist w on w.canonical_id = p.id
   where p.status <> 'active';
  if n <> 0 then raise exception '% canónico(s) dejaron de estar activos', n; end if;

  -- Ningún merged en el catálogo.
  select count(*) into n from products p
    join _merge_whitelist w on w.duplicate_id = p.id
   where public.en_catalogo(p);
  if n <> 0 then raise exception '% merged siguen en el catálogo', n; end if;

  -- La historia sigue completa: ninguna línea perdió su snapshot.
  select count(*) into n from (
    select 1 from sales_quote_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
    union all
    select 1 from sales_order_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
    union all
    select 1 from delivery_lines l join _merge_whitelist w on w.duplicate_id = l.product_id
      where coalesce(btrim(l.sku_snapshot),'') = '' or coalesce(btrim(l.name_snapshot),'') = ''
  ) s;
  if n <> 0 then raise exception '% línea(s) históricas sin snapshot completo', n; end if;

  -- El stock no se tocó.
  select count(*) into n from stock_balances s
    join _merge_whitelist w on w.duplicate_id = s.product_id
   where s.on_hand <> 0 or s.reserved <> 0;
  if n <> 0 then raise exception 'el stock cambió en % fila(s)', n; end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Vuelta atrás
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se deshace con la MISMA lista, no con `where status = 'merged'`: si más
-- adelante hay otros productos merged, ese where los revertiría también.
--
-- begin;
--   create temporary table _rollback (duplicate_id uuid primary key) on commit drop;
--   insert into _rollback values ('f6b8a4b5-4d7a-4915-8d37-4dcd543052e7'), ... ;  -- los mismos 88 ids
--
--   delete from public.product_equivalences e
--    using _rollback r
--    where e.product_id = r.duplicate_id
--      and e.source_kind = 'duplicate';
--
--   update public.products p
--      set status = 'active'
--     from _rollback r
--    where p.id = r.duplicate_id and p.status = 'merged';
-- commit;
--
-- Los CHECK de A y B no hace falta revertirlos: admitir un valor más no
-- rompe nada, y volver a angostarlos fallaría si quedara alguna fila con el
-- valor nuevo. Si aun así se quisiera, hay que correr el DELETE y el UPDATE
-- primero.
