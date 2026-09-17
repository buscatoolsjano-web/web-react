/**
 * Proveedores de IA para el análisis de WhatsApp. SÓLO servidor (Deno).
 *
 * La clave del proveedor vive en los secrets de la Edge Function y no sale de
 * acá: no se devuelve, no se registra y no aparece en ningún mensaje de error.
 *
 * Elegir proveedor es configuración, no código:
 *
 *   WHATSAPP_AI_PROVIDER = anthropic | falso     (default: falso)
 *   ANTHROPIC_API_KEY    = …                     (sólo con anthropic)
 *   WHATSAPP_AI_MODEL    = claude-opus-5         (default)
 *   WHATSAPP_AI_EFFORT   = low | medium | high   (default: medium)
 *
 * El default es `falso` A PROPÓSITO: una función desplegada sin configurar no
 * manda conversaciones a ningún tercero. Encender la IA real es una decisión
 * explícita, con su secret.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.126.0'
import {
  ESQUEMA_SALIDA,
  FalloProveedor,
  INSTRUCCIONES,
  construirEntradaUsuario,
  proveedorFalso,
  type EntradaAnalisis,
  type ProveedorIA,
  type RespuestaProveedor,
} from './logica.ts'

const MODELO_POR_DEFECTO = 'claude-opus-5'

function proveedorAnthropic(apiKey: string, modelo: string, esfuerzo: string): ProveedorIA {
  // maxRetries en 1: un análisis es a demanda y la persona está esperando. Un
  // 429 o un 5xx se reintenta una vez; después, se informa y se reintenta a mano.
  const cliente = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })

  return {
    nombre: 'anthropic',
    async analizar(entrada: EntradaAnalisis): Promise<RespuestaProveedor> {
      let respuesta
      try {
        respuesta = await cliente.beta.messages.create({
          model: modelo,
          max_tokens: 16_000,
          // Las instrucciones son fijas: primero y cacheables. Lo variable
          // (mensajes, resumen previo) va en el turno del usuario.
          system: [{ type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: construirEntradaUsuario(entrada) }],
          // La FORMA la garantiza el proveedor; el CONTENIDO lo valida
          // `validarResultado` igual.
          output_config: {
            effort: esfuerzo,
            format: { type: 'json_schema', schema: ESQUEMA_SALIDA },
          },
          // Si el modelo declina por un clasificador de seguridad, el pedido se
          // reintenta server-side en el modelo que Anthropic recomienda para esa
          // categoría, dentro de la misma llamada.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        } as unknown as Parameters<typeof cliente.beta.messages.create>[0])
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
          throw new FalloProveedor('rechazo', 'credencial del proveedor rechazada')
        }
        if (e instanceof Anthropic.RateLimitError) throw new FalloProveedor('limite', 'límite de uso del proveedor')
        if (e instanceof Anthropic.BadRequestError) throw new FalloProveedor('rechazo', 'pedido rechazado por el proveedor')
        if (e instanceof Anthropic.APIConnectionError) throw new FalloProveedor('caido', 'sin conexión con el proveedor')
        if (e instanceof Anthropic.APIError) throw new FalloProveedor('caido', `proveedor respondió ${e.status ?? 'error'}`)
        throw new FalloProveedor('caido', 'error inesperado del proveedor')
      }

      const r = respuesta as unknown as {
        model: string
        stop_reason: string | null
        content: { type: string; text?: string }[]
        usage?: { input_tokens?: number; output_tokens?: number }
      }

      // Antes de leer el contenido: una negativa o un corte no son una salida.
      if (r.stop_reason === 'refusal') throw new FalloProveedor('refusal', 'el proveedor declinó el análisis')
      if (r.stop_reason === 'max_tokens') throw new FalloProveedor('truncado', 'la respuesta quedó cortada')

      const texto = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
      return {
        texto,
        modelo: r.model,
        uso: { inputTokens: r.usage?.input_tokens ?? null, outputTokens: r.usage?.output_tokens ?? null },
      }
    },
  }
}

/** El proveedor configurado. Sin configuración: el falso, nunca uno real. */
export function proveedorConfigurado(): ProveedorIA {
  const nombre = (Deno.env.get('WHATSAPP_AI_PROVIDER') ?? 'falso').trim()
  if (nombre === 'falso') return proveedorFalso
  if (nombre === 'anthropic') {
    const clave = Deno.env.get('ANTHROPIC_API_KEY')
    if (!clave) {
      return {
        nombre: 'anthropic',
        analizar: () => Promise.reject(new FalloProveedor('sin_configurar', 'falta la clave del proveedor')),
      }
    }
    const esfuerzo = Deno.env.get('WHATSAPP_AI_EFFORT') ?? 'medium'
    return proveedorAnthropic(clave, Deno.env.get('WHATSAPP_AI_MODEL') ?? MODELO_POR_DEFECTO, esfuerzo)
  }
  return {
    nombre,
    analizar: () => Promise.reject(new FalloProveedor('sin_configurar', 'proveedor desconocido')),
  }
}
