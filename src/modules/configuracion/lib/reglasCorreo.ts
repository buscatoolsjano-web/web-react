/**
 * Reglas de correo (Fase 70 · E2). PURO.
 *
 * Una regla es «si pasa esto, hacé esto»: condiciones que tienen que cumplirse
 * TODAS —el «y» del filtro de Gmail— y acciones que se aplican cuando se
 * cumplen.
 *
 * Acá viven tres cosas y ninguna toca la red: el vocabulario, lo que hace que
 * una regla esté bien escrita, y cómo se LEE una regla en castellano. Lo
 * último no es decoración: una regla que no se puede leer en voz alta es una
 * regla que nadie se anima a tocar, y la lista termina llena de reglas que
 * nadie sabe qué hacen.
 *
 * LA VALIDACIÓN DE ACÁ NO ES EL CONTROL. El control lo hace
 * `app.validar_regla_email` en la base, que es la que rechaza de verdad. Ésta
 * existe para decirlo ANTES de mandar, con el campo marcado; si las dos se
 * desencuentran, manda la base.
 */
import type { EstadoTrabajo } from '@/modules/emails/types'

export const CAMPOS_REGLA = ['de', 'para', 'asunto', 'texto', 'es_cliente'] as const
export type CampoRegla = (typeof CAMPOS_REGLA)[number]

export const OPERADORES_REGLA = ['contiene', 'no_contiene', 'es'] as const
export type OperadorRegla = (typeof OPERADORES_REGLA)[number]

export type CondicionTexto = {
  campo: Exclude<CampoRegla, 'es_cliente'>
  op: OperadorRegla
  valor: string
}
export type CondicionCliente = { campo: 'es_cliente'; valor: boolean }
export type Condicion = CondicionTexto | CondicionCliente

export type Accion =
  | { tipo: 'etiquetar'; labelId: string }
  | { tipo: 'asignar'; userId: string }
  | { tipo: 'estado'; valor: EstadoTrabajo }
  | { tipo: 'sacar_de_bandeja' }

export interface ReglaCorreo {
  id: string
  nombre: string
  activa: boolean
  orden: number
  condiciones: Condicion[]
  acciones: Accion[]
}

export const esCondicionCliente = (c: Condicion): c is CondicionCliente => c.campo === 'es_cliente'

/**
 * Cómo se nombra cada campo en la pantalla.
 *
 * «Para» dice «alguno de los que participan» y no «para», a propósito: el
 * índice guarda los participantes del hilo —la dirección nuestra incluida—, no
 * una lista de destinatarios. Prometer un «para» exacto que no se puede
 * cumplir haría que las reglas fallaran sin que nadie entienda por qué.
 */
export const ETIQUETA_CAMPO: Record<CampoRegla, string> = {
  de: 'El remitente',
  para: 'Alguno de los que participan',
  asunto: 'El asunto',
  texto: 'En cualquier parte',
  es_cliente: 'Es de un cliente del ERP',
}

export const ETIQUETA_OPERADOR: Record<OperadorRegla, string> = {
  contiene: 'contiene',
  no_contiene: 'no contiene',
  es: 'es exactamente',
}

export const ETIQUETA_ESTADO_ACCION: Record<EstadoTrabajo, string> = {
  pendiente: 'dejarlo pendiente',
  en_proceso: 'marcarlo en proceso',
  resuelto: 'darlo por resuelto',
}

/** Los nombres que hacen falta para leer una regla: etiquetas y personas. */
export interface NombresDeLaEmpresa {
  etiquetas: ReadonlyMap<string, string>
  personas: ReadonlyMap<string, string>
}

export function describirCondicion(c: Condicion): string {
  if (esCondicionCliente(c)) {
    return c.valor ? 'es de un cliente del ERP' : 'NO es de un cliente del ERP'
  }
  return `${ETIQUETA_CAMPO[c.campo].toLowerCase()} ${ETIQUETA_OPERADOR[c.op]} «${c.valor}»`
}

export function describirAccion(a: Accion, nombres: NombresDeLaEmpresa): string {
  switch (a.tipo) {
    case 'etiquetar':
      /* Si la etiqueta se borró, la regla sigue existiendo y esa acción ya no
         hace nada. Decirlo es mejor que mostrar un uuid o callarlo. */
      return `ponerle «${nombres.etiquetas.get(a.labelId) ?? 'una etiqueta que ya no existe'}»`
    case 'asignar':
      return `asignárselo a ${nombres.personas.get(a.userId) ?? 'alguien que ya no está'}`
    case 'estado':
      return ETIQUETA_ESTADO_ACCION[a.valor]
    case 'sacar_de_bandeja':
      return 'sacarlo de la bandeja'
  }
}

/**
 * La regla, leída en voz alta.
 *
 * «Si el remitente contiene «stelorder.com» y el asunto no contiene «factura»,
 * ponerle «Avisos» y darlo por resuelto.»
 */
export function describirRegla(regla: ReglaCorreo, nombres: NombresDeLaEmpresa): string {
  const si = regla.condiciones.map(describirCondicion).join(' y ')
  const entonces = regla.acciones.map((a) => describirAccion(a, nombres)).join(' y ')
  return `Si ${si}, ${entonces}.`
}

/**
 * Qué le falta a la regla para poder guardarse.
 *
 * Devuelve frases, no códigos: se muestran tal cual debajo del formulario. Una
 * lista vacía quiere decir que está lista.
 */
export function problemasDeRegla(regla: {
  nombre: string
  condiciones: readonly Condicion[]
  acciones: readonly Accion[]
}): string[] {
  const falta: string[] = []
  const nombre = regla.nombre.trim()
  if (nombre === '') falta.push('Ponele un nombre a la regla.')
  if (nombre.length > 60) falta.push('El nombre no puede pasar de 60 caracteres.')
  if (regla.condiciones.length === 0) falta.push('Agregá al menos una condición.')
  if (regla.acciones.length === 0) falta.push('Agregá al menos una acción.')

  for (const c of regla.condiciones) {
    if (!esCondicionCliente(c) && c.valor.trim() === '') {
      falta.push(`Escribí qué tiene que decir ${ETIQUETA_CAMPO[c.campo].toLowerCase()}.`)
    }
  }
  for (const a of regla.acciones) {
    if (a.tipo === 'etiquetar' && a.labelId === '') falta.push('Elegí la etiqueta que se va a poner.')
    if (a.tipo === 'asignar' && a.userId === '') falta.push('Elegí a quién asignárselo.')
  }

  /*
   * Dos acciones del mismo tipo no se avisan como error: «ponerle Cotizar y
   * ponerle Urgente» es perfectamente razonable. Lo que sí no tiene sentido es
   * repetir la MISMA etiqueta o asignar a dos personas, porque el hilo tiene
   * un solo asignado y la segunda nunca va a correr.
   */
  if (regla.acciones.filter((a) => a.tipo === 'asignar').length > 1) {
    falta.push('Un hilo se le asigna a una sola persona: dejá una.')
  }
  if (regla.acciones.filter((a) => a.tipo === 'estado').length > 1) {
    falta.push('Elegí un solo estado.')
  }
  return falta
}

/** Una condición nueva, con algo razonable cargado. */
export const CONDICION_NUEVA: CondicionTexto = { campo: 'de', op: 'contiene', valor: '' }
