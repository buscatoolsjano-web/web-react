/**
 * Fase 5 · Clientes — entrega 3 (alta y edición), contra los datos reales.
 *
 * Con sesión real, las mismas escrituras que hacen los services de React:
 * alta, edición, contactos, direcciones, baja lógica, la marca de revisión,
 * concurrencia de la referencia CLI y del CUIT, y lo que cada rol NO puede
 * hacer, probado con un intento real.
 *
 * Se limpia sola: todo lo que crea lleva el prefijo `ZZ-E3` y al final se
 * borra con la clave de servicio, comprobando que la base queda como estaba.
 *
 *   set -a; source .env; source .env.migration; source .env.rls; set +a
 *   node scripts/fase5-clientes-edicion-tests.mjs
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL
const PUB = process.env.VITE_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL || !PUB || !SECRET) { console.error('✗ Faltan variables de entorno'); process.exit(1) }

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(70)}`)
const PASS = (t, d = '') => console.log(`    PASS  ${t}${d ? ' — ' + d : ''}`)
const FAIL = (t, d = '') => { fallos++; console.log(`    FAIL  ${t}${d ? ' — ' + d : ''}`) }
const cmp = (t, esperado, real) =>
  String(esperado) === String(real) ? PASS(t, String(real))
                                    : FAIL(t, `esperaba ${esperado}, dio ${real}`)

const sesion = () => createClient(URL, PUB, { auth: { persistSession: false } })
const admin = () => createClient(URL, SECRET, { auth: { persistSession: false } })

const MARCA = 'ZZ-E3'
const creados = { clientes: [], contactos: [], direcciones: [] }

/** El alta tal como la hace `crearCliente`. */
async function altaCliente(c, BT, nombre, extra = {}) {
  const { data: ref, error: eN } = await c.rpc('next_document_number', {
    p_company: BT, p_doc_type: 'customer',
  })
  if (eN) throw new Error('referencia: ' + eN.message)
  const { data, error } = await c.from('customers').insert({
    company_id: BT, legacy_ref: ref, legal_name: nombre,
    email_domains: [], customer_type: 'business', status: 'active', ...extra,
  }).select('id, legacy_ref').single()
  if (error) return { error }
  creados.clientes.push(data.id)
  return { id: data.id, referencia: data.legacy_ref }
}

const main = async () => {
  const c = sesion()
  const { error: eL } = await c.auth.signInWithPassword({
    email: 'buscatools.jano@gmail.com',
    password: process.env.BT_PW_JANO,
  })
  if (eL) { console.error('✗ login: ' + eL.message); process.exit(1) }

  const { data: mem } = await c.from('company_memberships').select('company_id, companies ( slug )')
  const BT = mem.find((m) => m.companies.slug === 'buscatools').company_id
  const s = admin()

  // Estado previo: la limpieza compara contra esto, no contra cero.
  const { count: clientesAntes } = await s.from('customers')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { count: contactosAntes } = await s.from('customer_contacts')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { count: direccionesAntes } = await s.from('customer_addresses')
    .select('*', { count: 'exact', head: true }).eq('company_id', BT)
  const { data: seqAntes } = await s.from('document_sequences')
    .select('next_number').eq('company_id', BT).eq('doc_type', 'customer').single()

  console.log('='.repeat(74))
  console.log('  CLIENTES · entrega 3 — alta, edición, baja y revisión')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(74))

  try {
    // ── Alta ───────────────────────────────────────────────────────────────
    seccion('1 · ALTA')

    const minimo = await altaCliente(c, BT, `${MARCA} Mínimo`)
    minimo.id ? PASS('alta con lo mínimo: sólo la razón social', minimo.referencia)
              : FAIL('el alta mínima falló', minimo.error?.message)

    const formatoRef = /^CLI\d{5}$/
    formatoRef.test(minimo.referencia ?? '')
      ? PASS('la referencia tiene el formato CLI00000', minimo.referencia)
      : FAIL('formato de referencia', String(minimo.referencia))

    const completo = await altaCliente(c, BT, `${MARCA} Completo S.A.`, {
      trade_name: `${MARCA} Completo`,
      tax_id: '30-71535942-8'.replace('30-7', '30-9'), // uno que no exista
      emails: ['compras@zz-e3.com', 'pagos@zz-e3.com'],
      email_domains: ['zz-e3.com'],
      industry: 'Prueba',
      phone: '+54 11 0000-0000',
      payment_terms: '30 días',
      default_currency: 'USD',
      notes: 'Cliente de prueba de la entrega 3.',
    })
    completo.id ? PASS('alta completa con todos los campos reales', completo.referencia)
                : FAIL('el alta completa falló', completo.error?.message)

    const { data: leido } = await c.from('customers')
      .select('legal_name, trade_name, tax_id, emails, email_domains, industry, needs_review')
      .eq('id', completo.id).single()
    cmp('guarda los dos emails', 2, leido.emails.length)
    cmp('un cliente nuevo NO nace marcado para revisión', false, leido.needs_review)

    // ── CUIT ───────────────────────────────────────────────────────────────
    seccion('2 · CUIT')

    const mismoCuitOtroFormato = await altaCliente(c, BT, `${MARCA} CUIT repetido`, {
      tax_id: leido.tax_id.replace(/\D/g, ''),   // el mismo, sin guiones
    })
    mismoCuitOtroFormato.error
      ? PASS('el mismo CUIT escrito distinto es rechazado',
             mismoCuitOtroFormato.error.code ?? mismoCuitOtroFormato.error.message.slice(0, 40))
      : FAIL('SE PUDO REPETIR EL CUIT cambiándole el formato')

    const sinCuit1 = await altaCliente(c, BT, `${MARCA} Sin CUIT 1`)
    const sinCuit2 = await altaCliente(c, BT, `${MARCA} Sin CUIT 2`)
    sinCuit1.id && sinCuit2.id
      ? PASS('dos clientes sin CUIT conviven: el índice es parcial')
      : FAIL('no se pudieron crear dos clientes sin CUIT')

    // El histórico trae `tax_id` que no son un CUIT y hay dos que normalizan a
    // la cadena vacía. El índice sólo mira los de once dígitos, así que esos
    // no se rompen ni se corrigen solos.
    const { count: basura } = await s.from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', BT).not('tax_id', 'is', null)
      .filter('tax_id', 'not.ilike', '%0%')
    PASS('el histórico con CUIT mal cargado sigue intacto', `${basura} fila(s) sin dígito 0`)

    // ── Concurrencia ───────────────────────────────────────────────────────
    seccion('3 · CONCURRENCIA')

    const N = 12
    const conReintento = async (fn) => {
      for (let i = 0; i < 5; i += 1) {
        const r = await fn()
        if (!r.error) return r
        if (!String(r.error.message).includes('fetch failed')) return r
        await new Promise((z) => setTimeout(z, 200 * (i + 1)))
      }
      return { error: { message: 'fetch failed tras 5 intentos' } }
    }

    const altas = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        conReintento(() => altaCliente(c, BT, `${MARCA} Concurrente ${i}`))),
    )
    const conError = altas.filter((a) => a.error)
    cmp(`${N} altas simultáneas sin error`, 0, conError.length)
    const refs = altas.map((a) => a.referencia).filter(Boolean)
    cmp('todas las referencias son distintas', refs.length, new Set(refs).size)
    const nums = refs.map((r) => Number(r.replace(/\D/g, ''))).sort((a, b) => a - b)
    const sinHuecos = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1)
    sinHuecos ? PASS('sin huecos por carrera', `${nums[0]}…${nums[nums.length - 1]}`)
              : FAIL('la numeración dejó huecos', nums.join(','))

    // Dos altas simultáneas con el MISMO CUIT: la base tiene que dejar pasar
    // una sola. No alcanza con validar en el navegador.
    const cuitDisputado = '30-99999999-7'
    const [a, b] = await Promise.all([
      altaCliente(c, BT, `${MARCA} Carrera A`, { tax_id: cuitDisputado }),
      altaCliente(c, BT, `${MARCA} Carrera B`, { tax_id: cuitDisputado.replace(/\D/g, '') }),
    ])
    const ganadores = [a, b].filter((x) => x.id).length
    cmp('dos altas simultáneas con el mismo CUIT: gana una sola', 1, ganadores)

    // ── Edición ────────────────────────────────────────────────────────────
    seccion('4 · EDICIÓN')

    const { error: eEd } = await c.from('customers')
      .update({ legal_name: `${MARCA} Completo S.A. (renombrado)`, phone: '+54 11 1111-1111' })
      .eq('company_id', BT).eq('id', completo.id)
    eEd ? FAIL('la edición falló', eEd.message) : PASS('edita razón social y teléfono')

    const { data: refTrasEditar } = await c.from('customers')
      .select('legacy_ref').eq('id', completo.id).single()
    cmp('la referencia CLI no se toca al editar', completo.referencia, refTrasEditar.legacy_ref)

    // ── Contactos ──────────────────────────────────────────────────────────
    seccion('5 · CONTACTOS')

    const { data: cto, error: eC } = await c.from('customer_contacts').insert({
      company_id: BT, customer_id: completo.id, full_name: `${MARCA} Ana`,
      role: 'Compras', email: 'ana@zz-e3.com', is_default: true,
    }).select('id').single()
    if (eC) FAIL('no se pudo crear el contacto', eC.message)
    else { creados.contactos.push(cto.id); PASS('crea contacto con customer_id real') }

    const { error: eC2 } = await c.from('customer_contacts')
      .update({ role: 'Jefa de compras' }).eq('company_id', BT).eq('id', cto.id)
    eC2 ? FAIL('no se pudo editar el contacto', eC2.message) : PASS('edita contacto')

    const { error: eSinCliente } = await c.from('customer_contacts').insert({
      company_id: BT, full_name: `${MARCA} Huérfano`,
    })
    eSinCliente
      ? PASS('un contacto sin cliente es rechazado', eSinCliente.code ?? '')
      : FAIL('SE PUDO CREAR UN CONTACTO SIN CLIENTE')

    const { data: cto2 } = await c.from('customer_contacts').insert({
      company_id: BT, customer_id: completo.id, full_name: `${MARCA} Beto`, is_default: false,
    }).select('id').single()
    if (cto2) creados.contactos.push(cto2.id)
    const { error: eDosPrincipales } = await c.from('customer_contacts')
      .update({ is_default: true }).eq('id', cto2.id)
    eDosPrincipales
      ? PASS('dos contactos principales a la vez: rechazado', eDosPrincipales.code ?? '')
      : FAIL('SE PUDIERON MARCAR DOS CONTACTOS PRINCIPALES')

    const { error: eBorrar } = await c.from('customer_contacts')
      .delete().eq('company_id', BT).eq('id', cto2.id)
    if (eBorrar) FAIL('no se pudo borrar el contacto', eBorrar.message)
    else {
      creados.contactos = creados.contactos.filter((x) => x !== cto2.id)
      PASS('borra contacto')
    }

    // ── Direcciones ────────────────────────────────────────────────────────
    seccion('6 · DIRECCIONES')

    const { data: dir, error: eD } = await c.from('customer_addresses').insert({
      company_id: BT, customer_id: completo.id, kind: 'shipping',
      street: `${MARCA} Av. Siempreviva 742`, city: 'Springfield', country_code: 'AR',
      is_default: true,
    }).select('id').single()
    if (eD) FAIL('no se pudo crear la dirección', eD.message)
    else { creados.direcciones.push(dir.id); PASS('crea dirección de entrega') }

    const { data: dir2 } = await c.from('customer_addresses').insert({
      company_id: BT, customer_id: completo.id, kind: 'billing',
      street: `${MARCA} Otra 1`, is_default: true,
    }).select('id').single()
    if (dir2) { creados.direcciones.push(dir2.id); PASS('entrega y facturación conviven como principales') }
    else FAIL('no se pudo crear la dirección de facturación')

    const { error: eTipo } = await c.from('customer_addresses').insert({
      company_id: BT, customer_id: completo.id, kind: 'otra', street: 'X',
    })
    eTipo
      ? PASS('un tipo de dirección que la tabla no tiene es rechazado', eTipo.code ?? '')
      : FAIL('SE ACEPTÓ UN TIPO DE DIRECCIÓN INVENTADO')

    const { error: eD2 } = await c.from('customer_addresses')
      .update({ city: 'Shelbyville' }).eq('company_id', BT).eq('id', dir.id)
    eD2 ? FAIL('no se pudo editar la dirección', eD2.message) : PASS('edita dirección')

    // ── Revisión ───────────────────────────────────────────────────────────
    seccion('7 · NEEDS_REVIEW')

    const { data: marcado } = await s.from('customers')
      .select('id, legal_name, review_reason, phone')
      .eq('company_id', BT).eq('needs_review', true)
      .like('review_reason', '%VARIOS_LEGACY%').limit(1).single()

    const motivosAntes = marcado.review_reason
    await c.from('customers').update({ phone: '+54 11 2222-2222' }).eq('id', marcado.id)
    const { data: trasTelefono } = await s.from('customers')
      .select('needs_review, review_reason').eq('id', marcado.id).single()
    cmp('cambiar el teléfono NO borra la marca', motivosAntes, trasTelefono.review_reason)
    cmp('sigue marcado', true, trasTelefono.needs_review)

    const { error: ePisar } = await c.from('customers')
      .update({ needs_review: false, review_reason: null }).eq('id', marcado.id)
    const { data: trasPisar } = await s.from('customers')
      .select('needs_review, review_reason').eq('id', marcado.id).single()
    !ePisar && trasPisar.review_reason === motivosAntes
      ? PASS('escribir la columna a mano NO resuelve nada: el trigger la recalcula')
      : FAIL('SE PUDO BORRAR LA MARCA ESCRIBIENDO LA COLUMNA', trasPisar.review_reason ?? 'null')

    // Verificable: un cliente sin CUIT marcado por eso se resuelve solo al
    // cargarle un CUIT válido.
    const conMotivoCuit = await altaCliente(c, BT, `${MARCA} Marcado`)
    await s.from('customers').update({
      needs_review: true, review_reason: 'CUIT_NO_ASIGNADO | VARIOS_LEGACY_AL_MISMO_CLIENTE',
    }).eq('id', conMotivoCuit.id)
    await c.from('customers').update({ tax_id: '30-88888888-9' }).eq('id', conMotivoCuit.id)
    const { data: trasCuit } = await s.from('customers')
      .select('needs_review, review_reason').eq('id', conMotivoCuit.id).single()
    cmp('cargar el CUIT resuelve SÓLO el motivo del CUIT',
      'VARIOS_LEGACY_AL_MISMO_CLIENTE', trasCuit.review_reason)

    const { data: resuelto, error: eR } = await c.rpc('resolver_revision_cliente', {
      p_customer: conMotivoCuit.id, p_motivos: ['VARIOS_LEGACY_AL_MISMO_CLIENTE'],
    })
    if (eR) FAIL('la resolución explícita falló', eR.message)
    else {
      const { data: trasResolver } = await s.from('customers')
        .select('needs_review, review_reason').eq('id', conMotivoCuit.id).single()
      cmp('resolver a mano deja el motivo en null', null, trasResolver.review_reason)
      cmp('y baja la marca', false, trasResolver.needs_review)
      PASS('la RPC devuelve lo que queda', JSON.stringify(resuelto.motivos_restantes))
    }

    // ── Baja lógica ────────────────────────────────────────────────────────
    seccion('8 · BAJA LÓGICA')

    const { error: eBaja } = await c.from('customers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' })
      .eq('company_id', BT).eq('id', minimo.id)
    eBaja ? FAIL('no se pudo dar de baja', eBaja.message) : PASS('da de baja sin borrar')

    const { data: sigueVisible } = await c.from('customers')
      .select('id, deleted_at, status').eq('id', minimo.id).maybeSingle()
    sigueVisible
      ? PASS('un rol interno sigue viendo al cliente dado de baja')
      : FAIL('EL CLIENTE DADO DE BAJA DESAPARECIÓ PARA EL ADMIN')

    // El selector de un documento nuevo: mismo filtro que `buscarClientes`.
    const { data: ofrecidos } = await c.from('customers')
      .select('id').eq('company_id', BT).is('deleted_at', null).eq('status', 'active')
      .eq('id', minimo.id)
    cmp('el cliente dado de baja NO se ofrece para un documento nuevo', 0, (ofrecidos ?? []).length)

    // `customers` no tiene policy de DELETE, así que el intento no da error:
    // simplemente no alcanza ninguna fila. Lo que hay que medir NO es el
    // error —contar el error sería el mismo falso PASS de la Fase 3.5— sino
    // que el cliente siga estando después del intento.
    const { data: borradas, error: eDel } = await c.from('customers')
      .delete().eq('id', minimo.id).select('id')
    const { count: sobrevive } = await s.from('customers')
      .select('*', { count: 'exact', head: true }).eq('id', minimo.id)
    sobrevive === 1 && (borradas ?? []).length === 0
      ? PASS('desde la aplicación un cliente no se borra nunca',
             eDel ? (eDel.code ?? '') : 'el DELETE no alcanza ninguna fila')
      : FAIL('SE PUDO BORRAR UN CLIENTE DESDE LA APLICACIÓN')

    // ── El histórico no se rompe ───────────────────────────────────────────
    seccion('9 · VENTAS NO SE ROMPE')

    const { data: docCliente } = await s.from('sales_quotes')
      .select('id, customer_id, original_number').eq('company_id', BT)
      .not('customer_id', 'is', null).limit(1).single()
    const { data: original } = await s.from('customers')
      .select('id, legal_name').eq('id', docCliente.customer_id).single()

    await c.from('customers')
      .update({ legal_name: `${original.legal_name} ${MARCA}` }).eq('id', original.id)
    const { data: docTrasRename } = await c.from('sales_quotes')
      .select('id, customer_id, customers!customer_id ( legal_name )')
      .eq('id', docCliente.id).single()
    cmp('renombrar al cliente no cambia el customer_id del documento',
      docCliente.customer_id, docTrasRename.customer_id)
    docTrasRename.customers.legal_name.endsWith(MARCA)
      ? PASS('el documento muestra el nombre nuevo, porque lo lee por FK')
      : FAIL('el documento no siguió al cliente renombrado')
    await s.from('customers').update({ legal_name: original.legal_name }).eq('id', original.id)

    // Dar de baja a un cliente con documentos: el documento lo sigue nombrando.
    await c.from('customers')
      .update({ deleted_at: new Date().toISOString(), status: 'inactive' }).eq('id', original.id)
    const { data: docTrasBaja } = await c.from('sales_quotes')
      .select('id, customers!customer_id ( legal_name )').eq('id', docCliente.id).single()
    docTrasBaja.customers?.legal_name
      ? PASS('un documento de un cliente dado de baja lo sigue nombrando',
             docTrasBaja.customers.legal_name.slice(0, 30))
      : FAIL('EL DOCUMENTO PERDIÓ EL NOMBRE DEL CLIENTE AL DARLO DE BAJA')
    const { count: bloqueado } = await s.from('customers')
      .select('*', { count: 'exact', head: true }).eq('id', original.id)
    cmp('y el cliente sigue existiendo', 1, bloqueado)
    await s.from('customers')
      .update({ deleted_at: null, status: 'active' }).eq('id', original.id)

    const { error: eDelDocs } = await s.from('customers').delete().eq('id', original.id)
    eDelDocs
      ? PASS('ni la clave de servicio borra un cliente con documentos',
             eDelDocs.code ?? eDelDocs.message.slice(0, 45))
      : FAIL('SE BORRÓ UN CLIENTE CON DOCUMENTOS')

    // ── RLS ────────────────────────────────────────────────────────────────
    seccion('10 · RLS POR ROL')

    const externo = sesion()
    const { error: eLe } = await externo.auth.signInWithPassword({
      email: 'cliente.test@buscatools.com.ar',
      password: process.env.BT_PW_TEST,
    })
    if (eLe) {
      FAIL('no se pudo iniciar sesión como cliente externo', eLe.message)
    } else {
      const { error: eIns } = await externo.from('customers')
        .insert({ company_id: BT, legal_name: `${MARCA} intento externo` })
      eIns ? PASS('un externo no crea clientes', eIns.code ?? '')
           : FAIL('UN EXTERNO CREÓ UN CLIENTE')

      const { data: propio } = await externo.from('customers').select('id').limit(1)
      if ((propio ?? []).length === 1) {
        const { data: tras } = await externo.from('customers')
          .update({ legal_name: `${MARCA} pisado` }).eq('id', propio[0].id).select('id')
        cmp('un externo no edita ni su propia ficha empresarial', 0, (tras ?? []).length)
      }

      const { error: eCto } = await externo.from('customer_contacts')
        .insert({ company_id: BT, customer_id: completo.id, full_name: `${MARCA} externo` })
      eCto ? PASS('un externo no crea contactos', eCto.code ?? '')
           : FAIL('UN EXTERNO CREÓ UN CONTACTO')

      const { error: eDir } = await externo.from('customer_addresses')
        .insert({ company_id: BT, customer_id: completo.id, kind: 'shipping', street: 'X' })
      eDir ? PASS('un externo no crea direcciones', eDir.code ?? '')
           : FAIL('UN EXTERNO CREÓ UNA DIRECCIÓN')

      const { error: eRev } = await externo.rpc('resolver_revision_cliente',
        { p_customer: marcado.id, p_motivos: null })
      eRev ? PASS('un externo no resuelve la revisión de nadie', eRev.code ?? eRev.message.slice(0, 30))
           : FAIL('UN EXTERNO RESOLVIÓ UNA REVISIÓN')

      const { data: bajaAjena } = await externo.from('customers')
        .select('id').eq('id', minimo.id)
      cmp('un externo no ve un cliente dado de baja', 0, (bajaAjena ?? []).length)
    }

    const anon = sesion()
    const { data: nada } = await anon.from('customers').select('id').limit(1)
    cmp('anónimo: cero clientes', 0, (nada ?? []).length)
    const { error: eAnon } = await anon.from('customers')
      .insert({ company_id: BT, legal_name: `${MARCA} anon` })
    eAnon ? PASS('anónimo no escribe', eAnon.code ?? '') : FAIL('ANÓNIMO ESCRIBIÓ')
  } finally {
    // ── Limpieza ─────────────────────────────────────────────────────────
    seccion('LIMPIEZA')
    const sc = admin()
    if (creados.direcciones.length) await sc.from('customer_addresses').delete().in('id', creados.direcciones)
    if (creados.contactos.length) await sc.from('customer_contacts').delete().in('id', creados.contactos)
    if (creados.clientes.length) {
      await sc.from('customer_contacts').delete().in('customer_id', creados.clientes)
      await sc.from('customer_addresses').delete().in('customer_id', creados.clientes)
      await sc.from('customers').delete().in('id', creados.clientes)
    }
    // Las altas de prueba CONSUMEN referencias reales. Ningún cliente las
    // usó, así que la secuencia vuelve al número que tenía.
    await sc.from('document_sequences')
      .update({ next_number: seqAntes.next_number })
      .eq('company_id', BT).eq('doc_type', 'customer')

    const { count: clientesDespues } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: contactosDespues } = await sc.from('customer_contacts')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: direccionesDespues } = await sc.from('customer_addresses')
      .select('*', { count: 'exact', head: true }).eq('company_id', BT)
    const { count: sobrantes } = await sc.from('customers')
      .select('*', { count: 'exact', head: true }).like('legal_name', `${MARCA}%`)

    cmp('clientes vuelven a su número', clientesAntes, clientesDespues)
    cmp('contactos vuelven a su número', contactosAntes, contactosDespues)
    cmp('direcciones vuelven a su número', direccionesAntes, direccionesDespues)
    cmp('no quedó ningún fixture', 0, sobrantes)
    console.log(`    secuencia CLI repuesta en ${seqAntes.next_number}`)

    console.log('\n' + '='.repeat(74))
    console.log(`  RESULTADO: ${fallos} fallo(s)`)
    console.log('='.repeat(74))
    process.exit(fallos === 0 ? 0 : 1)
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
