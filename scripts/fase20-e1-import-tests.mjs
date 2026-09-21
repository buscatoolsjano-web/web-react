/**
 * Fase 20 · E1 — Las reglas de la importación, con fixtures.
 *
 * No toca STEL, no toca la base y no necesita credenciales: prueba las
 * decisiones puras de `lib/fase20-mapeo.mjs`, que son las que pueden arruinar
 * una importación sin que se note —un equipo asignado al cliente equivocado no
 * se ve en ningún número—.
 *
 *   node scripts/fase20-e1-import-tests.mjs
 */
import { aFilaDeActivo, claveDeIdentidad, elegirCliente, normSerie } from './lib/fase20-mapeo.mjs'

let pasaron = 0
let fallaron = 0
const prueba = (nombre, fn) => {
  try {
    fn()
    pasaron++
    console.log(`  ✓ ${nombre}`)
  } catch (e) {
    fallaron++
    console.log(`  ✗ ${nombre}\n      ${e.message}`)
  }
}
const igual = (a, b, msg = '') => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  if (x !== y) throw new Error(`${msg} esperado ${y}, obtenido ${x}`)
}

const indices = (clientes) => {
  const porCuit = new Map()
  const porRef = new Map()
  for (const c of clientes) {
    if (c.tax_id) porCuit.set(c.tax_id.replace(/\D/g, ''), [...(porCuit.get(c.tax_id.replace(/\D/g, '')) ?? []), c])
    if (c.legacy_ref) porRef.set(c.legacy_ref, [...(porRef.get(c.legacy_ref) ?? []), c])
  }
  return { porCuit, porRef }
}

const BASE = {
  companyId: 'empresa-1',
  marcaPorNombre: new Map([['FEIN', 'marca-fein']]),
  ahora: '2026-09-21T12:00:00.000Z',
}

console.log('\nFASE 20 · E1 — reglas de importación')

console.log('\nA · a qué cliente va cada equipo')

prueba('el CUIT manda', () => {
  const i = indices([{ id: 'c1', tax_id: '30-50328441-0', legacy_ref: 'CLI00001' }])
  const r = elegirCliente({ 'tax-identification-number': '30503284410' }, i)
  igual([r.cliente.id, r.via], ['c1', 'cuit'])
})

prueba('sin CUIT, la referencia legacy', () => {
  const i = indices([{ id: 'c2', tax_id: null, legacy_ref: 'CLI00324' }])
  const r = elegirCliente({ 'full-reference': 'CLI00324' }, i)
  igual([r.cliente.id, r.via], ['c2', 'legacy_ref'])
})

prueba('el nombre NO decide: un cliente que sólo coincide por nombre queda sin vincular', () => {
  const i = indices([{ id: 'c3', tax_id: '30111111112', legacy_ref: 'CLI00999' }])
  const r = elegirCliente({ 'legal-name': 'MABE ARGENTINA S.A.', name: 'Mabe' }, i)
  igual([r.cliente, r.via, r.ambiguo], [null, null, false])
})

prueba('dos clientes con el mismo CUIT: ambiguo, y no elige ninguno', () => {
  const i = indices([
    { id: 'c4', tax_id: '30111111112', legacy_ref: 'CLI1' },
    { id: 'c5', tax_id: '30-11111111-2', legacy_ref: 'CLI2' },
  ])
  const r = elegirCliente({ 'tax-identification-number': '30111111112' }, i)
  igual([r.cliente, r.ambiguo], [null, true])
})

prueba('un activo sin cuenta en STEL entra sin dueño', () => {
  const r = elegirCliente(null, indices([]))
  igual([r.cliente, r.ambiguo], [null, false])
})

console.log('\nB · qué se guarda de cada campo')

const activoStel = {
  id: 147236,
  'full-reference': 'ACT00339',
  identifier: 'P037 - ASM10-9 PC',
  name: 'FEIN ASM 10-9-PC P037',
  'serial-number': 'V00129',
  brand: 'FEIN',
  model: 'ASM18-12- PC',
  description: null,
  'private-comments': 'Revisar mandril',
  'warranty-start-date': '2026-01-10T00:00:00+0000',
  'warranty-end-date': '2027-01-10T00:00:00+0000',
  'subject-to-maintenance': true,
}

prueba('la identidad es el id de STEL, no la referencia', () => {
  const f = aFilaDeActivo(activoStel, { ...BASE, cliente: { id: 'c1' }, direccion: null })
  igual([f.external_source, f.external_id], ['stel', '147236'])
  igual(claveDeIdentidad(f), 'empresa-1:stel:147236')
})

prueba('el modelo entra tal cual, con su espacio de más', () => {
  const f = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null })
  igual(f.model_text, 'ASM18-12- PC')
})

prueba('la marca se enlaza si ya existe, y siempre queda el texto', () => {
  const f = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null })
  igual([f.brand_id, f.brand_text], ['marca-fein', 'FEIN'])
})

prueba('una marca que no existe NO se crea: queda el texto y el enlace en nulo', () => {
  const f = aFilaDeActivo({ ...activoStel, brand: 'ACRADYNE' }, { ...BASE, cliente: null, direccion: null })
  igual([f.brand_id, f.brand_text], [null, 'ACRADYNE'])
})

prueba('el nombre de STEL, cuando no es la etiqueta, se conserva en las notas', () => {
  const f = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null })
  igual(f.identifier, 'P037 - ASM10-9 PC')
  if (!f.notes.includes('Nombre en STEL: FEIN ASM 10-9-PC P037')) throw new Error('se perdió el nombre')
  if (!f.notes.includes('Revisar mandril')) throw new Error('se perdieron los comentarios')
})

prueba('sin etiqueta, el nombre de STEL pasa a ser la etiqueta y no se duplica', () => {
  const f = aFilaDeActivo({ ...activoStel, identifier: null }, { ...BASE, cliente: null, direccion: null })
  igual(f.identifier, 'FEIN ASM 10-9-PC P037')
  if ((f.notes ?? '').includes('Nombre en STEL')) throw new Error('quedó duplicado en las notas')
})

prueba('la ciudad sale de la dirección de STEL', () => {
  const f = aFilaDeActivo(activoStel, {
    ...BASE, cliente: null, direccion: { 'city-town': 'Garín', province: 'Buenos Aires' },
  })
  igual([f.city, f.state], ['Garín', 'Buenos Aires'])
})

console.log('\nC · los datos que no cierran')

prueba('un equipo sin serie entra igual, con serial nulo', () => {
  const f = aFilaDeActivo({ ...activoStel, 'serial-number': '   ' }, { ...BASE, cliente: null, direccion: null })
  igual(f.serial_number, null)
})

prueba('dos equipos con la misma serie escrita distinto entran los dos, y se detectan al normalizar', () => {
  const a = aFilaDeActivo({ ...activoStel, id: 1, 'serial-number': '2020 11 023052' }, { ...BASE, cliente: null, direccion: null })
  const b = aFilaDeActivo({ ...activoStel, id: 2, 'serial-number': '2020-11-023052' }, { ...BASE, cliente: null, direccion: null })
  if (a.serial_number === b.serial_number) throw new Error('el original no se conservó')
  igual(normSerie(a.serial_number), normSerie(b.serial_number), 'normalizados deberían coincidir:')
  if (claveDeIdentidad(a) === claveDeIdentidad(b)) throw new Error('la serie no puede ser la identidad')
})

prueba('la garantía al revés no se guarda ni se corrige: se anota', () => {
  const f = aFilaDeActivo(
    { ...activoStel, 'warranty-start-date': '2023-01-18', 'warranty-end-date': '2023-01-17' },
    { ...BASE, cliente: null, direccion: null },
  )
  igual([f.warranty_start, f.warranty_end], [null, null])
  if (!f.notes.includes('2023-01-18 → 2023-01-17')) throw new Error('se perdió el dato original')
})

console.log('\nD · idempotencia')

prueba('la misma corrida dos veces da la misma clave', () => {
  const a = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null })
  const b = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null, ahora: '2027-01-01T00:00:00.000Z' })
  igual(claveDeIdentidad(a), claveDeIdentidad(b))
})

prueba('si STEL renumera la referencia, sigue siendo el mismo activo', () => {
  const a = aFilaDeActivo(activoStel, { ...BASE, cliente: null, direccion: null })
  const b = aFilaDeActivo({ ...activoStel, 'full-reference': 'ACT99999' }, { ...BASE, cliente: null, direccion: null })
  igual(claveDeIdentidad(a), claveDeIdentidad(b))
  if (a.reference === b.reference) throw new Error('la referencia debería haber cambiado')
})

console.log(`\n${pasaron} pasaron · ${fallaron} fallaron\n`)
process.exit(fallaron === 0 ? 0 : 1)
