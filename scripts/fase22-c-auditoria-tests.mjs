/**
 * Tests de las reglas de la auditoría de productos sin marca (Fase 22 · Cierre).
 *
 * La regla que todo lo demás protege: **el texto no es identidad**. Un
 * producto que se llama «APEX ...» no es APEX por decirlo; puede decir
 * «compatible con APEX», y «Mercedes Benz» en el nombre es casi siempre el
 * cliente y no el fabricante. Si estos tests se aflojan, la auditoría empieza
 * a proponer asignaciones que después alguien aplica.
 *
 *   node scripts/fase22-c-auditoria-tests.mjs
 */
import {
  clasificar,
  esMencionDeCompatibilidad,
  indexar,
  marcaEnNombre,
  normRef,
  referenciasEnNombre,
  sinPrefijo,
} from './fase22-c-auditoria-sin-marca.mjs'

let ok = 0
const fallos = []
const cmp = (titulo, esperado, real) => {
  const a = JSON.stringify(esperado)
  const b = JSON.stringify(real)
  if (a === b) ok++
  else fallos.push(`${titulo}\n    esperado: ${a}\n    real:     ${b}`)
}

// ── Normalizar referencias ─────────────────────────────────────────────────
cmp('separadores y mayúsculas no cambian la referencia', normRef('SP.J23-1/2H'), normRef('spj2312h'))
cmp('acentos tampoco', 'DINAMOMETRICA', normRef('Dinamométrica'))
cmp('null es vacío', '', normRef(null))

cmp('el prefijo del SKU es de Buscatools, no del fabricante', 'EX50818', sinPrefijo('AP.EX-508-18'))
cmp('sin prefijo se deja igual', 'EX50818', sinPrefijo('EX-508-18'))
cmp('un SKU correlativo no tiene prefijo de marca', 'PRO00249', sinPrefijo('PRO00249'))

// ── Referencias escondidas en el nombre ────────────────────────────────────
cmp('saca el part number del nombre', true, referenciasEnNombre('APEX EX-508-18').includes('EX50818'))
cmp('y el de GEDORE', true, referenciasEnNombre('GEDORE TSN25A DE 3-25 NM').includes('TSN25A'))
cmp(
  'una medida NO es una referencia',
  false,
  referenciasEnNombre('PUNTA DIAMETRO 6.35mm LARGO 100mm').some((r) => ['635MM', '100MM'].includes(r)),
)
cmp('un encastre tampoco', false, referenciasEnNombre('ENCASTRE 1/4 HEX').includes('14'))
cmp('ni el voltaje', false, referenciasEnNombre('CARGADOR 20V').includes('20V'))
cmp('una palabra suelta no es referencia', [], referenciasEnNombre('TORNILLO DE ACERO INOXIDABLE'))

// ── El texto no es identidad (§9) ──────────────────────────────────────────
const conocidas = new Map([
  [normRef('APEX'), 'APEX'],
  [normRef('GEDORE'), 'GEDORE'],
  [normRef('CHICAGO PNEUMATIC'), 'CHICAGO PNEUMATIC'],
])
cmp('el nombre sugiere la marca', 'APEX', marcaEnNombre('APEX EX-508-18', conocidas))
cmp('marca de dos palabras', 'CHICAGO PNEUMATIC', marcaEnNombre('CHICAGO PNEUMATIC CP7748', conocidas))
cmp('un sustantivo común NO es una marca', null, marcaEnNombre('MARTILLO DE GOMA', conocidas))
cmp('ni «LLAVE», por más que abra el nombre', null, marcaEnNombre('LLAVE DE IMPACTO 1/2', conocidas))
cmp('una marca que no existe en la tabla no se inventa', null, marcaEnNombre('BREMEN 6906 JUEGO', conocidas))

cmp('«compatible con APEX» no dice que sea APEX', true, esMencionDeCompatibilidad('Punta compatible con APEX', 'APEX'))
cmp('«equivalente a GEDORE» tampoco', true, esMencionDeCompatibilidad('Llave equivalente a GEDORE 760', 'GEDORE'))
cmp('«para APEX» tampoco', true, esMencionDeCompatibilidad('Repuesto para APEX 1107', 'APEX'))
cmp('pero «APEX EX-508-18» sí lo afirma', false, esMencionDeCompatibilidad('APEX EX-508-18', 'APEX'))

// ── Clasificación ──────────────────────────────────────────────────────────
const conMarca = [
  { sku: 'AP.EX-508-18', model_code: 'AP.EX-508-18', brands: { name: 'APEX' } },
  { sku: 'GE.TSN25A', model_code: 'GE.TSN25A', brands: { name: 'GEDORE' } },
  { sku: 'DU.B2036LA-2', model_code: 'DU.B2036LA-2', brands: { name: 'DUROFIX' } },
  // La misma referencia en dos marcas distintas: nadie gana.
  { sku: 'AP.PH2X50', model_code: 'AP.PH2X50', brands: { name: 'APEX' } },
  { sku: 'GE.PH2X50', model_code: 'GE.PH2X50', brands: { name: 'GEDORE' } },
]
const idx = indexar(conMarca, [])

const clase = (p) => clasificar(p, idx).clase
const marca = (p) => clasificar(p, idx).marca

cmp(
  'mismo SKU que un producto con marca → A',
  'EXACT_MATCH_SAME_SKU',
  clase({ sku: 'B2036LA-2', model_code: 'B2036LA-2', name: 'DUROFIX Bateria Cod. B2036LA-2' }),
)
cmp(
  'referencia del nombre que existe en esa marca → B',
  'EXACT_MATCH_MODEL',
  clase({ sku: 'PRO00249', model_code: 'PRO00249', name: 'APEX EX-508-18' }),
)
cmp('y propone esa marca', 'APEX', marca({ sku: 'PRO00249', model_code: 'PRO00249', name: 'APEX EX-508-18' }))

cmp(
  'el nombre dice APEX pero ninguna referencia lo confirma → C, NO se asigna',
  'HIGH_CONFIDENCE_NAME_ONLY',
  clase({ sku: 'PRO00306', model_code: 'PRO00306', name: 'APEX 4403PZD' }),
)
cmp(
  'y C no propone marca',
  null,
  marca({ sku: 'PRO00306', model_code: 'PRO00306', name: 'APEX 4403PZD' }),
)

cmp(
  'una referencia que existe en DOS marcas no elige ninguna',
  'MULTIPLE_CANDIDATES',
  clase({ sku: 'PH2X50', model_code: 'PH2X50', name: 'Punta PH2 x 50' }),
)

cmp(
  'la referencia dice una marca y el nombre otra → CONFLICT',
  'CONFLICT',
  clase({ sku: 'GE.TSN25A', model_code: 'GE.TSN25A', name: 'APEX TSN25A' }),
)

cmp(
  'sin referencia ni marca en el nombre → E',
  'NO_MATCH',
  clase({ sku: 'PRO12225', model_code: 'PRO12225', name: 'Perfil C 200 * 70 * 3,2 mm' }),
)

cmp(
  '«compatible con APEX» NO se clasifica como APEX',
  'NO_MATCH',
  clase({ sku: 'PRO99999', model_code: 'PRO99999', name: 'Punta compatible con APEX de 1/4' }),
)

// ── Lo que no puede pasar nunca ────────────────────────────────────────────
const soloTextoAPEX = clasificar({ sku: 'PRO00306', model_code: 'PRO00306', name: 'APEX 4403PZD' }, idx)
cmp('C jamás trae una marca propuesta: es la garantía de §5', true, soloTextoAPEX.marca === null)

const mercedes = clasificar({ sku: 'PRO03677', model_code: 'PRO03677', name: 'Mercedes Benz.Modelo ULT-100-RK' }, idx)
cmp('un cliente en el nombre no produce marca', null, mercedes.marca)
cmp('y no queda como proponible', false, mercedes.clase.startsWith('EXACT'))

// Referencias cortas: una de 1–3 caracteres cruza cualquier cosa.
const idxCorto = indexar([{ sku: 'AP.11', model_code: 'AP.11', brands: { name: 'APEX' } }], [])
cmp(
  'una referencia de dos caracteres no alcanza para identificar nada',
  'NO_MATCH',
  clasificar({ sku: '11', model_code: '11', name: 'Arandela 11' }, idxCorto).clase,
)

console.log(`${ok} OK, ${fallos.length} fallos`)
for (const f of fallos) console.error('  ✗ ' + f)
process.exit(fallos.length === 0 ? 0 : 1)
