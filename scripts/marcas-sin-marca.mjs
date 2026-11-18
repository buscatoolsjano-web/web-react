/**
 * Propone la marca de los productos que no tienen. SÓLO LEE: escribe
 * revision/categorias/propuesta-marcas.json.
 *
 *   node scripts/marcas-sin-marca.mjs
 *
 * La marca sale, en este orden, del atributo «Marca (display)» (marca_disp,
 * cargado al importar) o del nombre del producto. Se normaliza con el
 * diccionario de abajo (CP → Chicago Pneumatic, «De Pascale» → Depascale…).
 *
 *   - Si es una marca que ya existe en `brands`, va a brand_id.
 *   - Si es una marca real con dos o más productos (o una marca de
 *     herramienta conocida), se crea la marca.
 *   - Si no se sabe, o es una marca suelta de un solo producto, va a
 *     «Genérico» y el nombre de la marca queda en marca_disp, que es lo que
 *     muestra la ficha. Así el filtro de marcas no se llena de nombres de una
 *     sola aparición (ver la memoria marca-disp-vs-brand-id).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const P = JSON.parse(readFileSync('revision/categorias/sinmarca.json', 'utf8'))

// Marca canónica → cómo puede aparecer escrita. La canónica es como queda en `brands`.
const MARCAS = {
  'CHICAGO PNEUMATIC': [/^CP$/, /CHICAGO PNEUMATIC/, /^CP\d/],
  'INGERSOLL RAND': [/INGERSOLL/],
  Depascale: [/DE ?PASC?L?AE?L?E/],
  Bahco: [/BAHCO/],
  // Siemens también por sus números de pedido (6ES7…, 6AV2…, 3SU1…).
  Siemens: [/SIEM+ENS?\b|SIEMEN\b|\b(6ES7|6AV\d|6EP\d|3SU\d|5SL\d|5SV\d|3RT\d|3RV\d|6SL\d)|SIMATIC|SITOP/],
  'Uni-t': [/UNI-?T\b/],
  SMC: [/^SMC$/],
  'Phoenix Contact': [/PHOENIX/],
  'Black Jack': [/BLACK JACK/],
  Zoloda: [/ZOLODA/],
  Cambre: [/CAMBRE/],
  '3M': [/^3M$|\b3M\b/],
  Schneider: [/SCHNEIDER/],
  Festo: [/FESTO/],
  Kalop: [/KALOP/],
  Skyhard: [/SKYHARD/],
  Fischer: [/FISCHER/],
  'El Galgo': [/EL GALGO/],
  'UNI Paint': [/UNI PAINT/],
  'MILWAUKEE': [/MILWAUKEE/],
  GEDORE: [/GEDORE/],
  BREMEN: [/BREMEN/],
  URYU: [/URYU/],
  ESTIC: [/ESTIC\b/],
  SUMAKE: [/SUMAKE/],
  TECNA: [/TECNA/],
  FIAM: [/FIAM/],
  SPEEDRILL: [/SPEEDRILL/],
  TOHNICHI: [/TOHNICHI/],
  FEIN: [/^FEIN\b/],
  RIVIT: [/RIVIT/],
  TRILOGIQ: [/TRILOGIQ|TIRLOGIQ/],
  ACRADYNE: [/ACRADYNE/],
  'KING TONY': [/KING TONY/],
  SAIPOR: [/SAIPOR/],
  NORMECO: [/NORMECO/],
  'RED ROOSTER': [/RED ROOSTER/],
  // Marcas reales que no estaban: se crean.
  Bosch: [/BOSCH/],
  Stanley: [/STANLEY|STANLAY|BOSTITCH|FATMAX/],
  Makita: [/MAKITA/],
  DeWalt: [/DE ?WALT/],
  Crane: [/^CRANE\b|\bCRANE (OPTA|TRANSDUCTOR)/],
  Interroll: [/INTERROLL/],
  Logiform: [/LOGIFORM/],
  INGUN: [/INGUS|INGUN/],
  Vessel: [/VESSEL/],
  Felo: [/FELO\b/],
  Thiele: [/THIELE/],
  ReeR: [/^REER\b|\bREER\b/],
  Ledvance: [/LEDVANCE|OSRAM/],
  Ingco: [/INGCO/],
  Panasonic: [/PANASONIC/],
  'Sturtevant Richmont': [/STURTEVANT/],
  Irimo: [/IRIMO/],
  Lumenac: [/LUMENAC/],
  Hamilton: [/HAMILTON/],
  Destaco: [/DESTACO/],
  Libus: [/LIBUS/],
  Roamat: [/ROAMAT/],
  Endo: [/^ENDO\b|\bENDO (EH|EHB|EHL|EHW)/],
  'POP': [/^POP\b/],
  'Hellermann Tyton': [/HELLERMANN/],
  Uranga: [/URANGA/],
  Fluke: [/FLUKE/],
  'Euro-Torq': [/EURO-? ?TORQ/],
  Cleco: [/CLECO/],
  'Atlas Copco': [/ATLAS COPCO/],
  Tyrolit: [/TYROLIT/],
  Ruhlmann: [/RUHLMANN/],
  "Pro'sKit": [/PRO'?S ?KIT/],
  IFM: [/^IFM\b|\bIFM [A-Z]{1,3}\d/],
  Sick: [/^SICK\b|\bGL6G?-|\bYF2A/],
  Dremel: [/DREMEL/],
  Gesipa: [/GESIPA/],
  Kito: [/^KITO\b/],
  Norbar: [/NORBAR/],
  Klauke: [/KLAUKE/],
  Knipex: [/KNIPEX/],
  Mitsubishi: [/MITSUBISHI/],
  Dormer: [/DORMER/],
  Brady: [/BRADY/],
  ESAB: [/ESAB/],
  Yale: [/YALE\b/],
  Danfoss: [/DANFOSS/],
  Parker: [/PARKER/],
  SKF: [/\bSKF\b/],
  Wilkox: [/WILKOX/],
  Harden: [/HARDEN\b/],
  Lusqtoff: [/L[UÜ]SQTOFF/],
  Truper: [/TRUPER/],
  Einhell: [/EINHELL/],
  Hyundai: [/HYUNDAI|HYNDAI/],
  'Kärcher': [/KARCHER|KÄRCHER/],
  Starrett: [/STARRET/],
  Mountz: [/MOUNTZ/],
  Corghi: [/CORGHI/],
  AIMCO: [/AIMCO/],
  Walter: [/^WALTER\b/],
  Dynabrade: [/DYNABRADE|DINABRADE/],
  Ansell: [/ANSELL/],
  WAGO: [/WAGO/],
  Harting: [/^HC-(B|STA)/],
  Interpact: [],
  Wembley: [/WEMBLEY/],
  Ezeta: [/EZETA/],
  Neumacon: [/NEUMACON/],
  Graco: [/GRACO/],
  'Zephyr Tools': [/ZEPHYR|ZEOHYR/],
  'Doble A': [/DOBLE A\b/],
  Crossmaster: [/CROSSMASTER/],
  Kushiro: [/KUSHIRO/],
  Tacsa: [/TACSA/],
  Riello: [/RIELLO/],
  Shinano: [/SHINANO/],
  Brikol: [/BRIKOL/],
  Avdel: [/AVDEL/],
  Demag: [/DEMAG/],
  Vahle: [/VAHLE/],
  'Red Lion': [/RED LION/],
}
// Las que ya existen en `brands` (las demás del diccionario se crean).
const EXISTENTES = new Set([
  'CHICAGO PNEUMATIC', 'INGERSOLL RAND', 'Depascale', 'Bahco', 'Siemens', 'Uni-t', 'SMC', 'Phoenix Contact',
  'Black Jack', 'Zoloda', 'Cambre', '3M', 'Schneider', 'Festo', 'Kalop', 'Skyhard', 'Fischer', 'El Galgo',
  'UNI Paint', 'MILWAUKEE', 'GEDORE', 'BREMEN', 'URYU', 'ESTIC', 'SUMAKE', 'TECNA', 'FIAM', 'SPEEDRILL',
  'TOHNICHI', 'FEIN', 'RIVIT', 'TRILOGIQ', 'ACRADYNE', 'KING TONY', 'SAIPOR', 'NORMECO', 'RED ROOSTER',
])
// Marcas de herramienta conocidas que se crean aunque tengan un solo producto.
const SIEMPRE = new Set(['Dremel', 'Knipex', 'Norbar', 'Klauke', 'Gesipa', 'Mitsubishi', 'Atlas Copco', 'Kito', 'Corghi', 'Kärcher', 'Starrett', 'Mountz', 'Fluke', 'Cleco', 'Makita', 'DeWalt', 'Bosch', 'Stanley', 'Parker', 'SKF', 'Danfoss', 'ESAB', 'Brady', 'Yale', 'Avdel', 'Demag'])

const norm = (s) => ` ${s ?? ''} `.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/®/g, '').replace(/^\s*:?\s*\d*:?\s*/, ' ').replace(/\s+/g, ' ')
function detectar(texto) {
  const t = norm(texto).trim()
  if (t === '') return null
  for (const [marca, res] of Object.entries(MARCAS)) if (res.some((r) => r.test(t))) return marca
  return null
}

const filas = P.map((p) => {
  const porDisp = p.marca_disp ? detectar(p.marca_disp) : null
  const porNombre = detectar(p.nombre)
  // URYU para Mercedes: la marca de la herramienta es URYU.
  const marca = /URYU/i.test(p.nombre) ? 'URYU' : porDisp ?? porNombre
  return { ...p, marca }
})

const cuenta = {}
for (const f of filas) if (f.marca) cuenta[f.marca] = (cuenta[f.marca] ?? 0) + 1
const crear = Object.keys(cuenta).filter((m) => !EXISTENTES.has(m) && (cuenta[m] >= 2 || SIEMPRE.has(m))).sort()

const propuesta = filas.map((f) => {
  const conMarca = f.marca && (EXISTENTES.has(f.marca) || crear.includes(f.marca))
  return {
    id: f.id, sku: f.sku, cat: f.cat, nombre: f.nombre, publico: f.publico,
    marca: conMarca ? f.marca : 'Genérico',
    // Lo que se muestra: la marca detectada, o la que ya traía.
    marcaDisp: f.marca && !conMarca ? f.marca : f.marca_disp,
    detectada: f.marca ?? null,
  }
})
writeFileSync('revision/categorias/propuesta-marcas.json', JSON.stringify({ crear, propuesta }, null, 1))
const porMarca = {}
for (const x of propuesta) porMarca[x.marca] = (porMarca[x.marca] ?? 0) + 1
console.log('Marcas nuevas a crear:', crear.length, crear.join(', '))
console.log(Object.entries(porMarca).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' | '))
console.log('quedan en Genérico con marca conocida (suelta):', propuesta.filter((x) => x.marca === 'Genérico' && x.detectada).length)
