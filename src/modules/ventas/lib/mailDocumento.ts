import { formatearImporte } from './formato'
import type { TipoDocumento } from '../types'

/**
 * El mail con el que se manda un documento al cliente (Fase 84).
 *
 * Es sólo la SEMILLA del composer: el asunto, a quién va y un cuerpo corto.
 * Nada de esto se manda solo —el composer se abre con todo escrito y quien
 * vende lo lee, lo corrige y aprieta «Enviar»—, así que lo que se arma acá no
 * tiene que ser perfecto, tiene que ahorrar los treinta segundos de escribir
 * siempre lo mismo y no equivocarse de dirección.
 *
 * Por qué el cuerpo es corto: el documento va adjunto. Repetir las líneas y
 * los precios en el texto sería decir dos veces lo mismo, y la segunda sin
 * formato. Lo que el cuerpo sí dice es el número y el total, que es lo que
 * alguien busca cuando abre el mail en el teléfono y no va a abrir el PDF.
 */

export interface DatosMailDocumento {
  tipo: TipoDocumento
  numero: string
  contactoNombre: string | null
  contactoEmail: string | null
  /** El resto del equipo del cliente que sigue la venta (Fase 40). */
  contactosExtra: readonly { nombre: string; email: string | null }[]
  moneda: string | null
  total: number | null
}

/** Cómo se llama cada documento en una frase. */
const NOMBRE: Record<TipoDocumento, string> = {
  cotizacion: 'cotización',
  pedido: 'pedido',
  entrega: 'remito',
}

/** Con mayúscula, para el asunto. */
const NOMBRE_TITULO: Record<TipoDocumento, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Remito',
}

export function asuntoDeDocumento(d: Pick<DatosMailDocumento, 'tipo' | 'numero'>): string {
  return `${NOMBRE_TITULO[d.tipo]} ${d.numero}`
}

/**
 * El primer nombre del contacto, para saludar.
 *
 * «Hola Matias» y no «Hola Matias Lamas», que suena a carta de banco. Si no
 * hay contacto, el saludo va sin nombre: inventar uno sería peor.
 */
function nombreDeSaludo(nombre: string | null): string | null {
  const limpio = (nombre ?? '').trim()
  if (limpio === '') return null
  return limpio.split(/\s+/)[0] ?? null
}

/**
 * El cuerpo, sin firma.
 *
 * La firma la pone el composer —es la de quien escribe, y se puede editar en
 * un mail puntual sin tocar la plantilla (Fase 41 · E3)—, así que acá no va:
 * si se pusiera, saldría dos veces.
 */
export function cuerpoDeDocumento(d: DatosMailDocumento): string {
  const nombre = nombreDeSaludo(d.contactoNombre)
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,'
  const importe = d.total === null ? null : formatearImporte(d.total, d.moneda)
  const frase =
    importe === null
      ? `Te adjunto la ${NOMBRE[d.tipo]} ${d.numero}.`
      : `Te adjunto la ${NOMBRE[d.tipo]} ${d.numero}, por ${importe}.`

  return `${saludo}\n\n${frase}\n\nQuedo a disposición por cualquier consulta.`
}

/** Una dirección que vale la pena intentar: no valida, sólo descarta lo vacío. */
const sirve = (email: string | null): email is string => (email ?? '').includes('@')

/**
 * A quién va.
 *
 * El contacto principal en «Para» y el resto del equipo en copia: son los que
 * el documento ya registra como los que siguen esta venta, y mandarle la
 * cotización sólo a uno es cómo se pierden las respuestas.
 *
 * Sin contacto principal con correo, los extras suben a «Para»: el mail tiene
 * que tener destinatario, y si no hay ninguno el composer se abre vacío y lo
 * escribe la persona.
 */
export function destinatariosDeDocumento(d: DatosMailDocumento): { para: string[]; cc: string[] } {
  const extras = d.contactosExtra.map((c) => c.email).filter(sirve)
  const principal = sirve(d.contactoEmail) ? d.contactoEmail : null

  // Sin duplicar: el principal puede estar también en la lista de extras.
  const sinElPrincipal = extras.filter((e) => e.toLowerCase() !== principal?.toLowerCase())
  const unicos = [...new Set(sinElPrincipal.map((e) => e.toLowerCase()))].map(
    (bajo) => sinElPrincipal.find((e) => e.toLowerCase() === bajo)!,
  )

  if (principal === null) return { para: unicos, cc: [] }
  return { para: [principal], cc: unicos }
}
