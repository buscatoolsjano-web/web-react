/*
 * Fase 96 · Clasificar los productos de «Otros» de Buscatools interpretando la
 * descripción. NO ESCRIBE en la base: arma el plan y un reporte para revisar.
 *   node fase96-clasificar.mjs          → reporte + scripts/.otros/plan.json
 *
 * Positivo y conservador: sólo asigna categoría cuando una palabra clave lo deja
 * claro; lo dudoso queda en «otros» (mejor no mover que mover mal).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const P = JSON.parse(readFileSync('scripts/.otros/otros.json', 'utf8'))
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function clasificar(p) {
  // El TIPO de producto está en el NOMBRE («Angle Nutrunner», «Cable», «Socket»).
  // La descripción trae medidas y encastres (3/8 SQ DR) que confunden, así que
  // el tipo se decide por el nombre (H); el texto completo (T) sólo para repuestos.
  const nom = norm(p.name)
  const t = norm(p.name + ' ' + (p.description || ''))
  const m = (p.marca || '').toUpperCase()
  const H = (re) => re.test(nom)
  const T = (re) => re.test(t)

  // ── No son herramientas: categorías propias (Fase 96) ──────────────────────
  if (T(/zapato|calzado|bota de seg/) || m === 'MACSI') return ['seguridad', 'seguridad', 'alta']
  if (m === 'QIMAROX' || m === 'TRILOGIQ') return ['automatizacion', 'automatizacion', 'alta']

  // ── Repuestos (partes internas: o-rings, mordazas, resortes, RIVIT.REP) ────
  if (H(/o-?ring|\bmordaza\b|\bresorte\b|\bjunta\b|sufridera|nosepiece|boquilla|\bcono\b|\bmuela\b|\bjaw\b|\bseal\b|\bgasket\b|\bperno\b|empaque|\breten\b|punteria/) || T(/\brep\b\.?|repuesto|rivit\.rep|\bspare\b|\bpos\b\.? ?\d/)) return ['repuestos', 'repuesto', 'alta']

  // ── Accesorio evidente por el NOMBRE (cable, batería, cargador, soporte) ───
  if (H(/\bcable\b|cargador|charger|bateria|battery|power cord|\bfuente\b|power supply|\bfunda\b|protector|\bsoporte\b|\bbrazo\b|\barm\b|reaction|\bholder\b|\bgancho\b|\bhook\b|acople|coupler|controller|controlador|adaptador de program/)) return ['accesorio', 'accesorio', 'alta']

  // ── Herramientas, por el tipo escrito en el NOMBRE ─────────────────────────
  if (H(/balancer|balanceador|equilibrador/)) return ['balanceador', 'balanceador', 'alta']
  if (H(/remachadora|riveter|rivet tool|rivet machine|rivet gun/)) return ['remachadora', 'remachadora', 'alta']
  if (H(/impact wrench|llave de impacto|impact gun|pistola de impacto/)) return ['llave-de-impacto', 'impacto', 'alta']
  if (H(/torque wrench|llave dinamom|dinamometric|torqu[i]metro|torque screwdriver|torque driver|torque gauge|destornillador de torque/)) return ['llave-dinamometrica', 'torque', 'alta']
  if (H(/nutrunner|atornillador|screwdriver|destornillador|aprietatuercas|tornillador/)) return ['atornillador', 'atornillador', 'alta']

  // ── Puntas y tubos, por el NOMBRE (socket/bit/extensión/adaptador) ─────────
  if (H(/\bsocket\b|embocadura|\bvaso\b|\bdado\b|nutsetter|holder bit|\bbit holder\b|insert bit|magnet holder|portapunta|\bbits?\b/)) return ['punta', 'socket/bit', 'alta']
  if (H(/\bextension\b|\bextensor\b|\bcardan/)) return ['punta', 'extension', 'alta']
  if (H(/\badaptador\b|\badapter\b/)) return ['punta', 'adaptador', 'media']

  // ── Repuestos por todo el texto (kits de repuesto, conectores, collares) ───
  if (T(/\bkit\b|conector|connector|\bcollar\b|\bcono\b|retorno|empaquetadura/)) return ['repuestos', 'repuesto', 'media']

  // ── Fallback por marca (línea conocida) — confianza BAJA, no se aplica aún ──
  if (m === 'TOHNICHI') return ['llave-dinamometrica', 'marca TOHNICHI', 'baja']
  if (m === 'FIAM') return ['atornillador', 'marca FIAM', 'baja']
  if (m === 'ACRADYNE' || m === 'URYU' || m === 'YOKOTA') return ['atornillador', 'marca ' + m, 'baja']

  return ['otros', null, null]
}

const porCat = {}, porRegla = {}, porConf = { alta: 0, media: 0, baja: 0 }, muestras = {}
const plan = []
for (const p of P) {
  const [cat, regla, conf] = clasificar(p)
  porCat[cat] = (porCat[cat] || 0) + 1
  if (cat !== 'otros') {
    porConf[conf] = (porConf[conf] || 0) + 1
    plan.push({ id: p.id, sku: p.sku, cat, conf })
  }
  porRegla[regla || '(sin match)'] = (porRegla[regla || '(sin match)'] || 0) + 1
  ;(muestras[cat] ??= []).push(`${p.marca || '—'} · ${(p.name || '').slice(0, 70)}`)
}

writeFileSync('scripts/.otros/plan.json', JSON.stringify(plan))

console.log('\n══ DISTRIBUCIÓN POR CATEGORÍA ══')
for (const [c, n] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${c}`)
console.log(`\n  A mover: ${plan.length} · quedan en otros: ${porCat['otros'] || 0}`)
console.log(`  Confianza — alta ${porConf.alta} · media ${porConf.media} · baja ${porConf.baja}`)
console.log('\n══ MUESTRAS POR CATEGORÍA (5 c/u) ══')
for (const c of Object.keys(muestras)) {
  console.log(`\n-- ${c} --`)
  for (const s of muestras[c].slice(0, 5)) console.log('   ' + s)
}
