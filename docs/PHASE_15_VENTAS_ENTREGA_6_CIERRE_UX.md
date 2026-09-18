# Fase 15 · Ventas · Entrega 6 — Cierre de la experiencia diaria

Fecha: 2026-09-17. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: `docs/database/PHASE_15_VENTAS_ENTREGA_6.sql` (migraciones
`phase15_ventas_entrega_6_domicilio_y_adjuntos`, `…_remito_domicilio`,
`…_storage_select_carpeta`), con ROLLBACK.

E6 cierra lo que se usa todos los días alrededor de los tres documentos: adjuntos, relacionados,
vista previa e impresión, la pestaña Información y el domicilio de entrega. **Buena parte ya existía
y se auditó antes de tocar nada**: lo que estaba bien se dejó como estaba y se documenta acá para no
volver a discutirlo.

WhatsApp no se tocó.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_ATTACHMENTS | **Ya existía** y bien resuelto: tabla `attachments` (una sola, con `entity_type`/`entity_id` para los tres documentos y ocho más), bucket privado `ventas` con límite de 20 MB y lista blanca de tipos, subida cliente→Storage y después la fila, URL firmada de 5 minutos, RLS por empresa. Le faltaba: confirmación al borrar, decir quién subió y de qué tipo es, validar contra el documento real y auditoría. |
| CURRENT_RELATED | Cadena cotización → pedido(s) → entrega(s) por claves foráneas reales, en consultas batch. Le faltaba el remito que no viene de un pedido pero sí de una cotización (`source_quote_id`: 11 en producción) y las cobranzas. |
| CURRENT_PRINT_PREVIEW | **Ya existía**: `ModalImpresion` + `VistaImpresion`, un único componente que se ve en pantalla y es el que se imprime, con seis formatos del legacy (valorado, sin valorar, sin impuestos, pro forma, sin totales, ticket), A4 y carta, y hoja de impresión que esconde el resto de la aplicación. La vista previa **siempre** precede a la impresión. |
| CURRENT_SEND_FLOW | **No existe** backend de envío por email para documentos de venta. Lo único parecido es la invitación de usuarios (`config-usuarios`), que es otra cosa. |
| DELIVERY_ADDRESS_MODEL | `customer_addresses` (street, city, state, postal_code, country_code, kind, is_default) y FK `deliveries.shipping_address_id` / `sales_orders.shipping_address_id`. **Cero filas cargadas** en producción, y el remito mostraba la dirección viva del cliente: si el cliente se mudaba, el remito ya emitido «cambiaba» de domicilio. |
| SCHEMA_GAPS | Faltaba el snapshot del domicilio; `attachments` no validaba que `entity_id` existiera ni que la ruta cayera en la carpeta del documento; no había eventos de auditoría de adjuntos. |

## 2 · Adjuntos

Se reutilizó todo lo que había. Lo que agregó E6:

- **Confirmación al borrar** (`ConfirmDialog`, «¿Eliminar este archivo?»), con el nombre a la vista.
- La lista dice **qué es** (PDF/Imagen/Planilla/Texto), **para qué** (OC del cliente, comprobante…),
  cuánto pesa, cuándo se subió y **quién** lo subió.
- Al subir se elige la clase (`attachments.kind`), que el modelo tenía y la pantalla no ofrecía.
- Validación en el navegador de tamaño y tipo, con el mismo listado que el bucket, para no subir
  20 MB y recibir un error en inglés. **El que manda sigue siendo el servidor.**
- `DOCUMENTO_INEXISTENTE` / `RUTA_INVALIDA` / `ARCHIVO_DEMASIADO_GRANDE`: un trigger nuevo exige que
  el documento exista **en la misma empresa** y que `storage_path` empiece por
  `<empresa>/<tipo>/<documento>/`, y rechaza rutas con `..`.
- Auditoría: `attachment_added` y `attachment_deleted` en `sales_audit`, contra el documento (no
  contra la tabla de adjuntos). **Las lecturas no se auditan**: serían ruido.
- La URL firmada se pide **al hacer clic**, no para los cincuenta archivos de una lista.

**Nombres duplicados**: permitidos. La identidad es la ruta, que lleva un UUID por archivo; dos
«orden-de-compra.pdf» conviven sin pisarse (probado).

**Orden al borrar**: primero la fila, después el archivo. Si se cae en el medio queda un archivo sin
referencia —basura que se limpia— y no una fila que promete un archivo que ya no está. Si el borrado
del archivo falla, la pantalla lo dice en vez de callarse.

### El hallazgo del storage

La política de lectura del bucket decía «podés leer el objeto si podés ver su fila de `attachments`».
Era cierta, pero tenía un efecto que encontró la prueba: al borrar un adjunto, en el paso 2 la fila ya
no existía, el objeto dejaba de ser visible y **el borrado del archivo no hacía nada ni avisaba**.
Quedaban huérfanos en el bucket. Ahora la cerradura es la carpeta —la ruta empieza con el
`company_id`— y se exige pertenencia **interna** a esa empresa: misma regla que la metadata, el
cliente del portal sigue afuera, y borrar funciona.

## 3 · Relacionados

- Remito → **pedido** → cotización, como antes; y ahora también remito → **cotización** cuando el
  remito no pasó por un pedido (`source_quote_id`).
- Cobranzas: se resuelven por las imputaciones de las facturas, y **la consulta sólo se hace si hay
  facturas** (hoy no hay ninguna). Preguntar por las cobranzas de una lista vacía es un viaje al
  servidor para que conteste «nada».
- Sin N+1: una consulta por tabla, verificado con un test que cuenta las consultas.
- Las secciones de la cadena se muestran aunque estén vacías («No hay»); facturas y cobranzas, sólo
  si existen: dibujar su hueco prometería una pantalla que todavía no está.

## 4 · Vista previa e impresión

Ya estaba resuelto y se verificó contra los tres documentos:

| Clave | Estado |
|---|---|
| PREVIEW | `ModalImpresion` abre una vista previa real **antes** de imprimir; nunca se dispara `window.print()` de un clic. |
| PRINT | El mismo componente que se ve es el que se imprime. A4 o carta, sin menú, sin botones, sin pestañas. |
| PDF | **Gap conocido**: no hay generación propia. Se imprime a A4 y el navegador guarda el PDF; la pantalla lo dice. No se agregó una librería pesada para poder decir «PDF». |
| AUTHORITY | Ver e imprimir están permitidos **aunque la numeración sea de STEL**; lo que sigue bloqueado es emitir. Verificado en producción sobre un remito real. |

E6 le agregó al remito la **dirección de entrega** en el documento impreso, y sólo si quedó
registrada. La cotización y el pedido no la llevan.

Sobre el remito valorado: se mantiene. Los 631 renglones históricos tienen precio y el remito
valorado es lo que usa el negocio; quien no lo quiera tiene el formato «Sin valorar», que imprime el
mismo documento sin un solo precio.

## 5 · Envío por email

`EMAIL_SEND = no implementado, a propósito.` No hay backend real de envío de documentos, así que **no
se agregó un botón que no manda nada**. Cuando exista el proveedor, lo que falta es el modal
(destinatario por defecto = email del contacto, asunto, mensaje, adjunto y vista previa) y un evento
`email_sent` con actor, destinatario y documento. Queda como E7.

## 6 · Domicilio de entrega

`deliveries.delivery_address_snapshot jsonb`, **congelado al crear el remito**:

- sale del domicilio de envío del pedido y, si no tiene, del domicilio de envío por defecto del
  cliente;
- si no hay ninguno, queda `NULL` y la pantalla dice «Sin domicilio registrado». **Nunca** se muestra
  el domicilio de hoy del cliente como si fuera el de aquel día;
- **sin backfill**: los 193 remitos históricos siguen en `NULL`, porque en producción no hay ni una
  fila de `customer_addresses` y copiar algo sería inventarlo;
- probado: se guarda al emitir, y mudar al cliente después **no cambia** el remito.

## 7 · Información, acciones y fechas

- La pestaña **Información es ahora el mismo componente para los tres documentos**. Hasta E5 la
  cotización usaba uno y el pedido y el remito tenían su lista escrita a mano, con etiquetas que no
  coincidían. Las reglas quedaron explícitas: lo que falta y debería estar se dice («Sin registrar»);
  lo que no corresponde al tipo no se muestra (el remito no tiene vendedor, forma de pago ni tarifa);
  lo opcional y vacío tampoco (tipo de cambio, transporte).
- «Pedido de origen» y «Cotización de origen» se muestran **aunque no haya**: que un remito no venga
  de un pedido —37 en producción— o que un pedido sea manual es un dato, no un olvido.
- **ActionBar**: ya era homogénea, porque las acciones salen de un componente compartido
  (`useAccionesDocumento`): PRIMARIA = la del flujo, SECUNDARIAS = Editar · Ver/Imprimir · Duplicar,
  PELIGRO = Cancelar · Eliminar. La primaria nunca se esconde; cuando está bloqueada se ve
  deshabilitada y con el motivo.
- **Fechas**: `formatearFecha` parte el ISO a mano en vez de usar `Date`, justamente para no correr un
  día en Argentina; los momentos (creado, modificado) usan `formatearMomento`. Sin mezcla.

## 8 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase15-e6-adjuntos-tests.mjs` (base real, empresas de fixture, archivos reales en el bucket) | **38 PASS · 0 fallos** |
| `scripts/fase15-e5-remitos-tests.mjs` (regresión E5) | 0 fallos |
| `npm test` / `npm run test:isolated` | 1436 tests, 126 archivos |
| `npm run lint`, `npx tsc -b`, `npm run build` | limpio |

Del corrido de la base: `subir deja el archivo y la fila`; `dos archivos con el MISMO nombre
conviven`; `un adjunto de un documento de OTRA empresa — DOCUMENTO_INEXISTENTE`; `una ruta con salto
de carpeta — RUTA_INVALIDA`; `y el bucket tampoco lo acepta` (21 MB) y `un tipo de archivo fuera de la
lista` (`.exe`); `el vendedor VE los adjuntos de su empresa` pero `no sube`; `el admin de otra empresa
no firma una URL ajena`; `leer NO audita nada`; `el remito guarda el domicilio del pedido`; `si el
cliente se muda, el remito NO cambia`; `los remitos históricos siguen sin domicilio (no hubo
backfill)`; `producción idéntica al baseline`.

Frontend: `PanelAdjuntos.test.tsx` (11), `InformacionDocumento.test.tsx` (10),
`relacionados.test.ts` (8, incluye el chequeo de N+1) e impresión de los tres documentos dentro de
`impresion.test.ts`.

## 9 · Verificación en el navegador

Sobre datos reales, **sin escribir nada**: remito RT0000001431 con la Información unificada
(«Sin domicilio registrado», «Sin pedido relacionado», origen STEL explicado), la pestaña Adjuntos con
su estado vacío y el selector de clase, y la vista previa abriendo **pese a que la numeración es de
STEL**, con sus seis formatos y A4/carta. Sin desborde horizontal a 375, 430, 768, 1024 ni 1440 px.
No se subió ningún archivo a un documento productivo: eso se probó contra empresas de fixture.

## 10 · Efecto colateral de E5 que conviene saber

El backfill de `line_no` de la Entrega 5 tocó las 631 líneas de remito y, por el trigger
`empujar_totales_entrega`, movió `updated_at` de los **193 remitos**. Los importes **no** cambiaron
—`recalcular_totales_entrega` no toca documentos importados, y la suma sigue siendo 51.297.232,91—,
pero la columna «Última modificación» de los históricos muestra la fecha de la migración y no la de
STEL. Es visible y no se puede deshacer sin inventar una fecha.

## 11 · Gaps para E7

- **Envío por email**: falta el proveedor. Sin él no hay botón (§5).
- **PDF propio**: hoy es el «Guardar como PDF» del navegador.
- **Domicilios sin cargar**: el snapshot funciona, pero no hay ni una dirección en `customer_addresses`.
  Hasta que se carguen, todos los remitos nuevos van a decir «Sin domicilio registrado».
- **Archivos huérfanos previos**: si alguna vez quedó un objeto en el bucket sin fila (con la política
  vieja era posible), nadie lo ve. Conviene un barrido comparando `storage.objects` con `attachments`.
- **Facturas y cobranzas**: las consultas y el panel ya están; faltan los documentos.

## 12 · Qué NO se hizo (a propósito)

Facturación y cobranzas completas, cutover de STEL, autoridad productiva, WhatsApp, grupos, campañas,
lógica nueva de stock o reservas y cualquier cambio de pricing.
