import { describe, expect, it } from 'vitest'
import {
  documentoOpenAPI,
  elegirEmpresa,
  EXPUESTAS,
  gptsAArmar,
  herramientasDelGpt,
  revisarExpuestas,
  rutaDe,
} from './logica'
import { herramienta } from '../asistente/herramientas'

const doc = documentoOpenAPI('https://ejemplo.supabase.co/functions/v1/erp-api')
const paths = doc['paths'] as Record<string, Record<string, Record<string, unknown>>>

describe('el registro de lo expuesto', () => {
  /*
   * Los errores que rompen esto no fallan al desplegar: un id mal escrito da
   * un documento con una operación de menos, y el GPT nunca puede contestar
   * sobre ese tema. Por eso hay una revisión y por eso corre acá.
   */
  it('es coherente', () => {
    expect(revisarExpuestas()).toEqual([])
  })

  it('cada herramienta expuesta tiene su operación', () => {
    for (const id of EXPUESTAS) {
      expect(paths[`/h/${id}`], `falta /h/${id}`).toBeDefined()
      expect(paths[`/h/${id}`]?.['post']?.['operationId']).toBe(id)
    }
    // Y ninguna de más: el documento son las expuestas más `/yo`.
    expect(Object.keys(paths).length).toBe(EXPUESTAS.length + 1)
  })

  /*
   * ── EL TEST QUE IMPORTA ───────────────────────────────────────────────────
   *
   * La regla número uno de `herramientas.ts` es que el modelo NUNCA ve un
   * identificador: los pone el servidor desde el JWT, y por eso la RLS sigue
   * mandando. Un `company` que se escape al documento es un parámetro que el
   * GPT va a completar inventándolo, y una llamada que pide datos de otra
   * empresa.
   *
   * Se revisa sobre el documento serializado porque es exactamente lo que se
   * le entrega a OpenAI: si la palabra no está ahí, no hay forma de que la
   * mande.
   */
  it('no expone ningún identificador que ponga el servidor', () => {
    for (const [ruta, metodos] of Object.entries(paths)) {
      const esquema = metodos['post']?.['requestBody'] as
        | { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } }
        | undefined
      if (!esquema) continue
      const props = Object.keys(esquema.content['application/json'].schema.properties)
      expect(props, `${ruta} expone un identificador`).not.toContain('company')
      expect(props, `${ruta} expone un identificador`).not.toContain('usuario')
    }
    expect(JSON.stringify(doc)).not.toContain('p_company')
    expect(JSON.stringify(doc)).not.toContain('p_usuario')
  })

  it('los obligatorios del documento son los del catálogo', () => {
    for (const id of EXPUESTAS) {
      const h = herramienta(id)
      const cuerpo = paths[`/h/${id}`]?.['post']?.['requestBody'] as {
        content: { 'application/json': { schema: { required: string[] } } }
      }
      expect(cuerpo.content['application/json'].schema.required).toEqual([
        ...(h?.obligatorios ?? []),
      ])
    }
  })

  /* La empresa es opcional en todas: las seis personas de una sola empresa no
     tienen que saber que existen. */
  it('«empresa» está en todas y no es obligatoria en ninguna', () => {
    for (const id of EXPUESTAS) {
      const esquema = (
        paths[`/h/${id}`]?.['post']?.['requestBody'] as {
          content: {
            'application/json': {
              schema: { properties: Record<string, unknown>; required: string[] }
            }
          }
        }
      ).content['application/json'].schema
      expect(Object.keys(esquema.properties)).toContain('empresa')
      expect(esquema.required).not.toContain('empresa')
    }
  })
})

describe('la confirmación de ChatGPT', () => {
  /*
   * ChatGPT da por consecuente todo lo que no es GET, y una acción consecuente
   * pregunta CADA VEZ sin ofrecer «permitir siempre». Como acá todo es POST,
   * olvidarse de marcar una lectura significa un clic por búsqueda.
   *
   * `preparar_cotizacion` es el caso que más parece escritura y no lo es: arma
   * el borrador y no toca la base. Si algún día alguien la marca consecuente
   * «por si acaso», este test lo frena.
   */
  it('ninguna lectura pide confirmación', () => {
    for (const id of EXPUESTAS) {
      expect(
        paths[`/h/${id}`]?.['post']?.['x-openai-isConsequential'],
        `${id} pide confirmación`,
      ).toBe(false)
    }
    expect(paths['/yo']?.['get']?.['x-openai-isConsequential']).toBe(false)
  })
})

describe('el reparto de herramientas por GPT', () => {
  it('Ventas lleva también las de Catálogo, porque las consultaba', () => {
    const v = herramientasDelGpt('ventas')
    expect(v).toContain('preparar_cotizacion') // propia
    expect(v).toContain('buscar_productos') // de Catálogo, vía `consulta`
    // Y no lleva lo que no es suyo ni de su colega.
    expect(v).not.toContain('buscar_emails')
    expect(v).not.toContain('ranking_comercial')
  })

  it('Catálogo no lleva nada de ventas', () => {
    const c = herramientasDelGpt('catalogo')
    expect(c).toEqual(['buscar_productos', 'ficha_producto', 'resumen_catalogo', 'stock_actual'])
  })

  /*
   * `general` no es un especialista: consulta a los cinco, así que hereda
   * todo. No entra en los GPT que se arman —en ChatGPT derivar lo hace la
   * persona al elegir con quién habla—, pero su lista sigue siendo útil: es el
   * esquema completo, el que se pega si uno prefiere UN solo GPT que haga todo.
   */
  it('el derivador no es un GPT, pero su lista es la superficie entera', () => {
    expect(gptsAArmar().map((g) => g.id)).not.toContain('general')
    expect(herramientasDelGpt('general')).toEqual([...EXPUESTAS])
  })

  it('un agente que no existe no da herramientas', () => {
    expect(herramientasDelGpt('inventado')).toEqual([])
  })

  /*
   * ── LA PUERTA QUE NADIE PUEDE ABRIR ───────────────────────────────────────
   *
   * Si una herramienta está expuesta pero ningún GPT la lleva, queda una
   * puerta publicada que nadie usa: todo el costo de exponerla y ninguno de
   * los beneficios. Pasa solo, en silencio, el día que se agrega a EXPUESTAS y
   * se olvida de dársela a algún agente.
   */
  it('toda herramienta expuesta la lleva al menos un GPT', () => {
    const cubiertas = new Set(gptsAArmar().flatMap((g) => g.herramientas))
    for (const id of EXPUESTAS) {
      expect(cubiertas.has(id), `${id} está expuesta y ningún GPT la lleva`).toBe(true)
    }
  })

  it('ningún GPT queda sin herramientas', () => {
    for (const g of gptsAArmar()) {
      expect(g.herramientas.length, `${g.id} no tiene ninguna`).toBeGreaterThan(0)
    }
  })

  it('el documento filtrado trae sólo esas, y siempre /yo', () => {
    const doc = documentoOpenAPI('https://x', herramientasDelGpt('catalogo'))
    const rutas = Object.keys(doc['paths'] as Record<string, unknown>)
    expect(rutas).toContain('/yo')
    expect(rutas).toContain('/h/buscar_productos')
    expect(rutas).not.toContain('/h/buscar_emails')
    expect(rutas.length).toBe(5)
  })

  /* Un id que no está expuesto no entra por pedirlo en la lista. */
  it('el filtro no puede publicar algo que no esté expuesto', () => {
    const doc = documentoOpenAPI('https://x', ['crear_cotizacion', 'buscar_productos'])
    const rutas = Object.keys(doc['paths'] as Record<string, unknown>)
    expect(rutas).toEqual(['/yo', '/h/buscar_productos'])
  })
})

describe('con qué empresa se trabaja', () => {
  const buscatools = { companyId: 'c1', nombre: 'Buscatools S.R.L.', rol: 'admin' }
  const otra = { companyId: 'c2', nombre: 'Andina Herramientas', rol: 'vendedor' }

  it('con una sola, esa', () => {
    const r = elegirEmpresa([buscatools])
    expect(r).toEqual({ ok: true, empresa: buscatools, porDefecto: true })
  })

  /*
   * El orden es por nombre y no el de la base. La pantalla usa `membresias[0]`
   * de una consulta SIN `order by` más una preferencia guardada en el
   * navegador, que acá no existe: sin orden fijo, dos preguntas seguidas
   * podrían contestar sobre empresas distintas.
   */
  it('con varias y sin pedir ninguna, la primera por nombre', () => {
    const r = elegirEmpresa([buscatools, otra])
    const alReves = elegirEmpresa([otra, buscatools])
    expect(r.ok && r.empresa.companyId).toBe('c2')
    expect(alReves.ok && alReves.empresa.companyId).toBe('c2')
  })

  /* Un modelo escribe «Buscatools» donde la razón social dice «S.R.L.». */
  it('encuentra por nombre parcial, sin tildes y sin mayúsculas', () => {
    expect(elegirEmpresa([buscatools, otra], 'buscatools').ok).toBe(true)
    expect(elegirEmpresa([buscatools, otra], 'BUSCATOOLS S.R.L.').ok).toBe(true)
    const r = elegirEmpresa([buscatools, otra], 'andina')
    expect(r.ok && r.empresa.companyId).toBe('c2')
  })

  it('avisa cuáles son las tuyas cuando pide una que no es', () => {
    const r = elegirEmpresa([buscatools, otra], 'Mirgor')
    expect(r.ok).toBe(false)
    // Que diga las opciones importa: si no, el GPT vuelve a adivinar.
    expect(!r.ok && r.mensaje).toContain('Buscatools S.R.L.')
    expect(!r.ok && r.mensaje).toContain('Andina Herramientas')
  })

  it('sin membresías no inventa ninguna', () => {
    expect(elegirEmpresa([]).ok).toBe(false)
    expect(elegirEmpresa([], 'Buscatools').ok).toBe(false)
  })

  /* Un `empresa: ''` que manda el modelo es «no me importa», no un error. */
  it('un nombre vacío es lo mismo que no pedir nada', () => {
    const r = elegirEmpresa([buscatools, otra], '   ')
    expect(r.ok && r.porDefecto).toBe(true)
  })
})

describe('el enrutado', () => {
  const base = 'https://ejemplo.supabase.co'

  it('encuentra las tres clases de ruta', () => {
    expect(rutaDe('GET', `${base}/erp-api/openapi.json`)).toEqual({ clase: 'openapi' })
    expect(rutaDe('GET', `${base}/erp-api/yo`)).toEqual({ clase: 'yo' })
    expect(rutaDe('POST', `${base}/erp-api/h/buscar_productos`)).toEqual({
      clase: 'herramienta',
      id: 'buscar_productos',
    })
  })

  /* El prefijo con el que Supabase sirve la función cambia según de dónde
     venga la llamada. Contar segmentos se rompe; buscar el nombre, no. */
  it('aguanta los dos prefijos con los que llega', () => {
    expect(rutaDe('GET', `${base}/functions/v1/erp-api/yo`)).toEqual({ clase: 'yo' })
    expect(rutaDe('GET', '/erp-api/yo')).toEqual({ clase: 'yo' })
  })

  /*
   * Una herramienta que no está en EXPUESTAS no existe para afuera, aunque
   * exista en el catálogo. Es la diferencia entre publicar una puerta a
   * propósito y publicarla porque alguien agregó una entrada en otro archivo.
   */
  it('una herramienta no expuesta no existe', () => {
    expect(rutaDe('POST', `${base}/erp-api/h/inventada`)).toEqual({ clase: 'desconocida' })
    expect(rutaDe('POST', `${base}/erp-api/h/crear_cotizacion`)).toEqual({ clase: 'desconocida' })
  })

  it('distingue el método equivocado de la ruta inexistente', () => {
    // Importa para el status: 405 dice «probá con POST», 404 dice «no existe».
    expect(rutaDe('GET', `${base}/erp-api/h/buscar_productos`)).toEqual({ clase: 'metodo' })
    expect(rutaDe('POST', `${base}/erp-api/yo`)).toEqual({ clase: 'metodo' })
    expect(rutaDe('GET', `${base}/erp-api/`)).toEqual({ clase: 'desconocida' })
    expect(rutaDe('GET', `${base}/erp-api/h`)).toEqual({ clase: 'desconocida' })
    expect(rutaDe('GET', `${base}/erp-api/h/a/b`)).toEqual({ clase: 'desconocida' })
  })
})
