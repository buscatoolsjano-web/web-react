# Fase 12 · Configuración — Entrega 2: empresa, logo y numeración

Estado: **implementada y probada contra la base real; commit local, sin push.**
Fecha: 2026-09-14. No se tocó STEL, productos, precios, listas, marcas,
categorías, usuarios ni roles reales, Emails, WhatsApp, Informes, legacy, Make,
DNS, SMTP ni la configuración de Auth. `MIGRATION_STATUS.md` no se actualizó.
Ningún valor de secuencia se modificó.

```
NUMERATION_EDITABLE = NO
STEL_AUTHORITY      = YES, mientras siga coexistiendo
SEQUENCE_ALIGNMENT  = PENDING CUTOVER
SPF/DKIM            = PENDING
GLOBAL_REDESIGN     = NOT STARTED
```

---

## A · Empresa

### Auditoría del schema real (`companies`)

| columna | tipo | nulo | notas |
|---|---|---|---|
| `id` | uuid | no | PK |
| `slug` | text | no | UNIQUE — clave interna |
| `name` | text | no | nombre comercial |
| `legal_name`, `tax_id`, `address`, `phone`, `email`, `website` | text | sí | |
| `logo_path` | text | sí | **null en las 2 empresas** |
| `brand_color` | text | sí | |
| `default_currency` | text | no | FK `currencies`, default ARS |
| `is_active` | bool | no | |
| `created_at`, `updated_at` | timestamptz | no | trigger `trg_companies_touch` |

- **No existen** columnas de ciudad, provincia, país ni código postal: la
  dirección es un único texto. No se agregaron columnas.
- RLS antes de la entrega: `companies_select` (miembros) y **`companies_update`
  (admin, TODAS las columnas por REST: `slug`, `is_active`, `default_currency`)**.
- Consumidores: impresión de Ventas y de Compras (`services/empresa.ts`: nombre,
  razón social, CUIT, dirección, teléfono, email, web, color) y el selector de
  empresa (`name`, `slug`). **Nadie usa el logo todavía.**
- No hay tabla de logos/media ni bucket apto: `ventas` (adjuntos de documentos)
  y `whatsapp` (media) son de otros módulos.

### Datos productivos (sólo lectura, nada se modificó)

| campo | Buscatools | Torquetools |
|---|---|---|
| nombre | Buscatools | Torquetools |
| razón social | Juan M. J. Mocciaro (BUSCATOOLS) | **vacío** |
| CUIT/NIF | 20-27089205-2 | **vacío** |
| dirección | Melincué 5125, CABA (1417) | **vacío** |
| teléfono | 11.2169.3304 | vacío |
| email | info@ (dominio de la empresa) | vacío |
| web | www.buscatools.com.ar | vacío |
| logo | ninguno | ninguno |
| color | #F37021 | #2563EB |
| moneda base | ARS | ARS |

**Torquetools:** el dato conocido (TORQUETOOLS SL, Ctra. de la Celulosa, s/n,
Km 3,2, 18613, Granada, España) **difiere de la base, que no tiene razón social
ni dirección cargadas**. No se sobrescribió; queda para que un admin lo cargue
desde la pantalla nueva. También figura moneda base ARS para una empresa
española: no se tocó (campo bloqueado).

## B · Campos editables

| campo | editable | requerido | validación | normalización |
|---|---|---|---|---|
| Nombre comercial (`name`) | admin | sí | ≤ 120 | trim |
| Razón social (`legal_name`) | admin | no | ≤ 200 | trim, vacío → null |
| CUIT / NIF (`tax_id`) | admin | no | **forma básica** `^[A-Za-z0-9][A-Za-z0-9./ -]{1,29}$`; no se verifica dígito ni padrón (no hay validador oficial en el proyecto) | trim, vacío → null |
| Dirección (`address`) | admin | no | ≤ 300, un solo campo | trim, vacío → null |
| Teléfono (`phone`) | admin | no | `[0-9+() ./-]{4,50}` | trim, vacío → null |
| Email (`email`) | admin | no | ≤ 254 y patrón básico | trim, minúsculas |
| Sitio web (`website`) | admin | no | dominio con `http(s)://` opcional (rechaza `javascript:`) | trim |
| Color (`brand_color`) | admin | no | `#RRGGBB` | mayúsculas |
| Logo (`logo_path`) | admin | — | ver C | — |

**Bloqueados:** `id`, `slug`, `created_at`, `updated_at`, `default_currency`
(cambia comportamiento de documentos), `is_active` (dejaría a todos afuera) y
cualquier secuencia. Se muestran como «Datos del sistema (no editables)».

Sólo se validan los campos **que cambian**: un dato histórico que no cumpla una
regla nueva (probado con un teléfono «abc») no bloquea editar los demás.

## C · Logo

- Formatos: **PNG, JPEG, WEBP**. **SVG no** (puede llevar script y no hay
  sanitizador confiable). Máximo **2 MB** (no había logos para medir; un logo
  típico pesa bastante menos).
- Flujo: `POST multipart` a la Edge Function `config-empresa-logo`:
  1. JWT (gateway `verify_jwt` + `auth.getUser`);
  2. campos en lista blanca (`accion`, `company_id`, `version`, `archivo`);
  3. la base valida admin activo y versión (`config_empresa_logo_precheck`);
  4. **tipo real por los primeros bytes** y coincidencia con el tipo declarado;
     el nombre del archivo se ignora;
  5. subida con clave de servicio a `<company_id>/logo-<epoch ms>.<ext>`, sin
     upsert; el timestamp evita servir caché vieja;
  6. `config_empresa_logo_registrar` guarda la ruta con concurrencia optimista y
     bitácora; si falla, se borra lo recién subido;
  7. se borra el logo anterior: **un solo archivo por empresa**.
- Quitar: confirmación explícita; borra objeto y `logo_path`.
- Los bytes no se procesan ni se re-codifican; se sirven como imagen con su tipo
  real. No se guarda base64 en Postgres.
- El logo del repositorio (`public/icon-*.png`, `favicon.svg`) es el ícono de la
  app, **no** el logo de una empresa: no se subió nada automáticamente.
- **Uso en documentos:** la impresión de Ventas/Compras todavía no lo lee
  (pendiente). La UI lo aclara al quitarlo.

## D · Storage

| bucket | público | límite | MIME | lectura | escritura |
|---|---|---|---|---|---|
| `empresa-logos` | **no** | 2 MB | png, jpeg, webp | miembros activos de la empresa de la carpeta (URL firmada 10 min) | **sólo service_role** (Edge Function); sin policies de INSERT/UPDATE/DELETE |

## E · Auditoría

`company_audit`: `COMPANY_UPDATED`, `COMPANY_LOGO_UPDATED`,
`COMPANY_LOGO_REMOVED` con actor, empresa, **nombres** de los campos
cambiados y fecha. Sin valores, sin imágenes, sin rutas firmadas. La lee sólo
el admin de la empresa; nadie la escribe desde el cliente.

## F · Concurrencia

- `companies.updated_at` (con trigger) es la versión. `config_empresa_actualizar`
  y el registro de logo toman la fila `FOR UPDATE` y rechazan con
  `conflicto_version` si no coincide.
- La UI manda sólo los campos cambiados y la versión leída. Ante conflicto:
  mensaje y «Descartar mis cambios y recargar»; nunca last-write-wins silencioso.
- Un cambio de logo actualiza la versión local sin perder lo que se estaba
  editando en el formulario.

## G · Numeración (sólo lectura)

`config_numeracion_diagnostico(p_company)` (admin y employee): por cada
secuencia devuelve prefijo, relleno, próximo número formateado, documentos,
fuera de patrón, mayor existente, mayor **sin atípicos** (`number_outlier` del
import), atípicos por encima del próximo, estado y autoridad. **No escribe ni
genera números.**

Estados: `OK` (próximo = mayor + 1) · `BEHIND` (el próximo ya existe:
colisión) · `AHEAD` (salto) · `SIN_DOCUMENTOS` · `UNKNOWN`.

Mapeo tipo → columna medido en el código: quote → `sales_quotes.number`,
sales_order → `sales_orders.number`, delivery → `deliveries.number`, customer →
`customers.legacy_ref`, supplier → `suppliers.legacy_ref`, purchase_order,
goods_receipt, supplier_invoice (FP), maintenance_order → `number`,
maintenance_asset → `maintenance_assets.reference`.

### Paridad (Buscatools, 2026-09-14)

| tipo | próximo (React) | docs | mayor (sin atípicos) | atípicos ≥ próximo | fuera de patrón | estado | autoridad |
|---|---|---:|---|---:|---:|---|---|
| Cotizaciones | COTI02629 | 288 | COTI02540 | 0 | 0 | **AHEAD** | STEL |
| Pedidos de venta | PDV01316 | 166 | PDV01315 | 9 (PDV11157…PDV11292) | 0 | OK | STEL |
| Notas de entrega | RT0000001424 | 182 | RT0000001423 | 0 | 4 (RT-ML…) | OK | STEL |
| Clientes | CLI01225 | 1.010 | CLI01224 | 0 | 3 | OK | ERP |
| Proveedores | PROV00146 | 142 | PROV00145 | 0 | 0 | OK | ERP |
| Pedidos de compra | PC00002 | 0 | — | — | 0 | SIN_DOCUMENTOS | ERP |
| Notas de entrada | NEP00001 | 0 | — | — | 0 | SIN_DOCUMENTOS | ERP |
| Facturas de proveedor | FP00001 | 0 | — | — | 0 | SIN_DOCUMENTOS | ERP |
| Equipos | EQ00001 | 0 | — | — | 0 | SIN_DOCUMENTOS | ERP |
| Órdenes de servicio | OS00001 | 0 | — | — | 0 | SIN_DOCUMENTOS | ERP |

Torquetools: 10 secuencias, 0 documentos (proveedores con próximo PROV00022 y 0
proveedores: SIN_DOCUMENTOS).

## H · Autoridad STEL

No existe una columna que registre quién numera. La autoridad es un **estado
operativo** declarado en la función y visible en la UI: **STEL** para
cotizaciones, pedidos y remitos de Buscatools; **ERP** para el resto. Cambiarla
es una decisión de cutover, no un dato editable.

## I · Conflictos

**RT (re-auditado, lectura del legacy):** STEL ya emitió **RT0000001424, 1425 y
1426** (última fecha en el legacy: 2026-09-11). React tiene importado hasta
RT0000001423 y su próximo es **RT0000001424** → **colisión de 3 números si React
emitiera un remito**. Contra los datos importados la secuencia está «OK»: **la
colisión no es detectable desde la base nueva** porque los documentos
posteriores de STEL no están en ella. La UI lo advierte en toda secuencia con
autoridad STEL («Al día no descarta una colisión con STEL»). No se corrigió.

Otros:
- **COTI:** STEL llegó a COTI02547; React saltaría a COTI02629 (sin colisión hoy,
  hueco de 81).
- **PDV:** 9 números atípicos del import (PDV11xxx) quedan por encima; sin ellos
  la secuencia está al día. En el legacy no hay pedidos nuevos.
- **Riesgo vigente fuera de esta entrega:** Ventas en React permite crear
  cotizaciones, pedidos y remitos con `next_document_number`. Mientras STEL sea
  autoridad, hacerlo generaría números fuera de la serie de STEL (y en RT,
  duplicados).

## J · Seguridad

| capa | estado |
|---|---|
| `companies` UPDATE/INSERT/DELETE directo | **bloqueado** para authenticated y anon (policy borrada, privilegios revocados) |
| `document_sequences` | sin policies y sin privilegios de tabla para anon/authenticated; lectura sólo por la RPC de diagnóstico |
| RPC de empresa | SECURITY DEFINER, `search_path` fijo, sin EXECUTE para PUBLIC/anon; lista blanca, `campos_no_permitidos` ante cualquier extra |
| RPC de logo | sólo `service_role` |
| Edge Function | `verify_jwt`, CORS con lista de orígenes, sin URLs firmadas ni tokens en respuestas, sin logs de JWT ni del cuerpo |
| Storage | bucket privado; subida y borrado directos bloqueados |
| Advisors | nuevos: 3 WARN «authenticated puede ejecutar DEFINER» para `config_empresa_obtener`, `config_empresa_actualizar`, `config_numeracion_diagnostico` (intencional, con guardas, mismo patrón que el resto). Sin ERROR nuevos. Preexistentes: vista `product_availability` (ERROR), leaked password protection (WARN), tablas sin policies (INFO) |

Detalle observado: un SVG con `<script>` enviado a la función lo corta antes el
gateway con 403 (no llega al código); un SVG sin script llega y la función lo
rechaza con 422.

## K · Mobile (medido)

| ancho | Empresa | Numeración |
|---|---|---|
| 390 | sin overflow · controles ≥ 44 px · inputs 16 px | cards, sin overflow |
| 430 | ídem | cards, sin overflow |
| 768 | ídem | tabla con scroll interno, sin overflow global |
| 1440 | ídem | tabla sin scroll |

Accesibilidad: `fieldset`/`legend` por sección, `label` en cada campo, errores
con `aria-invalid` + `aria-describedby`, estados de numeración con texto (no
sólo color), diálogo de confirmación con foco y Escape.

## L · Tests

| suite | resultado |
|---|---|
| `scripts/fase12-configuracion-entrega2-tests.mjs` (base + Edge Function + lectura de Buscatools) | **71 PASS · 0 FAIL** |
| vitest | 60 archivos · **708 PASS** (nuevos: `empresa.test.ts`, `numeracion.test.ts`; actualizado el de permisos) |
| `test:isolated`, `lint`, `typecheck`, `build` | verdes |
| regresión, en serie | Configuración E1 **85 PASS** (sin casos de envío, ver abajo) · RLS por roles **71 PASS · 0 fallos** |

La suite E2 cubre: lógica pura del logo (8) · permisos con JWT reales de 8
identidades + anon (8) · lista blanca con 11 campos inyectados, tipos, 17
formatos inválidos, normalización y datos históricos (8) · concurrencia: versión
vieja, versión nula y 6 rondas de guardados simultáneos (3) · escrituras
directas sobre `companies`, 7 ataques a `document_sequences` y RPC de edición
inexistentes (7) · bitácora (4) · numeración con estados BEHIND/OK/SIN_DOCUMENTOS
y lectura real de Buscatools (10) · logo: 11 ataques, ciclo subir → firmar →
reemplazar → quitar, subida y borrado directos bloqueados, CORS (19) · datos
reales intactos (2).

**Incidente durante la regresión:** con el SMTP propio ya configurado, la suite
de la Entrega 1 dejó de chocar con el mailer por defecto y **envió 3 invitaciones
reales** (14:51:59, 14:52:03 y 14:52:07 UTC) a direcciones de fixture
`zz-cfg1-…@buscatools.test`. `.test` es un dominio reservado que no entrega:
ninguna persona las recibió, pero puede haber rebotes en el buzón remitente. Las
cuentas se borraron. Corregido: los casos con envío real de esa suite quedan
**desactivados por defecto** (`--con-envios` para correrlos con direcciones
controladas).

Prueba real en navegador (fixture `zz-cfg2ui`, magic link sin correo): editar y
guardar; email inválido bloquea el guardado con el error asociado al campo;
normalización visible tras guardar; **conflicto real** (otro admin cambió el
sitio web) → mensaje y recarga sin pisar; SVG rechazado en el navegador; PNG
real subido, mostrado con URL firmada y quitado con confirmación; Numeración
con colisión, «Al día» y «Sin documentos»; employee: Empresa en sólo lectura,
sin botones de logo, sin acceso a Usuarios (0 llamadas), Numeración visible.
Fixtures y enlaces temporales borrados.

## M · Limitaciones

- La colisión con STEL no se detecta desde la base (I).
- Dirección en un solo campo: no hay ciudad/provincia/país/código postal.
- CUIT/NIF sólo por forma.
- La impresión de documentos no usa el logo todavía.
- Moneda base y estado de la empresa no se editan.
- Si el borrado del logo anterior falla, queda un objeto huérfano sin referencia
  (se registra en logs de la función).

## N · Pendientes

1. Alinear la numeración con STEL en el cutover (decisión U-B-1 de la Entrega 0).
2. Decidir si React debe dejar de ofrecer altas de cotización/pedido/remito
   mientras STEL sea autoridad.
3. Cargar los datos de Torquetools (un admin, desde la pantalla).
4. Usar el logo en la impresión de Ventas y Compras.
5. SPF / DKIM / DMARC (fuera de esta entrega).
