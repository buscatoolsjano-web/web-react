# Fase 17 · Clientes · Entrega 0 — Auditoría funcional, modelo y UX

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
**Sin implementar**: 0 cambios de base, 0 cambios de código de aplicación, 0 datos tocados, sin push.
Todo lo que sigue sale de leer el código, el esquema y **contar** filas de producción (nunca de
mostrar datos de clientes).

> Conclusión de entrada, para no perder tiempo: **el módulo de Clientes no está vacío ni es viejo**.
> Se construyó entero en la Fase 5 (listado, ficha con 7 pestañas, alta, edición, contactos,
> direcciones, memoria de productos, precios, historial) y se rediseñó en la Fase 13 · E4. Lo que
> falta no es «hacer Clientes»: es **cerrar la distancia con el estándar que dejó Ventas E1–E6** y
> **conectar los defaults comerciales del cliente con los documentos**, que hoy están desconectados.

---

## 1 · Estado actual del módulo

| Clave | Cómo está |
|---|---|
| CURRENT_CUSTOMER_LIST | `/clientes` — listado **server-side** con `count: 'exact'`, filtros en la URL (`q`, `rubro`, `revision`, `bajas`, `page`, `per`, `orden`, `dir`), paginado 10/25/50/100 y exportación a CSV. Columnas: selección · **Referencia** · **Nombre jurídico** (link) · **CUIT** · **Rubro** · **Nombre comercial** · **Email** (el primero + «+N») · **Dominio**; las cuatro primeras ordenables con `aria-sort`. A 1279 px se ocultan nombre comercial y dominio, a 1023 px el rubro, y **por debajo de 768 px la tabla se reemplaza por tarjetas** (`useIsMobile`). Búsqueda con debounce de 300 ms sobre `legal_name`, `trade_name`, `legacy_ref`, `tax_id` y `legacy_name`, más los arrays `emails`/`email_domains` cuando el texto parece un mail. |
| CURRENT_CUSTOMER_DETAIL | `/clientes/:id` — cabecera con nombre, badge «Migrado del sistema anterior», razón social y referencia; acciones **Editar** y **Dar de baja**; tira de contacto (contacto principal, email, teléfono, CUIT, dirección principal); panel **Actividad** con 6 métricas de una sola función SQL (`resumen_cliente`); y 7 pestañas: **Datos comerciales · Contactos · Direcciones · Memoria de productos · Precios · Historial · Relacionados**. |
| CURRENT_CUSTOMER_CREATE | `/clientes/nuevo`, formulario propio. La referencia la da `next_document_number(company,'customer')` —la misma numeración que Ventas— **antes** del insert; si el insert falla, ese número queda como hueco. Un solo `insert` en `customers`: el alta no crea contacto ni dirección. |
| CURRENT_CUSTOMER_EDIT | «Editar» reemplaza la vista de lectura **dentro de la pestaña «Datos comerciales»** (no hay ruta `/editar`) con un formulario de borrador local y **Guardar cambios / Cancelar**. En todo el módulo **no hay un solo `onBlur`**: no se guarda campo por campo. Lo que falta: **control de concurrencia** (el `update` filtra por `company_id` + `id`, sin `updated_at` ni `select()` de retorno: gana el último que escribe), **aviso al salir con cambios** (`useSalidaConCambios` existe y lo usan las 5 páginas de Ventas, ninguna de Clientes) y **atomicidad** (es un `update` desde el navegador, no una RPC). Validación: razón social obligatoria, CUIT de 11 dígitos **sólo si cambió**, emails con forma válida y sin repetidos; los errores se resumen en un `Alert role="alert"`. |
| CURRENT_CONTACTS | Pestaña propia con alta, edición y borrado físico (`EditorContactos`), ordenados por principal y nombre. Soporta **contacto principal** (`is_default`), precargado en `true` para el primero. Dos problemas: marcar principal son **dos escrituras sin transacción** (baja el anterior, sube el nuevo) y el borrado es un **DELETE físico** que, si el contacto está en un documento, la base rechaza con el error crudo. El formulario no ofrece el campo «notas», aunque la columna se lee y se muestra. |
| CURRENT_ADDRESSES | Pestaña propia con alta, edición y borrado (`EditorDirecciones`), con los 4 tipos del modelo y principal **por tipo**. **Es la ÚNICA superficie de `customer_addresses` en toda la aplicación**: ni Ventas, ni Compras, ni Mantenimiento, ni Emails la leen o escriben. Y **nadie cargó ninguna dirección**: 0 filas en producción. |
| CURRENT_COMMERCIAL_DATA | La pestaña «Datos comerciales» muestra razón social, nombre comercial, referencia, rubro, tipo, estado, condición de pago, moneda por defecto, **vendedor asignado (sólo lectura)**, alta, nombre en el sistema anterior, dominios y notas. `discount_pct` y `credit_limit` **se leen en el servicio y están en el tipo, pero no se renderizan en ninguna parte**. La **tarifa por cliente no aparece**: ni en lectura ni en edición. |
| CURRENT_RELATED | Pestaña **Historial**: importes por moneda (RPC `totales_por_moneda_cliente`), gráfico de 12 meses (`actividad_mensual_cliente`) y tabla Documento/Número/Fecha/Estado/Total **con links a Ventas** y atajos «Ver N … en Ventas» (`?cliente=<id>`); tres consultas en `Promise.all`, tope 200 por tipo. Pestaña **Relacionados**: candidatos de orden de compra (`customer_po_candidates`, 134 en producción), sólo lectura. Pestañas **Memoria de productos** (alias cliente→SKU) y **Precios** (último precio por producto y moneda, con variación, más el histórico paginado). |
| CURRENT_AUDIT | **No hay auditoría de clientes.** `sales_audit` sólo tiene `sales_quote` y `sales_order`; nada escribe eventos de cliente, contacto o dirección. La ficha muestra el alta (`created_at`) y el badge de migrado, pero **ni `updated_at` ni quién modificó**. Lo único parecido es la cola de revisión (`needs_review` / `review_reason`) y el log de reconciliación de STEL. |
| CURRENT_PERMISSIONS | El módulo tiene su **propio** helper (`src/modules/clientes/lib/permisos.ts` → `permisosDe`), no el de Ventas. `admin` y `employee`: todo. `salesperson`: crea, edita y da de baja **los suyos** (el servidor le pone `salesperson_id = auth.uid()` con un trigger y no lo deja cambiarlo), pero **no puede tocar contactos, direcciones ni memoria, ni resolver revisiones**. `customer` (portal): se ve a sí mismo. Otra empresa y anónimo: nada. Cada bandera se combina además con `!cliente.dadoDeBaja`. |

---

## 2 · Modelo de datos — matriz de campos

`CUSTOMER_MODEL`: una tabla `customers` ancha y bien poblada de identidad, tres FK comerciales y
soft-delete; `customer_contacts` y `customer_addresses` completas y con «principal» resuelto por
índice único parcial.

| FIELD | SOURCE_TABLE | REAL_DATA_PRESENT | USED_IN_UI | USED_IN_SALES | EDITABLE | ESTADO |
|---|---|---|---|---|---|---|
| `legal_name` | customers | 1010/1010 | sí | sí (nombre del documento) | sí | OK |
| `trade_name` | customers | 961 (95 %) | sí | sí (se prefiere al legal) | sí | OK |
| `tax_id` | customers | 565 (56 %); 544 con 11 dígitos | sí | impresión | sí | OK |
| `emails[]` | customers | 877 (87 %) | sí | no | sí | OK |
| `email_domains[]` | customers | 680 (67 %) | sí | no (sí en email/WhatsApp) | sí | OK |
| `phone` | customers | **3 (0,3 %)** | sí | no | sí | OK (dato casi vacío) |
| `industry` | customers | **1** | sí («Rubro») | no | sí | OK (dato casi vacío) |
| `customer_type` | customers | 1010 `business` | sí | no | sí | OK |
| `status` | customers | 1010 `active` | sí | filtra el buscador | vía baja/reactivación | OK |
| `deleted_at` | customers | 0 | sí | excluye del buscador | vía baja | OK |
| `notes` | customers | 0 | sí | no | sí | OK |
| `payment_terms` | customers | **3** | sí (lectura) | **sugerencia no cableada** | sí | **GAP de uso** |
| `default_currency` | customers | **3** | sí (lectura) | **sugerencia no cableada** | sí | **GAP de uso** |
| `default_price_list_id` | customers | **3** | **no se muestra** | **sugerencia no cableada** | **no** | **MISSING en UI** |
| `salesperson_id` | customers | **1** | sí (lectura) | **sugerencia no cableada** | **no** (lo pone el trigger) | **MISSING en UI** |
| `discount_pct` | customers | 0 ≠ 0 | no | no | no | **MISSING en UI** |
| `credit_limit` | customers | 0 | no | no | no | **MISSING en UI** |
| `legacy_ref` | customers | 991 (98 %) | sí («Referencia») | no | no (a propósito) | OK |
| `imported_at` / `legacy_source` / `legacy_name` | customers | 950 importados | badge «Migrado» | no | no | OK |
| `needs_review` / `review_reason` | customers | **40 a revisar** | sí (aviso + filtro + resolver) | no | vía RPC | OK |
| `full_name`, `role`, `email`, `phone`, `fax`, `notes` | customer_contacts | 87 contactos en 30 clientes | sí | `contact_id` en los 3 documentos | sí | OK |
| `is_default` (contacto principal) | customer_contacts | **0 marcados** | sí | no | sí | **existe, sin datos** |
| `kind`, `street`, `city`, `state`, `postal_code`, `country_code`, `is_default`, `notes` | customer_addresses | **0 filas** | sí | `shipping_address_id` en pedido y remito; `delivery_address_snapshot` en remito | sí | **existe, sin datos** |

Índices existentes (no hace falta crear nada en E1): trigram sobre `legal_name` y `trade_name`
(búsqueda por nombre), GIN sobre `emails` y `email_domains`, únicos parciales de CUIT normalizado a
11 dígitos y de `legacy_ref` por empresa, `is_default` único por cliente (contactos) y por
cliente+tipo (direcciones), e índice por vendedor.

### Identidad: qué es obligatorio y qué no

- **Obligatorio real**: `legal_name` y `company_id`. Nada más.
- **Único por empresa**: el CUIT, comparado **normalizado a 11 dígitos** y sólo para clientes no
  dados de baja; y `legacy_ref`.
- **Puede repetirse**: el nombre (hay razones sociales parecidas de verdad), el email y el teléfono.
- **No existe** en el modelo: separación entre «nombre de fantasía» y «alias», tipo de contribuyente
  / condición frente al IVA, ni país a nivel cliente (sí a nivel dirección).

---

## 3 · Perfil de datos productivos (`CUSTOMER_DATA_PROFILE`)

Sólo cantidades. Empresa Buscatools, 1.010 clientes:

| Dato | Clientes | % |
|---|---|---|
| Activos / dados de baja | 1010 / 0 | 100 % / 0 % |
| Tipo empresa / persona | 1010 / 0 | 100 % / 0 % |
| Con CUIT (cualquier formato) | 565 | 56 % |
| Con CUIT válido de 11 dígitos | 544 | 54 % |
| Con nombre comercial | 961 | 95 % |
| Con al menos un email | 877 | 87 % |
| Con dominio de email | 680 | 67 % |
| Con teléfono | 3 | 0,3 % |
| Con rubro | 1 | 0,1 % |
| Con notas | 0 | 0 % |
| Con vendedor asignado | 1 | 0,1 % |
| Con tarifa por defecto | 3 | 0,3 % |
| Con condición de pago | 3 | 0,3 % |
| Con moneda por defecto | 3 | 0,3 % |
| Con descuento o límite de crédito | 0 | 0 % |
| Importados de legacy | 950 | 94 % |
| Marcados para revisión | 40 | 4 % |
| Con contactos | 30 (87 contactos) | 3 % |
| Con contacto marcado principal | 0 | 0 % |
| **Con direcciones** | **0** | **0 %** |
| Con cotizaciones / pedidos / remitos | 58 / 34 / 33 | 5,7 % / 3,4 % / 3,3 % |

Motivos de revisión: `CUIT_REPETIDO_EN_LEGACY` 31 · `CUIT_NO_ASIGNADO` 27 · `SOLO_EN_CONTACTOS` 7 ·
`VARIOS_LEGACY_AL_MISMO_CLIENTE` 3 (un cliente puede tener más de uno).

Distribución de contactos: 16 clientes con 1, 5 con 2, 3 con 3, y una cola larga hasta **uno con 22**.

**La lectura importante**: la ficha del cliente hoy es sobre todo identidad importada. Lo comercial
—tarifa, vendedor, condición de pago, moneda, domicilio— está **vacío en la práctica**. Cualquier
diseño que dé esos datos por sentados va a mostrar «Sin registrar» el 99 % de las veces.

---

## 4 · Relación con Ventas (`SALES_INTEGRATION_MAP`)

| CUSTOMER_FIELD | SUGIERE EN EL DOCUMENTO | HOY | SNAPSHOT / REFERENCIA VIVA |
|---|---|---|---|
| `customers.default_price_list_id` | `price_list_id` de cotización y pedido | **no está cableado**: el alta abre sin tarifa | **snapshot** (E2/E4 ya lo congelan) |
| `customers.salesperson_id` | `salesperson_id` de cotización y pedido | no cableado | **snapshot** |
| `customers.payment_terms` | `payment_terms` | no cableado (hoy se sugiere un texto fijo, «30 DIAS F/F con ECHEQ») | **snapshot** |
| `customers.default_currency` | `currency_code` | no cableado (el alta obliga a elegir, por decisión de Ventas E3) | **snapshot** |
| `customer_contacts.id` (principal) | `contact_id` | el desplegable lista los contactos del cliente, sin preseleccionar | **referencia viva** (FK) + nombre al imprimir |
| `customer_addresses.id` (envío) | `shipping_address_id` del pedido | **no hay UI para elegirla** | **referencia viva** en el pedido |
| idem | `delivery_address_snapshot` del remito | ya implementado en E6 (copia al emitir) | **snapshot congelado** |
| `customers.discount_pct` | `discount_pct` del documento | no cableado | snapshot |

Dónde pide Ventas cada cosa hoy: `BuscadorCliente` (ventas) busca por nombre, CUIT y referencia
excluyendo bajas e inactivos; el desplegable de contacto sale de `opciones.ts`, que ya ordena por
`is_default` primero —o sea que **el día que haya un contacto principal, ya aparece arriba**—; y la
dirección de entrega **no tiene ninguna UI**: `sales_orders.shipping_address_id` existe y nadie lo
escribe. Además de Ventas, consumen clientes los módulos de **Mantenimiento** (buscador de cliente
para activos y órdenes), **Emails** (panel de cliente vinculado con sus contactos) y **WhatsApp**
(panel con enlaces a la ficha y a sus documentos).

Estado de los datos históricos: de 306 cotizaciones, 172 pedidos y 193 remitos, **ninguno** tiene
`contact_id`, `price_list_id`, `salesperson_id` ni `shipping_address_id`. Las columnas son nuevas y
la carga es hacia adelante: no hay nada que migrar, y **no hay que inferir** la tarifa o el vendedor
a partir de documentos viejos.

`REGLA DOCUMENTO VS CLIENTE` (la que ya rige en Ventas y conviene escribir en la ficha):

> El cliente **sugiere**; el documento **congela**. Cambiar la tarifa, el vendedor o el domicilio del
> cliente **no** cambia ningún documento ya emitido. Lo único que viaja como referencia viva es la FK
> al contacto y a la dirección: el nombre y el domicilio que valen para un remito emitido son los de
> su snapshot.

---

## 5 · Contactos, direcciones y «principal»

- **Contacto principal existe en el modelo** (`is_default` + índice único parcial por cliente) y la
  pantalla lo ofrece. Lo que no existe son los datos: **0 contactos marcados**. No hay que inventar
  el concepto: hay que empezar a usarlo (y ofrecerlo como default de `contact_id`).
- Marcar principal hoy son **dos escrituras sueltas** (bajar el anterior, subir el nuevo). Si la
  segunda falla, el cliente queda sin principal. Es el mismo problema que Ventas resolvió con RPC.
- **Direcciones**: el esquema soporta `billing`, `shipping`, `both`, `other`, con **default por tipo**
  (índice único parcial `(company_id, customer_id, kind) where is_default`). Le falta lo que el
  negocio argentino suele querer separado: **número, piso/depto** (hoy todo entra en `street`) y una
  marca de **activa/inactiva** (hoy sólo se borra). `country_code` existe.
- Un contacto o una dirección referenciados por documentos **no se pueden borrar**: la FK es
  `on delete no action` desde `sales_quotes`, `sales_orders` y `deliveries`. La UI hoy ofrece
  «Eliminar» y el error llega crudo de la base.

`ADDRESSES` — decisión concreta que pide el § 32:

1. **No hace falta tabla nueva.** `customer_addresses` alcanza.
2. Faltan tres columnas chicas: `street_number`, `floor_unit` (o aceptar que `street` es una línea
   libre y documentarlo) y `active boolean not null default true`.
3. **Default por tipo**: ya está resuelto por índice. Marcar una como default tiene que ser **una
   RPC** que baje la anterior y suba la nueva en una transacción.
4. **Selección desde el documento**: el pedido debería tener un selector «Dirección de entrega» con
   las direcciones `shipping`/`both` del cliente, preseleccionando la default. El remito ya congela
   lo que reciba (E6).
5. **Congelado**: ya está hecho en el remito (`delivery_address_snapshot`). Para el pedido, la
   referencia viva alcanza: el pedido se puede reimprimir con la dirección actual sin mentir, porque
   todavía no se entregó. **El papel que se entrega es el remito, y ése ya está congelado.**

---

## 6 · Documentos, adjuntos y actividad

- `DOCUMENTS`: la pestaña Historial ya trae cotizaciones, pedidos y remitos del cliente por
  `customer_id`, con totales por moneda y un gráfico de 12 meses. Falta que cada fila **enlace** al
  documento con el estándar de Ventas (número, fecha, estado, total, link) y poder filtrar por tipo.
- `ATTACHMENTS`: la tabla **ya acepta `entity_type = 'customer'`** (está en el CHECK) y hay **0**
  filas. La infraestructura de E6 —bucket privado, URL firmada, validación de ruta, auditoría— se
  reutiliza tal cual; la única condición es extender el trigger `app.validar_adjunto()` para que
  valide también el caso `customer`. **No hace falta tabla nueva.**
- `AUDIT`: hoy **no existe** para clientes. `sales_audit` sirve (es genérica: `entity_type`,
  `entity_id`, `action`, `diff`, `actor_id`), pero nadie escribe eventos de cliente. Un timeline real
  se puede armar con: documentos del cliente + adjuntos + eventos de edición **si se empiezan a
  registrar**. Hasta entonces, «Actividad» debe seguir siendo lo que ya es —documentos— y no un
  timeline inventado.

---

## 7 · Permisos, RLS y seguridad

`PERMISSIONS`

| rol | ve clientes | crea | edita | da de baja | contactos/direcciones | resuelve revisión |
|---|---|---|---|---|---|---|
| admin | todos | sí | sí | sí | sí | sí |
| employee | todos | sí | sí | sí | sí | sí |
| salesperson | **sólo los suyos** | sí (queda como su vendedor) | sólo los suyos | sí (los suyos) | **no** | **no** |
| technician | no | no | no | no | no | no |
| customer (portal) | **sólo a sí mismo** | no | no | no | ve los suyos | no |
| otra empresa / anon | nada | nada | nada | nada | nada | nada |

`RLS`: activa en las tres tablas.

- `customers`: `select` por rol (admin/employee todo, salesperson lo suyo, portal a sí mismo si no
  está dado de baja), `insert` y `update` para admin/employee/salesperson. **No hay policy de
  DELETE**: desde la aplicación un cliente no se borra nunca —el intento no falla, simplemente no
  alcanza ninguna fila— y además `app.proteger_borrado_cliente()` lo rechaza si tiene documentos.
- `customer_contacts` / `customer_addresses`: `select` para internos de la empresa o el propio
  cliente del portal; `write` para `app.current_writer_company_ids()`, o sea **admin y employee**.

`SECURITY` — lo que encontré, todo de diseño y nada urgente:

1. **Asimetría de permisos**: un `salesperson` puede crear un cliente pero **no puede cargarle un
   contacto ni una dirección**. Es incoherente de cara al usuario y hoy se resuelve pidiéndoselo a un
   admin. Es una decisión de negocio (§ 39), no un bug.
2. El `update` de cliente **no controla concurrencia**: dos pestañas pisan sin avisar. Mismo problema
   que Ventas tenía antes de E2.
3. Marcar contacto/dirección principal **no es atómico** (dos requests).
4. `resolver_revision_cliente` es `SECURITY DEFINER` pero **valida el rol adentro** (admin/employee) —
   correcto.
5. El linter de Supabase no reporta nada sobre estas tres tablas (ni RLS faltante ni policy faltante).
6. Los filtros del listado son **del servidor** (`.eq`, `.or`, `range`, `count: exact`): no hay
   filtrado sólo-frontend ni consultas sin `company_id`.
7. La ficha del portal: un cliente logueado ve su propia fila y sus contactos. Conviene revisar qué
   muestra la pestaña «Datos comerciales» en ese caso antes de abrir el portal a clientes reales.

---

## 8 · Performance, responsive y accesibilidad

- `PERFORMANCE`: listado paginado server-side con `count: 'exact'`; la búsqueda usa `ilike '%x%'`
  sobre columnas con índice trigram; el resumen de la ficha es **una** función SQL; el historial son
  tres consultas en `Promise.all` con tope 200; los precios son RPC con `count(*) over ()`.
  **No hay N+1 por fila en ningún lado.** Dos cosas para mirar en E1, ninguna urgente: el
  `count: 'exact'` se recalcula en cada tecleo (barato con 1.010 filas, caro con 50.000) y
  `exportarClientes` hace hasta **5 requests secuenciales** de 1.000 filas.
- `RESPONSIVE`: verificado en el navegador a 375 px sobre listado y ficha: **sin desborde
  horizontal**, tabla → tarjetas a 768 px (por JS, `useIsMobile`), columnas que se van cayendo a
  1279 y 1023 px, emails con área táctil de 44 px, botones a ancho completo en el formulario. La
  Fase 13 · E4 ya corrigió contraste, inputs < 16 px y confirmaciones en línea.
- `ACCESSIBILITY`: mejor de lo esperado. Un solo `h1` por página (los vacíos de sección fuerzan
  `headingLevel=3`), todos los campos por `Field` con `useId` y `fieldset`/`legend`, `th scope="col"`
  y `aria-sort` en las tablas, pestañas con el patrón ARIA completo (`tablist`/`tab`/`tabpanel`,
  foco itinerante), `role="alertdialog"` en las tres confirmaciones destructivas con el foco inicial
  en «Cancelar», errores con `role="alert"`, y el gráfico con `role="img"` **más una tabla con los
  mismos datos**. Lo que queda para mirar en E1: que el resumen de errores mueva el foco al primer
  campo inválido, y el uso de `title` como único portador de detalle en un par de celdas.

---

## 9 · Legacy y STEL

`LEGACY_GOOD_PATTERNS` (del `index.html` auditado en la Fase 5, ya migrado en su mayoría):

- ficha con pestañas y **panel rápido** con métricas + gráfico de 12 meses → migrado y mejorado;
- **memoria de productos** («cómo llama el cliente a cada SKU») → migrado, 14 alias en 3 clientes;
- **precios históricos por SKU** → migrado como función, sin tabla caché;
- listado con filtro por columna y export CSV → migrado (server-side);
- lo que **no** se migró a propósito: «Clientes potenciales» (en el legacy no hacía nada) y el total
  único que sumaba ARS + USD + EUR (mentía).

`STEL`: la reconciliación **sólo escribe `tax_id`**, y sólo si el cliente no tenía CUIT y nadie más
lo usa (`stel_reconciliar_cliente`). No hay sincronización de nombre, email ni dirección. Los campos
de importación (`imported_at`, `legacy_source`, `legacy_ref`, `legacy_name`) no se editan desde el
ERP y así debe quedar.

---

## 10 · Lo que falta en el esquema (`MISSING_SCHEMA`)

Nada urgente, y **nada de esto se toca en E0**:

| Falta | Para qué | Prioridad |
|---|---|---|
| `customer_addresses.active` | dar de baja una dirección sin borrarla (hoy sólo se borra, y una referenciada por un documento no se puede borrar) | alta si se empiezan a cargar direcciones |
| `customer_addresses.street_number`, `floor_unit` | separar altura y piso/depto; hoy todo va en `street` | media (o documentar que `street` es línea libre) |
| RPC `guardar_cliente(p_customer, p_esperado, p_datos)` | edición atómica con control de concurrencia, como Ventas | alta |
| Desactivar contacto en vez de borrarlo (`active` o `deleted_at`) | hoy es DELETE físico y la FK desde los documentos lo rechaza con un error crudo | media |
| RPC `marcar_contacto_principal` / `marcar_direccion_principal` | que «principal» sea una sola transacción | media |
| Eventos de auditoría de cliente en `sales_audit` (o tabla propia) | trazabilidad de la ficha; hoy no hay ninguna | media |
| `entity_type = 'customer'` en `app.validar_adjunto()` | habilitar adjuntos del cliente reutilizando E6 | media |
| Condición frente al IVA / tipo de contribuyente | facturación futura | baja (decisión de negocio) |

---

## 11 · Decisiones que necesito de Juan (`BUSINESS_DECISIONS`)

**BLOCKING** (sin esto no puedo diseñar bien E2/E3):

1. **¿El vendedor asignado se edita desde la ficha?** Hoy lo pone el servidor cuando un vendedor crea
   el cliente y nadie más lo cambia. ¿Un admin debería poder reasignar la cartera?
2. **¿La tarifa por defecto del cliente debe sugerir la tarifa de la cotización?** Es el cambio que
   más se nota en el día a día, y hoy no está conectado.
3. **¿Un vendedor puede cargar contactos y direcciones de sus clientes?** Hoy no puede, y es raro.
4. **¿Qué tipos de dirección se usan de verdad?** El modelo ofrece facturación, entrega, ambas y otra.
   Si en la práctica es una sola, simplifico la pantalla.
5. **¿El CUIT debe ser obligatorio para clientes nuevos?** Hoy 44 % no tiene, todos importados. Se
   puede exigir sólo en los nuevos.

**NICE_TO_HAVE**:

6. ¿Sirve el «rubro»? Hay **un** cliente con rubro cargado. Si no se usa, lo saco de la ficha.
7. ¿Sirve el teléfono a nivel cliente, o el teléfono vive en el contacto? Hoy: 3 clientes con
   teléfono contra 87 contactos.
8. ¿Querés límite de crédito y descuento por cliente? Las columnas existen, vacías, y no hay ninguna
   regla de negocio escrita que las use.
9. ¿«Estado» del cliente necesita más que activo/inactivo (por ejemplo «moroso» o «bloqueado»)?
10. Los 40 clientes marcados para revisión, ¿los resolvés vos desde la ficha o querés una pantalla de
    cola con los duplicados enfrentados?

---

## 12 · Propuesta de UX

### `DESKTOP_WIREFRAME`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Clientes                                                                    │
│ ACINDAR S.A.                       [Activo] [Migrado]        Cotizaciones 12  │
│ Acindar Grupo ArcelorMittal · CLI00215 · CUIT 30-50287435-3  Pedidos       4  │
│                                                              Última  12/09/26 │
│ [Nueva cotización]  [Editar]  [Adjuntar]  [Más ▾]            [Dar de baja]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Resumen │ Contactos 3 │ Direcciones 2 │ Comercial │ Documentos 16 │ Adjuntos │ Trazabilidad │
├──────────────────────────────────────────────────────────────────────────────┤
│ RESUMEN                                                                       │
│ ┌ Identidad ──────────────┐ ┌ Comercial ─────────────┐ ┌ Contacto principal ┐│
│ │ Razón social            │ │ Vendedor    Juan M.    │ │ Ana Pérez · Compras││
│ │ Nombre comercial        │ │ Tarifa      Mayorista  │ │ ana@acindar.com    ││
│ │ CUIT · Referencia       │ │ Cond. pago  30 días    │ │ +54 11 ...         ││
│ │ Emails · Dominios       │ │ Moneda      USD        │ │ [Ver los 3]        ││
│ └─────────────────────────┘ └────────────────────────┘ └────────────────────┘│
│ ┌ Dirección de entrega principal ─────────────────┐ ┌ Últimos documentos ───┐│
│ │ Av. Siempreviva 742 · Springfield · B1636 · AR  │ │ COTI02558 12/09 USD…  ││
│ │ [Ver las 2]                                     │ │ PDV01321  10/09 USD…  ││
│ └─────────────────────────────────────────────────┘ └───────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

Reglas del wireframe: **cada tarjeta se muestra sólo si el dato existe o si su ausencia es
información** (contacto principal y dirección de entrega sí; rubro y límite de crédito no). El panel
de Actividad de hoy se convierte en tres números en la cabecera, que es donde se miran.

### `MOBILE_WIREFRAME`

```
┌────────────────────────┐
│ ← Clientes             │
│ ACINDAR S.A.           │
│ [Activo] [Migrado]     │
│ CLI00215               │
│ ┌────────────────────┐ │
│ │ 12 cot · 4 ped     │ │
│ │ Última 12/09/26    │ │
│ └────────────────────┘ │
│ [Nueva cotización]     │   ← una sola primaria, ancho completo
│ [Editar] [Más ▾]       │
│ ─ Resumen ─ Contactos ─│   ← pestañas con scroll horizontal propio
│ Identidad              │
│  Razón social          │
│  CUIT · Referencia     │
│ Comercial              │
│  Vendedor · Tarifa     │
│ Contacto principal     │
│  Ana Pérez             │
│ [Ver los 3 contactos]  │   ← tarjetas, nunca tabla
└────────────────────────┘
```

Alta (las dos): **un paso**, con identidad arriba y, plegados, «Contacto (opcional)» y «Datos
comerciales (opcional)». Sin dirección en el alta: se carga desde la ficha, donde se elige el tipo.
Edición: **borrador con Guardar / Descartar, aviso al salir y control de concurrencia**, igual que la
cotización.

---

## 13 · Plan de implementación (`IMPLEMENTATION_PLAN`)

El orden sale de la auditoría, no de la lista teórica: primero lo que **arregla riesgos**, después lo
que **conecta con Ventas**, y al final lo que agrega superficie.

| Entrega | Qué | Por qué en ese orden |
|---|---|---|
| **E1 · Edición segura** | RPC `guardar_cliente` con whitelist y `updated_at`, borrador con Guardar/Descartar, aviso al salir, y eventos `created`/`updated` en auditoría. Sin campos nuevos. | Es el único riesgo real de pérdida de datos que queda en el módulo, y ya sabemos exactamente cómo se hace. |
| **E2 · Defaults comerciales y su uso en Ventas** | Editar vendedor, tarifa, condición de pago, moneda y descuento desde la ficha; y que **sugieran** al crear cotización y pedido (nunca recalculando documentos existentes). | Es el cambio que más se nota, y el que justifica que las columnas existan. |
| **E3 · Contactos y direcciones al estándar** | Principal atómico por RPC, no borrar lo referenciado (desactivar), `active` en direcciones, selector de dirección de entrega en el pedido. | Depende de la decisión sobre tipos de dirección y sobre permisos del vendedor. |
| **E4 · Ficha completa** | Shell documental con pestañas, Resumen nuevo, Documentos con enlaces al estándar de Ventas, Adjuntos reutilizando E6 y Trazabilidad. | Es presentación: conviene hacerla cuando los datos de E1–E3 ya existen, para no diseñar sobre huecos. |
| **E5 · Cola de revisión y duplicados** | Pantalla para los 40 marcados, con los candidatos enfrentados y fusión asistida. | Es trabajo de datos, no de UX, y puede esperar. |

---

## 14 · Cierre

```
DB_CHANGES = 0
APP_CODE_CHANGES = 0
FILES_CREATED = docs/PHASE_17_CLIENTES_ENTREGA_0_AUDITORIA.md
```

No se tocó Ventas, WhatsApp, OpenAI, STEL, Compras, Stock, Productos, Mantenimiento ni Informes. No
se crearon fixtures. No hubo push.
