import { supabase } from './supabase/client'

/**
 * Borrar dejando rastro (Fase 40).
 *
 * Hasta ahora borrar hacía desaparecer: la fila se iba y con ella cualquier
 * forma de saber quién la sacó y por qué. En un remito era peor todavía,
 * porque el trigger de borrado limpia a propósito los eventos de auditoría de
 * la entidad —son suyos y se van con ella—.
 *
 * El registro vive en `deletion_log`, una tabla aparte justamente para que
 * sobreviva a lo que describe, y guarda la fila entera: además de contar lo
 * que pasó, permite rehacer a mano lo que se borró por error.
 *
 * El borrado lo sigue haciendo el usuario, con su RLS y contra todos los
 * triggers de protección de siempre: esto agrega trazabilidad, no permisos. Si
 * un trigger lo rechaza, la excepción se lleva puesto también el registro,
 * porque es la misma transacción. Nunca queda anotado un borrado que no pasó.
 */

/** Las cosas que la base sabe registrar al borrar (`app.entidad_borrable`). */
export type EntidadBorrable =
  | 'sales_quote'
  | 'sales_order'
  | 'delivery'
  | 'purchase_order'
  | 'goods_receipt'
  | 'supplier_invoice'
  | 'maintenance_order'
  | 'maintenance_asset'
  | 'customer'
  | 'supplier'
  | 'product'
  | 'attachment'
  | 'customer_contact'
  | 'customer_address'

/** El mínimo que acepta la base. Un motivo de dos letras no es un motivo. */
export const MINIMO_MOTIVO = 4

/**
 * Los motivos de siempre, a un clic (Fase 40).
 *
 * Pedir un motivo escrito en cada borrado es fricción, y la fricción se paga
 * con basura: «a», «asd», «borrar». Con cuatro botones el caso normal son dos
 * clics y el registro queda clasificado; el que tiene algo distinto que decir
 * sigue teniendo la caja de texto, que es lo que de verdad importa guardar.
 */
export const MOTIVOS_FRECUENTES = [
  'Era una prueba',
  'Está duplicado',
  'Error de carga',
  'Lo pidió el cliente',
] as const

export const MENSAJES_BORRADO: Record<string, string> = {
  DELETION_REASON_REQUIRED: 'Escribí por qué se borra: queda registrado.',
  DELETION_ENTITY_UNKNOWN: 'Eso no se puede borrar desde acá.',
  DELETION_NOT_FOUND: 'Ya no está. Puede que alguien lo haya borrado antes.',
  DELETION_BLOCKED: 'No se borró nada: no tenés permiso sobre eso.',
}

export function mensajeDeBorrado(e: unknown): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const codigo = Object.keys(MENSAJES_BORRADO).find((c) => texto.includes(c))
  if (codigo) return MENSAJES_BORRADO[codigo]!
  return texto || 'No se pudo borrar.'
}

export interface Borrado {
  /** El número o el nombre de lo que se borró, para decirlo en pantalla. */
  etiqueta: string | null
  /** «la cotización», «el remito»: para armar la frase sin repetirla acá. */
  nombre: string
}

function leer(data: unknown): Borrado {
  const r = (data ?? {}) as { etiqueta?: string | null; nombre?: string }
  return { etiqueta: r.etiqueta ?? null, nombre: r.nombre ?? 'el registro' }
}

/** Registra el motivo y borra, en una sola transacción. */
export async function borrarConMotivo(
  entidad: EntidadBorrable,
  id: string,
  motivo: string,
): Promise<Borrado> {
  const { data, error } = await supabase.rpc('borrar_con_motivo', {
    p_entidad: entidad,
    p_id: id,
    p_motivo: motivo,
  })
  if (error) throw new Error(error.message)
  return leer(data)
}

/**
 * Registra una baja lógica, sin borrar nada.
 *
 * Para el que la hace es lo mismo —«lo borré»— y merece el mismo registro,
 * aunque la fila siga existiendo con su `deleted_at`. Se llama junto con el
 * update que da de baja; si el update falla, queda un registro de más, que es
 * mucho menos grave que una baja sin explicación.
 */
export async function registrarBaja(
  entidad: EntidadBorrable,
  id: string,
  motivo: string,
): Promise<Borrado> {
  const { data, error } = await supabase.rpc('registrar_borrado', {
    p_entidad: entidad,
    p_id: id,
    p_motivo: motivo,
    p_accion: 'deactivate',
  })
  if (error) throw new Error(error.message)
  return leer(data)
}
