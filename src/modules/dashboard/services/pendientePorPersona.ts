import { supabase } from '@/services/supabase/client'

/**
 * Lo pendiente, persona por persona (Fase 40).
 *
 * Una sola RPC —`pendiente_por_persona`— porque las tres cuentas se cruzan por
 * usuario y hacerlo en el navegador serían tres consultas y un `join` a mano.
 * La RPC es SECURITY DEFINER con su propia puerta: sólo `admin` y `employee`
 * ven el tablero de toda la empresa, y si otro rol la llama devuelve
 * `insufficient_privilege` en vez de datos.
 *
 * Las tres definiciones de «pendiente» son las MISMAS que ya usa el resto de
 * la app: correo recibido con el último mensaje entrante y sin resolver (igual
 * que la tarjeta y el filtro de la bandeja), cotizaciones `sent`, y pedidos
 * con `fulfillment_status = 'pending'`.
 *
 * DE QUIÉN ES CADA UNO (Fase 72). El correo, de `assigned_to`, que es un campo
 * que la gente usa de verdad. Las cotizaciones y los pedidos, del vendedor y
 * —cuando no hay, que es siempre— de quien los creó: la misma regla que la
 * columna Vendedor del listado de Ventas. Repartiendo sólo por
 * `salesperson_id` no se repartía nada, porque está en null en los 751
 * documentos, y el bloque «Lo tuyo» salía vacío para todos.
 */
export interface PendienteDePersona {
  /** `null` es la fila «Sin asignar», no un usuario que falta. */
  userId: string | null
  nombre: string
  rol: string
  /** La fila del que está mirando. La marca el servidor con `auth.uid()`. */
  esMio: boolean
  correos: number
  cotizaciones: number
  pedidos: number
  /**
   * Lo hecho en el mes en curso, por AUTOR del documento.
   *
   * SÓLO CUENTA LO NACIDO EN EL ERP, y eso hay que decirlo en pantalla.
   * `salesperson_id` está en null en los 751 documentos de la empresa, así que
   * como medida de «qué hizo cada uno» no sirve; `created_by` sí, pero lo
   * tienen únicamente los documentos creados acá. Medido sobre el mes: los
   * documentos sin autor son EXACTAMENTE los que traen `external_source`, sin
   * un solo caso mezclado. Por eso lo que cae en la fila «Sin asignar» se
   * puede llamar por su nombre —lo que entró por la sincronización de STEL— en
   * vez de quedar como un agujero sin explicar.
   */
  hecho: {
    cotizaciones: number
    pedidos: number
    entregas: number
    correos: number
  }
}

function aNumero(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function pendientePorPersona(companyId: string): Promise<PendienteDePersona[]> {
  const { data, error } = await supabase.rpc('pendiente_por_persona', { p_company: companyId })
  if (error) throw new Error(`No se pudo leer el pendiente por persona: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
    userId: typeof f['user_id'] === 'string' ? f['user_id'] : null,
    nombre: typeof f['nombre'] === 'string' ? f['nombre'] : '(sin nombre)',
    rol: typeof f['rol'] === 'string' ? f['rol'] : '',
    esMio: f['es_mio'] === true,
    correos: aNumero(f['correos_sin_responder']),
    cotizaciones: aNumero(f['cotizaciones_enviadas']),
    pedidos: aNumero(f['pedidos_sin_entregar']),
    hecho: {
      cotizaciones: aNumero(f['cotizaciones_mes']),
      pedidos: aNumero(f['pedidos_mes']),
      entregas: aNumero(f['entregas_mes']),
      correos: aNumero(f['correos_enviados_mes']),
    },
  }))
}

/** El total de las tres columnas: lo que hace falta para ordenar y para el vacío. */
export function totalDe(p: PendienteDePersona): number {
  return p.correos + p.cotizaciones + p.pedidos
}

/** Lo hecho en el mes, sumado: para saber si el bloque tiene algo que decir. */
export function totalHecho(p: PendienteDePersona): number {
  return p.hecho.cotizaciones + p.hecho.pedidos + p.hecho.entregas + p.hecho.correos
}

/**
 * Mi fila y la de los demás, separadas.
 *
 * `mio` es null cuando el servidor no marcó ninguna: pasa si el que mira no
 * es miembro listado de la empresa. En ese caso no hay bloque personal y el
 * panel de abajo queda completo, que es exactamente lo que había antes.
 *
 * La fila «Sin asignar» NUNCA es mía —`userId` null— así que siempre cae del
 * lado del resto, donde es el dato importante: el montón que no repartió nadie.
 */
export function separarMiFila(filas: readonly PendienteDePersona[]): {
  mio: PendienteDePersona | null
  resto: PendienteDePersona[]
} {
  const mio = filas.find((f) => f.esMio) ?? null
  return { mio, resto: filas.filter((f) => !f.esMio) }
}

/**
 * Los documentos del mes que no registran autor.
 *
 * Son los de la fila «Sin asignar», y son —medido, sin un caso mezclado— los
 * que entraron por la sincronización de STEL. Es el denominador que vuelve
 * honesto al bloque personal: sin él, «1 pedido» se lee como «hiciste uno
 * solo» cuando la empresa hizo veintidós.
 *
 * El correo NO se cuenta acá: un correo enviado siempre sabe quién lo mandó,
 * así que no hay correo «sin autor» que explicar.
 */
export function documentosSinAutor(filas: readonly PendienteDePersona[]): number {
  const nadie = filas.find((f) => f.userId === null)
  if (!nadie) return 0
  return nadie.hecho.cotizaciones + nadie.hecho.pedidos + nadie.hecho.entregas
}
