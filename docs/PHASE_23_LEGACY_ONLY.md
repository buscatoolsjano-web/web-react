# Fase 23 · Lo que hoy sólo se puede hacer en el HTML

La pregunta que contesta este documento es una: **¿qué puedo hacer hoy en el
legacy que directamente no puedo hacer en React?**

93 capacidades están `MISSING` o `PARTIAL`. Abajo están agrupadas por bloque
funcional, porque muchas dependen de la misma pieza y no tiene sentido
mirarlas sueltas.

---

## Bloque 1 · Facturación de venta — **BLOQUEANTE**

`FA-01` `FA-02` `FA-03` `FA-04` `FA-05` `FA-06` `VE-50`

**Qué hace.** Listar facturas de venta, crearlas y editarlas con sus líneas
(SKU, descripción, cantidad, precio, descuento), imprimirlas, enviarlas por
mail y exportarlas. Además: recibos de cobro y notas de crédito, cada uno con
su listado y su CSV. Y el botón que lo enlaza con Ventas: desde un remito,
«Generar factura».

**Quién la usa.** Quien cobra. Todo el equipo comercial en el paso final.

**Dónde está.** `app.js:27095` `renderFacturasList` · `:27366`
`renderFacturaEditor` · `:27703` `renderRecibosList` · `:27803`
`renderNotasCreditoList` · `:27313`, `:27776`, `:27876` los CSV ·
`#ne-gen-factura` el enlace desde el remito.

**Severidad.** BLOCKER.

**Dependencias.** Nada la bloquea a ella. Necesita: tabla de facturas,
numeración por serie (ya existe: `autoridad_numeracion_*`), motor de
impresión (ya existe), y el tipo de cambio del bloque 2 para los documentos
en moneda extranjera.

**Riesgo de migración.** Alto, pero de negocio, no técnico: una factura es un
documento fiscal. Hay que definir si React va a emitir o sólo registrar.
**Esa pregunta hay que contestarla antes de escribir una línea.**

---

## Bloque 2 · Finanzas

`FI-01` `FI-02` `FI-03`

**Qué hace.** Cargar y mantener el tipo de cambio (`FI-01`), ver el aging de
cuentas por cobrar (`FI-02`) y el flujo de caja (`FI-03`).

**Quién la usa.** Administración.

**Dónde está.** `app.js:28362` `renderFinanzasTC` · `:28434`
`renderFinanzasAging` · `:28474` `renderFinanzasCash` · `erp_finanzas_rates`
en `localStorage`.

**Severidad.** HIGH (`FI-01`, `FI-02`), MEDIUM (`FI-03`).

**Dependencias.** El aging depende de que existan las facturas: **el bloque 1
va primero.** El tipo de cambio no depende de nada y lo necesitan los
documentos multi-moneda que React ya emite.

**Riesgo.** Bajo. El tipo de cambio es una tabla con fecha y valor.

---

## Bloque 3 · Portal del cliente y visitante

`SH-04` `PC-01` `PC-02` `PC-03` `PC-04` `PC-05` `DA-10`

**Qué hace.** Entrar **sin sesión** y ver el catálogo. Que un cliente arme su
propia cotización con un carrito, la mande, y que el equipo la vea en un panel
de solicitudes. Más el panel de leads de la web.

**Quién la usa.** Clientes y visitantes — es decir, gente de afuera. Y el
equipo comercial del otro lado.

**Dónde está.** `app.js:1008` `getPermsFor(null)` da `catalogo` +
`micotizacion` a quien no tiene usuario · `:2088` `renderClienteCotizacion` ·
`:2273` `renderAdminLeadsPanel` · `:2294` `renderAdminSolicitudesPanel` ·
`erp_client_carrito`, `erp_client_solicitudes`, `erp_client_leads`,
`erp_client_accounts`.

**Severidad.** HIGH.

**Dependencias.** Necesita el carrito del catálogo (`CA-02`, que también es
BLOCKER por otro motivo) y una decisión de RLS: **hoy React no tiene rol
anónimo.** Abrirlo es una decisión de seguridad, no una pantalla.

**Riesgo.** Alto. Es la única parte de la migración que expone algo a
internet sin sesión. Si hay clientes usando el portal hoy, apagar el legacy
los deja afuera sin aviso. **Hay que saber cuántos son antes de planificar.**

---

## Bloque 4 · Carrito del catálogo — **BLOQUEANTE**

`CA-02` `CA-03`

**Qué hace.** Un stepper `− n +` en cada fila del catálogo, una barra flotante
con ítems y total, «Ver cotización» y «Vaciar». Hay dos carritos distintos,
uno para el cliente y otro para el interno. Y la exportación del catálogo con
27 columnas a elegir.

**Quién la usa.** Todos. **Es el camino por el que nace una cotización en el
legacy.**

**Dónde está.** `app.js:15308` el stepper por fila · `#cat-cart-bar` y
`#cat-icart-bar` las barras · `loadClientCarrito` / `loadInternalCarrito` ·
`:16960` el modal de exportación.

**Severidad.** BLOCKER (`CA-02`), HIGH (`CA-03`).

**Dependencias.** Ninguna. Es la más barata de las bloqueantes y la que más
cambia el uso diario.

**Riesgo.** Bajo.

---

## Bloque 5 · Mandar el documento por mail

`VE-15` `CO-10`

**Qué hace.** Desde cotización, pedido, remito, factura y pedido de compra:
un botón que abre el correo con el documento.

**Dónde está.** `app.js:37282` ENVIAR DOCUMENTO POR MAIL · `data-doc-enviar`
en los cinco documentos. Usa `mailto:` — 5 apariciones.

**Severidad.** HIGH.

**Dependencias.** Para mandar el PDF adjunto hace falta `VE-14`: que React
**genere** el archivo, no que abra el diálogo de impresión. Con `mailto:` no
se puede adjuntar; el legacy manda el cuerpo. React ya tiene backend de
correo (F9), así que puede hacerlo mejor — pero eso es diseño, no copia.

**Riesgo.** Bajo si se replica `mailto:`. Medio si se hace bien.

---

## Bloque 6 · Importar la orden de compra del cliente

`VE-51` `CL-17` `CL-18`

**Qué hace.** Pegar o subir el PDF de la OC del cliente, parsearlo, proponer
las líneas, y **recordar** que ese texto del cliente corresponde a ese SKU
para la próxima vez. Si el producto no existe, ofrece crearlo.

**Quién la usa.** Quien carga pedidos grandes de clientes recurrentes.

**Dónde está.** `app.js:38347` OC Import — parser de PDF inline ·
`#oc-ok-btn`, `#oc-retry-btn`, `#oc-create-prod-btn` · `:15070`
`getClienteAliases` / `setClienteAlias` · `:18998` exporta la memoria a JSON ·
`data-mem-key`, `data-mem-del`.

**Severidad.** HIGH.

**Dependencias.** El parser necesita `pdf.min.js`. La memoria de alias
necesita una tabla — hoy vive en la memoria del cliente en `localStorage`.
Crear el producto faltante depende de `CA-07`.

**Riesgo.** Medio. El parser es frágil por naturaleza; la memoria de alias
es el valor real y es fácil de migrar.

---

## Bloque 7 · Alta y edición de productos

`CA-07` `CA-08`

**Qué hace.** Crear un producto desde el catálogo, con secciones y atributos
a medida, y editarlo.

**Dónde está.** `_abrirModalNuevoProducto` · RPC `erp_create_product`,
`erp_update_product_full`, `erp_sync_product`.

**Severidad.** HIGH.

**Dependencias.** Ninguna funcional. **Pero choca con una decisión abierta:**
hoy los productos entran por STEL y por el catálogo técnico, y F22 acaba de
documentar 226 duplicados nacidos justamente de tener dos puertas de alta.
Abrir una tercera sin resolver eso es pedir más duplicados.

**Riesgo.** Medio-alto por ese motivo, no por la pantalla.

---

## Bloque 8 · Comparador y orden del catálogo

`CA-04` `CA-05` `CA-06`

Elegir 2 a 4 productos con checkbox y compararlos; ordenar por columna;
filtrar por stock con operadores (`>5`, `<=2`). Detalle completo en
`docs/PHASE_22_PARIDAD_CATALOGO.md` (#42, #13, #11).

**Severidad.** HIGH (`CA-04`), MEDIUM (`CA-05`, `CA-06`).
**`CA-05` es el más barato de toda la auditoría:** el parámetro de orden ya
viaja hasta la RPC y ya vive en la URL; falta el encabezado clickeable.

---

## Bloque 9 · CRM

`CR-01` `CR-02` `CR-03` `CR-04`

Leads, embudo de oportunidades, actividades comerciales e informes de CRM.
`app.js:27970`, `:28093`, `:28223`, `:28259`.

**Severidad.** MEDIUM. React tiene el embudo **de lectura** en Informes
(`informe_pipeline_comercial`), no la gestión.

**Dependencias.** Los leads se alimentan del portal del cliente (bloque 3).

---

## Bloque 10 · Módulos sueltos del legacy

| bloque | ids | qué | sev |
|---|---|---|---|
| **Agenda** | `AG-01` `AG-02` | Calendario de eventos, crear y abrir | MEDIUM |
| **Importación** | `IM-01` `IM-02` `IM-03` | Calculadora de costo Europa→Argentina, courier contra despacho formal, ítems editables | MEDIUM |
| **Notas de proveedor** | `CO-14` | Notas de crédito y débito de proveedor | MEDIUM |
| **Informe de compras** | `IN-04` | El informe, no el listado | MEDIUM |
| **Biblioteca de archivos** | `IN-11` | Repositorio central de todos los adjuntos | MEDIUM |
| **Etiquetas y reglas de email** | `EM-10` `EM-11` | Clasificación automática de la bandeja | MEDIUM |
| **Despiece interactivo** | `CA-14` `MA-17` | Elegir el repuesto sobre el plano (FEIN AccuTec) | MEDIUM |
| **Mantenimiento: lotes, modelos, manuales** | `MA-10` `MA-11` `MA-12` | Cotizaciones por lotes, alta de modelos, manuales PDF | MEDIUM |
| **Permiso por sección** | `SH-11` `CF-04` | Habilitar sección por sección y por usuario | MEDIUM |
| **Rubros de cliente** | `CL-19` | Administrar rubros | MEDIUM |
| **Conexiones** | `CN-01` `CN-02` | Mercado Libre y Amazon (sólo ADMIN) | LOW |
| **Chat interno** | `CH-01` `CH-02` `CH-03` | Chat y mensajes entre usuarios | LOW |
| **Widgets del panel** | `DA-05` | Acomodar el inicio arrastrando (gridstack) | LOW |
| **Notificaciones push** | `SH-13` `SH-14` `SH-15` | Panel de notificaciones, FCM, instalar como app | LOW/MEDIUM |
| **IA** | `IA-01`…`IA-05` | Asistente del catálogo, 4 chats, ejecutor de acciones, memoria | LOW — fuera de alcance por decisión |

---

## Lo que el chat interno enseña sobre el resto

`CH-01` está marcado LOW por una razón que conviene explicar: el chat del
legacy guarda los mensajes en `localStorage` (`erp_chat_messages`). Eso
significa que **sólo funciona entre pestañas del mismo navegador.** Dos
personas en dos computadoras nunca se vieron un mensaje.

Es el ejemplo más claro de por qué §2 del pedido importa: la capacidad
declarada y la capacidad real no son la misma. Antes de migrarlo hay que
preguntar si alguien lo usó alguna vez.

Lo mismo aplica, en menor grado, a `CN-01` y `CN-02` (Mercado Libre y
Amazon): existen, son sólo de ADMIN, y no pude comprobar si tienen
credenciales cargadas.
