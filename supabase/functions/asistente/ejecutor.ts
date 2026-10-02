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
}

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

    // El borrador se guarda entero para la pantalla, antes de recortarlo
    // para el modelo.
    if (bandeja && nombre === 'preparar_cotizacion') bandeja.propuesta = datos ?? null

    const texto = JSON.stringify(datos ?? null)
    return texto.length <= MAX_TEXTO
      ? texto
      : `${texto.slice(0, MAX_TEXTO)}\n[…cortado: pedí menos filas con «limite»]`
  }
}
