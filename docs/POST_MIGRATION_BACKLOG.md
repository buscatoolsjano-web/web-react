# Backlog post-migración

Cosas detectadas durante la migración que **no la bloquean**. Se anotan acá y se
sigue: el objetivo de la Fase 4 es migración funcional 1:1, no rediseñar Ventas.

Sólo se frena la migración por pérdida de datos, seguridad, integridad, RLS o un
bug crítico.

---

## Producto / proceso comercial

### Política de stock negativo

Hoy **se permite**: emitir un remito por más de lo que hay en stock deja el
saldo en negativo. No es una decisión nueva, es la del sistema anterior
—`applyStockDeductions` descontaba sin mirar el saldo— y migrar el circuito no
era el momento de cambiarla. La pantalla avisa cuándo va a pasar.

Queda para evaluar más adelante:

- bloquear
- pedir autorización
- permitirlo sólo a ciertos roles
- permitirlo cuando haya un pedido de compra pendiente de ingreso

**No cambiarlo ahora.**

### El remito: ¿valorizado o exclusivamente logístico?

Hoy es **valorizado**, por decisión explícita (Fase 4 · Stage 3 · G.1 opción A):
la nota de entrega del legacy se edita con precios y las 182 migradas traen
moneda, subtotal, impuesto y total en la cabecera, así que `delivery_lines`
recibió `unit_price`, `discount_pct`, `tax_treatment` y `tax_rate_snapshot`.

Vale la pena evaluar más adelante si el remito debería llevar sólo **qué y
cuánto** se entregó, dejando el importe en la factura. Es más limpio
conceptualmente y evita tener el precio en tres documentos. **No se cambia
ahora**: cambiaría el proceso comercial, no sólo el modelo.

### `salesperson_id` vacío en todo el histórico

Los 166 pedidos migrados lo tienen en `NULL` — el legacy no guardaba el vendedor
por documento. La columna «vendedor» de los listados va a estar vacía para el
histórico. Para documentos nuevos se completa con quien lo crea. Evaluar si vale
la pena reconstruir algo del histórico a partir de otra fuente.

### Direcciones de cliente

`customer_addresses` está vacía. El selector de dirección de envío no tiene de
dónde elegir hasta que se cargue el módulo de Clientes.

---

## Funciones legacy no migradas

### Importar OC con IA

El legacy sube un PDF de orden de compra, lo manda a un worker externo con IA y
propone las líneas. **No se migra ahora**: la API key viaja del lado del cliente.
Para migrarlo hay que mover la llamada al servidor (Edge Function) con la key
como secreto. Los 134 candidatos de OC ya detectados en la migración siguen
disponibles en `customer_po_candidates`.

### Nota de entrega → Factura

`sales_invoices` y `payments` están vacías y la numeración fiscal puede venir de
STEL. Se migra cuando esté definida la integración.

### Vista previa en vivo del documento

El editor legacy muestra el documento renderizado en un `iframe` con zoom y panel
redimensionable. Es cómodo pero no es funcionalidad: se evalúa después de que la
edición funcione.

### Pestaña «Firma»

**No hay nada que migrar**: en el legacy es un placeholder que dice
«Sin firma cargada (próximamente)». Si alguna vez se necesita firma del remito,
es una función nueva, no una migración.

---

## Datos históricos pendientes de decisión

- **13 clientes nombrados sólo en contactos** (y sus 32 contactos) no se
  migraron: el alcance aprobado eran los del histórico de ventas.
- **1 equivalencia** (`gmra s a u`) cuyo cliente no está en el histórico.
- **Serie `RT-ML`**: existe, es concurrente con `RT` y tiene contador propio,
  pero no sabemos qué significa `ML`, qué significa el `2025` embebido (los
  cuatro documentos son de 2026) ni cuál sería el próximo número. El schema la
  soporta y el histórico la conserva; la web **no la emite**.
- **Los 9 `PDV11xxx`**: conservan su número literal con la sospecha registrada
  aparte. Nadie los corrigió y nadie debería hacerlo automáticamente.
- **Los 21 pedidos sin entrega enlazada pero con remito huérfano del mismo
  cliente**: si alguna vez se revisan a mano, 28 remitos podrían encontrar su
  pedido.
- **Los 14 enlaces `AMBIGUOUS` / `UNRESOLVED`** de `delivery_lines`: sólo se
  resuelven con criterio humano. No aplicar fuzzy matching sin revisión
  explícita.

---

## UI

- **Capítulos**: `line_type = 'chapter'` está soportado, pero ninguna línea
  histórica lo usa, así que no hay con qué probarlo contra datos reales.
- **Listados mobile**: el legacy sólo tiene tarjetas en notas de entrega; los
  otros dos son tablas anchas. La versión React usa tarjetas en los tres.
- **Un tablero de Ventas** (`#/ventas` con su propia pantalla) sería una idea
  nueva. Hoy redirige a cotizaciones.

---

## Abierto al cerrar Ventas (entrega 6)

### Adjuntos: los roles externos no ven ninguno

La policy `attachments_select` es **sólo para roles internos**, tal como quedó
en Stage 1. Un cliente o un distribuidor no ve ningún adjunto, ni siquiera de
sus propios documentos.

Eso cumple de sobra con «sólo los adjuntos de documentos que pueden leer»,
pero si en algún momento se quiere que el cliente descargue su propia OC o su
remito firmado, hay que **ampliar la policy**, y ampliar acceso es una
decisión, no un detalle de implementación. No se hizo por las dudas.

### `entity_type` no se llama igual en las dos tablas

`attachments` usa `quote` / `order` / `delivery` y `sales_audit` usa
`sales_quote` / `sales_order` / `delivery`. Viene del schema de Stage 1. Cada
tabla se respeta como está: unificarlo obliga a migrar datos y no arregla
nada que hoy moleste.

### Impresión: no genera PDF por su cuenta

Se imprime con el diálogo del navegador, y desde ahí se elige «Guardar como
PDF». El legacy usaba `html2pdf` para generar el archivo y adjuntarlo a un
mail. Cuando exista el envío de mail desde la web, hay que decidir si el PDF
se genera en el cliente o en el servidor.

### Puerta de mantenimiento en el borrado

`service_role` puede borrar un documento **no histórico** aunque esté enviado
o cancelado. Es la misma clave que corre las migraciones, nunca sale del
servidor y la aplicación no la usa; existe para que los scripts de prueba
puedan limpiar lo que crean. Los 636 históricos están protegidos para todos,
incluida esa puerta, y ningún documento con derivados se borra nunca.

### Selección múltiple: sólo exportar

De las siete acciones de lote del legacy se migró **exportar**. Eliminar y
duplicar en lote son operaciones masivas peligrosas sobre documentos
comerciales y no se agregaron «por comodidad»; imprimir en lote necesita
resolver antes cómo se concatenan varias hojas.
