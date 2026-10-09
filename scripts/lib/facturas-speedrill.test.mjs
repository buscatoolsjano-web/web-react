/*
 * Verificación del lector de facturas de SPEEDRILL (Fase 55).
 *
 *   node scripts/lib/facturas-speedrill.test.mjs
 *
 * Los textos son de facturas REALES, tal como los devuelve el lector de PDF
 * del Drive. Se eligieron las tres que concentran todo lo que puede salir mal:
 *
 *  · FA230003 — una descripción que sigue DESPUÉS de los importes de su propio
 *    renglón, así que el tramo del renglón siguiente empieza con la cola del
 *    anterior;
 *  · FA240007 — el código escrito dos veces («VPPH2/90 VPPH2/90»), el mismo
 *    código en dos renglones distintos, y precios impresos redondeados
 *    (40 × 5,43 = 217,20 pero la factura dice 217,27);
 *  · FA240008 — descripciones que TERMINAN EN NÚMERO («MIDDLE GEAR 19 4 16,07
 *    64,28»), que es donde un parseo posicional carga la cantidad equivocada.
 */
import { leerFactura } from './facturas-speedrill.mjs'

const F230003 = `Código Referencia cliente

Descripción Cantidad Precio Importe Albarán S/230009 del 28/11/2023. Contacto: JUAN MANUEL

EM3 PUNTA HEXAGONAL DE INSERCIÓN 1/4, TIPO 3, L=25 150 1,64 246,00 VPTX20/160 PUNTA TORX® DE INSERCIÓN 1/4, TIPO T20, L=160, 30 5,83 174,90 A=3,86, D=4,8

VPTX20/300 PUNTA TORX® DE INSERCIÓN 1/4, TIPO T20, L=300,

30 9,45 283,50 A=3,86, D=4,8

Suma Importes

Base I.V.A. 21% R.E.

Importe total 704,40 704,40 147,92

852,32 €`

const F240007 = `Código Referencia cliente

Descripción Cantidad Precio Importe Albarán S/240004 del 18/03/2024. Contacto: CHRISTIAN CASTANO

553 PORTAPUNTA MAGNÉTICO 1/4 L=60MM 40 5,43 217,27 553/4 PORTAPUNTA MAGNÉTICO 1/4 L=100MM 40 9,34 373,54 553/6 PORTAPUNTA MAGNÉTICO 1/4 L=150MM 40 9,69 387,54 VPPH2/50 PUNTA PHILLIPS 1/4, TIPO 2, L=50 500 0,57 284,06 VPPH2/70 PUNTA PHILLIPS 1/4, TIPO 2, L=70 500 0,90 451,92 VPPH2/90 VPPH2/90 PUNTA PHILLIPS 1/4, TIPO 2, L=90 500 0,99 494,95 JIM2308H EMBOCADURA DE IMPULSO 3/8 E/C8 L=43MM 10 18,64 186,38 JIM2310H EMBOCADURA DE IMPULSO 3/8 E/C10 L=43MM 10 18,64 186,38 JIM2312H EMBOCADURA DE IMPULSO 3/8 E/C12 L=43MM 7 18,64 130,47 JIM2312H EMBOCADURA DE IMPULSO 3/8 E/C12 L=43MM 1 18,64 18,64 JIM3024C EXTENSIÓN DE IMPULSO 3/8 (H) L=100MM CON 1 31,42 31,42 PASADOR

SPCOPMGR MAGNETIC RING 50 8,81 440,56 2005.5VPCM ADAPTADOR INSERCIÓN MACHO 1/4 HEX 5.5 L= 30 6,44 193,20 50MM MAGNÉTICO

JIM3024C EXTENSIÓN DE IMPULSO 3/8 (H) L=100MM CON

4 31,42 125,68 PASADOR

Suma Importes Portes

Base I.V.A. 21% R.E.

Importe total 3.522,01 30,00 3.552,01 745,92

4.297,93 €`

const F240008 = `Código Referencia cliente

Descripción Cantidad Precio Importe Albarán S/240006 del 02/04/2024. Contacto: CHRISTIAN CASTANO

SPLMTA30 RUBBER TRIM FASTENER

2 2.170,00 4.340,00 NUMEROS DE SERIE: 1 x SP240401 -1 , 1 x SP240401-2

6J5-006 SLEEVE 4 15,61 62,44 0-241003 THRUST BALL BEARING(CRT8-16) 14 18,70 261,80 0-211006 NEEDLE BEARING(HK0810) 14 3,71 51,94 6G2-007 MIDDLE GEAR 19 4 16,07 64,28 6J2-ZG-009 ACTIVE SHAFT 4 48,22 192,88 6J5-009 PIN 25 4 15,45 61,80 6G2-008 MIDDLE GEAR 12 2 16,07 32,14 801-024 DRIVEN GEAR 15 2 24,88 49,76 801-023 BEVEL GEAR 35 2 24,88 49,76 0-132010 FLAT HEAD SCREW(M6X16L) 5 10 0,31 3,10 6J5-030 FLAT HEAD SCREW(M6X16L) 7 10 0,31 3,10 6J5-028 ACTIVE ROLLER 6 4 34,77 139,08 6J5-029 FIXED ROLLER 8 4 34,77 139,08 0-101064 CAP SCREW(M4X10L ) 9 10 0,31 3,10 0-101063 CAP SCREW(M4X45L ) 3 10 0,31 3,10 0-101005 CAP SCREW(M4X6L ) 2 10 0,31 3,10 Suma Importes Portes

Base I.V.A. 21% R.E.

Importe total 5.460,46 15,00 5.475,46 1.149,85

6.625,31 €`

let fallos = 0
const chequeo = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos += 1
}
const tiene = (r, cod) => r.candidatos.includes(cod)

// ── FA230003: la descripción que sigue después de los importes ─────────────
const a = leerFactura(F230003, 704.4)
chequeo('FA230003 · tres renglones', a.renglones.length === 3, `salieron ${a.renglones.length}`)
chequeo('FA230003 · la suma da la Suma Importes', a.cierra === true, `${a.suma} vs ${a.sumaEsperada}`)
chequeo('FA230003 · el primero es EM3 a 1,64', tiene(a.renglones[0] ?? {candidatos:[]}, 'EM3') && a.renglones[0]?.unitario === 1.64)
/* El caso: el tramo del tercer renglón empieza con «A=3,86, D=4,8», que es la
   cola de la descripción del segundo. El código verdadero está más adelante, y
   por eso se devuelven todos los candidatos y decide el catálogo. */
chequeo(
  'FA230003 · el tercero propone VPTX20/300 aunque el tramo empiece con otra cosa',
  tiene(a.renglones[2] ?? {candidatos:[]}, 'VPTX20/300'),
  a.renglones[2]?.candidatos.slice(0, 4).join(' | '),
)

// ── FA240007: precios redondeados, código repetido, código en dos renglones ─
const b = leerFactura(F240007, 3522.01)
chequeo('FA240007 · catorce renglones', b.renglones.length === 14, `salieron ${b.renglones.length}`)
chequeo('FA240007 · la suma da la Suma Importes', b.cierra === true, `${b.suma} vs ${b.sumaEsperada}`)

/* El precio impreso es 5,43 y el importe 217,27: el unitario real es 5,4318.
   Se guarda el real, que es el que se pagó. */
const r553 = b.renglones.find((r) => tiene(r, '553'))
chequeo('FA240007 · el unitario sale del importe, no del precio impreso', r553?.unitario === 5.4318, String(r553?.unitario))

/* `VPPH2/90 VPPH2/90` — el código escrito dos veces no puede generar dos
   renglones ni duplicarse entre los candidatos. */
const rPH90 = b.renglones.find((r) => tiene(r, 'VPPH2/90'))
chequeo('FA240007 · el código repetido no se duplica', rPH90 !== undefined && rPH90.importe === 494.95)
chequeo(
  'FA240007 · y aparece una sola vez entre sus candidatos',
  (rPH90?.candidatos.filter((c) => c === 'VPPH2/90').length ?? 0) === 1,
)

/*
 * El mismo código en dos renglones con cantidades distintas: los dos entran y
 * el cargador después decide.
 *
 * Los unitarios coinciden AL CENTAVO, no exactamente: `130,47 / 7 = 18,6386` y
 * `18,64 / 1 = 18,64`, porque la factura redondea cada importe. Exigir
 * igualdad exacta sería exigir que el proveedor no redondee, y haría que el
 * cargador avise de un conflicto que no existe.
 */
const jim = b.renglones.filter((r) => tiene(r, 'JIM2312H'))
chequeo('FA240007 · JIM2312H aparece en dos renglones', jim.length === 2, `salieron ${jim.length}`)
chequeo(
  'FA240007 · con el mismo unitario al centavo en los dos',
  jim.length === 2 && Math.abs(jim[0].unitario - jim[1].unitario) <= 0.01,
  jim.map((r) => r.unitario).join(' vs '),
)

// ── FA240008: descripciones que terminan en número ─────────────────────────
const c = leerFactura(F240008, 5460.46)
chequeo('FA240008 · diecisiete renglones', c.renglones.length === 17, `salieron ${c.renglones.length}`)
chequeo('FA240008 · la suma da la Suma Importes', c.cierra === true, `${c.suma} vs ${c.sumaEsperada}`)

/*
 * EL CASO QUE JUSTIFICA LA ARITMÉTICA. «6G2-007 MIDDLE GEAR 19 4 16,07 64,28»:
 * el 19 es parte de la descripción y la cantidad es 4. Un parseo posicional
 * toma 19 y carga un costo de 3,38 en vez de 16,07.
 */
const gear = c.renglones.find((r) => tiene(r, '6G2-007'))
chequeo('FA240008 · «MIDDLE GEAR 19» no se lee como cantidad 19', gear?.cantidad === 4, `cantidad ${gear?.cantidad}`)
chequeo('FA240008 · y su unitario es 16,07', gear?.unitario === 16.07, String(gear?.unitario))

const tornillo = c.renglones.find((r) => tiene(r, '0-132010'))
chequeo('FA240008 · «SCREW(M6X16L) 5» tampoco', tornillo?.cantidad === 10 && tornillo?.unitario === 0.31)

/* El equipo de 2.170 con número de serie en la descripción. */
const equipo = c.renglones.find((r) => tiene(r, 'SPLMTA30'))
chequeo('FA240008 · el equipo de 4.340 sale bien', equipo?.cantidad === 2 && equipo?.unitario === 2170)

// ── una factura que no cierra NO es válida ─────────────────────────────────
const mala = leerFactura(F230003, 999.99)
chequeo('una suma que no da deja la factura como no válida', mala.valida === false && mala.cierra === false)

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} fallos.`)
process.exit(fallos === 0 ? 0 : 1)
