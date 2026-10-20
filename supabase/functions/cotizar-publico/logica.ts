/**
 * El pedido de cotización que llega de la calle (Fase 87 · E3). PURO.
 *
 * ── POR QUÉ ESTO ES DISTINTO DE TODO LO DEMÁS ──────────────────────────────
 *
 * Es lo primero que ESCRIBE en la base sin que haya una persona identificada
 * del otro lado. Lo público, hasta acá, eran tres funciones de sólo lectura.
 *
 * Por eso la tabla no tiene política de inserción para nadie: la única forma
 * de que entre una fila es esta función, con la clave de servicio. Y lo que
 * justifica ese privilegio es lo que hay en este archivo: validar la forma,
 * acotar los largos y decidir si esto es una consulta o es ruido.
 *
 * Todo acá es puro para poder probarlo. Lo que decide si un pedido entra o no
 * no puede depender de levantar un servidor para saber si funciona.
 */

export interface ItemPedido {
  sku: string
  nombre: string
  cantidad: number
}

export interface PedidoLimpio {
  nombre: string
  email: string
  empresa: string | null
  telefono: string | null
  mensaje: string | null
  items: ItemPedido[]
}

export type Revision =
  | { ok: true; pedido: PedidoLimpio }
  | { ok: false; motivo: string; mensaje: string }

/**
 * Los largos. No son estéticos: son el tope de lo que se acepta guardar.
 *
 * Un «nombre» de cuarenta mil caracteres no es un nombre, y aceptarlo es
 * dejar que alguien llene la tabla con una sola consulta.
 */
export const LARGOS = {
  nombre: 120,
  email: 160,
  empresa: 160,
  telefono: 40,
  mensaje: 2_000,
  sku: 64,
  nombreItem: 200,
} as const

export const MAXIMO_RENGLONES = 50
export const MAXIMO_CANTIDAD = 9_999

/**
 * Cuántos pedidos acepta la misma conexión por hora.
 *
 * Tres es holgado para alguien que de verdad consulta —manda uno, se da
 * cuenta de que olvidó algo, manda otro— y corto para un robot. No pretende
 * ser infranqueable: pretende que llenar la tabla cueste más de lo que vale.
 */
export const MAXIMO_POR_HORA = 3

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Recorta y limpia los caracteres de control, que no son texto escrito. */
export function limpiar(v: unknown, largo: number): string {
  // eslint-disable-next-line no-control-regex -- es justamente lo que se saca
  return texto(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, largo)
}

/**
 * Si eso parece un correo.
 *
 * Deliberadamente flojo: la validación estricta de direcciones rechaza
 * direcciones válidas y no atrapa a nadie —un robot escribe una dirección
 * perfecta—. Lo que importa es que haya algo, un arroba y un punto después,
 * para que quien atienda tenga a dónde contestar.
 */
export function pareceEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/**
 * Lo que se guarda de cada renglón.
 *
 * NO se guarda el id interno del producto: se guardan el SKU y el nombre tal
 * como los vio quien consulta. Si mañana el producto se renombra o se da de
 * baja, el pedido tiene que seguir diciendo qué pidieron.
 */
export function limpiarItems(crudo: unknown): ItemPedido[] {
  if (!Array.isArray(crudo)) return []
  const vistos = new Set<string>()
  const salida: ItemPedido[] = []
  for (const c of crudo) {
    if (salida.length >= MAXIMO_RENGLONES) break
    const o = (c ?? {}) as Record<string, unknown>
    const sku = limpiar(o['sku'], LARGOS.sku)
    if (sku === '' || vistos.has(sku)) continue
    const n = Math.floor(Number(o['cantidad']))
    if (!Number.isFinite(n) || n <= 0) continue
    vistos.add(sku)
    salida.push({
      sku,
      nombre: limpiar(o['nombre'], LARGOS.nombreItem) || sku,
      cantidad: Math.min(n, MAXIMO_CANTIDAD),
    })
  }
  return salida
}

/**
 * Revisar un pedido.
 *
 * Devuelve el motivo además del mensaje porque son para dos lectores
 * distintos: el mensaje lo lee quien está llenando el formulario y tiene que
 * poder arreglarlo; el motivo lo lee el registro del servidor, donde lo que
 * importa es poder contar cuántos fallaron por lo mismo.
 */
export function revisar(cuerpo: unknown): Revision {
  const o = (cuerpo ?? {}) as Record<string, unknown>

  /*
   * La trampa para robots, primero.
   *
   * El formulario tiene un campo escondido que una persona nunca ve y por lo
   * tanto nunca completa; un programa que rellena todo lo que encuentra, sí.
   * Se contesta que salió bien a propósito: decirle «te descubrí» es
   * enseñarle a esquivarlo la próxima.
   */
  if (texto(o['web']) !== '') {
    return { ok: false, motivo: 'trampa', mensaje: 'Recibimos tu consulta.' }
  }

  const nombre = limpiar(o['nombre'], LARGOS.nombre)
  if (nombre === '') {
    return { ok: false, motivo: 'sin_nombre', mensaje: 'Decinos cómo te llamás.' }
  }

  const email = limpiar(o['email'], LARGOS.email).toLowerCase()
  if (!pareceEmail(email)) {
    return { ok: false, motivo: 'email', mensaje: 'Revisá el correo: no lo podemos leer.' }
  }

  const items = limpiarItems(o['items'])
  const mensaje = limpiar(o['mensaje'], LARGOS.mensaje)
  // Un pedido sin productos y sin texto no es una consulta: no hay nada que
  // contestar. Con una de las dos cosas alcanza.
  if (items.length === 0 && mensaje === '') {
    return {
      ok: false,
      motivo: 'vacio',
      mensaje: 'Agregá algún producto o contanos qué necesitás.',
    }
  }

  return {
    ok: true,
    pedido: {
      nombre,
      email,
      empresa: limpiar(o['empresa'], LARGOS.empresa) || null,
      telefono: limpiar(o['telefono'], LARGOS.telefono) || null,
      mensaje: mensaje || null,
      items,
    },
  }
}

/**
 * La huella de la conexión, para contar pedidos sin guardar la IP.
 *
 * Se guarda el hash y no la dirección: alcanza para saber que dos pedidos
 * vinieron del mismo lado, que es para lo único que se usa, y no deja
 * guardado un dato personal que nadie va a mirar nunca.
 *
 * Con sal, y la sal es un secreto del servidor: sin ella, el espacio de
 * direcciones IPv4 es tan chico que cualquiera con la tabla podría probar
 * las cuatro mil millones y descubrir cuál es cuál.
 */
export async function huellaDeOrigen(ip: string, sal: string): Promise<string | null> {
  const limpio = ip.split(',')[0]?.trim() ?? ''
  if (limpio === '') return null
  const datos = new TextEncoder().encode(`${sal}:${limpio}`)
  const resumen = await crypto.subtle.digest('SHA-256', datos)
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
