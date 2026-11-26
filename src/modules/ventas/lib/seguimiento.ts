/**
 * El seguimiento de una cotización (2026-11). PURO.
 *
 * «Ganada» no se marca: la base la pone sola cuando la cotización tiene pedido
 * (`cotizacion_sigue_a_su_pedido`). Lo que sí es una decisión de una persona
 * es que se PERDIÓ, y por qué: es lo que después dice dónde se pierde plata.
 * Y mientras está abierta, cuándo volver a llamar.
 */

export type MotivoPerdida = 'precio' | 'plazo' | 'competencia' | 'sin_respuesta' | 'postergado' | 'otro'

export const MOTIVOS_PERDIDA: readonly { valor: MotivoPerdida; etiqueta: string }[] = [
  { valor: 'precio', etiqueta: 'Precio' },
  { valor: 'plazo', etiqueta: 'Plazo de entrega' },
  { valor: 'competencia', etiqueta: 'Lo ganó la competencia' },
  { valor: 'sin_respuesta', etiqueta: 'El cliente no respondió' },
  { valor: 'postergado', etiqueta: 'Se postergó / sin presupuesto' },
  { valor: 'otro', etiqueta: 'Otro' },
]

export function etiquetaMotivo(m: string | null): string | null {
  if (!m) return null
  return MOTIVOS_PERDIDA.find((x) => x.valor === m)?.etiqueta ?? m
}

/** Días de validez con que nace una cotización nueva. */
export const DIAS_DE_VALIDEZ = 15

/** Suma días a una fecha `YYYY-MM-DD`, sin zonas horarias. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Atajos para el próximo contacto: lo que se elige casi siempre. */
export const ATAJOS_CONTACTO: readonly { etiqueta: string; dias: number }[] = [
  { etiqueta: 'Mañana', dias: 1 },
  { etiqueta: 'En 3 días', dias: 3 },
  { etiqueta: 'En una semana', dias: 7 },
  { etiqueta: 'En 15 días', dias: 15 },
]

export type EstadoContacto = 'atrasado' | 'hoy' | 'proximo' | null

/** Si el próximo contacto ya pasó, es hoy o viene. */
export function estadoContacto(proximo: string | null, hoy: string): EstadoContacto {
  if (!proximo) return null
  if (proximo < hoy) return 'atrasado'
  if (proximo === hoy) return 'hoy'
  return 'proximo'
}
