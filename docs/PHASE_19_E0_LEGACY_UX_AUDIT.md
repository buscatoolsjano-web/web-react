# Fase 19 · E0 — Qué copiar de la web anterior, y qué no

Fecha: 2026-09-18.

> **Observación de sólo lectura.** Se recorrió **STEL Order** (`app.stelorder.com`) con la sesión
> real de Buscatools, sin modificar, crear, borrar ni enviar nada. No se tocó ningún documento, no
> se abrió «Ver / Imprimir» —para no disparar una descarga ni un diálogo de impresión sobre un
> sistema productivo— y no se usó ninguna acción del menú «Más».

Hay **dos** sistemas anteriores y conviene no confundirlos, porque las buenas ideas vienen de
distinto lado:

| | Qué es | Qué se mira acá |
|---|---|---|
| **STEL Order** | El ERP comercial del que se está migrando. Sigue siendo el sistema productivo de numeración. | Clientes, Cotizaciones, Pedidos, Notas de entrega: pantallas reales, recorridas hoy. |
| **La web propia** | El `index.html` + `app.js` de 45.345 líneas auditado en la [Fase 5](PHASE_5_CLIENTES_PLAN.md). | De ahí sale la idea de la **ficha rápida** (`abrirClienteQuickPanel`, app.js 18180): panel lateral con resumen y gráfico de doce meses, abierto desde el listado. |

---

## 1 · Clientes

### Lo que hace bien

`LEGACY_CUSTOMERS_GOOD_PATTERNS`

1. **Un filtro por columna, en la propia cabecera.** Cada columna del listado tiene su casilla
   «Buscar». Para «todos los Whirlpool» no hay que abrir un panel de filtros: se escribe en la
   columna. Es denso, pero es rapidísimo para quien lo usa ocho horas por día.
2. **Filtros guardados.** Un desplegable arriba a la derecha con búsquedas guardadas (`whirl`,
   `mercado`, `integra`). El vendedor que atiende siempre a los mismos clientes entra y ya está
   filtrado.
3. **Navegación anterior/siguiente dentro del resultado.** La ficha muestra «2 de 2» y dos flechas:
   se recorre el resultado de la búsqueda sin volver a la lista.
4. **«Relacionados → Documentos»: todo el historial comercial en una sola tabla.** Cotizaciones,
   pedidos, notas de entrega y facturas mezclados en orden cronológico, con tipo, estado, fecha,
   importe **con su moneda al lado** y un clip cuando hay adjuntos. Es la pantalla que contesta
   «¿qué viene pasando con este cliente?».
5. **El panel rápido de la web propia** (`abrirClienteQuickPanel`): abrir un resumen del cliente
   **sin salir del listado**. Es exactamente la idea que la Fase 19 · E1 rescata.

### Lo que hace mal

- **Click en una fila = te vas de la lista.** No hay vista rápida: cada cliente que se quiere mirar
  cuesta una navegación de ida y otra de vuelta, perdiendo el scroll.
- **La ficha empieza con un formulario largo y las once pestañas quedan bajo la línea de flote.**
  Al entrar se ve razón social, CUIT, calle, ciudad, provincia, código postal y país —datos que casi
  nunca son la pregunta— y para llegar a los documentos hay que scrollear y después elegir pestaña.
- **Once pestañas** (General, Comercial, Precios especiales, Cuenta bancaria, Personas de contacto,
  Otras calles / direcciones, Activos, Adjuntos, Saldo, Relacionados, Shop). Ninguna jerarquía: la
  que se usa todos los días y la que no se usó nunca pesan lo mismo.
- **Sin totales por moneda.** La tabla de documentos muestra ARS y USD mezclados y no suma nada.

---

## 2 · Ventas (cotizaciones, pedidos, notas de entrega)

Las tres secciones tienen **la misma forma**, y eso ya es un acierto: quien aprendió cotizaciones
sabe usar pedidos.

### Lo que hace bien

`LEGACY_SALES_GOOD_PATTERNS`

1. **La barra de acciones siempre arriba y siempre igual**: Volver · Editar · Más · Ver/Imprimir ·
   Enviar, más las flechas «1 de 7». No se mueve entre tipos de documento.
2. **El pie de totales fijo.** Mientras se editan las líneas, abajo queda pegada una barra con
   `Uds.: 49,00 · Total base (ARS): 515.988,00 · IVA (ARS): 108.357,48 · Total (ARS): 624.345,48`.
   **Cada importe dice su moneda en la etiqueta.** Es el mejor detalle de todo el sistema: el número
   que importa nunca se va de la pantalla.
3. **La cabecera comercial junta en un bloque**: cliente, forma de pago, IVA/percepción, fecha,
   estado, título, creado por, agente y tarifa. Todo lo que define el documento en un solo golpe de
   vista.
4. **La referencia se copia con un botón** al lado del número.
5. **El cliente tiene lupa y botón de abrir** desde la cabecera del documento: se puede saltar a la
   ficha del cliente sin buscarlo.
6. **La procedencia está en el título.** Una nota de entrega encabeza con «Generado a partir del
   pedido de venta **PDV01305** (04/09/2026)», con link al pedido.
7. **Filtro de período en la barra** («Últimos 6 meses»), que es como se mira un listado de
   documentos de verdad.

### Lo que hace mal

`LEGACY_BAD_PATTERNS`

1. **Suma monedas y le pone la etiqueta de una.** La pantalla de inicio muestra
   `Cotizaciones 10.313.498.939,61 USD` y `Notas de entrega 90.525.135,32 USD`: son pesos sumados
   con dólares y rotulados «USD». No está mal por poco, está mal por tres órdenes de magnitud, y
   nadie lo nota porque parece un número. **Éste es el error que no se copia por ningún motivo.**
2. **El pie de los listados muestra un único total con `$`** mientras las filas están en ARS y en
   USD, sin decir a qué moneda ni a qué cambio convirtió.
3. **«Eliminar» es el primer ítem del menú «Más»**, y «Generar…» —la conversión a pedido o a
   entrega, que es la acción más frecuente del documento— está enterrada cuarta, entre trece ítems.
4. **No hay pipeline.** La cadena cotización → pedido → entrega → factura existe, pero como una
   tabla plana en la pestaña «Relacionados». Hay que leerla y reconstruir mentalmente en qué etapa
   está el documento.
5. **La nota de entrega no muestra cuánto faltaba entregar.** Las líneas tienen «Uds.» y nada más:
   ni pedido, ni ya entregado, ni pendiente. Justo el dato por el que existe una entrega parcial.
6. **Columnas que cortan el dato**: `1.917,57 U…`, `OC XXX WHIRLP…`, `BUSCATOOLS EPP …`. Se ve que
   hay algo, no se ve qué.
7. **Campos de sólo lectura con aspecto de input.** En modo lectura todo parece editable y no lo es.
8. **Estados con color saturado y sin forma** (verde/amarillo a pantalla llena). Depende del color.

---

## 3 · Qué se conserva y qué se cambia

`WHAT_TO_KEEP`

| Idea | Cómo entra al ERP nuevo |
|---|---|
| Ficha rápida desde el listado | **E1 (esta entrega)**: panel lateral con master/detail, sin salir de la lista. |
| Historial comercial en un solo lugar | El bloque «Actividad reciente» de la ficha rápida y la pestaña Historial de la ficha completa. |
| Importes con su moneda pegada | Ya es regla del módulo: `formatearImporte` nunca muestra un número sin moneda. |
| Pie de totales fijo mientras se edita | **E2**, en el editor de cotización. |
| Procedencia en el encabezado del documento | Ya existe en Ventas (Fase 15) y se refuerza con el pipeline de E2. |
| Copiar la referencia / el CUIT de un click | «Copiar CUIT» en la ficha rápida (E1). |
| Anterior / siguiente dentro del resultado | **E2**, en el detalle de documento. |
| Filtro por columna | **Descartado por ahora**: el listado nuevo ya filtra server-side por texto, rubro y estado. Volver a discutirlo si aparece la necesidad real. |

`WHAT_TO_IMPROVE`

1. **Nunca sumar monedas.** Todo KPI viene desagregado y la pantalla muestra una línea por moneda.
2. **Decir qué es cada serie.** «Cotizado», «Pedido» y «Entregado» son tres cosas distintas y el
   gráfico las nombra; el legacy mostraba «ventas» sin aclarar cuál.
3. **Pipeline visual** en vez de tabla de relacionados (E2).
4. **Entregas con pedido / entregado / pendiente** a la vista (E4).
5. **Jerarquía de acciones**: lo frecuente primero y visible; lo destructivo aparte y confirmado.
6. **Menos densidad, más aire**, y nada de estado sólo por color: badge con texto.
7. **Responsive de verdad.** La tabla de ocho columnas del legacy en 390 px obliga a scrollear toda
   la página de costado; el listado nuevo pasa a tarjetas.

---

## 4 · Lo que NO se copia, y por qué

- **El total convertido del pie de listado.** Sin tipo de cambio visible ni fecha, un total
  convertido es una opinión disfrazada de dato.
- **Las once pestañas de la ficha.** La ficha completa del ERP nuevo ya tiene menos, y la ficha
  rápida no es «la ficha completa comprimida»: es otra pregunta.
- **El menú «Más» de trece ítems.**
- **«Facturado».** No hay módulo de facturación en el ERP nuevo, así que no se muestra un
  `Facturado USD 0` que parecería un dato y sería una ausencia.
