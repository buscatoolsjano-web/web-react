/**
 * Propuesta de categoría, tipo y marca para Torquetools. SÓLO LEE.
 *
 *   node scripts/torquetools-categorias.mjs
 *
 * El catálogo de Torquetools es un clon del de Buscatools (mismo SKU). Para
 * los que cruzan, se copia lo que ya quedó corregido en Buscatools: categoría
 * (por slug), tipo y marca (por nombre). Los propios de Torquetools pasan por
 * clasificar-categorias.mjs (propuesta-TTsolo.json), después por el nombre
 * contra Buscatools y al final por la revisión a mano (tt-manual.txt).
 * Las dos empresas no se mezclan: sólo se leen datos de Buscatools.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const leer = (f) => JSON.parse(readFileSync(`revision/categorias/${f}`, 'utf8'))
const T = leer('productos-Torquetools.json')
const B = leer('productos-Buscatools.json')
const porSku = new Map(B.map((b) => [b.sku, b]))
const clasif = new Map(leer('propuesta-TTsolo.json').filter((x) => x.a !== 'herramientas' && x.origen !== 'cajon').map((x) => [x.id, x]))
const porNombre = new Map(leer('tt-por-nombre.json').map((x) => [x.id, x]))

const COD = { P: 'punta', B: 'balanceador', A: 'atornillador', C: 'accesorio', I: 'llave-de-impacto', R: 'remachadora', D: 'llave-dinamometrica', E: 'seguridad', M: 'medicion', U: 'automatizacion', N: 'conduccion', Q: 'repuestos', X: 'abrasivos', H: 'herramientas-manuales', L: 'electrico', F: 'fijaciones', Y: 'mobiliario', T: 'neumatica', K: 'quimicos', W: 'pintureria', S: 'almacenamiento', SO: 'soldadura', Z: 'limpieza', G: 'amoladora', J: 'taladro', V: 'sierra', EL: 'elevacion', MC: 'mechas' }
// tt-manual.txt habla de los índices de tt-resto.txt, en el mismo orden.
const resto = readFileSync('revision/categorias/tt-resto.txt', 'utf8').split('\n')
const k = (s) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').slice(0, 80)
const manual = new Map()
for (const l of readFileSync('revision/categorias/tt-manual.txt', 'utf8').split('\n')) {
  const m = l.trim().match(/^(\d+)(?:-(\d+))?\s+(\S+)(?:\s+(.+))?$/)
  if (!m) continue
  for (let i = +m[1]; i <= +(m[2] ?? m[1]); i++) {
    const nombre = resto[i].split('|').slice(2).join('|')
    manual.set(k(nombre), { a: COD[m[3]], tipoA: m[4] ?? null })
  }
}

const propuesta = []
for (const t of T) {
  const b = porSku.get(t.sku)
  let a, tipoA, marca, origen
  if (b) {
    a = b.cat
    tipoA = b.tipo ?? null
    marca = b.marca
    origen = 'sku'
  } else if (clasif.has(t.id)) {
    const x = clasif.get(t.id)
    a = x.a
    tipoA = x.tipoA
    origen = 'reglas'
  } else if (porNombre.has(t.id)) {
    const x = porNombre.get(t.id)
    a = x.a
    tipoA = x.tipoA
    marca = t.marca ? undefined : x.marcaBT
    origen = 'nombre'
  } else if (t.cat === 'herramientas' && manual.has(k(t.nombre.replace(/\s+/g, ' ')))) {
    const x = manual.get(k(t.nombre.replace(/\s+/g, ' ')))
    a = x.a
    tipoA = x.tipoA
    origen = 'manual'
  } else continue
  if (!marca && !t.marca) marca = 'Genérico'
  const cambiaCat = a !== t.cat
  const cambiaTipo = (tipoA ?? null) !== (t.tipo ?? null)
  const cambiaMarca = marca !== undefined && marca !== null && marca.toLowerCase() !== (t.marca ?? '').toLowerCase()
  if (!cambiaCat && !cambiaTipo && !cambiaMarca) continue
  propuesta.push({ id: t.id, sku: t.sku, nombre: t.nombre, de: t.cat, a, tipoDe: t.tipo, tipoA, marcaDe: t.marca, marca: cambiaMarca ? marca : null, origen })
}
writeFileSync('revision/categorias/propuesta-Torquetools-final.json', JSON.stringify(propuesta, null, 1))
const r = {}
for (const x of propuesta) r[x.origen] = (r[x.origen] ?? 0) + 1
console.log(propuesta.length, 'cambios', r)
console.log('cambian categoría:', propuesta.filter((x) => x.de !== x.a).length, '· tipo:', propuesta.filter((x) => (x.tipoA ?? null) !== (x.tipoDe ?? null)).length, '· marca:', propuesta.filter((x) => x.marca).length)
const fin = {}
for (const t of T) fin[t.cat] = (fin[t.cat] ?? 0) + 1
for (const x of propuesta) { fin[x.de]--; fin[x.a] = (fin[x.a] ?? 0) + 1 }
console.log('Herramientas queda con', fin.herramientas, '· Otros', fin.otros, '· Repuestos', fin.repuestos)
console.log('marcas a crear en TT:', [...new Set(propuesta.filter((x) => x.marca).map((x) => x.marca))].length)
