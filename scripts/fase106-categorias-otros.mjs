/*
 * Fase 106 · Sacar de "Otros" a categorías reales con subfiltro "Tipo".
 * Clasifica por familia (keyword sobre el nombre), crea la categoría pública si
 * no existe, y setea category_id + product_type (el product_type arma la faceta
 * "Tipo" del catálogo público). SECO por defecto; «apply» crea y mueve.
 *   node fase106-categorias-otros.mjs          → plan
 *   node fase106-categorias-otros.mjs apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c', OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'
const APLICAR = process.argv[2] === 'apply'

// Override: tornillo de banco / morsa NO es fijación, es herramienta manual
const OVERRIDE = [[/tornillo de banco|\bmor[sz]a\b/i, 'herramienta_manual']]
const FAMILIAS = [
  ['medicion', /\b(calibre|vernier|nivel|luxometr|multimetr|mic(r[oó]metro)?|comparador|man[oó]metro|term[oó]metro|caudal[ií]metro|dinam[oó]metro\b|flex[oó]metr|cinta m[eé]trica|regla|escuadra|goni[oó]metr|tester|ph-?metr|balanza|peso digital)/i],
  ['fijaciones', /\b(tornillo|tuerca|tarugo|bul[oó]n|arandela|remache|fijaci[oó]n|esp[aá]rrago|perno|clavo|grampa|abrazadera|pasador|chaveta|anclaje|insert[oa] rosca)/i],
  ['soldadura', /\b(electrodo|soldadora|soldar|esta[ñn]o|antorcha|garrafa|mapp|oxiacetil|fundente|varilla de aporte|m[aá]scara soldar|caret[ao] soldar)/i],
  ['pintureria', /\b(pintura|aerosol|esmalte|l[aá]tex|barniz|pincel|rodillo|espatul|masilla|enduido|diluyente|aguarr[aá]s|thinner|bandeja pintura|cinta (de )?(papel|enmascar)|enmascarar)/i],
  ['quimicos', /\b(lubricante|grasa|sellador|adhesivo|silicona|pegamento|desengrasante|solvente|limpiador|anti.?oxidante|penetrante|loctite|spray|aceite\b|wd.?40|cola\b|rosca.?fix|trab[aá]rrosca)/i],
  ['abrasivos', /\b(disco (de )?(corte|desbaste|flap|lija)|lija|muela|piedra esmeril|esponja (de )?fibra|cepillo (de )?(alambre|acero)|amoladora.*disco|abrasiv)/i],
  ['electrico', /\b(ficha|tomacorriente|toma hembra|toma macho|cable|contactor|rel[eé]|borne|disyuntor|t[eé]rmica|ups\b|bater[ií]a|pila|fuente|transformador|portal[aá]mpara|interruptor|pulsador|sensor|fusible|zapatilla|prolongador|phoenix contact|siemens)/i],
  ['neumatica', /\b(v[aá]lvula|manguera|racor|conector r[aá]pido|regulador de presi[oó]n|filtro de aire|lubricador|cilindro neum|pistola de aire|acople r[aá]pido|smc\b|festo)/i],
  ['limpieza', /\b(cepillo|plumero|escoba|trapo|rejilla|secador|balde|guante.*limpieza|esponja\b|pa[ñn]o)/i],
  ['almacenamiento', /\b(estanter[ií]a|storage|rack|caj[oó]n|gaveta|organizador|bandeja (de )?almacen|modulo|contenedor|ba[uú]l|carro (de )?herramient)/i],
  ['mangueras_conduccion', /\b(ca[ñn]o|tuber[ií]a|codo|niple|reducci[oó]n|cupla|te\b|uni[oó]n|brida|perfil|ca[ñn]er[ií]a)/i],
  ['herramienta_manual', /\b(llave (fija|combinada|francesa|allen|tubo|estriada|crique|cricket|ajustable|t)|destornillad|alicate|pinza|martillo|maza|tenaza|formon|serrucho|arco de sierra|lima|cincel|punz[oó]n|morsa|prensa|gato hidr|crique)/i],
]
const CAT = {
  medicion: { name: 'Medición', slug: 'medicion' },
  fijaciones: { name: 'Fijaciones y tornillería', slug: 'fijaciones' },
  soldadura: { name: 'Soldadura', slug: 'soldadura' },
  pintureria: { name: 'Pinturería', slug: 'pintureria' },
  quimicos: { name: 'Químicos y lubricantes', slug: 'quimicos' },
  abrasivos: { name: 'Abrasivos', slug: 'abrasivos' },
  electrico: { name: 'Eléctrico', slug: 'electrico' },
  neumatica: { name: 'Neumática', slug: 'neumatica' },
  limpieza: { name: 'Limpieza', slug: 'limpieza' },
  almacenamiento: { name: 'Almacenamiento', slug: 'almacenamiento' },
  mangueras_conduccion: { name: 'Conducción de fluidos', slug: 'conduccion' },
  herramienta_manual: { name: 'Herramientas manuales', slug: 'herramientas-manuales' }, // existente
}
const TIPO = {
  medicion: [[/calibre|vernier|pie de rey/i, 'Calibre'], [/nivel/i, 'Nivel'], [/luxometr/i, 'Luxómetro'], [/mult[ií]metr|tester/i, 'Multímetro'], [/mic[r]?[oó]metro/i, 'Micrómetro'], [/comparador/i, 'Comparador'], [/man[oó]metro/i, 'Manómetro'], [/term[oó]metro/i, 'Termómetro'], [/flex[oó]metr|cinta m[eé]trica/i, 'Flexómetro'], [/regla|escuadra|goni/i, 'Regla y escuadra'], [/balanza|b[aá]scula|peso digital/i, 'Balanza'], [/caudal/i, 'Caudalímetro'], [/.*/, 'Instrumento de medición']],
  fijaciones: [[/tuerca/i, 'Tuerca'], [/arandela/i, 'Arandela'], [/tarugo|anclaje|insert/i, 'Tarugo y anclaje'], [/remache/i, 'Remache'], [/clavo/i, 'Clavo'], [/abrazadera|grampa/i, 'Abrazadera'], [/bul[oó]n|perno|esp[aá]rrago/i, 'Bulón y perno'], [/tornillo/i, 'Tornillo'], [/.*/, 'Fijación']],
  soldadura: [[/electrodo/i, 'Electrodo'], [/soldadora|m[aá]quina de soldar/i, 'Soldadora'], [/esta[ñn]o/i, 'Estaño'], [/antorcha|soplete|mapp|garrafa|gas/i, 'Soplete y gas'], [/m[aá]scara|caret/i, 'Máscara de soldar'], [/varilla|aporte|fundente/i, 'Material de aporte'], [/.*/, 'Soldadura']],
  pintureria: [[/aerosol/i, 'Aerosol'], [/pincel/i, 'Pincel'], [/rodillo/i, 'Rodillo'], [/espatul/i, 'Espátula'], [/masilla|enduido/i, 'Masilla y enduido'], [/diluyente|aguarr|thinner/i, 'Diluyente'], [/cinta.*(papel|enmascar)|enmascarar/i, 'Cinta de enmascarar'], [/esmalte|l[aá]tex|barniz|pintura/i, 'Pintura y esmalte'], [/.*/, 'Pinturería']],
  quimicos: [[/grasa/i, 'Grasa'], [/sellador|silicona/i, 'Sellador y silicona'], [/adhesivo|pegamento|cola\b|loctite/i, 'Adhesivo'], [/desengrasante|limpiador|solvente/i, 'Limpiador y solvente'], [/traba.?rosca|rosca.?fix/i, 'Traba-rosca'], [/penetrante|anti.?oxid|wd.?40/i, 'Penetrante'], [/lubricante|aceite/i, 'Lubricante y aceite'], [/.*/, 'Químico']],
  abrasivos: [[/flap/i, 'Disco flap'], [/corte/i, 'Disco de corte'], [/desbaste/i, 'Disco de desbaste'], [/lija/i, 'Lija'], [/muela|piedra/i, 'Muela y piedra'], [/alambre|acero/i, 'Cepillo de alambre'], [/pa[ñn]o|scotch|fibra/i, 'Paño abrasivo'], [/disco/i, 'Disco abrasivo'], [/.*/, 'Abrasivo']],
  electrico: [[/ficha|toma|enchufe/i, 'Ficha y toma'], [/\bcable|cord[oó]n|prolongador|zapatilla/i, 'Cable y prolongador'], [/contactor|rel[eé]/i, 'Contactor y relé'], [/disyuntor|t[eé]rmica|fusible/i, 'Protección eléctrica'], [/\bups\b/i, 'UPS'], [/bater[ií]a|\bpila/i, 'Batería y pila'], [/fuente|transformador/i, 'Fuente y transformador'], [/interruptor|pulsador/i, 'Interruptor y pulsador'], [/sensor|fotoc[eé]lula/i, 'Sensor'], [/l[aá]mpara|\bled\b|portal[aá]mpara|luminaria/i, 'Iluminación'], [/borne/i, 'Borne'], [/.*/, 'Componente eléctrico']],
  neumatica: [[/v[aá]lvula/i, 'Válvula'], [/filtro.*regulador|\bfrl\b|lubricador|regulador.*presi/i, 'FRL (filtro/regulador)'], [/manguera/i, 'Manguera'], [/racor|conector r[aá]pido|acople r[aá]pido|conexi/i, 'Racor y conector'], [/cilindro/i, 'Cilindro'], [/pistola/i, 'Pistola de aire'], [/.*/, 'Componente neumático']],
  limpieza: [[/cepillo/i, 'Cepillo'], [/plumero/i, 'Plumero'], [/escoba/i, 'Escoba'], [/balde/i, 'Balde'], [/trapo|pa[ñn]o|rejilla/i, 'Trapo y paño'], [/secador/i, 'Secador'], [/esponja/i, 'Esponja'], [/.*/, 'Artículo de limpieza']],
  almacenamiento: [[/estanter|rack/i, 'Estantería y rack'], [/contenedor|caj[oó]n|gaveta/i, 'Contenedor y gaveta'], [/organizador|bandeja/i, 'Organizador'], [/carro/i, 'Carro'], [/modulo|m[oó]dulo/i, 'Módulo'], [/.*/, 'Almacenamiento']],
  mangueras_conduccion: [[/codo/i, 'Codo'], [/niple/i, 'Niple'], [/reducci/i, 'Reducción'], [/cupla/i, 'Cupla'], [/uni[oó]n/i, 'Unión'], [/brida/i, 'Brida'], [/perfil/i, 'Perfil'], [/ca[ñn]o|tuber|ca[ñn]er/i, 'Caño y tubería'], [/.*/, 'Conexión']],
  herramienta_manual: [[/llave/i, 'Llave'], [/destornillad/i, 'Destornillador'], [/alicate|pinza|tenaza/i, 'Alicate y pinza'], [/martillo|maza/i, 'Martillo'], [/mor[sz]a|prensa|crique|gato/i, 'Morsa y prensa'], [/formon|cincel|punz/i, 'Cincel y punzón'], [/serrucho|sierra|arco/i, 'Sierra'], [/lima/i, 'Lima'], [/.*/, 'Herramienta manual']],
}

const familia = (n) => { for (const [re, f] of OVERRIDE) if (re.test(n || '')) return f; for (const [f, re] of FAMILIAS) if (re.test(n || '')) return f; return null }
const tipoDe = (fam, n) => { for (const [re, t] of TIPO[fam]) if (re.test(n || '')) return t; return null }

const prods = []
for (let o = 0; ; o += 1000) { const { data } = await sb.from('products').select('id, name, brand_id').eq('company_id', CID).eq('category_id', OTROS).eq('status', 'active').is('deleted_at', null).range(o, o + 999); prods.push(...data); if (data.length < 1000) break }

const { data: cats } = await sb.from('product_categories').select('id, slug').eq('company_id', CID)
const catIdBySlug = new Map(cats.map((c) => [c.slug, c.id]))

const porCat = {}, porTipo = {}, mover = []
let sinFam = 0, sinBrand = 0
for (const p of prods) {
  const fam = familia(p.name)
  if (!fam) { sinFam++; continue }
  if (!p.brand_id) { sinBrand++; continue } // sin marca no se puede publicar; queda en Otros
  const t = tipoDe(fam, p.name)
  porCat[fam] = (porCat[fam] || 0) + 1
  porTipo[fam] = porTipo[fam] || {}; porTipo[fam][t] = (porTipo[fam][t] || 0) + 1
  mover.push({ id: p.id, fam, tipo: t })
}
console.log(`otros: ${prods.length} · a mover: ${mover.length} · sin familia: ${sinFam} · con familia pero SIN brand_id (quedan en Otros): ${sinBrand}`)
for (const [fam, n] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) {
  const tipos = Object.entries(porTipo[fam]).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(', ')
  console.log(`  ${CAT[fam].name.padEnd(26)} ${String(n).padStart(4)}  → tipos: ${tipos}`)
}

if (APLICAR) {
  // Crear categorías faltantes (públicas)
  let pos = 20
  for (const fam of Object.keys(porCat)) {
    const { slug, name } = CAT[fam]
    if (catIdBySlug.has(slug)) continue
    const { data, error } = await sb.from('product_categories').insert({ company_id: CID, name, slug, slug_publico: slug, publica: true, is_active: true, position: pos++ }).select('id').single()
    if (error) throw new Error(`cat ${slug}: ${error.message}`)
    catIdBySlug.set(slug, data.id)
    console.log(`  + categoría ${name}`)
  }
  let n = 0
  for (const m of mover) {
    const cid = catIdBySlug.get(CAT[m.fam].slug)
    const { error } = await sb.from('products').update({ category_id: cid, product_type: m.tipo }).eq('id', m.id)
    if (error) throw new Error(`${m.id}: ${error.message}`)
    if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${mover.length}   `)
  }
  console.log(`\n[106] movidos ${n}`)
}
