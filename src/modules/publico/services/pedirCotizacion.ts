import { getEnv } from '@/lib/env'
import type { CarritoPublico } from '../lib/carritoPublico'

/**
 * Mandar el pedido de cotización (Fase 87 · E3).
 *
 * ── POR QUÉ NO USA EL CLIENTE DE SUPABASE ───────────────────────────────────
 *
 * Porque `supabase.functions.invoke` le pega el token de sesión si lo hay, y
 * acá lo normal es que no haya ninguna. Un `fetch` directo con la clave
 * pública deja ver qué viaja —que es nada más que el formulario— y no hace
 * falta nada más.
 *
 * ── LO QUE NO VIAJA ─────────────────────────────────────────────────────────
 *
 * Ni a qué empresa va dirigido —eso lo decide la base, con el mismo
 * interruptor que decide qué catálogo se publica— ni ningún id interno de
 * producto. Del carrito sale el SKU, el nombre y la cantidad: lo que quien
 * atiende necesita leer.
 */

export interface DatosDelPedido {
  nombre: string
  email: string
  empresa: string
  telefono: string
  mensaje: string
  /** La trampa para robots. Una persona nunca la ve, así que va vacía. */
  web: string
}

export interface Resultado {
  ok: boolean
  mensaje: string
}

export async function pedirCotizacion(
  datos: DatosDelPedido,
  carrito: CarritoPublico,
): Promise<Resultado> {
  const env = getEnv()
  const url = `${env.VITE_SUPABASE_URL}/functions/v1/cotizar-publico`

  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        ...datos,
        items: carrito.map((i) => ({ sku: i.sku, nombre: i.nombre, cantidad: i.cantidad })),
      }),
    })
  } catch {
    // Sin red, o el servidor no contesta. Se dice como lo que es, y no como
    // un error del formulario: quien lo llenó no tiene nada que corregir.
    return { ok: false, mensaje: 'No pudimos enviar la consulta. Revisá la conexión y probá de nuevo.' }
  }

  const cuerpo: unknown = await r.json().catch(() => null)
  const o = (cuerpo ?? {}) as Record<string, unknown>
  const mensaje = typeof o['mensaje'] === 'string' ? o['mensaje'] : ''

  if (!r.ok || o['ok'] !== true) {
    return {
      ok: false,
      mensaje: mensaje !== '' ? mensaje : 'No pudimos enviar la consulta. Probá de nuevo.',
    }
  }
  return { ok: true, mensaje: mensaje !== '' ? mensaje : 'Recibimos tu consulta.' }
}
