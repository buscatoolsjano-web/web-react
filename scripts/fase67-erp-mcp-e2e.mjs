/**
 * Fase 67 · servidor MCP del ERP: prueba de punta a punta contra lo desplegado.
 *
 *   set -a; . ./.env; set +a
 *   node scripts/fase67-erp-mcp-e2e.mjs
 *
 * `erp-mcp` va SIN el `verify_jwt` del gateway, porque el protocolo exige que
 * el servidor conteste él mismo el 401 con la cabecera que dice dónde están sus
 * metadatos. Esta prueba existe sobre todo por eso: una función sin el gateway
 * delante es una que se tiene que defender sola, y lo que acá se verifica es
 * que lo haga.
 *
 * Lo que necesita una persona de verdad corre sólo si está `ERP_API_TOKEN`:
 *
 *   1. Entrá a la app y logueate.
 *   2. En la consola del navegador:
 *      JSON.parse(Object.entries(localStorage).find(([k]) => k.includes('auth-token'))[1]).access_token
 *   3. Exportalo como ERP_API_TOKEN. Dura una hora.
 *
 * El token no se imprime nunca.
 */
const BASE = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const TOKEN = process.env.ERP_API_TOKEN ?? ''

if (!BASE || !ANON) {
  console.error('✗ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const URL_FN = `${BASE.replace(/\/+$/, '')}/functions/v1/erp-mcp`

let fallos = 0
const cmp = (t, esperado, real) => {
  if (String(esperado) === String(real)) console.log(`    PASS  ${t} — ${real}`)
  else {
    fallos++
    console.log(`    FAIL  ${t} — esperaba ${esperado}, dio ${real}`)
  }
}

/** Una llamada JSON-RPC. `token: null` para no mandar ninguna cabecera. */
const rpc = (metodo, params, { token = ANON, id = 1 } = {}) =>
  fetch(URL_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(id === null ? {} : { id }),
      method: metodo,
      ...(params === undefined ? {} : { params }),
    }),
  })

async function main() {
  console.log('='.repeat(78))
  console.log('  FASE 67 · erp-mcp — punta a punta contra lo desplegado')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(78))

  /*
   * ── EL DESCUBRIMIENTO ─────────────────────────────────────────────────────
   *
   * Sin estos dos pasos no hay nada: el cliente pide, recibe un 401, lee de la
   * cabecera dónde están los metadatos, y de ahí saca a qué servidor de
   * autorización ir. Si la cabecera no está o apunta mal, ChatGPT no puede ni
   * empezar, y el síntoma es «no se pudo conectar» sin más detalle.
   */
  console.log('\n  El descubrimiento de la autorización')
  const meta = await fetch(`${URL_FN}/.well-known/oauth-protected-resource`)
  cmp('los metadatos se leen SIN sesión: 200', 200, meta.status)
  const m = await meta.json()
  cmp('el recurso es esta función', URL_FN, m.resource)
  cmp('autoriza el proyecto de Supabase', `${BASE.replace(/\/+$/, '')}/auth/v1`, m.authorization_servers?.[0])
  // El spec dice que un recurso protegido NO debe pedir offline_access: es un
  // requisito del cliente, no del recurso.
  cmp('no pide offline_access', false, JSON.stringify(m).includes('offline_access'))

  const sinToken = await rpc('initialize', { protocolVersion: '2026-07-28' }, { token: null })
  cmp('sin token: 401', 401, sinToken.status)
  const desafio = sinToken.headers.get('www-authenticate') ?? ''
  cmp('el 401 trae WWW-Authenticate', true, desafio.startsWith('Bearer '))
  cmp('y dice dónde están los metadatos', true, desafio.includes(`resource_metadata="${URL_FN}/`))
  cmp('y qué alcance hace falta', true, desafio.includes('scope="erp"'))

  /*
   * LA QUE MÁS IMPORTA. Esta función no tiene el gateway delante, así que si
   * la clave anónima —que es pública, está en el bundle de la web— alcanzara
   * para listar las herramientas o leer una fila, la puerta quedaría abierta
   * para cualquiera que mire el código fuente.
   */
  console.log('\n  La clave anónima no es una sesión')
  for (const metodo of ['initialize', 'tools/list', 'ping']) {
    cmp(`${metodo} con la anon: 401`, 401, (await rpc(metodo)).status)
  }
  cmp(
    'tools/call con la anon: 401',
    401,
    (await rpc('tools/call', { name: 'buscar_productos', arguments: { texto: 'x' } })).status,
  )

  console.log('\n  El transporte')
  // No abrimos canal de eventos: el servidor no manda nada por su cuenta.
  cmp('GET: 405', 405, (await fetch(URL_FN)).status)
  cmp('PUT: 405', 405, (await fetch(URL_FN, { method: 'PUT' })).status)

  if (TOKEN === '') {
    console.log('\n  (Sin ERP_API_TOKEN: me salto lo que necesita una persona de verdad.)')
  } else {
    console.log('\n  Con un usuario de verdad')

    const ini = await rpc('initialize', { protocolVersion: '2026-07-28' }, { token: TOKEN })
    cmp('initialize: 200', 200, ini.status)
    const r = await ini.json()
    cmp('contesta la versión que pedí', '2026-07-28', r.result?.protocolVersion)
    cmp('declara herramientas', true, !!r.result?.capabilities?.tools)
    cmp('se presenta', 'erp-buscatools', r.result?.serverInfo?.name)

    // Una versión que no conocemos: se ofrece la nuestra, no se rompe.
    const vieja = await rpc('initialize', { protocolVersion: '2019-01-01' }, { token: TOKEN })
    cmp('ante una versión desconocida ofrece la suya', '2026-07-28', (await vieja.json()).result?.protocolVersion)

    const lista = await (await rpc('tools/list', undefined, { token: TOKEN })).json()
    const tools = lista.result?.tools ?? []
    cmp('tools/list trae el perfil más las trece', 14, tools.length)
    cmp('todas dicen que sólo leen', true, tools.every((t) => t.annotations?.readOnlyHint === true))
    cmp('todas tienen título legible', true, tools.every((t) => t.title && !t.title.includes('_')))
    cmp('ninguna pide un identificador', true,
      tools.every((t) => !('company' in (t.inputSchema?.properties ?? {}))))
    // La convención con la que ChatGPT reconoce la cuenta conectada.
    const perfil = tools.find((t) => t.name === 'quien_soy')
    cmp('el perfil está marcado', true, perfil?._meta?.['openai/profile'] === true)

    /*
     * ── LA SKILL ──────────────────────────────────────────────────────────
     *
     * Es donde viven los prompts. Si el servidor no declara la extensión o el
     * digest no coincide con el archivo, "Scan Tools" importa las herramientas
     * y NO la skill, EN SILENCIO: el agente funciona y contesta peor. Por eso
     * esto se verifica acá y no se confía en que ande.
     */
    console.log('\n  La skill')
    cmp('initialize declara la extensión', true,
      !!r.result?.capabilities?.extensions?.['io.modelcontextprotocol/skills'])
    cmp('instructions pone lo importante primero', true,
      /volvé a buscar con menos/i.test((r.result?.instructions ?? '').slice(0, 512)))

    const skills = await (await rpc('skills/list', {}, { token: TOKEN })).json()
    const skill = skills.result?.skills?.[0]
    cmp('skills/list devuelve una', 1, skills.result?.skills?.length)
    cmp('con el nombre en el front matter', 'erp-buscatools', skill?.frontmatter?.name)
    cmp('y una descripción', true, (skill?.frontmatter?.description ?? '').length > 40)

    const uri = skill?.resources?.[0]?.uri
    const leido = await (await rpc('resources/read', { uri }, { token: TOKEN })).json()
    const texto = leido.result?.contents?.[0]?.text ?? ''
    cmp('resources/read devuelve un solo item', 1, leido.result?.contents?.length)
    cmp('y es el SKILL.md', true, texto.startsWith('---\nname: erp-buscatools'))

    /* El digest declarado tiene que ser el del archivo servido: es lo que
       OpenAI verifica, y si no coincide rechaza el import entero. */
    const { createHash } = await import('node:crypto')
    const real = `sha256:${createHash('sha256').update(texto, 'utf8').digest('hex')}`
    cmp('el digest coincide con el archivo', skill?.resources?.[0]?.digest, real)

    /* Que no se hayan perdido las reglas que evitan contestar mal. */
    for (const [queEs, patron] of [
      ['insistir antes de decir que no hay', /no es una respuesta: es un primer intento/i],
      ['los importes a la argentina', /USD 10\.811,48/],
      ['costo contra precio', /el costo es lo que paga BuscaTools/i],
      ['nunca sumar monedas', /nunca sumes monedas distintas/i],
    ]) {
      cmp(`la skill conserva: ${queEs}`, true, patron.test(texto))
    }

    console.log('\n  El perfil')
    const yo = await (await rpc('tools/call', { name: 'quien_soy', arguments: {} }, { token: TOKEN })).json()
    const datos = JSON.parse(yo.result?.content?.[0]?.text ?? '{}')
    console.log(`          sos «${datos.nombre}» en «${datos.empresa}»`)
    cmp('dice quién sos', true, typeof datos.nombre === 'string' && datos.nombre.length > 0)
    cmp('y marca una empresa por defecto', 1,
      (datos.empresas ?? []).filter((e) => e.porDefecto).length)

    /* Una notificación no se contesta: 202 y nada de cuerpo. */
    const noti = await rpc('notifications/initialized', undefined, { token: TOKEN, id: null })
    cmp('una notificación: 202', 202, noti.status)
    cmp('y sin cuerpo', 0, (await noti.text()).length)

    /* Un método que no existe se contesta con el código de JSON-RPC, no con un 500. */
    const noExiste = await (await rpc('resources/list', undefined, { token: TOKEN })).json()
    cmp('método desconocido: -32601', -32601, noExiste.error?.code)

    /* Una herramienta no expuesta no se ejecuta aunque exista en el catálogo. */
    const vedada = await (
      await rpc('tools/call', { name: 'crear_cotizacion', arguments: {} }, { token: TOKEN })
    ).json()
    cmp('una herramienta no expuesta: -32602', -32602, vedada.error?.code)

    console.log('\n  Una herramienta de verdad')
    const llamada = await (
      await rpc(
        'tools/call',
        { name: 'buscar_productos', arguments: { texto: 'speedrill', limite: 3 } },
        { token: TOKEN },
      )
    ).json()
    cmp('tools/call: sin error', undefined, llamada.error?.code)
    cmp('no viene marcada como error', false, llamada.result?.isError)
    const texto = llamada.result?.content?.[0]?.text ?? '{}'
    const datos = JSON.parse(texto)
    cmp('devuelve productos', true, Array.isArray(datos.productos) && datos.productos.length > 0)
    cmp('y ninguno sin SKU', true, (datos.productos ?? []).every((p) => !!p.sku))

    /*
     * Un obligatorio que falta tiene que volver MARCADO como error, porque es
     * una instrucción para el modelo. Si no se marca, el cliente se la pasa a
     * la persona como si fueran datos.
     */
    const incompleta = await (
      await rpc('tools/call', { name: 'buscar_productos', arguments: {} }, { token: TOKEN })
    ).json()
    cmp('falta un obligatorio: isError', true, incompleta.result?.isError)
    cmp('y dice qué faltó', true,
      String(incompleta.result?.content?.[0]?.text ?? '').includes('texto'))

    /* Una empresa que no es tuya no se puede elegir nombrándola. */
    const ajena = await (
      await rpc(
        'tools/call',
        { name: 'resumen_catalogo', arguments: { empresa: 'Mirgor S.A.' } },
        { token: TOKEN },
      )
    ).json()
    cmp('una empresa ajena: -32602', -32602, ajena.error?.code)
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
