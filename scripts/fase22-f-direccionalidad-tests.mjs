/**
 * Tests de la direccionalidad de las equivalencias (Fase 22 · Validación final).
 *
 * El legacy cargó la equivalencia UNA sola vez, desde el lado que el vendedor
 * estaba mirando: «TECNA 9336L tiene como alternativa a IR BMDS-2». Nadie
 * cargó la vuelta. Estas funciones son las que deciden qué relaciones están
 * declaradas en una sola dirección y, por lo tanto, cuáles no se ven al abrir
 * el otro extremo.
 *
 * Si se aflojan, la medición empieza a decir que la cobertura es mejor de lo
 * que es —contando como simétrica una relación que sólo existe de ida—, y con
 * ese número se toma la decisión de si vale la pena consultar los dos lados.
 *
 *   node scripts/fase22-f-direccionalidad-tests.mjs
 */
import { porExtremoB, unaSolaVia } from './fase22-f-direccionalidad.mjs'

let ok = 0
const fallos = []
const cmp = (titulo, esperado, real) => {
  const a = JSON.stringify(esperado)
  const b = JSON.stringify(real)
  if (a === b) ok++
  else fallos.push(`${titulo}\n    esperado: ${a}\n    real:     ${b}`)
}

const par = (product_id, equivalent_product_id, source_kind = 'sim_ir') => ({
  product_id,
  equivalent_product_id,
  source_kind,
})

// ── Qué cuenta como «una sola vía» ─────────────────────────────────────────
cmp('una relación sin vuelta es de una sola vía', ['A|B'], unaSolaVia([par('A', 'B')]).map((p) => `${p.product_id}|${p.equivalent_product_id}`))

cmp('si están las dos direcciones, ninguna es de una sola vía', [], unaSolaVia([par('A', 'B'), par('B', 'A')]))

// Tener la vuelta de UN par no vuelve simétricos a los otros pares del mismo
// producto: con B→A cargada, A→B y B→A son simétricas y A→C queda sola.
cmp(
  'la simetría se evalúa por par, no por producto',
  ['A|C'],
  unaSolaVia([par('A', 'B'), par('A', 'C'), par('B', 'A')]).map((p) => `${p.product_id}|${p.equivalent_product_id}`),
)

// El mismo par declarado bajo dos campos del legacy sigue siendo UNA relación
// lógica, pero son dos filas: la medición cuenta filas, y tiene que decirlo.
cmp(
  'el mismo par bajo dos source_kind son dos filas de una sola vía',
  2,
  unaSolaVia([par('A', 'B', 'sim_ir'), par('A', 'B', 'sim_cp')]).length,
)

// La vuelta cuenta aunque venga de otro campo: lo que importa es que alguien,
// alguna vez, haya declarado la relación desde el otro lado.
cmp(
  'la vuelta declarada con otro source_kind igual hace simétrico al par',
  [],
  unaSolaVia([par('A', 'B', 'sim_ir'), par('B', 'A', 'sim_cp')]),
)

cmp('sin relaciones no hay nada de una sola vía', [], unaSolaVia([]))

// ── El agrupamiento por el extremo B ───────────────────────────────────────
// B es el producto que hay que ABRIR para comprobar si aparece A. Agrupar mal
// acá haría que un producto con 71 equivalentes se cuente como uno solo.
const porB = porExtremoB(unaSolaVia([par('A1', 'B'), par('A2', 'B'), par('A3', 'C')]))
cmp('agrupa por el extremo que hay que abrir', ['B', 'C'], [...porB.keys()])
cmp('y junta TODOS los A de cada B', ['A1', 'A2'], porB.get('B'))
cmp('un B con un solo A también es un grupo', ['A3'], porB.get('C'))
cmp('un producto que nunca está del lado B no aparece', undefined, porB.get('A1'))

// Un par repetido bajo dos campos apunta al mismo A dos veces: el conteo de
// «cuántos de sus A encuentra» no puede inflarse por eso sin avisar.
const repetido = porExtremoB(unaSolaVia([par('A', 'B', 'sim_ir'), par('A', 'B', 'sim_cp')]))
cmp('el par repetido queda listado dos veces bajo el mismo B', ['A', 'A'], repetido.get('B'))

console.log(`${ok} OK, ${fallos.length} fallos`)
for (const f of fallos) console.error('  ✗ ' + f)
process.exit(fallos.length === 0 ? 0 : 1)
