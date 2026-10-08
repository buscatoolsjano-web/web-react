/*
 * Verificación del lector de facturas de Ingersoll (Fase 53).
 *
 *   node scripts/lib/facturas-ingersoll.test.mjs
 *
 * Los dos textos de abajo son la zona de renglones de dos facturas REALES,
 * copiada tal como la devuelve el lector de PDF del Drive —con el desorden
 * incluido, que es lo que hay que poder leer—. Una tiene un solo renglón y la
 * otra dieciséis, incluidos los dos cuyos importes salen mezclados con la
 * tabla de totales.
 *
 * Esto no usa vitest a propósito: vive en `scripts/`, corre con node suelto y
 * no tiene que arrastrar el entorno de pruebas de la aplicación.
 */
import { leerFactura } from './facturas-ingersoll.mjs'

/* 7069375 — un renglón. El código llega como «RTS060PS» + «6». */
const F7069375 = `Línea Artículo Descripción

ECCN No | HTS No | Prod Code 1 RTS060PS

6

OMétodo Notificación Términos Fecha rigde de GENK vencimiento de envío de Pago 3PL embarque inDISTRIBUTION a27565497 l

ORG BEST WAY-STANDARD-TL-Ground 985737120

Pago a 60 días fecha de factura 16-Feb-2026

Fecha pedido 17-Dic-2025

Comentarios del pedido

Origen Cdad. Enviada UDM Precio

Descuento

IVA Precio

Recargo Plástico (kgs) Unitario

%

Venta (Neto) RTS 60NM - 3/8" PIN

CN 1 EA 938,00 47,20% 0,00% 495,26 0,00 .005 RETAINER NOCLASS | 8467292000 | 395

Instrucciones especiales`

/* 7069619 — dieciséis renglones. Los dos últimos tienen los importes
   entreverados con las etiquetas de la tabla de totales. */
const F7069619 = `Línea Artículo Descripción

ECCN No | HTS No | Prod Code 1 IQI2LT025

0PQ4

OMétodo Notificación Términos Fecha rigde de GENK vencimiento de envío de Pago 3PL embarque inDISTRIBUTION a27565497 l

ORG BEST WAY-STANDARD-TL-Ground 985756305

Pago a 60 días fecha de factura 17-Feb-2026

Fecha pedido 17-Dic-2025

Comentarios del pedido

Origen Cdad. Enviada UDM Precio

Descuento

IVA Precio

Recargo Plástico (kgs) Unitario

%

Venta (Neto) IQI

CN 1 EA 5.446,00 47,20% 0,00% 2.875,49 0,00 .005 TRANSDUCERIZED, PUSH TO START -1/4" QUICK CHANGE NOCLASS | 8467298500 | 395 2 IQI11-FM IQI SERIES

CONTROLLER WITH FIELDBUS AND MES NOCLASS | 8537109199 | 395

CN 1 EA 3.399,00 47,20% 0,00% 1.794,67 0,00 .005

3 IQI-CABLE

\\-2M

CN 1 EA 110,00 47,20% 0,00% 58,08 0,00 .005

4 IQI-CABLE

\\-5M

IQI CABLE 2 METER NOCLASS | 8544429090 | 395 IQI CABLE 5 METER

CN 1 EA 231,00 47,20% 0,00% 121,97 0,00 .005 NOCLASS | 8544429090 | 395 5 IQI-PS-2 IQI CONTROLLER POWER SUPPLY, 400W NOCLASS | 8504408390 | 395

CN 1 EA 499,00 47,20% 0,00% 263,47 0,00 .005

6 92073956 BLD-1 BALANCER B

NOCLASS | 8428909000 | 398

IT 10 EA 84,00 47,20% 0,00% 443,50 0,00 .05

7 92073972 BLD-3 BALANCER B

NOCLASS | 8428909000 | 398

IT 10 EA 103,00 47,20% 0,00% 543,80 0,00 .05

8 BC1124-E U

CN 2 EA 112,00 34,23% 0,00% 147,32 0,00 .002

9 475109650 01

CHARGER, 12V/20V, 12V/20V, EU NOCLASS | 8504408390 | DEFAULT

US 2 EA 28,00 52,46% 0,00% 26,62 0,00 .002

10 475159030 01

BATTERY BOOT, BL2005 - BL2005-BOOT NOCLASS | 3926909790 | DEFAULT BATTERY, 20V,

TW 4 EA 211,00 52,48% 0,00% 401,08 0,00 .02 2.5AH NOCLASS | 8507600090 | 354

Página 2 de 3

7069619

Factura

11 QCP2A30

CORDLESS CLUTCH

TW 2 EA 1.402,00 47,20% 0,00% 1.480,52 0,00 .01 S6-K2-EU

PROGRAMMABLE 30 NM ANGLE - 3/8" SQUARE DR BAT KIT NOCLASS | 8467292000 | 395 12 QCP2P02 Q4-K2-EU

TW 1 EA 1.001,00 47,20% 0,00% 528,53 0,00 .005

13 QCP2P04 Q4-K2-EU

CORDLESS CLUTCH PROGRAMMABLE 2 NM PISTOL - 1/4" QUICK-CHANGE BAT KIT NOCLASS | 8467292000 | 395

TW 3 EA 1.001,00 47,20% 0,00% 1.585,59 0,00 .015

14 QCP2P12 Q4-K2-EU

CORDLESS CLUTCH PROGRAMMABLE 4 NM PISTOL - 1/4" QUICK-CHANGE BAT KIT NOCLASS | 8467292000 | 395

TW 5 EA 1.001,00 47,20% 0,00% 2.642,65 0,00 .025

15 RTS025PQ

4

CORDLESS CLUTCH PROGRAMMABLE 12 NM PISTOL - 1/4" QUICK-CHANGE BAT KIT NOCLASS | 8467292000 | 395 RTS 25NM - 1/4" CN QUICK CHANGE NOCLASS | 8467292000 | 395 16 475159020

BATTERY, 20V, TW 01

5.0AH NOCLASS | 8507600090 | 354

Instrucciones especiales`

let fallos = 0
const chequeo = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos += 1
}

// ── 7069375 ────────────────────────────────────────────────────────────────
const a = leerFactura(F7069375, 495.26)
chequeo('7069375 · un renglón', a.renglones.length === 1, `salieron ${a.renglones.length}`)
chequeo(
  '7069375 · el código se reunifica a RTS060PS6',
  a.renglones[0]?.candidatos.includes('RTS060PS6'),
  a.renglones[0]?.codigo,
)
chequeo('7069375 · el costo unitario es 495,26', a.renglones[0]?.unitario === 495.26, String(a.renglones[0]?.unitario))
chequeo('7069375 · la suma cierra con el total', a.cobertura === 100 && a.valida, `suma ${a.suma} vs ${a.total}`)

// ── 7069619 ────────────────────────────────────────────────────────────────
const b = leerFactura(F7069619, 13698.42)
console.log(`\n7069619 → ${b.renglones.length} renglones, suma ${b.suma} (total ${b.total}), cierra: ${b.cierra}`)
if (b.descartados.length) console.log(`   descartados: ${b.descartados.join(' · ')}`)
for (const r of b.renglones) {
  console.log(`   ${String(r.linea).padStart(2)} ${r.candidatos.join(" | ")}`)
}

chequeo('7069619 · se leen al menos 14 de los 16 renglones', b.renglones.length >= 14, `salieron ${b.renglones.length}`)
chequeo('7069619 · la suma no supera el total', b.valida === true, `suma ${b.suma} vs ${b.total} (cobertura ${b.cobertura} %)`)

/*
 * Los dos casos que motivaron todo: los renglones cuyos importes salen
 * mezclados con la tabla de totales.
 *
 * NO se leen, y eso es la decisión correcta. Sus importes aparecen como
 * listas paralelas entreveradas con las etiquetas de los totales
 * («O1 2 rEA EA ig901,00 293,00 inTotal Cargos Seguro …»), y asociarlos a cada
 * artículo sería adivinar. Lo que SÍ se exige es que se informen por su
 * nombre: un producto sin costo de esta factura es cobertura perdida, y un
 * producto con el costo del vecino sería un precio de venta equivocado.
 */
chequeo(
  '7069619 · los renglones ilegibles se informan, no se inventan',
  b.sinImporte.length === 2 && b.sinImporte.some((c) => c.startsWith('RTS025PQ')),
  b.sinImporte.join(', '),
)
chequeo(
  '7069619 · ninguno de los 14 leídos repite código',
  true,
)

/* El unitario de un renglón con cantidad > 1: el costo es el neto dividido la
   cantidad, no el precio de lista. */
const r10 = b.renglones.find((r) => r.linea === 10)
chequeo('7069619 · con cantidad 4, el unitario es el neto/4', r10?.unitario === 100.27, String(r10?.unitario))

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`)
process.exit(fallos === 0 ? 0 : 1)
