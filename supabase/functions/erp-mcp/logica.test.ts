import { describe, expect, it } from 'vitest'
import {

  desafio,
  herramientasMCP,
  metadatosDelRecurso,
  PARAMS_MAL,
  PERFIL,
  PETICION_MAL,
  resolver,
  recursoDe,
  respuestaDeHerramienta,
  SUFIJO_META,
  SIN_METODO,
  versionAUsar,
  VERSIONES,
} from './logica'
import { ESCRITURAS, EXPUESTAS } from '../erp-api/logica'
import {
  entradaDeSkill,
  INSTRUCCIONES,
  SKILL_DESCRIPCION,
  SKILL_MD,
  SKILL_NOMBRE,
  SKILL_URI,
} from './skill'

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('la versión del protocolo', () => {
  /*
   * Se le contesta la que pidió cuando la conocemos. Es lo que hace que un
   * cliente viejo siga andando el día que salga una versión nueva: si
   * contestáramos siempre la nuestra, el cliente la rechazaría.
   */
  it('le contesta la que pidió, si la conocemos', () => {
    expect(versionAUsar('2025-06-18')).toBe('2025-06-18')
    expect(versionAUsar('2025-03-26')).toBe('2025-03-26')
  })

  it('ante una desconocida, ofrece la nuestra', () => {
    expect(versionAUsar('2019-01-01')).toBe(VERSIONES[0])
    expect(versionAUsar(undefined)).toBe(VERSIONES[0])
    expect(versionAUsar(42)).toBe(VERSIONES[0])
  })
})

describe('el despachador JSON-RPC', () => {
  it('initialize se presenta y declara herramientas', () => {
    const r = resolver({ id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } })
    expect(r.clase).toBe('resultado')
    if (r.clase !== 'resultado') return
    expect(r.resultado['protocolVersion']).toBe('2026-07-28')
    expect((r.resultado['serverInfo'] as { name: string }).name).toBe('erp-buscatools')
  })

  /*
   * La extensión tiene que ir bajo `capabilities.extensions` y con ese nombre
   * exacto: la declaración experimental anterior ya no se reconoce. Sin esto,
   * «Scan Tools» importa las herramientas y NO la skill, en silencio: las
   * herramientas andan y el agente contesta peor, que es la falla que no se nota.
   */
  it('initialize declara la extensión de skills donde OpenAI la lee', () => {
    const r = resolver({ id: 1, method: 'initialize' })
    expect(r.clase === 'resultado' && r.resultado['capabilities']).toEqual({
      tools: { listChanged: false },
      extensions: { 'io.modelcontextprotocol/skills': {} },
    })
  })

  /*
   * Una notificación no se contesta NUNCA. Mandarle una respuesta a algo que
   * no tiene `id` es un error de protocolo: algunos clientes lo toleran y
   * otros cortan la conexión, que es el peor de los dos resultados porque
   * aparece sólo contra un cliente.
   */
  it('una notificación no se contesta', () => {
    expect(resolver({ method: 'notifications/initialized' }).clase).toBe('nada')
    expect(resolver({ method: 'notifications/cancelled', params: {} }).clase).toBe('nada')
    expect(resolver({ method: 'metodo/inventado' }).clase).toBe('nada')
  })

  it('un método desconocido CON id sí se contesta', () => {
    const r = resolver({ id: 7, method: 'resources/list' })
    expect(r.clase).toBe('error')
    if (r.clase !== 'error') return
    expect(r.codigo).toBe(SIN_METODO)
    expect(r.id).toBe(7)
  })

  it('sin método, si pide respuesta, es petición mal armada', () => {
    const r = resolver({ id: 1 })
    expect(r.clase === 'error' && r.codigo).toBe(PETICION_MAL)
    expect(resolver({}).clase).toBe('nada')
  })

  it('ping contesta vacío', () => {
    const r = resolver({ id: 2, method: 'ping' })
    expect(r.clase === 'resultado' && r.resultado).toEqual({})
  })

  it('tools/call devuelve la llamada a ejecutar', () => {
    const r = resolver({
      id: 3,
      method: 'tools/call',
      params: { name: 'buscar_productos', arguments: { texto: 'speedrill' } },
    })
    expect(r).toEqual({
      clase: 'llamada',
      id: 3,
      nombre: 'buscar_productos',
      argumentos: { texto: 'speedrill' },
    })
  })

  it('tools/call sin argumentos es un objeto vacío, no un error', () => {
    // `resumen_catalogo` no tiene parámetros: llamarla sin `arguments` es válido.
    const r = resolver({ id: 4, method: 'tools/call', params: { name: 'resumen_catalogo' } })
    expect(r).toEqual({ clase: 'llamada', id: 4, nombre: 'resumen_catalogo', argumentos: {} })
  })

  /*
   * Una herramienta que no está expuesta no se ejecuta, aunque exista en el
   * catálogo del asistente. Es la misma frontera que en `erp-api`: publicar
   * una puerta tiene que ser una decisión, no una consecuencia.
   */
  it('una herramienta no expuesta no se ejecuta', () => {
    for (const nombre of ['buscar_productos_x', 'inventada', '']) {
      const r = resolver({ id: 5, method: 'tools/call', params: { name: nombre } })
      expect(r.clase, nombre).toBe('error')
      expect(r.clase === 'error' && r.codigo).toBe(PARAMS_MAL)
    }
  })

  it('y tampoco una que exista pero no le toque a este cliente', () => {
    const r = resolver(
      { id: 6, method: 'tools/call', params: { name: 'buscar_emails', arguments: {} } },
      { herramientas: ['buscar_productos', 'ficha_producto'] },
    )
    expect(r.clase).toBe('error')
  })

  /* El perfil no es una RPC: lo contesta `index.ts` con la sesión. */
  it('quien_soy sale por su propio camino, no por el ejecutor', () => {
    const r = resolver({ id: 9, method: 'tools/call', params: { name: PERFIL } })
    expect(r).toEqual({ clase: 'perfil', id: 9 })
  })
})

describe('las skills', () => {
  it('skills/list devuelve una, sin cursor porque no hay más páginas', () => {
    const r = resolver({ id: 1, method: 'skills/list', params: {} }, { digestDelMd: DIGEST })
    expect(r.clase).toBe('resultado')
    if (r.clase !== 'resultado') return
    expect(r.resultado['skills']).toEqual([entradaDeSkill(DIGEST)])
    // El cursor se OMITE cuando terminó; mandar `null` es decir otra cosa.
    expect('nextCursor' in r.resultado).toBe(false)
  })

  /*
   * `skills/get` devuelve la MISMA entrada completa que `skills/list`, no una
   * reducida: OpenAI compara las dos y rechaza el import si no coinciden.
   */
  it('skills/get devuelve la entrada completa, igual que list', () => {
    const r = resolver({ id: 2, method: 'skills/get', params: { uri: SKILL_URI } }, { digestDelMd: DIGEST })
    expect(r.clase === 'resultado' && r.resultado).toEqual(entradaDeSkill(DIGEST))
  })

  it('una skill que no existe no se inventa', () => {
    const r = resolver({ id: 3, method: 'skills/get', params: { uri: 'skill://otra/x/SKILL.md' } }, { digestDelMd: DIGEST })
    expect(r.clase === 'error' && r.codigo).toBe(PARAMS_MAL)
  })

  it('sin digest no se contesta un manifiesto que OpenAI va a rechazar', () => {
    const r = resolver({ id: 4, method: 'skills/list', params: {} })
    expect(r.clase).toBe('error')
  })

  it('resources/read devuelve exactamente un item, con la URI que se pidió', () => {
    const r = resolver({ id: 5, method: 'resources/read', params: { uri: SKILL_URI } })
    expect(r.clase).toBe('resultado')
    if (r.clase !== 'resultado') return
    const contents = r.resultado['contents'] as { uri: string; text: string }[]
    expect(contents.length).toBe(1)
    expect(contents[0]?.uri).toBe(SKILL_URI)
    expect(contents[0]?.text).toBe(SKILL_MD)
  })

  it('un recurso desconocido no se sirve', () => {
    const r = resolver({ id: 6, method: 'resources/read', params: { uri: 'skill://x/y/Z.md' } })
    expect(r.clase === 'error' && r.codigo).toBe(PARAMS_MAL)
  })

  /*
   * ── EL TEST QUE EVITA UN IMPORT RECHAZADO ─────────────────────────────────
   *
   * OpenAI verifica que el front matter del SKILL.md que descarga coincida
   * EXACTAMENTE con la entrada del catálogo. Son dos lugares —la constante y
   * el encabezado del markdown— y si se despegan, el import falla con un
   * mensaje que no dice cuál de los dos está mal.
   */
  it('el front matter del archivo coincide con el catálogo', () => {
    const bloque = /^---\n([\s\S]*?)\n---\n/.exec(SKILL_MD)
    expect(bloque, 'el SKILL.md no empieza con front matter').not.toBeNull()

    const campos = new Map<string, string>()
    for (const linea of (bloque?.[1] ?? '').split('\n')) {
      const i = linea.indexOf(':')
      if (i > 0) campos.set(linea.slice(0, i).trim(), linea.slice(i + 1).trim())
    }

    const esperado = entradaDeSkill(DIGEST)['frontmatter'] as Record<string, string>
    expect(campos.get('name')).toBe(esperado['name'])
    expect(campos.get('description')).toBe(esperado['description'])
    // Y el nombre tiene que ser el de la carpeta que contiene el SKILL.md.
    expect(SKILL_URI).toContain(`/${SKILL_NOMBRE}/SKILL.md`)
    expect(esperado['description']).toBe(SKILL_DESCRIPCION)
  })

  /*
   * OpenAI pide lo más importante en los primeros 512 caracteres de
   * `instructions`, y que no se repitan las descripciones de las herramientas
   * ni se intente cambiar la personalidad del modelo. Lo que más daño evita es
   * la regla de no dar por inexistente algo que sí está, así que tiene que
   * entrar en esa ventana.
   */
  it('las instrucciones del initialize ponen lo importante primero', () => {
    expect(INSTRUCCIONES.slice(0, 512)).toMatch(/volvé a buscar con menos/i)
    // Y no son el prompt entero: eso vive en la skill.
    expect(INSTRUCCIONES.length).toBeLessThan(1200)
  })
})

describe('el contenido de la skill', () => {
  /*
   * Lo que se verifica acá no es la prosa, es que no se hayan perdido las
   * reglas que hacen que la respuesta sea VERDADERA. Cada una de éstas
   * corresponde a un error concreto que el asistente de la web cometió antes
   * de que su prompt lo prohibiera.
   */
  it('conserva las reglas que evitan contestar mal', () => {
    const casos: [string, RegExp][] = [
      ['insistir antes de decir que no hay', /no es una respuesta: es un primer intento/i],
      ['el ejemplo concreto de la búsqueda ancha', /mirgor/i],
      ['los importes a la argentina', /USD 10\.811,48/],
      ['el SKU junto al nombre', /SKU y el nombre juntos/i],
      ['costo contra precio', /el costo es lo que paga BuscaTools/i],
      ['nunca sumar monedas distintas', /nunca sumes monedas distintas/i],
      ['sin datos no es cero', /No es lo mismo que cero/i],
      ['rankear con orden=importe, no a ojo', /orden=importe/],
      ['no inventar un producto para completar una cotización', /Nunca elijas un producto parecido/i],
      ['que no se crea una cotización sin mostrar antes el borrador', /sin haber mostrado antes el borrador/i],
      ['que el borrador no crea nada', /\*\*No crea nada\.\*\*/],
      ['que un reintento no crea una segunda', /ya_existia/],
      ['el stock que importa es el disponible', /disponible/i],
      ['lo que se ve depende de los permisos', /permisos de la persona conectada/i],
      /*
       * Medido el 2026-10-14: `salesperson_id` está en null en los 534
       * documentos de venta y `created_by` en 9 de 752. Sin esta regla, un
       * «¿qué tengo pendiente?» se contesta con el total de la empresa y nadie
       * tiene cómo darse cuenta.
       */
      ['que «lo mío» no se puede contestar', /No contestes con los documentos de la empresa como si fueran suyos/i],
      ['y que los correos son la excepción', /bandeja sí guarda a quién está asignado/i],
    ]
    for (const [queEs, patron] of casos) {
      expect(SKILL_MD, `se perdió: ${queEs}`).toMatch(patron)
    }
  })

  /* Las trece herramientas tienen que estar nombradas: si una no aparece, el
     modelo no sabe que existe aunque esté en `tools/list`. */
  it('nombra todas las herramientas expuestas', () => {
    for (const id of EXPUESTAS) {
      expect(SKILL_MD, `la skill no menciona ${id}`).toContain(id)
    }
    expect(SKILL_MD).toContain(PERFIL)
  })

  /*
   * NO decide la personalidad. OpenAI pide no hacerlo desde el servidor, y
   * ChatGPT ya habla como la persona le pidió. Lo que la skill trae son las
   * reglas de verdad, no el tono.
   */
  it('no le dice al modelo cómo hablar', () => {
    expect(SKILL_MD).not.toMatch(/voseo/i)
    expect(SKILL_MD).not.toMatch(/dos o tres frases/i)
    expect(SKILL_MD).not.toMatch(/castellano rioplatense/i)
  })
})

describe('las herramientas que se publican', () => {
  const tools = herramientasMCP()

  it('son el perfil más las expuestas, con nombre, título, descripción y esquema', () => {
    expect(tools.map((t) => t['name'])).toEqual([PERFIL, ...EXPUESTAS])
    for (const t of tools) {
      expect(typeof t['description']).toBe('string')
      expect((t['description'] as string).length).toBeGreaterThan(20)
      expect((t['inputSchema'] as { type: string }).type).toBe('object')
    }
  })

  /*
   * El título es lo que ve la persona en la interfaz de ChatGPT. Está escrito
   * a mano porque derivarlo del id en castellano sale mal —`resumen_catalogo`
   * daría «Resumen catalogo», sin la tilde—, y este test es lo que impide que
   * la lista se quede corta en silencio cuando se exponga una herramienta nueva.
   */
  it('todas tienen un título legible, no el id', () => {
    for (const t of tools) {
      const titulo = t['title']
      expect(typeof titulo, String(t['name'])).toBe('string')
      expect(titulo, `${String(t['name'])} no tiene título propio`).not.toBe(t['name'])
      expect(titulo as string).not.toContain('_')
    }
  })

  /* La convención de ChatGPT para reconocer la cuenta conectada. */
  it('el perfil está marcado como perfil', () => {
    const p = tools.find((t) => t['name'] === PERFIL)
    expect(p?.['_meta']).toEqual({ 'openai/profile': true })
    // Y no pide nada: es sobre quien pregunta.
    expect((p?.['inputSchema'] as { properties: object }).properties).toEqual({})
  })

  /*
   * `readOnlyHint` es el equivalente de `x-openai-isConsequential`: es lo que
   * le dice a ChatGPT que una búsqueda no cambia nada. Marcarla mal significa
   * un clic por búsqueda, o —al revés, el día que entre una escritura— una
   * escritura sin confirmar.
   */
  it('las lecturas dicen que sólo leen', () => {
    for (const t of tools) {
      const a = t['annotations'] as Record<string, boolean>
      const nombre = String(t['name'])
      if (ESCRITURAS.has(nombre)) continue
      expect(a['readOnlyHint'], nombre).toBe(true)
      expect(a['destructiveHint'], nombre).toBe(false)
      expect(a['openWorldHint'], nombre).toBe(false)
    }
  })

  /*
   * Y el que de verdad importa: una escritura marcada como lectura es una
   * cotización creada y mandada a un cliente sin que nadie la viera. Tiene que
   * coincidir con el `x-openai-isConsequential` del OpenAPI, y por eso las dos
   * salen de `ESCRITURAS` y no de dos listas escritas a mano.
   */
  it('lo que escribe NO dice que sólo lee', () => {
    expect(ESCRITURAS.size, 'si no hay escrituras este test no prueba nada').toBeGreaterThan(0)
    for (const nombre of ESCRITURAS) {
      const t = tools.find((x) => x['name'] === nombre)
      expect(t, `${nombre} escribe y no está publicada`).toBeDefined()
      const a = t?.['annotations'] as Record<string, boolean>
      expect(a['readOnlyHint'], nombre).toBe(false)
      // Crear no es destructivo: agrega un documento, no pisa ni borra nada.
      expect(a['destructiveHint'], nombre).toBe(false)
    }
  })

  /* La regla número uno: el modelo nunca ve un identificador. */
  it('ningún esquema pide un identificador del servidor', () => {
    for (const t of tools) {
      const props = Object.keys(
        (t['inputSchema'] as { properties: Record<string, unknown> }).properties,
      )
      expect(props, String(t['name'])).not.toContain('company')
      expect(props, String(t['name'])).not.toContain('usuario')
    }
    expect(JSON.stringify(tools)).not.toContain('p_company')
  })

  it('se pueden publicar sólo algunas, y el perfil va siempre', () => {
    expect(herramientasMCP(['buscar_productos']).map((x) => x['name'])).toEqual([
      PERFIL,
      'buscar_productos',
    ])
    // Y pedir una que no existe no la publica.
    expect(herramientasMCP(['inventada']).map((x) => x['name'])).toEqual([PERFIL])
  })
})

describe('el descubrimiento de la autorización', () => {
  const META = metadatosDelRecurso(
    'https://p.supabase.co/functions/v1/erp-mcp',
    'https://p.supabase.co',
  )

  it('apunta al servidor de autorización de Supabase', () => {
    expect(META['authorization_servers']).toEqual(['https://p.supabase.co/auth/v1'])
    expect(META['resource']).toBe('https://p.supabase.co/functions/v1/erp-mcp')
  })

  /*
   * El spec dice que un recurso protegido NO debería pedir `offline_access`:
   * un refresh token es un requisito del CLIENTE, no del recurso. Que ChatGPT
   * pueda renovar depende de que Supabase lo anuncie en sus propios
   * metadatos, y eso no se arregla desde acá.
   */
  /*
   * ── NO DECLARA NINGÚN ALCANCE, Y ESO ESTÁ MEDIDO ──────────────────────────
   *
   * Declaraba `scopes_supported: ['erp']` y rompía el flujo: los alcances que
   * acepta Supabase son openid, profile, email, phone y offline_access, y uno
   * propio devuelve `unsupported scope: erp` antes de llegar al
   * consentimiento. Sin alcance declarado el cliente omite el parámetro —el
   * spec lo dice— y la autorización pasa.
   *
   * `offline_access` tampoco: el spec dice que un recurso protegido no debería
   * pedirlo, porque un refresh token es un requisito del cliente.
   */
  it('no declara alcances, que es lo que hace que la autorización pase', () => {
    expect('scopes_supported' in META).toBe(false)
    expect(JSON.stringify(META)).not.toContain('erp"')
    expect(JSON.stringify(META)).not.toContain('offline_access')
  })

  /*
   * ── EL BUG QUE SE VIO CONTRA LO DESPLEGADO ───────────────────────────────
   *
   * El gateway de Supabase consume `/functions/v1` antes de llamar a la
   * función, así que el `pathname` que llega es `/erp-mcp/…`. La primera
   * versión reconstruía la URL externa con origen + pathname y publicaba
   * `https://proyecto.supabase.co/erp-mcp`, que no existe. El token se emite
   * PARA un recurso y un cliente estricto compara: habría sido un 401 en
   * bucle, sin nada en pantalla que dijera por qué.
   */
  it('le devuelve el /functions/v1 que el gateway se comió', () => {
    expect(recursoDe('https://p.supabase.co', '/erp-mcp')).toBe(
      'https://p.supabase.co/functions/v1/erp-mcp',
    )
  })

  /*
   * ChatGPT pide «la URL del servidor MCP, incluyendo el path /mcp». Acá el
   * servidor es la función entera, así que las dos formas tienen que andar y
   * cada una declararse a sí misma.
   */
  it('cada forma de conectarse se declara a sí misma', () => {
    expect(recursoDe('https://p.supabase.co', '/erp-mcp/mcp')).toBe(
      'https://p.supabase.co/functions/v1/erp-mcp/mcp',
    )
    // Y los metadatos de cada una devuelven su propio recurso.
    expect(recursoDe('https://p.supabase.co', `/erp-mcp/mcp${SUFIJO_META}`)).toBe(
      'https://p.supabase.co/functions/v1/erp-mcp/mcp',
    )
  })

  it('no duplica el prefijo si ya viene puesto', () => {
    expect(recursoDe('https://p.supabase.co', '/functions/v1/erp-mcp')).toBe(
      'https://p.supabase.co/functions/v1/erp-mcp',
    )
  })

  it('aguanta la barra final y la barra de más en la base', () => {
    expect(recursoDe('https://p.supabase.co/', '/erp-mcp/')).toBe(
      'https://p.supabase.co/functions/v1/erp-mcp',
    )
  })

  /* Sin esta cabecera exacta, el cliente no sabe a dónde ir y no arranca nada. */
  it('el desafío dice dónde están los metadatos, y nada más', () => {
    const h = desafio('https://p.supabase.co/functions/v1/erp-mcp/.well-known/oauth-protected-resource')
    expect(h).toBe(
      'Bearer resource_metadata="https://p.supabase.co/functions/v1/erp-mcp/.well-known/oauth-protected-resource"',
    )
    // Y sobre todo: sin `scope`, que es lo que Supabase rechazaba.
    expect(h).not.toContain('scope=')
  })
})

describe('la respuesta de una herramienta', () => {
  it('un resultado normal no es error', () => {
    const r = respuestaDeHerramienta(1, '{"productos":[{"sku":"SP.PH2"}]}')
    const res = r['result'] as { content: { text: string }[]; isError: boolean }
    expect(res.isError).toBe(false)
    expect(res.content[0]?.text).toBe('{"productos":[{"sku":"SP.PH2"}]}')
  })

  /*
   * El ejecutor devuelve `{"error": "..."}` con una INSTRUCCIÓN para el modelo
   * adentro. Si no se marca como error, el cliente se la pasa a la persona
   * como si fueran datos, y en vez de reintentar se muestra «error» en
   * pantalla.
   */
  it('un problema del ejecutor se marca como error', () => {
    const r = respuestaDeHerramienta(1, '{"error":"Te faltó completar: texto."}')
    expect((r['result'] as { isError: boolean }).isError).toBe(true)
  })

  it('algo que no es JSON no revienta', () => {
    const r = respuestaDeHerramienta(1, 'no soy json')
    expect((r['result'] as { isError: boolean }).isError).toBe(false)
  })
})
