/**
 * Tests de las reglas de la auditoría del maestro (Fase 22 · Etapa A).
 *
 * Las reglas de comparación son donde una auditoría miente sin darse cuenta.
 * En la primera corrida este script reportó 4.512 conflictos: eran míos, no de
 * los datos —`volume_cm3` es entero en el ERP y decimal en el legacy, así que
 * 1,6 se había guardado como 2 y yo lo comparaba como texto—. Reportarlo habría
 * mandado a revisar 4.506 productos sanos.
 *
 *   node scripts/fase22-a-auditoria-tests.mjs
 */
import {
  aMagnitud,
  claveDuplicado,
  diferencias,
  faltantesEnErp,
  clasificar,
  marcaSugerida,
  normalizar,
  procedencia,
  tecnicosCargados,
  tieneDato,
} from './fase22-a-auditoria-maestro.mjs'

let ok = 0
const fallos = []
const cmp = (titulo, esperado, real) => {
  const a = JSON.stringify(esperado)
  const b = JSON.stringify(real)
  if (a === b) ok++
  else fallos.push(`${titulo}\n    esperado: ${a}\n    real:     ${b}`)
}

// ── tieneDato · vacío no es lo mismo que cero (A9) ─────────────────────────
cmp('0 no es un dato: el legacy lo usa de relleno', false, tieneDato(0))
cmp('un peso real sí', true, tieneDato(74))
cmp('string vacío no', false, tieneDato('   '))
cmp('array vacío no', false, tieneDato([]))
cmp('array con algo sí', true, tieneDato(['hembra']))
cmp('null no', false, tieneDato(null))
cmp('objeto vacío no', false, tieneDato({}))
cmp('el string "0" sí es dato: es un texto, no una magnitud', true, tieneDato('0'))

// ── normalizar · para comparar, nunca para guardar (A2) ────────────────────
cmp('mayúsculas, espacios y separadores se van', 'J2312H', normalizar('j23-1/2 h'))
cmp('acentos también', 'DINAMOMETRICA', normalizar('dinamométrica'))
cmp('puntos y guiones bajos', 'AG60RA', normalizar('AG_60.RA'))
cmp('null es vacío', '', normalizar(null))

// ── aMagnitud · 80 mm y 8 cm son el mismo largo (A7) ───────────────────────
cmp('cm a mm', 80, aMagnitud('8 cm', 'longitud')?.valor)
cmp('m a mm', 1600, aMagnitud('1.6 m', 'longitud')?.valor)
cmp('coma decimal', 400, aMagnitud('0,4 kg', 'masa')?.valor)
cmp('sin unidad, longitud se asume mm', 200, aMagnitud('200', 'longitud')?.valor)
cmp('pulgadas', 25.4, aMagnitud('1"', 'longitud')?.valor)
cmp('conserva el original', '8 cm', aMagnitud('8 cm', 'longitud')?.raw)
cmp('lo que no es magnitud no se fuerza', null, aMagnitud('1/4 HEX', 'longitud'))
cmp('un texto tampoco', null, aMagnitud('Adaptador', 'longitud'))

// ── procedencia · la variable que explica los agujeros ─────────────────────
cmp('STEL', 'STEL', procedencia({ _importOrigen: 'STEL Order API (products)' }))
cmp('catálogo', 'CATALOGO', procedencia({ _importOrigen: 'catalogo apex' }))
cmp('sin marca de origen es catálogo', 'CATALOGO', procedencia({}))
cmp('sin fila en el legacy', 'SOLO_ERP', procedencia(null))

// ── diferencias · el caso que me salió mal ─────────────────────────────────
const erpVol = { volume_cm3: 2, attributes: {} }
cmp('2 contra 1,6 es el redondeo del integer, no un conflicto', [], diferencias(erpVol, { volumen_cm3: 1.6 }))
cmp('2 contra 9 sí es un conflicto', 1, diferencias(erpVol, { volumen_cm3: 9 }).length)

const erpLargo = { attributes: { largo: '80' } }
cmp('80 mm contra 8 cm no es conflicto', [], diferencias(erpLargo, { largo: '8 cm' }))
cmp('80 contra 75 sí', 'magnitud distinta', diferencias(erpLargo, { largo: '75' })[0]?.motivo)

const erpEnc = { attributes: { encastre: '1/4 HEX' } }
cmp('mismo encastre escrito distinto no es conflicto', [], diferencias(erpEnc, { encastre: '1/4hex' }))

cmp(
  'si uno de los dos no tiene el dato, no hay conflicto: hay un faltante',
  [],
  diferencias({ attributes: {} }, { largo: '80' }),
)
cmp(
  'y el faltante se reporta como tal',
  [{ campo: 'attributes.largo', legacy: '80' }],
  faltantesEnErp({ attributes: {} }, { largo: '80' }),
)
cmp('el legacy con 0 no genera un faltante', [], faltantesEnErp({ attributes: {} }, { peso_g: 0 }))

// ── clasificar (A3) ────────────────────────────────────────────────────────
cmp('sin fila en el legacy no hay match', 'NO_MATCH', clasificar({ attributes: {} }, null).match)
cmp('iguales', 'EXACT_LEGACY', clasificar({ attributes: { largo: '80' } }, { largo: '80' }).match)
cmp('distintos', 'CONFLICT', clasificar({ attributes: { largo: '80' } }, { largo: '75' }).match)
cmp(
  'nunca se declara EXACT_OFFICIAL: esta corrida no mira fabricantes',
  false,
  ['NO_MATCH', 'EXACT_LEGACY', 'CONFLICT'].includes('EXACT_OFFICIAL'),
)

// ── marcaSugerida · propone, no inventa ────────────────────────────────────
const conocidas = new Map([
  [normalizar('GEDORE'), 'GEDORE'],
  [normalizar('CHICAGO PNEUMATIC'), 'CHICAGO PNEUMATIC'],
])
cmp('marca en la primera palabra', 'GEDORE', marcaSugerida('Gedore 760-50 Llave', conocidas))
cmp('marca de dos palabras', 'CHICAGO PNEUMATIC', marcaSugerida('CHICAGO PNEUMATIC CP7748 LLAVE', conocidas))
cmp('una marca que NO está en la tabla no se inventa', null, marcaSugerida('BREMEN 6906 Juego', conocidas))
cmp('un sustantivo tampoco', null, marcaSugerida('MARTILLO DE GOMA', conocidas))
cmp('un cliente no es una marca', null, marcaSugerida('Mercedes Benz.Modelo ULT-100-RK', conocidas))

// ── tecnicosCargados y duplicados ──────────────────────────────────────────
cmp('cuenta los campos que hacen comparable', 3, tecnicosCargados({ product_type: 'Adaptador', series: 'Adaptador', attributes: { largo: '200' } }))
cmp('un producto de STEL no tiene ninguno', 0, tecnicosCargados({ attributes: {} }))

cmp(
  'dos notaciones del mismo modelo comparten clave',
  claveDuplicado({ model_code: 'SP.J23-1/2H', brands: { name: 'SPEEDRILL' } }),
  claveDuplicado({ model_code: 'SP.J2312H', brands: { name: 'SPEEDRILL' } }),
)
cmp('sin modelo no hay clave: dos innominados no son el mismo', null, claveDuplicado({ model_code: null }))
cmp(
  'la misma referencia en marcas distintas NO es duplicado',
  false,
  claveDuplicado({ model_code: 'PH2', brands: { name: 'BREMEN' } }) ===
    claveDuplicado({ model_code: 'PH2', brands: { name: 'BROPPE' } }),
)

console.log(`${ok} OK, ${fallos.length} fallos`)
for (const f of fallos) console.error('  ✗ ' + f)
process.exit(fallos.length === 0 ? 0 : 1)
