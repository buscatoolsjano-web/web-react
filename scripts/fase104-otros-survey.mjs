/* Fase 104 · Relevar "Otros" por familia de producto (keyword sobre el nombre). SÓLO LEE. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const CID = 'bbcb2cee-aeaa-43c9-a7a0-da0fb2b2f59c', OTROS = '9cac370c-7193-43d1-b775-8faff36dd27b'
mkdirSync('scripts/.otros', { recursive: true })

// Familias candidatas; primera que matchea gana (orden = prioridad)
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
  ['seguridad', /\b(guante|lente|antiparra|casco|protector auditiv|tapones|arn[eé]s|barbijo|respirador|m[aá]scara|calzado seg|botines|chaleco|faja lumbar)/i],
  ['almacenamiento', /\b(estanter[ií]a|storage|rack|caj[oó]n|gaveta|organizador|bandeja (de )?almacen|modulo|contenedor|ba[uú]l|carro (de )?herramient)/i],
  ['mangueras_conduccion', /\b(ca[ñn]o|tuber[ií]a|codo|niple|reducci[oó]n|cupla|te\b|uni[oó]n|brida|perfil|ca[ñn]er[ií]a)/i],
  ['herramienta_manual', /\b(llave (fija|combinada|francesa|allen|tubo|estriada|crique|cricket|ajustable|t)|destornillad|alicate|pinza|martillo|maza|tenaza|formon|serrucho|arco de sierra|lima|cincel|punz[oó]n|morsa|prensa|gato hidr|crique)/i],
]

const prods = []
for (let o = 0; ; o += 1000) { const { data } = await sb.from('products').select('id, sku, name').eq('company_id', CID).eq('category_id', OTROS).eq('status', 'active').is('deleted_at', null).range(o, o + 999); prods.push(...data); if (data.length < 1000) break }

const clasif = (nombre) => { for (const [fam, re] of FAMILIAS) if (re.test(nombre || '')) return fam; return null }
const cnt = {}, ej = {}, asign = []
let sinClasif = 0
for (const p of prods) {
  const f = clasif(p.name)
  if (!f) { sinClasif++; continue }
  cnt[f] = (cnt[f] || 0) + 1; (ej[f] = ej[f] || []).push(p.name.slice(0, 55)); asign.push({ id: p.id, fam: f, name: p.name })
}
console.log(`otros: ${prods.length} · clasificados: ${prods.length - sinClasif} · sin familia: ${sinClasif}`)
for (const [k, v] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)}   ej: ${ej[k][0]}`)
writeFileSync('scripts/.otros/survey104.json', JSON.stringify(asign))
