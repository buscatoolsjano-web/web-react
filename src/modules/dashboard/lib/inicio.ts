import type { IconName } from '@/components/icons/Icon'
import { navegacionPara } from '@/layouts/navegacion'
import { SIN_MONEDA, type Moneda, type PipelineComercial } from '@/modules/informes/types'

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

/** Los tipos de documento que STEL numera, en castellano y en orden de uso. */
export function textoAutoridadStel(tipos: readonly ('quote' | 'sales_order' | 'delivery')[]): string {
  const nombres = { quote: 'cotizaciones', sales_order: 'pedidos', delivery: 'notas de entrega' }
  const lista = tipos.map((t) => nombres[t])
  if (lista.length <= 1) return lista.join('')
  return `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}`
}
