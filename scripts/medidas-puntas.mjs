/**
 * Medidas de Puntas y tubos: deduce la medida del código del fabricante y la
 * compara con la cargada. SÓLO LEE: escribe revision/medidas-puntas.json.
 *
 *   node scripts/medidas-puntas.mjs Buscatools
 *
 * Convención del catálogo (la misma que el resto): tubos en «13 mm» o «3/8"»,
 * Torx «T20», Torx hembra «E10», Phillips «PH2», Pozidriv «PZ1», cuadrado
 * «SQ2», Torq-Set «TS1/4», Allen «5 mm» o «3/16"».
 *
 * Reglas confirmadas contra catálogos de los fabricantes:
 *  - APEX en pulgadas: los dos últimos dígitos del número son treintaidosavos
 *    (5622 → 22/32 = 11/16"; 6N-0810 → 10/32 = 5/16"; AM-06 → 6/32 = 3/16").
 *  - SPEEDRILL: S/J/K/L/M/R/SIM/JIM/KIM + 23 + medida en mm (S2313 → 13 mm);
 *    20NN = nutsetter de NN mm; xE NN = Torx hembra; TX NN = Torx.
 *  - Extensiones, adaptadores, portapuntas y cardánicos NO tienen medida de
 *    punta: si la «medida» es el largo, se vacía.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const empresa = process.argv[2] ?? 'Buscatools'
const P = JSON.parse(readFileSync(`revision/categorias/productos-${empresa}.json`, 'utf8')).filter((p) => p.cat === 'punta')

const FRAC = { 1: '1/32"', 2: '1/16"', 3: '3/32"', 4: '1/8"', 5: '5/32"', 6: '3/16"', 7: '7/32"', 8: '1/4"', 9: '9/32"', 10: '5/16"', 11: '11/32"', 12: '3/8"', 13: '13/32"', 14: '7/16"', 15: '15/32"', 16: '1/2"', 17: '17/32"', 18: '9/16"', 19: '19/32"', 20: '5/8"', 21: '21/32"', 22: '11/16"', 23: '23/32"', 24: '3/4"', 25: '25/32"', 26: '13/16"', 27: '27/32"', 28: '7/8"', 29: '29/32"', 30: '15/16"', 31: '31/32"', 32: '1"' }
/** NN treintaidosavos → texto en pulgadas ('1 1/8"' para 36). */
function treintaidosavos(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 96) return null
  const enteros = Math.floor(n / 32)
  const resto = n % 32
  if (resto === 0) return `${enteros}"`
  const f = FRAC[resto]
  return enteros === 0 ? f : `${enteros} ${f}`
}
const mm = (x) => `${String(Number(x))} mm`

/** [regla, (p, código, descripción) → medida | undefined]. La primera que da algo gana. */
const REGLAS = [
  // ── SPEEDRILL ── (el código manda: la descripción a veces está mal copiada)
  ['SP tubo mm', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^(?:S|J|K|L|M|R|SIM|JIM|KIM)23(\d{2,3}(?:\.\d)?)(?=[A-Z/]|$)/)?.[1]],
  ['SP tubo pulgadas', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^(?:S|J|K|L|R)23-(\d+\/\d+)(?=[A-Z])/)?.[1]],
  ['SP nutsetter mm', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^20(\d{2}(?:\.\d)?)(?:\/\d+)?VP/)?.[1]],
  ['SP nutsetter pulgadas', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^20-(\d+\/\d+)VP/)?.[1]],
  ['SP tubo R..MM', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^R(\d+)MM\d+/)?.[1]],
  ['SP Torx hembra', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^(?:S|J|R|K)E(\d+)(?=M|\/|$)/)?.[1]],
  ['SP Torx', (p, c) => p.marca === 'SPEEDRILL' && c.match(/(?:^|-)(?:VP)?TX(\d+)/)?.[1]],
  ['SP bi-hexagonal', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^(?:VP|VM)?BH(\d+(?:\.\d)?)/)?.[1]],
  ['SP Phillips', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^VPPH(\d)/)?.[1]],

  // ── APEX ──
  ['AP Torx macho', (p, c) => p.marca === 'APEX' && c.match(/^440TX(\d+)$/)?.[1]],
  ['AP Torx hembra', (p, c) => p.marca === 'APEX' && c.match(/^TX-\d{2}(\d{2})$/)?.[1]],
  ['AP Torx adaptador', (p, c) => p.marca === 'APEX' && c.match(/-TX-(\d+)$/)?.[1]],
  ['AP Allen pulgadas', (p, c) => p.marca === 'APEX' && c.match(/^A[MN]-(\d{2})(?:-\d+)?$/)?.[1]],
  ['AP Allen 315', (p, c) => p.marca === 'APEX' && c.match(/^315-(\d+)X$/)?.[1]],
  ['AP tubo métrico', (p, c) => p.marca === 'APEX' && !/TSQ/.test(c) && c.match(/(?:^|-)(\d{1,2})MM?(?:-|$)/)?.[1]],
  // 4 dígitos (5622), HE-530 o nutsetter 6N/6B-DDNN: los dos últimos son treintaidosavos.
  ['AP tubo pulgadas', (p, c) => p.marca === 'APEX' && ['Embocadura', 'Nutsetter'].includes(p.tipo) && /Socket|Nutsetter/i.test(p.desc ?? '')
    ? (c.match(/^\d{2}(\d{2})(?:-D)?$/) ?? c.match(/^HE-\d(\d{2})$/) ?? c.match(/^6[NB]-\d{2}(\d{2})(?:-\d+)?$/))?.[1]
    : undefined],
  ['AP cuadrado tapón', (p, c) => p.marca === 'APEX' && c.match(/^P-(?:14|20)(\d{2})$/)?.[1]],
  ['AP universal métrico', (p, c) => p.marca === 'APEX' && c.match(/^SA-C-\d+-(\d+)M$/)?.[1]],
  ['AP tubo métrico NNMM', (p, c) => p.marca === 'APEX' && c.match(/^(?:UG-)?(?:SF-)?(\d{1,2})MM\d/)?.[1]],
  ['AP tubo pulgadas SF', (p, c) => p.marca === 'APEX' && c.match(/^SF-\d{2}(\d{2})$/)?.[1]],
  // Segunda pasada: otras marcas.
  ['CP tubo de impacto', (p, c) => p.marca === 'CHICAGO PNEUMATIC' && c.match(/^S[4-8](\d{2})M/)?.[1]],
  ['URYU tubo', (p, c) => p.marca === 'URYU' && c.match(/Socket(\d+)MM/i)?.[1]],
  ['FIAM cabeza', (p, c) => p.marca === 'FIAM' && c.match(/SW(\d+)$/)?.[1]],
  ['SP Torq-Set', (p, c) => p.marca === 'SPEEDRILL' && c.match(/^(?:VP|VM)?TS(\d+(?:\/\d+)?)(?=\/|$)/)?.[1]],
  ['TOHNICHI Phillips', (p, c, d) => p.marca === 'TOHNICHI' && `${p.nombre} ${d}`.match(/#(\d)\s*Phillips/i)?.[1]],
  // La descripción la dice («Medida: PH2», «MEDIDO: PH2»), sólo si no hay medida
  // plausible y nunca cortando un «1/4» o un «1,5».
  ['descripción', (p, c, d) => {
    if (/TS\d|TSQ/.test(p.attrs?.medida ?? '') || /^VPEM12\//.test(c)) return undefined
    const m = d.match(/\bMEDID[AO]?:\s*((?:PH|PZ|TX|T|E|SQ)\s?\d+|\d+(?:[.,]\d+)?\s?mm)(?![\d/.,])/i)?.[1]
    return m?.toUpperCase().replace(/\s/g, '').replace(/^TX/, 'T').replace(',', '.').replace(/MM$/, ' mm')
  }],
  // Tercera pasada: lo que el nombre dice con todas las letras, sólo si no hay medida.
  ['CP tubo (nombre)', (p) => !p.attrs?.medida && p.marca === 'CHICAGO PNEUMATIC' && p.nombre.match(/\bS[4-8](\d{2})M/)?.[1]],
  ['SP nutsetter 28/51', (p, c) => !p.attrs?.medida && p.marca === 'SPEEDRILL' && c.match(/^[JRS](?:28|51)-(\d+\/\d+)V?(?:\/|$)/)?.[1]],
  // L23-2H = 2", L23-1-1/4H = 1 1/4" (como L23-15/16H = 1 5/16"); L23-105H = 105 mm.
  ['SP tubo grande', (p, c) => {
    if (p.attrs?.medida || p.marca !== 'SPEEDRILL') return undefined
    const m = c.match(/^[LS]23-(\d{3})HL?$/)
    if (m) return `${Number(m[1])} mm`
    const q = c.match(/^[LS]23-(\d)(?:-(\d\/\d))?H(?:L|M)?(?:\/TEF)?$/)
    return q ? `${q[1]}${q[2] ? ` ${q[2]}` : ''}"` : undefined
  }],
  ['tubo mm (nombre)', (p) => {
    if (p.attrs?.medida || !['Embocadura', 'Nutsetter', null, undefined].includes(p.tipo)) return undefined
    if (!/TUBO|BOCALLAVE|SOCKET|EMBOCADURA/i.test(p.nombre) || /JUEGO|SET|PIEZAS|PZS/i.test(p.nombre)) return undefined
    const m = p.nombre.match(/(?<!LARGO\s?(?:MM\s?)?)(?:\b|\()(\d{1,2}(?:[.,]5)?)\s?MM\b/i) ?? p.nombre.match(/SOCKET\s?(\d{1,2})MM/i)
    return m ? `${m[1].replace(',', '.')} mm` : undefined
  }],
  ['punta (nombre)', (p) => {
    if (p.attrs?.medida || /JUEGO|SET|PIEZAS|PZS/i.test(p.nombre)) return undefined
    const m = p.nombre.match(/\b(PH|PZ|TX|T|SQ)\s?(\d{1,2})(?=\b|\/|X|x)/i)
    if (!m) return undefined
    const t = m[1].toUpperCase()
    if (t === 'T' && !/TORX|^T\d/i.test(`${p.tipo} ${p.nombre.replace(/^\S+\s+/, '')}`)) return undefined
    return `${t === 'TX' ? 'T' : t}${Number(m[2])}`
  }],
  ['Allen mm (nombre)', (p) => !p.attrs?.medida && p.tipo === 'Allen' && p.nombre.match(/ALLEN\s?(\d+(?:[.,]5)?)\s?MM/i)?.[1]],
]

const FORMATO = {
  'SP tubo mm': mm, 'SP nutsetter mm': mm, 'SP tubo R..MM': mm, 'SP bi-hexagonal': mm, 'AP tubo métrico': mm, 'AP universal métrico': mm,
  'SP tubo pulgadas': (x) => `${x}"`, 'SP nutsetter pulgadas': (x) => `${x}"`,
  'SP Torx hembra': (x) => `E${Number(x)}`, 'AP Torx hembra': (x) => `E${Number(x)}`,
  'SP Torx': (x) => `T${Number(x)}`, 'AP Torx macho': (x) => `T${Number(x)}`, 'AP Torx adaptador': (x) => `T${Number(x)}`,
  'SP Phillips': (x) => `PH${x}`,
  'TOHNICHI Phillips': (x) => `PH${x}`,
  'SP Torq-Set': (x) => `TS${x}`,
  'AP tubo métrico NNMM': mm, 'CP tubo de impacto': mm, 'URYU tubo': mm, 'FIAM cabeza': mm,
  'AP tubo pulgadas SF': (x) => treintaidosavos(Number(x)),
  'AP tubo pulgadas': (x) => treintaidosavos(Number(x)), 'AP Allen pulgadas': (x) => treintaidosavos(Number(x)),
  'AP Allen 315': (x) => treintaidosavos(Number(x)), 'AP cuadrado tapón': (x) => treintaidosavos(Number(x)),
  descripción: (x) => x,
  'CP tubo (nombre)': mm, 'SP nutsetter 28/51': (x) => `${x}"`, 'SP tubo grande': (x) => x,
  'tubo mm (nombre)': (x) => x, 'punta (nombre)': (x) => x, 'Allen mm (nombre)': (x) => mm(x.replace(',', '.')),
}

// Tipos sin medida de punta: tienen encastre y largo, nada más.
const SIN_MEDIDA = new Set(['Extensión', 'Adaptador', 'Holder Bit', 'Cardánico', 'Husillo', 'Imán'])

const igualAlLargo = (p) => {
  const m = p.attrs?.medida
  const l = p.attrs?.largo
  return m && l && m.replace(/\s?mm$/, '') === String(l)
}

const propuesta = []
for (const p of P) {
  const codigo = p.sku.replace(/^[A-Z]{2,3}\./, '')
  const actual = p.attrs?.medida ?? null
  let nueva, regla
  for (const [nombre, f] of REGLAS) {
    const x = f(p, codigo, p.desc ?? '')
    if (x) {
      const v = FORMATO[nombre](x)
      if (v) { nueva = v; regla = nombre; break }
    }
  }
  // Tipos sin medida de punta: la «medida» que trae es el largo (o el encastre).
  if (!nueva && SIN_MEDIDA.has(p.tipo) && actual && (igualAlLargo(p) || /^\d+ mm$/.test(actual))) { nueva = null; regla = 'no aplica (era el largo)' }
  else if (!nueva && igualAlLargo(p)) { nueva = null; regla = 'era el largo' }
  else if (!nueva && p.tipo === 'Plana' && actual === p.attrs?.encastre?.replace(/ HEX$/i, '"').replace(/""$/, '"')) { nueva = null; regla = 'era el encastre' }
  if (nueva === undefined) continue
  if (nueva === actual) continue
  // Sólo se reemplaza una medida que ya estaba cuando está mal (igual al largo, «#…», otro formato);
  // si hay una medida plausible distinta, se deja para revisar a mano.
  const plausible = actual && !igualAlLargo(p) && !/^#|^\d+"$/.test(actual)
  propuesta.push({ id: p.id, sku: p.sku, marca: p.marca, tipo: p.tipo, nombre: p.nombre, de: actual, a: nueva, regla, revisar: Boolean(plausible && nueva) })
}

writeFileSync('revision/medidas-puntas.json', JSON.stringify(propuesta, null, 1))
const r = {}
for (const x of propuesta) r[`${x.regla}${x.revisar ? ' (REVISAR)' : ''}`] = (r[`${x.regla}${x.revisar ? ' (REVISAR)' : ''}`] ?? 0) + 1
console.log(propuesta.length, 'cambios')
for (const [k, v] of Object.entries(r).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k)
