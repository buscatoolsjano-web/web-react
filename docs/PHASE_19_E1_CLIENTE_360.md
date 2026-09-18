# Fase 19 · E1 — Cliente 360 y ficha rápida

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`docs/database/PHASE_19_EXPERIENCIA_ENTREGA_1.sql`](database/PHASE_19_EXPERIENCIA_ENTREGA_1.sql), con su ROLLBACK.
Auditoría del legacy: [`PHASE_19_E0_LEGACY_UX_AUDIT.md`](PHASE_19_E0_LEGACY_UX_AUDIT.md).

**0 tablas nuevas, 0 columnas nuevas, 0 índices nuevos.** Una función de sólo lectura y una
pantalla que ahora tiene dos columnas.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| `CURRENT_CUSTOMER_LIST` | `/clientes`: listado server-side de 1.010 clientes, filtros y orden en la URL, paginado, exportación a CSV, selección múltiple. **Click en el nombre = navegar a `/clientes/:id`.** |
| `CURRENT_CUSTOMER_DETAIL` | `/clientes/:id`: cabecera, tira de contacto, panel «Actividad» con 6 métricas (`resumen_cliente`) y 9 pestañas. |
| Consultas del resumen | **Cinco** funciones `security invoker`: `resumen_cliente`, `totales_por_moneda_cliente`, `actividad_mensual_cliente`, `documentos_del_cliente`, `productos_del_cliente`. Cada una recorre por su cuenta las tres tablas de Ventas. |
| Gráfico | `GraficoActividad`: SVG a mano, sin librería, con selector de moneda y tabla accesible. **Una sola serie por vez.** |
| Librería de charts | **Ninguna, y está bien.** No hay Recharts ni nada parecido en `package.json`. |
| Datos disponibles | Documentos desde **2026-01-05**, tres monedas en cotizaciones (ARS/USD/EUR) y dos en pedidos y entregas. `total` nunca es nulo. |
| Facturación | **No existe** como módulo. Hay `invoicing_status` en pedidos, pero no hay facturas. |

Dos hallazgos que cambiaron el diseño:

1. **`total` lo recalcula un trigger** a partir de las líneas y su IVA. Los tests no pueden
   «escribir 800 y esperar 800»: leen el total de la base y comparan contra eso.
2. **`line_type` admite `item`, `service` y `chapter`** — no `product`. Las funciones viejas usan
   `coalesce(l.line_type, 'product') <> 'chapter'`, que funciona por casualidad (cualquier cosa que
   no sea `chapter` pasa). La nueva usa `'item'`, que es el valor real.

---

## 2 · Una llamada, no cinco

`CUSTOMER_360_QUERY` = `resumen_cliente_360(p_customer uuid, p_meses int default 12) → jsonb`

Devuelve identidad, datos comerciales, KPIs, serie mensual, últimos documentos, productos
recientes y totales del histórico. **En un solo viaje.**

No es una optimización de lujo: el panel se abre al hacer click en una fila de una lista. Mirar
cinco clientes seguidos con el modelo viejo dejaba **veinticinco** consultas en vuelo compitiendo
por llegar, y la que llegaba última pintaba la pantalla —que puede no ser la del cliente que está
seleccionado—.

`security invoker`, igual que las cinco que reemplaza. Eso no es un detalle de implementación: es
**el** control de acceso. Hereda `customers_select`, y como todo el JSON se arma a partir de un
`join` contra esa fila, un cliente que el actor no ve devuelve `null` —no una estructura vacía—.
La pantalla usa esa diferencia para distinguir «este cliente no tiene movimientos» de «no podés
ver este cliente».

### Qué significa cada número

`KPIS` — cuatro, no ocho:

| KPI | Definición exacta |
|---|---|
| **Pedidos confirmados** (del mes) | `sales_orders` con `commercial_status = 'confirmed'` y `order_date` en el mes. |
| **Cotizado** (del mes) | `sales_quotes` con `quote_date` en el mes, aceptadas o no. |
| **Cotizaciones abiertas** | `status in ('draft','sent')`, **de cualquier fecha**. Una cotización de hace tres meses que nadie contestó sigue abierta. |
| **Pedidos por entregar** | `confirmed` y `fulfillment_status <> 'delivered'`. |

Se llaman «Pedidos confirmados» y no «Vendido» a propósito. Vender es facturar, y acá no hay
facturas; confirmar un pedido es lo más cerca que el ERP puede afirmar hoy. **No hay ninguna clave
de facturación en el JSON**: mostrar `Facturado USD 0` sería presentar una ausencia como un dato.

Un documento **cancelado** no entra en ningún KPI ni en el gráfico. Uno **rechazado o vencido**, sí:
cotizar y perder es trabajo hecho, y borrarlo del gráfico da la impresión de que ese mes no pasó
nada.

`MONTHLY_CHART` — tres series (`cotizacion`, `pedido`, `entrega`) por mes y por moneda, tal cual
salen de la base. `RECENT_DOCUMENTS` — el último de cada tipo, con id, número, fecha, estado,
moneda e importe. `RECENT_PRODUCTS` — seis, el más reciente de cada producto.
`OPEN_ITEMS` — los dos KPIs de arriba; **no se inventan «tareas»**, porque no hay tareas en el
modelo.

Un detalle del precio de los productos que los tests encontraron: cotizar y pedir el mismo día es
lo normal —se cotiza y el cliente confirma—, y en ese empate **gana el pedido**. El precio que se
cerró vale más que el que se ofreció, y el JSON dice de cuál de los dos vino (`origen`).

---

## 3 · Monedas

`MULTI_CURRENCY_BEHAVIOR` = **nunca se suman**.

La pantalla de inicio del legacy muestra `Cotizaciones 10.313.498.939,61 USD`: pesos sumados con
dólares y rotulados «USD». Es el error más caro que se puede copiar, porque el resultado parece un
número.

Acá cada KPI es una **lista** de importes, uno por moneda, y la pantalla los muestra separados. Con
una sola moneda —el caso normal— se ve un solo importe y no parece un informe. Grupo Mirgor, que
tiene dos, muestra `USD 352.018,76` y `EUR 6.711,81` en líneas distintas.

El gráfico lleva la misma regla al extremo: **un gráfico, una moneda**. Si el cliente compra en dos,
hay un selector. Una barra que sume ARS con USD no es un número más grande: es un número que no
existe.

La comparación contra el mes anterior es **por moneda**, y el caso que rompe estas comparaciones
está resuelto con palabras y no con un número: si el mes anterior fue cero no hay porcentaje, así
que dice **«Sin base de comparación»**. Nunca `+∞ %` ni `+100 %`.

---

## 4 · La pantalla

`CUSTOMER_QUICK_VIEW` = `FichaRapidaCliente` + `PanelLateralCliente`, en `modules/clientes/components`.

La ficha contesta siete preguntas y **no es la ficha completa comprimida**: no edita, no tiene
nueve pestañas y no trae el historial entero.

```
┌──────────────────────────────┬──────────────────────┐
│ LISTADO (server-side)        │ FICHA RÁPIDA         │
│ ← filtros, orden, página     │ · quién es           │
│                              │ · contacto/vendedor  │
│ Famar Fueguina               │ · acciones           │
│ ▌Grupo Mirgor  ← abierta     │ · 4 KPIs por moneda  │
│ Otro                         │ · 12 meses           │
│                              │ · últimos documentos │
│                              │ · productos          │
└──────────────────────────────┴──────────────────────┘
```

`FichaRapidaCliente` **no depende de `ClientesPage`**: recibe un `clienteId` y nada más. Es
deliberado (`GLOBAL_CUSTOMER_QUICK_VIEW`): mañana la abren la cotización, el pedido, el remito y la
bandeja de WhatsApp, y ninguno de ésos tiene por qué importar la pantalla de Clientes.

### Master/detail: dónde sí y dónde no

`RESPONSIVE` — medido en el navegador, no supuesto:

| Ancho | Qué se ve | Medición |
|---|---|---|
| 375 / 430 | Hoja a pantalla completa, modal | sin desborde horizontal |
| 768 / 1024 | Hoja centrada (máx. 640 px) | sin desborde |
| 1280 | Panel al costado | panel 486 px |
| 1440 | Panel al costado | panel **520 px**, listado **601 px**, 5 columnas |
| 1920 | Panel al costado | panel 520 px, listado **1081 px**, las 8 columnas |

El corte está en **1280 px y no en 1024**, y eso salió de una medición: a 1024, con la barra lateral
del ERP, el listado quedaba en **316 px**. Eso no es un listado, es una excusa. Abajo de 1280 la
ficha se muestra como hoja.

Con el panel abierto y menos de 1620 px, el listado esconde tres columnas —nombre comercial, rubro
y dominio— que son justamente las que está mostrando el panel al lado. Desde 1620 vuelven solas.

### Accesibilidad

`ACCESSIBILITY`:

- En escritorio el panel es `role="complementary"` con `aria-labelledby`, **no un `dialog`**: convive
  con el listado, que se sigue pudiendo filtrar y clickear. Atrapar el foco en un panel no modal
  sería un error, no una precaución. El foco entra al **abrir** —no en cada cambio de cliente, que
  sería insoportable con teclado— y vuelve a la fila al cerrar. Escape cierra si el foco está
  adentro.
- En pantalla angosta es un `dialog` modal de verdad, con `useModalAccesible`: foco atrapado, fondo
  `inert`, Escape, y el foco vuelve a donde estaba.
- La fila abierta se marca con `aria-current="true"` **y** con una barra al costado, para no
  depender del color de fondo (que además puede convivir con la selección del checkbox).
- El gráfico tiene leyenda siempre, orden fijo de barras, `<title>` por mes con las tres series y un
  `<details>` con la tabla completa. Las tres series tienen color propio y explícito: la primera
  versión sacaba «Pedido» de `--primary` y en el preset «grafito» eso vale `#94a3b8`, **exactamente**
  el gris de «Cotizado». Dos series del mismo color. Una paleta categórica no puede depender del
  acento del tema.
- La variación lleva flecha **y** texto: `▲ +18,2 %`, nunca sólo verde o rojo.

---

## 5 · Estado en la URL, caché y carreras

`URL_STATE` = `/clientes?cliente=<uuid>`.

De ahí salen cuatro cosas que un `useState` no da: «atrás» cierra el panel en vez de salir de la
pantalla, recargar lo deja abierto, el link se pasa por chat, y la misma ficha se va a poder abrir
desde una cotización armando la URL.

Dos reglas de historial: **abrir empuja** una entrada (para que «atrás» cierre), **cambiar de
cliente reemplaza** (mirar ocho clientes y tener que apretar «atrás» ocho veces es peor que no
tener historial).

Y una invariante que tiene sus propios tests: **abrir o cerrar la ficha no toca los filtros, y
filtrar no cierra la ficha**. `escribirFiltros` arma la query desde cero —a propósito, para que la
URL quede corta—, así que hay una lista explícita de parámetros que se conservan. «Limpiar filtros»
limpia los filtros, no la ficha: el cliente elegido no es un filtro.

`CACHE`: TanStack Query, `staleTime` de 60 s, clave `['clientes', empresa, 'ficha-360', id, meses]`.
A → B → A no vuelve a consultar. **No se usa `placeholderData`**: mostrar los importes del cliente
anterior mientras carga el nuevo es peor que un esqueleto — un importe que pertenece a otro cliente
durante 300 ms es un error de lectura, no un detalle de transición. Y como la clave incluye el id,
la respuesta lenta de la fila anterior se queda en su propia entrada del caché en vez de pintarse
encima: la carrera que apareció en los defaults de la Fase 17 · E2 acá no puede pasar.

`PERFORMANCE`:

- **Una** llamada por cliente abierto. El listado **no pide KPIs por fila** (hay un test que lo
  afirma): un N+1 sobre 1.010 clientes sería de manual.
- El plan de la consulta contra el cliente más pesado de producción —111 cotizaciones, 67 pedidos,
  80 entregas, 797 líneas— es **todo índices**, sin un solo `seq scan`: **6,2 ms** de ejecución en
  el servidor. Lo que se mide desde el navegador (450–600 ms en caliente) es el viaje a Supabase,
  no la consulta.

---

## 6 · Seguridad

`RLS` / `SECURITY`: la ficha hereda **exactamente** la visibilidad de `customers`. Probado contra
producción con fixtures `zz-e1c` y cinco identidades:

| Actor | Resultado |
|---|---|
| admin | ve cualquier cliente de su empresa |
| vendedor **asignado** | ve el suyo |
| vendedor **no asignado** | `null`, aunque tenga el uuid |
| technician | `null` |
| admin de **otra empresa** | `null` |
| anon | **ni siquiera puede ejecutar la función** (`revoke ... from anon`) |

Y lo que importa de verdad: el `null` no es un descuido que igual filtre importes por otro lado. Un
test comprueba que en la respuesta del vendedor ajeno **no aparece ni un número** del cliente que no
puede ver.

`DB_CHANGES`: una función nueva, `resumen_cliente_360`. Nada más.
`DB_BASELINE`: antes y después — 1.010 clientes, 306 cotizaciones, 172 pedidos, 193 entregas, 20
secuencias. **Sin cambios.** Ninguna fila productiva se tocó.

---

## 7 · Crear documentos: por qué todavía no

`QUOTE_CREATION_CURRENT_BLOCKER`
`ORDER_CREATION_CURRENT_BLOCKER`
`DELIVERY_CREATION_CURRENT_BLOCKER`

Los tres, el mismo: **`document_numbering_authority` = `STEL`** para `quote`, `sales_order` y
`delivery`, desde el `rollback-2026-09-16-colision-pdv01320`. `next_document_number` llama a
`app.exigir_emision_erp`, que revienta con `external_numbering_authority`. El bloqueo está en la
base, no en la pantalla: no se puede saltear desde el frontend, y está bien que así sea.

Por eso la ficha rápida muestra «Nueva cotización» **deshabilitado y con el motivo escrito al
lado**, usando el mismo `useAutoridadNumeracion` y el mismo texto que los listados de Ventas. No se
inventa un patrón nuevo para decir lo mismo. **«Nuevo pedido» directamente no está**: la Fase 19
habilita primero la cotización, y un botón que lleva a una pantalla que la base va a rechazar no es
una acción, es una trampa.

### La serie piloto: se puede, y sin tocar la autoridad productiva

`PILOT_SERIES_FEASIBILITY` = **VIABLE, sin cambios de esquema.**

El modelo ya soporta exactamente esto y lo está usando hoy. `app.autoridad_efectiva(company,
doc_type, series)` mira **primero** `document_numbering_authority_series` y sólo si no hay fila cae
a `document_numbering_authority`. Y hay una fila viva que lo demuestra: `RT-ML` (MercadoLibre) está
marcada `STEL` a nivel serie.

O sea: se puede crear una serie **con autoridad ERP** mientras el tipo de documento sigue en STEL.
Son dos filas por tipo y ningún DDL:

1. una fila en `document_sequences` — `series_code = 'COT-ERP'`, `prefix = 'COT-ERP'`,
   `is_default = false`;
2. una fila en `document_numbering_authority_series` — `('quote', 'COT-ERP', 'ERP')` con su motivo.

`RECOMMENDED_DOCUMENT_PILOT` = **cotización con serie `COT-ERP`, y sólo cotización.**

Por qué es segura: no consume la secuencia `COTI` (que va por 2630 y la sigue manejando STEL), no
puede chocar con un documento importado —ninguno tiene ese prefijo—, se identifica de un vistazo, y
una cotización **no mueve stock ni contabilidad**. Es el único documento del circuito del que se
puede decir eso.

**No se implementó.** Requiere dos filas en producción y la decisión de crearlas no es técnica: es
de quien responde por la numeración. Queda propuesta, justificada y lista para E2.

Y una advertencia que vale más que el resto de esta sección: **el remito es el peligroso**. Crear un
borrador no mueve stock —la Fase 15 · E5 lo impide: un remito sólo avanza con «Confirmar y
despachar»—, pero despachar sí descuenta. Un piloto de remitos se prueba con stock cero o no se
prueba.

---

## 8 · Plan

`IMPLEMENTATION_PLAN`:

| Entrega | Qué | Depende de |
|---|---|---|
| **E1** ✅ | Ficha rápida + `resumen_cliente_360` + master/detail | — |
| **E2** | Serie piloto `COT-ERP` · alta y edición de cotización con vista previa en vivo · pipeline visual · anterior/siguiente · pie de totales fijo | Que alguien apruebe las dos filas de la serie piloto |
| **E3** | Pedido: alta, conversión desde cotización con confirmación, serie `PDV-ERP` | E2 andando con documentos reales de prueba |
| **E4** | Remito: generación desde pedido con pedido/entregado/pendiente a la vista | E3 **y** una decisión explícita sobre stock |
| **E5** | Ficha rápida global: abrirla desde cotización, pedido, remito y WhatsApp | E1 (ya está lista para eso) |

El orden no es el del enunciado por casualidad: es el del riesgo. Cotización no toca stock ni
contabilidad; remito toca las dos.

---

## 9 · Tests

`TESTS`:

| Suite | Qué cubre | Resultado |
|---|---|---|
| `scripts/fase19-e1-cliente-360-tests.mjs` | La función contra **producción**: identidad, KPIs por moneda, abiertos, serie, recientes, productos, cliente vacío, cancelados, RLS con cinco identidades, y que la llamada única diga lo mismo que las cinco viejas | **53 PASS** |
| `lib/kpis.test.ts` | Separación por moneda, variación, mes anterior en cero | 17 |
| `components/FichaRapidaCliente.test.tsx` | Cliente completo, sin datos, dos monedas, sin base de comparación, recientes, productos, cargando, error con reintento, sin permiso, quién puede crear, bloqueo de STEL | 16 |
| `hooks/useClienteSeleccionado.test.tsx` | La URL: abrir, cerrar, link directo, y que filtros y ficha no se pisen | 10 |
| `pages/ClientesPage.test.tsx` | Master/detail: click abre sin navegar, Ctrl+click sigue navegando, fila marcada, cambio de cliente, cerrar, sin N+1, hoja en pantalla angosta | 16 (8 nuevos) |

Batería completa: `tsc -b`, `eslint`, **1.621 tests** en `npm test` y en `npm run test:isolated`,
y `npm run build`. Todo en verde.

---

## 10 · Rollback

La función es de sólo lectura y nada más la llama: `drop function resumen_cliente_360(uuid, int)`
y listo (está en el SQL, comentado). La pantalla vuelve al comportamiento anterior sacando el
`?cliente=` de la URL — sin ese parámetro, `/clientes` es exactamente el listado de antes.
