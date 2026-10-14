/**
 * Fase 67 · ERP API para ChatGPT: prueba de punta a punta contra lo desplegado.
 *
 *   set -a; . ./.env; set +a
 *   node scripts/fase67-erp-api-e2e.mjs
 *
 * Verifica la Edge Function `erp-api` ya desplegada: el enrutado, que la clave
 * anónima NO alcance para leer nada, y que el documento OpenAPI que sirve sea
 * el mismo que generan los archivos de `docs/fase67-chatgpt/`.
 *
 * ── Las dos mitades ─────────────────────────────────────────────────────────
 *
 * Lo que se puede probar sin ser nadie corre siempre. Lo que necesita una
 * persona de verdad —que la RLS deje ver lo suyo y nada más— necesita un token
 * de usuario, y corre sólo si está `ERP_API_TOKEN` en el entorno:
 *
 *   1. Entrá a la app y logueate.
 *   2. En la consola del navegador:
 *      JSON.parse(localStorage.getItem('bt-auth')).access_token
 *
 *   La clave es 'bt-auth', NO la de por omisión de Supabase: este proyecto la
 *   renombra en services/supabase/client.ts. Buscarla por el texto
 *   «auth-token» no encuentra nada y tira un TypeError que no dice por qué.
 *   3. Exportalo como ERP_API_TOKEN. Dura una hora.
 *
 * El token no se imprime nunca, ni entero ni cortado.
 */
const BASE = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const TOKEN = process.env.ERP_API_TOKEN ?? ''

if (!BASE || !ANON) {
  console.error('✗ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const URL_FN = `${BASE.replace(/\/+$/, '')}/functions/v1/erp-api`

let fallos = 0
const cmp = (t, esperado, real) => {
  if (String(esperado) === String(real)) console.log(`    PASS  ${t} — ${real}`)
  else {
    fallos++
    console.log(`    FAIL  ${t} — esperaba ${esperado}, dio ${real}`)
  }
}

const pedir = (ruta, { token = ANON, metodo = 'GET', cuerpo } = {}) =>
  fetch(`${URL_FN}${ruta}`, {
    method: metodo,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  })

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 67 · erp-api — punta a punta contra lo desplegado')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  console.log('\n  El enrutado')
  cmp('sin ninguna cabecera: 401', 401, (await pedir('/openapi.json', { token: null })).status)
  cmp('ruta inexistente: 404', 404, (await pedir('/nada')).status)
  cmp('herramienta inventada: 404', 404, (await pedir('/h/inventada', { metodo: 'POST' })).status)
  cmp('método equivocado en /yo: 405', 405, (await pedir('/yo', { metodo: 'POST' })).status)

  /*
   * LA QUE MÁS IMPORTA DE ESTE BLOQUE. La clave anónima es pública: está en el
   * bundle que sirve la web. Si con ella se pudiera leer una sola fila, la API
   * entera estaría abierta a cualquiera que abra el código fuente.
   */
  console.log('\n  La clave anónima no es una sesión')
  cmp('/yo con la anon: 401', 401, (await pedir('/yo')).status)
  cmp(
    'buscar_productos con la anon: 401',
    401,
    (await pedir('/h/buscar_productos', { metodo: 'POST', cuerpo: { texto: 'speedrill' } })).status,
  )

  /*
   * Una herramienta que NO está en EXPUESTAS no existe para afuera, aunque
   * exista en el catálogo del asistente. Es la diferencia entre publicar una
   * puerta a propósito y publicarla porque alguien tocó otro archivo.
   */
  cmp(
    'una herramienta inventada no existe: 404',
    404,
    (await pedir('/h/buscar_productos_x', { metodo: 'POST', cuerpo: {} })).status,
  )

  console.log('\n  El documento OpenAPI')
  const r = await pedir('/openapi.json')
  cmp('se sirve con sesión: 200', 200, r.status)
  const doc = await r.json()
  cmp('es OpenAPI 3.1', '3.1.0', doc.openapi)
  cmp('el servidor apunta a esta función', URL_FN, doc.servers?.[0]?.url)
  cmp('trae /yo', true, Object.keys(doc.paths ?? {}).includes('/yo'))

  // Que no se escape un identificador que pone el servidor. Mismo chequeo que
  // el test puro, pero sobre lo que REALMENTE está desplegado.
  const texto = JSON.stringify(doc)
  cmp('no menciona p_company', false, texto.includes('p_company'))
  cmp('no menciona p_usuario', false, texto.includes('p_usuario'))
  const conIdentificador = Object.entries(doc.paths ?? {}).filter(([, m]) => {
    const props =
      m.post?.requestBody?.content?.['application/json']?.schema?.properties ?? {}
    return 'company' in props || 'usuario' in props
  })
  cmp('ninguna operación pide un identificador', 0, conIdentificador.length)

  /*
   * Las lecturas no pueden pedir confirmación —sería un clic por búsqueda— y
   * lo que escribe TIENE que pedirla: una cotización creada sin que nadie la
   * viera es la falla que importa. Se compara la lista completa de las dos
   * cosas de una vez, así que agregar una escritura sin marcarla rompe acá.
   */
  const pidenConfirmacion = Object.entries(doc.paths ?? {})
    .filter(([, m]) => m.post?.['x-openai-isConsequential'] === true)
    .map(([ruta]) => ruta)
    .sort()
  cmp('sólo lo que escribe pide confirmación', '/h/crear_cotizacion', pidenConfirmacion.join(','))

  if (TOKEN === '') {
    console.log('\n  (Sin ERP_API_TOKEN: me salto lo que necesita una persona de verdad.)')
  } else {
    console.log('\n  Con un usuario de verdad')
    const yo = await pedir('/yo', { token: TOKEN })
    cmp('/yo: 200', 200, yo.status)
    const quien = await yo.json()
    console.log(`          sos «${quien.nombre}» en «${quien.empresa}»`)
    cmp('dice quién sos', true, typeof quien.nombre === 'string' && quien.nombre.length > 0)
    cmp('dice en qué empresa', true, typeof quien.empresa === 'string' && quien.empresa.length > 0)
    cmp('marca una por defecto', 1, (quien.empresas ?? []).filter((e) => e.porDefecto).length)

    const busca = await pedir('/h/buscar_productos', {
      token: TOKEN,
      metodo: 'POST',
      cuerpo: { texto: 'speedrill', limite: 3 },
    })
    cmp('buscar_productos: 200', 200, busca.status)
    const datos = await busca.json()
    cmp('devuelve productos', true, Array.isArray(datos.productos) && datos.productos.length > 0)
    cmp('y ninguno viene sin SKU', true, (datos.productos ?? []).every((p) => !!p.sku))

    // Una empresa que no es tuya no se puede elegir nombrándola.
    const ajena = await pedir('/h/resumen_catalogo', {
      token: TOKEN,
      metodo: 'POST',
      cuerpo: { empresa: 'Mirgor S.A.' },
    })
    cmp('una empresa ajena: 403', 403, ajena.status)

    // Un obligatorio que falta tiene que volver como instrucción, no como 500.
    const sinTexto = await pedir('/h/buscar_productos', {
      token: TOKEN,
      metodo: 'POST',
      cuerpo: {},
    })
    cmp('falta un obligatorio: 200 con error legible', 200, sinTexto.status)
    cmp('y dice qué faltó', true, String((await sinTexto.json()).error ?? '').includes('texto'))
  }

  console.log('\n' + '='.repeat(78))
  console.log(fallos === 0 ? '  TODO BIEN' : `  ${fallos} FALLO(S)`)
  console.log('='.repeat(78))
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
