/**
 * Ejecutar una herramienta contra la base. SÓLO servidor (Deno) — Fase 31 · E3.
 *
 * Acá está la frontera de seguridad del asistente entero, y es una sola idea:
 * **se llama con el JWT de la persona que pregunta**, nunca con la clave de
 * servicio. Por eso las RPC son SECURITY INVOKER y por eso la RLS alcanza: un
 * agente no puede leer nada que su usuario no pueda leer, y eso no depende de
 * que yo me acuerde de filtrar en cada herramienta.
 *
 * El modelo tampoco elige contra qué corre: el nombre que manda se busca en el
 * catálogo y, si no está, no se ejecuta nada. No hay forma de que una llamada
 * inventada llegue a la base.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import { clasificarFallo, instruccionParaElModelo } from './errores.ts'
import { herramienta } from './herramientas.ts'

export interface Contexto {
  /** El token del usuario, tal como llegó en la cabecera. */
  token: string
  companyId: string
  userId: string
}

/**
 * Lo que se le devuelve al modelo cuando algo sale mal.
 *
 * Siempre TEXTO y siempre en castellano: el modelo lo lee y decide qué hacer.
 * Un error de base de datos crudo no le dice nada y termina en una disculpa
 * genérica hacia la persona.
 */
const problema = (texto: string): string => JSON.stringify({ error: texto })

/** Cuántos caracteres de resultado se le pasan al modelo, como mucho. */
const MAX_TEXTO = 12_000

/**
 * Lo que una herramienta dejó para la pantalla, además del texto.
 *
 * El borrador de cotización viaja acá y NO metido en la prosa del modelo. Si
 * la pantalla tuviera que sacarlo del texto, haría falta que el modelo
 * escribiera un formato exacto todas las veces, que es la clase de cosa que
 * funciona en las pruebas y falla en producción. La web vieja lo hacía así,
 * con bloques `:::ACCION:::` y una expresión regular.
 */
export interface Bandeja {
  propuesta: unknown | null
  /**
   * Los productos que se nombraron, para dibujarlos como tarjetas con sus
   * botones (Fase 40).
   *
   * MISMO PRINCIPIO QUE EL BORRADOR: viajan como DATOS, no sacados de la prosa
   * del modelo. Si la pantalla tuviera que leer «SP.PH2 — SPEEDRILL: USD 1,81;
   * stock 400» de un texto, haría falta que el modelo escribiera un formato
   * exacto todas las veces, que es la clase de cosa que anda en las pruebas y
   * falla en producción. La web vieja lo hacía así, con expresiones regulares.
   */
  productos: ProductoNombrado[]
  /**
   * Y los correos, por lo mismo y con una razón más (Fase 69).
   *
   * Un listado de correos en prosa es lo más inútil que puede devolver el
   * asistente: nueve renglones de «remitente — asunto — fecha» que hay que
   * leer enteros para después ir a buscar el correo a mano. Con la tarjeta,
   * cada uno tiene su botón y se abre de un clic.
   */
  correos: CorreoNombrado[]
}

/** Lo mínimo para dibujar una tarjeta y poder actuar sobre ella. */
export interface ProductoNombrado {
  sku: string
  nombre: string
  precio: number | null
  moneda: string | null
  disponible: number | null
}

/**
 * Lo mínimo para dibujar la tarjeta de un correo y poder abrirlo.
 *
 * El `id` es el del hilo, que es lo que la pantalla necesita para enlazar.
 * NO se lo mostramos a quien pregunta —un uuid no le dice nada— ni se le pide
 * al modelo que lo escriba: viaja por acá, por afuera del texto.
 */
export interface CorreoNombrado {
  id: string
  asunto: string
  de: string | null
  fecha: string | null
  sinLeer: boolean
  adjuntos: boolean
  asignadoA: string | null
  cliente: string | null
}

/** Un número que puede venir como texto —`numeric` de Postgres— o faltar. */
function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Saca los productos de lo que devolvió una herramienta.
 *
 * `buscar_productos` los pone en `productos` y `stock` en `stock`, con nombres
 * de campo distintos para el saldo. Se normalizan acá, una vez, en vez de que
 * la pantalla conozca las dos formas.
 *
 * Se acumulan entre herramientas y SIN REPETIR: una consulta puede buscar por
 * nombre y después pedir el stock de uno de los resultados, y ese producto no
 * tiene que aparecer dos veces. Gana la primera aparición, que es la que trae
 * el precio.
 */
function cosecharProductos(datos: unknown, acumulado: ProductoNombrado[]): void {
  if (typeof datos !== 'object' || datos === null) return
  const d = datos as Record<string, unknown>
  const filas = [
    ...(Array.isArray(d['productos']) ? d['productos'] : []),
    ...(Array.isArray(d['stock']) ? d['stock'] : []),
  ]
  for (const f of filas) {
    if (typeof f !== 'object' || f === null) continue
    const p = f as Record<string, unknown>
    const sku = typeof p['sku'] === 'string' ? p['sku'] : null
    if (sku === null || acumulado.some((x) => x.sku === sku)) continue
    acumulado.push({
      sku,
      nombre: typeof p['nombre'] === 'string' ? p['nombre'] : sku,
      precio: aNumero(p['precio']),
      moneda: typeof p['moneda'] === 'string' ? p['moneda'] : null,
      disponible: aNumero(p['disponible']),
    })
  }
}

/**
 * Deja sólo los productos con disponible mayor a cero (Fase 166).
 *
 * Es el filtro de «con stock»: cuando la persona lo pide explícitamente, los que
 * están en cero no van ni al texto del modelo ni a las tarjetas. Se descartan
 * también los que no traen `disponible` (desconocido no es «con stock»). Lo demás
 * del resultado —el conteo, el aviso de recorte— se conserva.
 */
function soloConStock(datos: unknown): unknown {
  if (typeof datos !== 'object' || datos === null) return datos
  const d = datos as Record<string, unknown>
  if (!Array.isArray(d['productos'])) return datos
  const conStock = d['productos'].filter((f) => {
    if (typeof f !== 'object' || f === null) return false
    const disp = aNumero((f as Record<string, unknown>)['disponible'])
    return disp !== null && disp > 0
  })
  return { ...d, productos: conStock }
}

/**
 * Saca los correos de lo que devolvió `buscar_emails`.
 *
 * Una fila sin `id` se descarta: sin él la tarjeta no puede abrir nada, y una
 * tarjeta con un botón que no lleva a ningún lado es peor que un renglón de
 * texto. Sin repetir, igual que los productos: una consulta puede buscar dos
 * veces —ancha después de angosta— y el mismo hilo volvería en las dos.
 */
function cosecharCorreos(datos: unknown, acumulado: CorreoNombrado[]): void {
  if (typeof datos !== 'object' || datos === null) return
  const d = datos as Record<string, unknown>
  if (!Array.isArray(d['correos'])) return
  for (const f of d['correos']) {
    if (typeof f !== 'object' || f === null) continue
    const c = f as Record<string, unknown>
    const id = typeof c['id'] === 'string' ? c['id'] : null
    if (id === null || acumulado.some((x) => x.id === id)) continue
    const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
    acumulado.push({
      id,
      // «(sin asunto)» y no vacío: la tarjeta tiene que decir algo donde va el
      // asunto, y un hueco se lee como que la pantalla se rompió.
      asunto: texto(c['asunto']) ?? '(sin asunto)',
      de: texto(c['de']),
      fecha: texto(c['fecha']),
      sinLeer: c['sin_leer'] === true,
      adjuntos: c['adjuntos'] === true,
      asignadoA: texto(c['asignado_a']),
      cliente: texto(c['cliente']),
    })
  }
}

/** Cuántas tarjetas se mandan como mucho. Más que esto es una lista, no un atajo. */
const MAX_PRODUCTOS = 12

/**
 * Los correos toleran más que los productos.
 *
 * Una tarjeta de correo es un renglón alto; una de producto trae foto, precio
 * y dos botones. Y la pregunta típica —«¿qué quedó sin responder?»— espera una
 * bandeja, no tres ejemplos. La herramienta trae 25 como mucho.
 */
const MAX_CORREOS = 25

export function crearEjecutor(ctx: Contexto, bandeja?: Bandeja) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${ctx.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  return async function ejecutar(
    nombre: string,
    argumentos: Record<string, unknown>,
  ): Promise<string> {
    const h = herramienta(nombre)
    if (!h) return problema(`No existe la herramienta «${nombre}».`)

    /**
     * Los parámetros: los del modelo con el prefijo `p_`, y los fijos desde el
     * contexto. El modelo NUNCA manda un identificador; si intentara mandar
     * `p_company`, no llegaría, porque sólo se copian los parámetros
     * declarados en el esquema de la herramienta.
     */
    const params: Record<string, unknown> = {}
    for (const clave of Object.keys(h.parametros)) {
      // `solo_con_stock` es un filtro de pantalla, no una columna de la RPC: se
      // aplica acá sobre el resultado, no se manda a la base (Fase 166).
      if (clave === 'solo_con_stock') continue
      const v = argumentos[clave]
      if (v !== undefined && v !== null && v !== '') params[`p_${clave}`] = v
    }
    for (const fijo of h.fijos ?? []) {
      if (fijo === 'company') params['p_company'] = ctx.companyId
      if (fijo === 'usuario') params['p_usuario'] = ctx.userId
    }

    const faltan = h.obligatorios.filter((o) => params[`p_${o}`] === undefined)
    if (faltan.length > 0) {
      return problema(`Te faltó completar: ${faltan.join(', ')}. Volvé a llamarme con eso.`)
    }

    let datos: unknown
    try {
      const r = await supabase.rpc(h.rpc, params)
      if (r.error) {
        const codigo = (r.error as { code?: string }).code ?? null

        /*
         * El mensaje crudo va al LOG, no al modelo.
         *
         * Al modelo no le sirve «column order_number does not exist» y además
         * es información de adentro. Pero a quien mantiene esto le sirve
         * muchísimo: es la diferencia entre enterarse de que una herramienta
         * está rota y que el agente la siga llamando en silencio durante
         * semanas. Va con el nombre y el código para poder buscarlo.
         */
        console.error(`asistente: ${nombre} → ${h.rpc} falló [${codigo ?? 'sin código'}] ${r.error.message}`)

        // Y al modelo le va una INSTRUCCIÓN según el tipo de fallo: reintentar
        // sirve con parámetros mal escritos y sólo quema presupuesto con una
        // herramienta rota. Ver `errores.ts`.
        return problema(instruccionParaElModelo(clasificarFallo(codigo), nombre))
      }
      datos = r.data
    } catch {
      return problema('No pude consultar la base en este momento.')
    }

    // «Con stock»: se descartan los que no tienen disponible, ANTES de cosechar
    // las tarjetas y de recortar para el modelo. Así «¿hay puntas PH2 con
    // stock?» no devuelve, ni en texto ni en tarjetas, las que están en cero
    // (Fase 166). El modelo lo pide con `solo_con_stock: true`.
    if (nombre === 'buscar_productos' && argumentos['solo_con_stock'] === true) {
      datos = soloConStock(datos)
    }

    // El borrador se guarda entero para la pantalla, antes de recortarlo
    // para el modelo.
    if (bandeja && nombre === 'preparar_cotizacion') bandeja.propuesta = datos ?? null

    /*
     * Y los productos que la herramienta haya nombrado, para las tarjetas.
     * También ANTES del recorte: si la respuesta se corta por `MAX_TEXTO`, el
     * modelo ve menos, pero la pantalla ya tiene las filas enteras.
     */
    // `stock_actual`, no `stock`: el id de la herramienta es el del catálogo
    // de `herramientas.ts`, y el nombre corto nunca habría enganchado.
    if (bandeja && (nombre === 'buscar_productos' || nombre === 'stock_actual')) {
      if (bandeja.productos.length < MAX_PRODUCTOS) {
        cosecharProductos(datos, bandeja.productos)
        bandeja.productos.length = Math.min(bandeja.productos.length, MAX_PRODUCTOS)
      }
    }

    // Y los correos, por lo mismo (Fase 69).
    if (bandeja && nombre === 'buscar_emails' && bandeja.correos.length < MAX_CORREOS) {
      cosecharCorreos(datos, bandeja.correos)
      bandeja.correos.length = Math.min(bandeja.correos.length, MAX_CORREOS)
    }

    const texto = JSON.stringify(datos ?? null)
    return texto.length <= MAX_TEXTO
      ? texto
      : `${texto.slice(0, MAX_TEXTO)}\n[…cortado: pedí menos filas con «limite»]`
  }
}
