import type { IconName } from '@/components/icons/Icon'
import { navegacionPara } from '@/layouts/navegacion'
import { SIN_MONEDA, type ActividadComercial, type Moneda, type PipelineComercial, type TipoActividad } from '@/modules/informes/types'

/**
 * Reglas del Inicio (Fase 13 · E6). Todo es presentación de datos que ya
 * existen: no hay consultas nuevas ni cifras calculadas acá que no estén en
 * Informes, Ventas, Mantenimiento o Emails.
 */

/**
 * Qué ve cada rol al entrar.
 *   · operativa: admin y employee — los mismos que ya leen Informes, Emails y
 *     Mantenimiento.
 *   · ventas: salesperson — lo suyo en Ventas (RLS ya filtra por vendedor).
 *   · accesos: el resto (technician, customer, distributor, supplier). No hay
 *     datos propios que mostrar sin inventarlos: sólo accesos rápidos.
 */
export type VistaInicio = 'operativa' | 'ventas' | 'accesos'

export function vistaPara(rol: string | null | undefined): VistaInicio {
  if (rol === 'admin' || rol === 'employee') return 'operativa'
  if (rol === 'salesperson') return 'ventas'
  return 'accesos'
}

export interface AccesoRapido {
  to: string
  label: string
  /** Módulo al que pertenece («Ventas»), para leer «Pedidos» con contexto. */
  modulo: string | null
  icon: IconName
}

/**
 * Los accesos rápidos salen de la MISMA navegación del shell, ya filtrada por
 * rol: nunca se ofrece algo que el menú no ofrece. Inicio y lo «próximamente»
 * quedan afuera.
 */
export function accesosPara(rol: string): AccesoRapido[] {
  return navegacionPara(rol).flatMap((g) =>
    g.entradas.flatMap<AccesoRapido>((e) => {
      if (e.proximamente || e.id === 'inicio') return []
      if (e.destino) return [{ to: e.destino.to, label: e.destino.label, modulo: null, icon: e.icon }]
      return (e.hijos ?? []).map((h) => ({ to: h.to, label: h.label, modulo: e.label, icon: e.icon }))
    }),
  )
}

/** Un importe por moneda. Nunca se suman monedas distintas ni se convierten. */
export interface ImporteMoneda {
  moneda: Moneda
  documentos: number
  importe: number
}

/** SIN MONEDA siempre al final, el resto como vienen (Informes ya las ordena). */
function ordenar(filas: ImporteMoneda[]): ImporteMoneda[] {
  return [...filas.filter((f) => f.moneda !== SIN_MONEDA), ...filas.filter((f) => f.moneda === SIN_MONEDA)]
}

export interface ResumenMonedas {
  /** Documentos de todas las monedas: contar sí se puede sumar. */
  documentos: number
  porMoneda: ImporteMoneda[]
}

export function cotizacionesAbiertas(p: PipelineComercial): ResumenMonedas {
  const porMoneda = ordenar(p.abiertas.map((a) => ({ moneda: a.moneda, documentos: a.documentos, importe: a.importe })))
  return { documentos: porMoneda.reduce((s, m) => s + m.documentos, 0), porMoneda }
}

/** Pedidos pendientes de entrega (sin entrega + entrega parcial), por moneda. */
export function pedidosPendientes(p: PipelineComercial): ResumenMonedas {
  const porMoneda = ordenar(
    p.pendientes.map((m) => ({
      moneda: m.moneda,
      documentos: m.sinEntrega.documentos + m.parcial.documentos,
      importe: m.sinEntrega.importe + m.parcial.importe,
    })),
  ).filter((m) => m.documentos > 0)
  return { documentos: porMoneda.reduce((s, m) => s + m.documentos, 0), porMoneda }
}

export interface ActividadTipo {
  tipo: TipoActividad
  documentos: number
  porMoneda: ImporteMoneda[]
}

const ORDEN_TIPOS: readonly TipoActividad[] = ['cotizaciones', 'pedidos', 'entregas']

/** Lo emitido en el mes en curso, por tipo y moneda (los ceros no se listan). */
export function actividadDelMes(a: ActividadComercial): ActividadTipo[] {
  return ORDEN_TIPOS.map((tipo) => {
    const kpi = a.kpis.find((k) => k.tipo === tipo)
    const porMoneda = ordenar(
      (kpi?.monedas ?? []).filter((m) => m.actual.documentos > 0).map((m) => ({ moneda: m.moneda, documentos: m.actual.documentos, importe: m.actual.importe })),
    )
    return { tipo, documentos: kpi?.documentosActual ?? 0, porMoneda }
  })
}

/**
 * Documentos del mes que REQUIEREN ATENCIÓN HOY, y cuántos de ellos no tienen
 * moneda.
 *
 * Fase 19 · E4: lo que cuenta el servidor ya no es `needs_review` —la foto de
 * la migración— sino la clasificación de `revision_de_documentos`. El nombre
 * del campo no cambió para no tocar el contrato del informe.
 */
export function revisionDelMes(a: ActividadComercial): { enRevision: number; sinMoneda: number } {
  return a.kpis.reduce(
    (s, k) => ({ enRevision: s.enRevision + k.enRevisionActual, sinMoneda: s.sinMoneda + k.sinMonedaEnRevisionActual }),
    { enRevision: 0, sinMoneda: 0 },
  )
}

export const ETIQUETA_TIPO: Record<TipoActividad, { singular: string; plural: string }> = {
  cotizaciones: { singular: 'cotización', plural: 'cotizaciones' },
  pedidos: { singular: 'pedido', plural: 'pedidos' },
  entregas: { singular: 'nota de entrega', plural: 'notas de entrega' },
}

/** Los tipos de documento que STEL numera, en castellano y en orden de uso. */
export function textoAutoridadStel(tipos: readonly ('quote' | 'sales_order' | 'delivery')[]): string {
  const nombres = { quote: 'cotizaciones', sales_order: 'pedidos', delivery: 'notas de entrega' }
  const lista = tipos.map((t) => nombres[t])
  if (lista.length <= 1) return lista.join('')
  return `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`
}
