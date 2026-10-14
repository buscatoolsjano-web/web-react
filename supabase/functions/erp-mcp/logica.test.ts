import { describe, expect, it } from 'vitest'
import {
  ALCANCE,
  desafio,
  herramientasMCP,
  metadatosDelRecurso,
  PARAMS_MAL,
  PETICION_MAL,
  resolver,
  respuestaDeHerramienta,
  SIN_METODO,
  versionAUsar,
  VERSIONES,
} from './logica'
import { EXPUESTAS } from '../erp-api/logica'

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
    expect(r.resultado['capabilities']).toEqual({ tools: { listChanged: false } })
    expect((r.resultado['serverInfo'] as { name: string }).name).toBe('erp-buscatools')
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
    for (const nombre of ['crear_cotizacion', 'inventada', '']) {
      const r = resolver({ id: 5, method: 'tools/call', params: { name: nombre } })
      expect(r.clase, nombre).toBe('error')
      expect(r.clase === 'error' && r.codigo).toBe(PARAMS_MAL)
    }
  })

  it('y tampoco una que exista pero no le toque a este cliente', () => {
    const soloCatalogo = ['buscar_productos', 'ficha_producto']
    const r = resolver(
      { id: 6, method: 'tools/call', params: { name: 'buscar_emails', arguments: {} } },
      soloCatalogo,
    )
    expect(r.clase).toBe('error')
  })
})

describe('las herramientas que se publican', () => {
  const tools = herramientasMCP()

  it('son las expuestas, con nombre, descripción y esquema', () => {
    expect(tools.map((t) => t['name'])).toEqual([...EXPUESTAS])
    for (const t of tools) {
      expect(typeof t['description']).toBe('string')
      expect((t['description'] as string).length).toBeGreaterThan(20)
      expect((t['inputSchema'] as { type: string }).type).toBe('object')
    }
  })

  /*
   * `readOnlyHint` es el equivalente de `x-openai-isConsequential`: es lo que
   * le dice a ChatGPT que una búsqueda no cambia nada. Marcarla mal significa
   * un clic por búsqueda, o —al revés, el día que entre una escritura— una
   * escritura sin confirmar.
   */
  it('todas dicen que sólo leen, porque hoy sólo leen', () => {
    for (const t of tools) {
      const a = t['annotations'] as Record<string, boolean>
      expect(a['readOnlyHint'], String(t['name'])).toBe(true)
      expect(a['destructiveHint'], String(t['name'])).toBe(false)
      expect(a['openWorldHint'], String(t['name'])).toBe(false)
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

  it('se pueden publicar sólo algunas', () => {
    const t = herramientasMCP(['buscar_productos'])
    expect(t.map((x) => x['name'])).toEqual(['buscar_productos'])
    // Y pedir una no expuesta no la publica.
    expect(herramientasMCP(['crear_cotizacion'])).toEqual([])
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
  it('no pide offline_access', () => {
    expect(META['scopes_supported']).toEqual([ALCANCE])
    expect(JSON.stringify(META)).not.toContain('offline_access')
  })

  /* Sin esta cabecera exacta, el cliente no sabe a dónde ir y no arranca nada. */
  it('el desafío dice dónde están los metadatos y qué alcance hace falta', () => {
    const h = desafio('https://p.supabase.co/functions/v1/erp-mcp/.well-known/oauth-protected-resource')
    expect(h).toContain('Bearer ')
    expect(h).toContain('resource_metadata="https://p.supabase.co/')
    expect(h).toContain(`scope="${ALCANCE}"`)
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
