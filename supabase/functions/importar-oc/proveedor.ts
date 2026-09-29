/**
 * El proveedor de IA que lee la OC. SÓLO servidor (Deno).
 *
 * La clave vive en los secrets de la Edge Function y no sale de acá: no se
 * devuelve, no se registra y no aparece en ningún mensaje de error.
 *
 *   OC_AI_PROVIDER = openai | falso        (default: falso)
 *   OPENAI_API_KEY = …
 *   OC_AI_MODEL    = gpt-5.6-luna          (default)
 *   OC_AI_EFFORT   = none | low | medium   (default: low)
 *
 * **El default es `falso` a propósito**, igual que en `whatsapp-ai-analyze`:
 * una función desplegada sin configurar no manda las órdenes de compra de
 * nadie a un tercero. Encender la IA real es una decisión explícita, con su
 * secret.
 *
 * Y sirve para algo más: con el falso, el circuito entero de la pantalla
 * —leer, emparejar, revisar, importar— se puede probar de punta a punta sin
 * tener la clave todavía.
 */
import OpenAI from 'npm:openai@7.17.0'
import { ESQUEMA_OC, INSTRUCCIONES_OC, construirEntradaOc } from './logica.ts'

const MODELO_POR_DEFECTO = 'gpt-5.6-luna'
const MODELOS = ['gpt-5.6-luna', 'gpt-5.6-terra'] as const
const ESFUERZOS = ['none', 'low', 'medium'] as const
const TIMEOUT_MS = 90_000
const REINTENTOS = 1
const MAX_OUTPUT_TOKENS = 16_000

export type MotivoProveedor =
  | 'sin_configurar'
  | 'rechazo'
  | 'limite'
  | 'caido'
  | 'truncado'
  | 'refusal'

export class FalloProveedor extends Error {
  constructor(
    readonly motivo: MotivoProveedor,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloProveedor'
  }
}

export interface Proveedor {
  nombre: string
  /** Devuelve el JSON CRUDO. Validarlo es responsabilidad de quien llama. */
  leer(texto: string): Promise<string>
}

/** Un PDF de ejemplo, para que la pantalla se pueda probar sin la clave. */
const RESPUESTA_FALSA = JSON.stringify({
  cliente: { nombre: 'A-Evangelista S.A.', cuit: '30-68521819-0' },
  numero: 'OC-DEMO-0001',
  fecha: '2026-09-29',
  moneda: 'ARS',
  lineas: [
    { codigo: null, descripcion: 'SPEEDRILL VPPH2/50', cantidad: 20, precio: 1500 },
    { codigo: 'TC.QSP100N4', descripcion: 'Llave de torque', cantidad: 2, precio: 95000 },
    { codigo: 'ZZZ-999', descripcion: 'Algo que no tenemos', cantidad: 3, precio: 10 },
  ],
})

const proveedorFalso: Proveedor = {
  nombre: 'falso',
  leer: () => Promise.resolve(RESPUESTA_FALSA),
}

function clasificar(e: unknown): MotivoProveedor {
  const status = (e as { status?: number } | null)?.status
  if (status === 401 || status === 403) return 'rechazo'
  if (status === 400 || status === 404 || status === 422) return 'rechazo'
  if (status === 429) return 'limite'
  return 'caido'
}

function proveedorOpenAI(cliente: OpenAI, modelo: string, esfuerzo: string): Proveedor {
  return {
    nombre: 'openai',
    async leer(texto: string): Promise<string> {
      let respuesta: unknown
      try {
        respuesta = await cliente.responses.create({
          model: modelo,
          instructions: INSTRUCCIONES_OC,
          input: [{ role: 'user', content: construirEntradaOc(texto) }],
          // La FORMA la garantiza el proveedor; el CONTENIDO lo valida
          // `validarOcExtraida` igual, porque el esquema deja pasar cantidades
          // negativas y precios con coma sin despeinarse.
          text: { format: { type: 'json_schema', name: 'orden_de_compra', strict: true, schema: ESQUEMA_OC } },
          reasoning: { effort: esfuerzo },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          // Una orden de compra es de un cliente: no se guarda del otro lado.
          store: false,
        } as unknown as Parameters<typeof cliente.responses.create>[0])
      } catch (e) {
        throw new FalloProveedor(clasificar(e), 'el proveedor no respondió')
      }

      const r = (respuesta ?? {}) as {
        status?: string
        incomplete_details?: { reason?: string } | null
        output?: { content?: { type?: string; text?: string; refusal?: string }[] }[]
      }

      // Antes de leer el contenido: una negativa o un corte no son una salida.
      if (r.status === 'incomplete' && r.incomplete_details?.reason === 'max_output_tokens') {
        throw new FalloProveedor('truncado', 'la respuesta quedó cortada')
      }
      const bloques = (r.output ?? []).flatMap((o) => o.content ?? [])
      if (bloques.some((b) => typeof b.refusal === 'string')) {
        throw new FalloProveedor('refusal', 'el proveedor declinó leer el documento')
      }

      return bloques
        .filter((b) => b.type === 'output_text')
        .map((b) => b.text ?? '')
        .join('')
    },
  }
}

const sinConfigurar = (nombre: string, detalle: string): Proveedor => ({
  nombre,
  leer: () => Promise.reject(new FalloProveedor('sin_configurar', detalle)),
})

/** El proveedor configurado. Sin configuración: el falso, nunca uno real. */
export function proveedorConfigurado(): Proveedor {
  const nombre = (Deno.env.get('OC_AI_PROVIDER') ?? 'falso').trim()
  if (nombre === 'falso') return proveedorFalso
  if (nombre !== 'openai') return sinConfigurar(nombre, 'proveedor desconocido')

  const clave = Deno.env.get('OPENAI_API_KEY')
  if (!clave) return sinConfigurar('openai', 'falta la clave del proveedor')

  const modelo = (Deno.env.get('OC_AI_MODEL') ?? MODELO_POR_DEFECTO).trim()
  if (!(MODELOS as readonly string[]).includes(modelo)) {
    return sinConfigurar('openai', 'modelo no habilitado')
  }
  const esfuerzo = (Deno.env.get('OC_AI_EFFORT') ?? 'low').trim()
  if (!(ESFUERZOS as readonly string[]).includes(esfuerzo)) {
    return sinConfigurar('openai', 'esfuerzo no habilitado')
  }

  return proveedorOpenAI(
    new OpenAI({ apiKey: clave, timeout: TIMEOUT_MS, maxRetries: REINTENTOS }),
    modelo,
    esfuerzo,
  )
}
