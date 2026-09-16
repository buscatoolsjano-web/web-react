# FASE 15 · VENTAS — ENTREGA 1: SHELL DOCUMENTAL + COTIZACIÓN

> Implementación visual y funcional. **No cambia el modelo de guardado**: editar sigue
> guardando al salir de cada campo. Sin migraciones: `DB_CHANGES = 0`.
> No toca autoridad, secuencias, cutover, STEL, stock, permisos ni RLS. 2026-09-16.

---

## 1. Antes y después

### Antes

```
PageHeader (número, chips, cliente · fecha · título, total)
AvisosHistoricos
AvisoAutoridadStel
ActionBar
DocSection «Datos de la cotización»
DocSection «Líneas» + Totales
DocSection «Adjuntos»
DocSection «Relacionados»
```

Seis bloques apilados. Para ver las líneas —lo único que se mira siempre— había que pasar por
encima de la cabecera y de los avisos, y adjuntos y relacionados competían por la misma atención.
La trazabilidad no existía en pantalla, aunque la base la venía escribiendo desde la Fase 4.

### Después

```
DocumentHeader   ← identidad: número, estado, origen, cliente · fecha, título, total
ActionBar        ← acciones, arriba y a la vista, con el motivo cuando están bloqueadas
DocumentTabs     ← Líneas · Información · Adjuntos · Relacionados · Trazabilidad
   contenido de la pestaña abierta
```

Tres piezas fijas y el contenido debajo. El documento abre en **Líneas**, y la pestaña abierta
queda en la URL (`?tab=trazabilidad`), así que el enlace se puede compartir.

---

## 2. Componentes

### Nuevos, compartidos — `src/components/document/`

| Componente | Qué hace |
|---|---|
| `DocumentHeader` | Identidad del documento. Se apoya en `PageHeader`, no lo duplica: el enlace de vuelta, el único `h1` y el comportamiento en mobile son los del resto del sistema |
| `DocumentTabs` | Pestañas + panel de la activa. Monta **sólo** el contenido visible, así cada panel paga sus consultas al abrirse |
| `useTabDeUrl` | La pestaña en la URL, con `replace` para que Atrás vuelva al listado. Un `?tab=` desconocido cae en la de por defecto |
| `MoreMenu` | «Más ▾». Desplegable con `aria-expanded`, no `role="menu"`: adentro van los mismos `Button`, con su propio nombre y su propio estado deshabilitado |

### Evolucionados, no duplicados

| Componente | Cambio |
|---|---|
| `ActionBar` | Slot nuevo `more`. Compatible: las ocho pantallas que ya lo usan (Compras, Mantenimiento, Ventas) no cambian. **No se renombró a `DocumentActions`** para no arrastrar churn fuera del alcance de E1 — es el mismo componente que el diseño llama así |
| `TablaLineas` | Columnas `Producto`, `Descripción` e `Impuesto` separadas; tarjetas reales en pantallas angostas |
| `PanelRelacionados` | La cadena cotización → pedido → entregas se muestra siempre; facturas y cobranzas, sólo si existen |
| `AvisoAutoridadStel` | Acepta `idDetalle`: los botones bloqueados referencian **este** texto en vez de repetirlo |
| `useAccionesDocumento` | Acepta `idMotivoAutoridad`. Con él, «Duplicar» apunta al banner y ya no escribe su propia copia del motivo |

### Nuevos, de Ventas — `src/modules/ventas/`

`TotalesDocumento` · `InformacionDocumento` · `PanelTrazabilidad` · `lib/origen.ts` ·
`lib/trazabilidad.ts` · `services/auditoria.listarEventos` · `hooks/useTrazabilidad`.

**Por qué no están en `components/document/`:** dependen de los tipos y los servicios de Ventas.
Ponerlos en la carpeta compartida haría que `components/` importara de `modules/`, que es
exactamente la dependencia que la arquitectura evita. Lo compartido es la forma; lo que conoce
`DocumentoDetalle` vive en el módulo.

---

## 3. Acciones

| Acción | Dónde | Condición (sin cambios respecto de antes) |
|---|---|---|
| **Marcar como enviada** | PRIMARY si `draft` | escribe · `draft` · autoridad ERP |
| **Generar pedido** | PRIMARY si no es borrador; SECONDARY si lo es | escribe · estado ≠ `rejected` · sin pedido previo · autoridad ERP |
| Editar | SECONDARY | `editabilidad(estado, escribe).editable` |
| Marcar aceptada | SECONDARY | escribe · `sent` · autoridad ERP |
| Ver / Imprimir | SECONDARY | cualquiera |
| Duplicar | SECONDARY | escribe · autoridad ERP |
| Marcar rechazada | **MORE** | escribe · `sent` |
| Cancelar cotización | DANGER | escribe · no cerrada |
| Eliminar | DANGER | escribe · no histórica |

Tres reglas que la pantalla respeta:

1. **La acción principal nunca entra en «Más».** Si está bloqueada se muestra deshabilitada, no se
   esconde.
2. **El motivo es texto visible**, no un tooltip, y el botón lo referencia con `aria-describedby`.
3. **Un solo mensaje de autoridad por pantalla.** Antes el mismo hecho se contaba dos veces —el
   banner y otra vez debajo de la barra—; ahora el banner es el único texto y los botones apuntan
   a él.

«Enviar» (por correo) **no se agregó**: no existe el flujo todavía y un botón que no hace nada es
peor que su ausencia. Queda en E7, como planificó E0.

---

## 4. Pestañas

| Pestaña | Contenido | Cuándo consulta |
|---|---|---|
| **Líneas** (por defecto) | Tabla o tarjetas + totales. En edición, el editor actual | Con el documento |
| Información | Cliente, contacto, vendedor, forma de pago, moneda, tipo de cambio, serie, validez, origen, observaciones, creado/modificado | Con el documento |
| Adjuntos | `PanelAdjuntos`, sin cambios | Al abrir la pestaña |
| Relacionados | La cadena real | Con el documento (ya se usaba para saber si tiene pedido) |
| Trazabilidad | `sales_audit`, sólo lectura | Al abrir la pestaña, y sólo para quien escribe |

### Qué se muestra y qué no, en Información

- Un dato que falta y **debería estar** se muestra como faltante: contacto, vendedor, forma de pago
  y validez. Verlos vacíos **es** la información.
- Un dato que **no corresponde** al tipo no se muestra (el remito no tiene forma de pago).
- Un dato **opcional y vacío** tampoco: el tipo de cambio de un documento en pesos no es un olvido.

### Trazabilidad

Se implementó el lector porque no hacía falta backend: `sales_audit` ya tiene policy de `SELECT`
(`audit_select`, limitada a las empresas donde la persona escribe). El panel traduce la acción y el
estado con las etiquetas del documento («Pendiente → Cerrada», no `sent → accepted`) y el diff con
el nombre que usa la gente («Precio unitario: 120 → 100»). **No muestra ids, ni la función que lo
escribió, ni el JSON crudo**; un valor que no sea número ni texto se reporta como «sin detalle» en
vez de volcarse.

---

## 5. Origen

Sale de datos reales —`external_source`, `imported_at` y la serie—, nunca de una suposición:

| Dato | Etiqueta |
|---|---|
| serie terminada en `-ML` | `MercadoLibre` (se suma a la que sigue) |
| `external_source = 'stel'` | `Migrado desde STEL` |
| importado sin `external_source` | `Migrado del sistema anterior` |
| ni importado ni externo | `Emitido en el ERP` |

Va como badge de contorno junto al estado, **no como alerta**: un documento migrado es normal. El
detalle largo se lee en Información. Con esto desaparece el badge «Migrado del sistema anterior»
duplicado que E0 anotó como deuda.

---

## 6. Responsive

Probado en el navegador a 1440, 1280, 1024, 768, 430 y 390. **Cero scroll horizontal de página en
todos.**

| Ancho | Líneas |
|---|---|
| ≥ 1280 | Tabla con `Descripción` en columna propia (9 columnas) |
| 900 – 1279 | Tabla de 8 columnas; la descripción vuelve debajo del nombre del producto |
| < 900 | Tarjetas: producto y descripción arriba, referencia, después cantidad · precio y descuento · impuesto en dos columnas, y el subtotal separado por una línea |

El corte de tarjetas es **900px**, no los 767px del resto del sistema. Se subió durante la revisión:
a 768px la tabla de ocho columnas dejaba «Producto» en una palabra por renglón y scrolleaba de
costado igual. Con ocho columnas, 767 llegaba tarde.

La descripción se duplica en el DOM —una copia en su columna y otra dentro de la celda de producto,
`aria-hidden`— porque CSS no puede mover un nodo entre celdas. Sólo una de las dos se ve nunca.

---

## 7. Accesibilidad

- Un solo `h1` por pantalla: el número del documento. Verificado en test.
- Pestañas con el patrón ARIA completo: `tablist` / `tab` / `tabpanel`, ← → Inicio Fin, y el panel
  nombrado por su pestaña.
- «Más ▾» con `aria-expanded`; cerrado queda fuera del árbol de accesibilidad, no sólo invisible.
  Escape cierra y **devuelve el foco al botón**.
- El motivo de un botón deshabilitado es texto real, referenciado con `aria-describedby`.
- Estados con palabra, nunca sólo color.
- Objetivos táctiles de 44px y tipografía de 16px en mobile: los de las primitivas, sin cambios.

---

## 8. Modo edición — lo que E1 NO cambió

El botón «Editar» sigue funcionando igual: cada campo se guarda solo al perder el foco.

**No se agregó «Guardar» ni «Descartar»**, y es deliberado. Hoy no hay transacción que descartar:
lo que se escribe ya se escribió. Un botón «Descartar cambios» sería una promesa falsa. En su lugar,
al entrar en edición la barra dice exactamente lo que pasa:

> Los cambios se guardan solos al salir de cada campo. Todavía no hay «Guardar» ni «Descartar»: lo
> que escribís, queda escrito.

E1 = shell y vista. **E2 = edición por lote.**

---

## 9. Base de datos

`DB_CHANGES = 0`. Ninguna migración, ninguna función, ninguna policy.

Lo único que cambió del lado de los datos son **columnas agregadas al `select` que ya existía** en
`obtenerDocumento`: `external_source`, `created_at`, `updated_at`, el contacto completo
(`role`, `email`, `phone`) y quién creó el documento. Misma consulta, más columnas: ni un viaje más
a la base.

---

## 10. Gaps encontrados

| Gap | Estado |
|---|---|
| **Tarifa / lista de precios del documento** | Confirmado. `price_list_id` existe en el cliente (`customers.default_price_list_id`), no en el documento. Mostrar la lista actual del cliente sería atribuirle al documento una tarifa que quizá no es la que se usó, así que **no se muestra nada**. Es la migración de E2 |
| El `from` de la auditoría de cabecera se pierde | Sigue en pie: `registrarEvento(..., { [columna]: { from: null, ... } })`. El valor anterior correcto sale del borrador de E2 |
| Un documento importado sin totales muestra rayas | Comprobado en el fixture: el trigger de totales respeta los importes de lo importado. Es correcto —no se inventa un número—, pero conviene revisar si hay documentos productivos así |
| «Producto» apretado entre 900 y 1279 con el menú expandido | Aceptable: no desborda y el contenedor scrollea si hace falta. Si molesta, la salida es subir el corte de tarjetas o achicar «Referencia» |
| Adjuntos sin clasificar ni confirmación al borrar | Sin cambios; es E6 |

---

## 11. Lo que queda para E2

1. **Guardar/Descartar atómico.** Un borrador en memoria y un guardado por lote. Cambia cuándo se
   dispara la auditoría de precios: pasa del `blur` al guardado, y recién ahí se puede registrar el
   valor anterior de verdad.
2. **Selector de contacto.** El modelo ya está (`contact_id`, 87 contactos cargados); falta el
   control: cliente elegido → contactos de ese cliente → contacto opcional. Sin obligar, y sin
   tocar documentos históricos.
3. **Vendedor.** Mostrarlo ya se muestra. Falta poder elegirlo al crear, sin rellenar nada hacia
   atrás.
4. **Tarifa.** `price_list_id` en los tres documentos, con el precio de la línea como snapshot
   histórico: cambiar la tarifa después **no** cambia documentos existentes.
5. **Auditoría con valor anterior**, junto con el punto 1.
6. **Guardado por lote de las líneas**, con el editor convertido en tarjetas.

---

## 12. Verificación

| Paso | Resultado |
|---|---|
| `eslint .` | limpio |
| `tsc -b --noEmit` | limpio |
| `vitest run` | verde |
| `vitest run --config vitest.aislado.config.ts` | verde |
| `vite build` | ok |
| Revisión en navegador con fixture `zz-f13ui` | 1440 / 1280 / 1024 / 768 / 430 / 390 |

Casos mirados en el navegador: cotización migrada desde STEL, cerrada, con capítulo, contacto,
descripciones, dos alícuotas y sin totales · cotización enviada emitida por el ERP, con pedido
derivado y trazabilidad · borrador bajo autoridad STEL, con las emisiones deshabilitadas y un solo
mensaje · adjuntos vacíos · relacionados con y sin documentos.

Dos defectos encontrados y corregidos en esa revisión:

1. **El panel de «Más» se veía abierto.** `display: flex` le ganaba al `display: none` que el
   navegador aplica por `[hidden]`. Se agregó la regla explícita.
2. **Scroll horizontal a 768px.** El corte de tarjetas pasó de 767 a 900px.

### Tests agregados

`DocumentShell.test.tsx` (header, barra con «Más», pestañas y URL, teclado) ·
`CotizacionDetallePage.test.tsx` (19 casos: vista, totales con unidades, origen, autoridad ERP y
STEL, mensaje único, cerrada, rol sin escritura, edición sin Descartar, las cinco pestañas,
relacionados, adjuntos vacíos, trazabilidad, enlace directo) · `origen.test.ts` ·
`trazabilidad.test.ts` · tres casos nuevos en `TablaLineas.test.tsx`.

Los tests de la página montan la página real con la autoridad, los permisos y `editabilidad` de
producción: **si alguna acción cambiara su condición de habilitación, se caen.**
