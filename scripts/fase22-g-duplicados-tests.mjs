/**
 * Tests de las reglas de clasificación de duplicados (Fase 22 · §5).
 *
 * Lo que estas reglas protegen es una sola cosa: que no se retire un producto
 * que NO es el mismo que su supuesto canónico. Ya nos pasó una vez —`RV.RIV504`
 * es la remachadora y las 94 filas que la nombraban eran sus repuestos— y el
 * caso está acá abajo como test, porque la próxima vez tiene que fallar el
 * test y no la base.
 *
 * El otro lado importa igual: una regla demasiado estricta manda a revisión a
 * mano 90 pares buenos y nadie los revisa. Por eso están también los casos que
 * NO deben marcarse.
 *
 *   node scripts/fase22-g-duplicados-tests.mjs
 */
import {
  baseDelCruce,
  clasificar,
  leerCsv,
  medidasDelNombre,
  medidasSeContradicen,
  pareceParteDelOtro,
  partNumberDetectado,
  repuestoEnSku,
  riquezaTecnica,
  stockDe,
  tieneHojaDeCatalogo,
} from './fase22-g-duplicados-candidatos.mjs'
import { enCatalogo } from './fase22-g-invariantes.mjs'

let ok = 0
const fallos = []
const cmp = (titulo, esperado, real) => {
  const a = JSON.stringify(esperado)
  const b = JSON.stringify(real)
  if (a === b) ok++
  else fallos.push(`${titulo}\n    esperado: ${a}\n    real:     ${b}`)
}

// ── Repuestos y accesorios ─────────────────────────────────────────────────
cmp(
  'el caso que ya rompimos: unas mordazas no son la remachadora',
  { palabra: 'JAWS', dureza: 'dura' },
  pareceParteDelOtro('RIVIT RIV503 JAWS (x3pz) Cod.1250100', 'RIVIT.MAQ RIV503 REMACHADORA HIDRONEUMATICA'),
)
cmp(
  'da lo mismo de qué lado esté el repuesto',
  { palabra: 'JAWS', dureza: 'dura' },
  pareceParteDelOtro('RIVIT.MAQ RIV503 REMACHADORA', 'RIVIT RIV503 JAWS Cod.1250100'),
)
cmp('REPUESTO también es señal dura', 'dura', pareceParteDelOtro('REPUESTO X', 'MAQUINA X')?.dureza)

// «PARA» es blanda: un cargador «para baterías» es el cargador, no un
// accesorio de la batería. Tratarlo como duro descartaba un par bueno.
cmp(
  'un cargador PARA baterías se manda a revisar, no se descarta',
  { palabra: 'PARA/COMPATIBLE', dureza: 'blanda' },
  pareceParteDelOtro('INGERSOLL RAND BC1121-EU CARGADOR PARA BATERIAS 20V', 'INGERSOLL RAND BC1121-EU CHARGER, 12V/20V, EU'),
)
cmp('dos nombres normales no marcan nada', null, pareceParteDelOtro('APEX 492X PUNTA', 'APEX PHILLIPS 492X PH2x50'))

// El SKU también habla, y a veces es el único que habla: «FM.REP.BC12_ST» se
// llama «FIAM ARM BC12 SISTEMA TELESCOPICO», que no suena a repuesto de nada.
cmp('REP como segmento del SKU es repuesto', 'REP en el SKU', repuestoEnSku('FM.REP.BC12_ST'))
cmp('y con guión bajo también', 'REP en el SKU', repuestoEnSku('FM_REP_BC12'))
cmp('pero REP dentro de un part number NO cuenta', null, repuestoEnSku('AP.REPTX25'))
cmp('ni un SKU cualquiera', null, repuestoEnSku('PRO05697'))
cmp('un sku vacío no rompe', null, repuestoEnSku(null))

// ── Medidas ────────────────────────────────────────────────────────────────
cmp('lee el rango con la unidad sólo al final', ['14NM', '6NM'], medidasDelNombre('PISTOLA DE 6 A 14 NM'))
cmp('y el rango con unidad en los dos', ['12NM', '6NM'], medidasDelNombre('OBN-30PD DE 6 NM A 12 NM'))
cmp('varias unidades distintas conviven', ['20V', '4AH'], medidasDelNombre('Bateria 20V 4 Ah'))
cmp('los encastres no son medidas', [], medidasDelNombre('PISTOLA ENCASTRE 3/8" SQ'))

cmp(
  'el mismo rango escrito distinto NO es contradicción',
  null,
  medidasSeContradicen('TORERO OBN-30PD PISTOLA DE 6 A 14 NM', 'TORERO OBN-30PD DE 6 NM A 12 NM'),
)
cmp(
  'rangos que se solapan tampoco',
  null,
  medidasSeContradicen('RECTO DE 18 A 25 NM', 'OBN-50SH DE 18 NM A 30 NM'),
)
cmp(
  '271 contra 270 es redondeo, no otro producto',
  null,
  medidasSeContradicen('ANGULAR A BATERIA 271NM', 'QX WIRELESS 40V 60NM MULTIPLIED 270 NM'),
)
cmp(
  'un hueco grande sí se reporta',
  'NM: 148–148 vs 200–200',
  medidasSeContradicen('PISTOLA A BATERIA 148NM', '200NM QX PISTOL, 3/4" SQ.'),
)
cmp(
  'que uno no diga nada no es contradicción: está menos descrito',
  null,
  medidasSeContradicen('TOHNICHI SH15DX14', 'TOHNICHI SH15DX14 OPEN END HEAD 20NM'),
)

// ── Sobre qué se apoya el cruce ────────────────────────────────────────────
const canonTorero = { sku: 'TO.OBN-30PD', model_code: 'OBN-30PD', name: 'TORERO OBN-30PD DE 6 NM A 12 NM' }
cmp(
  'el part number del fabricante vive en el NOMBRE del registro de STEL',
  'referencia_en_el_nombre',
  baseDelCruce({ sku: 'PRO04779', model_code: 'PRO04779', name: 'TORERO OBN-30PD PISTOLA DE 6 A 14 NM' }, canonTorero),
)
cmp(
  'y se puede nombrar',
  'OBN30PD',
  partNumberDetectado({ sku: 'PRO04779', model_code: 'PRO04779', name: 'TORERO OBN-30PD PISTOLA' }, canonTorero),
)
cmp(
  'el prefijo de Buscatools no impide cruzar dos SKU iguales',
  'sku_identico_sin_prefijo',
  baseDelCruce({ sku: 'B2036LA-2', model_code: null, name: 'DUROFIX Bateria' }, { sku: 'DU.B2036LA-2', model_code: null, name: 'DUROFIX B2036LA-2' }),
)
cmp(
  'sin referencia común no hay base',
  null,
  baseDelCruce({ sku: 'PRO99999', model_code: null, name: 'AMOLADORA GENERICA' }, canonTorero),
)

// ── La clasificación completa ──────────────────────────────────────────────
const dupLimpio = { id: 'd', sku: 'PRO05697', model_code: 'PRO05697', name: 'APEX 50TX08', brand_id: null, status: 'active', attributes: {}, product_images: [] }
const canonLimpio = { id: 'c', sku: 'AP.50-TX-08', model_code: '50-TX-08', name: 'APEX 50-TX-08 PUNTA', brand_id: 'b-apex', status: 'active', attributes: { encastre: '1/4' }, series: '50', product_type: 'Punta', product_images: [{ id: 'i', kind: 'photo' }], ncm_code: '8207' }
const base = { dup: dupLimpio, canon: canonLimpio, duplicadosDelCanonico: 1, docsDup: 0, stockDup: null }

cmp('un par limpio es SAFE_TO_MERGE', 'SAFE_TO_MERGE', clasificar(base).clase)
cmp('y trae confianza, no un booleano', true, clasificar(base).confianza > 0.7)

cmp(
  'el stock NO descalifica, pero sube el riesgo y queda escrito',
  ['SAFE_TO_MERGE', 'medio', true],
  (() => {
    const r = clasificar({ ...base, stockDup: { real: 3, virtual: 3 } })
    return [r.clase, r.riesgo, r.razones.some((x) => x.includes('ATENCIÓN'))]
  })(),
)

cmp(
  'la historia comercial tampoco descalifica: los snapshots la sostienen',
  'SAFE_TO_MERGE',
  clasificar({ ...base, docsDup: 12 }).clase,
)

cmp(
  'si el canónico absorbe varios, no es 1:1 y no se fusiona',
  'DO_NOT_MERGE',
  clasificar({ ...base, duplicadosDelCanonico: 4 }).clase,
)

cmp(
  'un canónico que no está activo no puede recibir nada',
  'DO_NOT_MERGE',
  clasificar({ ...base, canon: { ...canonLimpio, status: 'discontinued' } }).clase,
)

cmp(
  'dos marcas distintas son dos productos',
  'DO_NOT_MERGE',
  clasificar({ ...base, dup: { ...dupLimpio, brand_id: 'b-otra' } }).clase,
)

cmp(
  'un canónico sin más ficha que el duplicado no es canónico de nada',
  'DO_NOT_MERGE',
  clasificar({ ...base, canon: { ...canonLimpio, brand_id: null, attributes: {}, series: null, product_type: null, product_images: [], ncm_code: null } }).clase,
)

cmp(
  'si sólo uno de los dos se declara repuesto en el SKU, el par no se fusiona',
  'DO_NOT_MERGE',
  clasificar({
    ...base,
    dup: { ...dupLimpio, sku: 'FM.REP.BC12_ST', model_code: 'BC12', name: 'FIAM ARM BC12 SISTEMA TELESCOPICO' },
    canon: { ...canonLimpio, sku: 'FI.BC12', model_code: 'BC12', name: 'FIAM ARM BC12 BRAZO DE REACCION' },
  }).clase,
)

cmp(
  'si los DOS lo dicen, el par sigue en pie: son dos fichas del mismo repuesto',
  'SAFE_TO_MERGE',
  clasificar({
    ...base,
    dup: { ...dupLimpio, sku: 'FM.REP.BC12', model_code: 'BC12', name: 'FIAM BC12' },
    canon: { ...canonLimpio, sku: 'FI.REP.BC12', model_code: 'BC12', name: 'FIAM BC12 REACTION' },
  }).clase,
)

cmp(
  'las mordazas de la RIV503 no se fusionan con la remachadora',
  'DO_NOT_MERGE',
  clasificar({
    ...base,
    dup: { ...dupLimpio, sku: 'PRO04873', model_code: 'PRO04873', name: 'RIVIT RIV503 JAWS (x3pz) Cod.1250100 Morsetti / Muelas' },
    canon: { ...canonLimpio, sku: 'RV.RIV503', model_code: 'RIV503', name: 'RIVIT.MAQ RIV503 REMACHADORA HIDRONEUMATICA HASTA D 4,8MM' },
  }).clase,
)

// ── Lo que se lee de cada producto ─────────────────────────────────────────
cmp('sin fila de saldo es null, no cero (Fase 21 · E3.1)', null, stockDe({ stock_balances: [] }))
cmp('con fila, virtual = on_hand − reserved', { real: 10, virtual: 7 }, stockDe({ stock_balances: [{ on_hand: 10, reserved: 3 }] }))
cmp('varias filas se suman', { real: 12, virtual: 9 }, stockDe({ stock_balances: [{ on_hand: 10, reserved: 3 }, { on_hand: 2, reserved: 0 }] }))

cmp('el diagrama compartido ES la hoja de catálogo', true, tieneHojaDeCatalogo({ product_images: [{ kind: 'shared_diagram' }] }))
cmp('y el par catálogo+página del legacy también', true, tieneHojaDeCatalogo({ attributes: { catalogo_id: 'durofix', catalogo_pagina: 12 } }))
cmp('una foto común no es una hoja de catálogo', false, tieneHojaDeCatalogo({ product_images: [{ kind: 'photo' }], attributes: {} }))
cmp('un producto vacío no tiene hoja', false, tieneHojaDeCatalogo(null))

cmp('la riqueza técnica premia marca, atributos e imagen', true, riquezaTecnica(canonLimpio) > riquezaTecnica(dupLimpio))

// ── La regla de visibilidad del catálogo (§8) ──────────────────────────────
// El null de marca es lo delicado: un producto sin marca no tiene quién lo
// oculte, así que se ve. Escrito como `b.is_active` a secas, el LEFT JOIN da
// null, null no es true, y 5.482 productos desaparecerían del catálogo sin
// que nadie lo pidiera.
const vivo = { deleted_at: null, status: 'active', brand_id: 'b', brands: { is_active: true } }
cmp('active + marca activa se ve', true, enCatalogo(vivo))
cmp('active + marca inactiva no se ve', false, enCatalogo({ ...vivo, brands: { is_active: false } }))
cmp('active SIN marca se ve: nadie lo oculta', true, enCatalogo({ ...vivo, brand_id: null, brands: null }))
cmp('discontinued no se ve', false, enCatalogo({ ...vivo, status: 'discontinued' }))
cmp('merged no se ve', false, enCatalogo({ ...vivo, status: 'merged' }))
cmp('borrado no se ve, aunque esté active', false, enCatalogo({ ...vivo, deleted_at: '2026-01-01' }))
cmp('draft se sigue viendo: esta regla no lo toca', true, enCatalogo({ ...vivo, status: 'draft' }))

// ── El CSV de entrada ──────────────────────────────────────────────────────
// La lista de 92 se lee de un archivo congelado. Si el lector se equivoca con
// una coma dentro de un nombre, la lista que revisa Juan no es la que se
// aplica — que es exactamente lo que no puede pasar.
cmp(
  'una coma dentro de comillas no parte el campo',
  [{ a: '1', b: 'PINZA, RECTA', c: '3' }],
  leerCsv('a,b,c\n"1","PINZA, RECTA","3"'),
)
cmp(
  'las comillas escapadas se devuelven como comillas',
  'PUNTA 1/4"',
  leerCsv('a\n"PUNTA 1/4"""')[0].a,
)

console.log(`${ok} OK, ${fallos.length} fallos`)
for (const f of fallos) console.error('  ✗ ' + f)
process.exit(fallos.length === 0 ? 0 : 1)
