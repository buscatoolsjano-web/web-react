import { describe, expect, it } from 'vitest'
import {
  compartidoCon,
  etiquetaDeDocumento,
  etiquetaDeEstadoHistorico,
  importeDelServicio,
  resumenDelServicio,
  tituloDeEvento,
} from './historial'
import type { ServicioHistorico } from '../types'

/**
 * Cómo se cuenta el historial importado de STEL (Fase 20 · E2).
 *
 * Lo que se prueba acá es lo que puede mentir sin que se note: un servicio de
 * 2023 presentado como trabajo pendiente de hoy, o un importe compartido entre
 * once equipos mostrado como el costo de uno.
 */
const servicio = (p: Partial<ServicioHistorico> = {}): ServicioHistorico => ({
  id: 's1',
  cadenaId: 'c1',
  activoId: 'a1',
  referencia: 'ORT00012',
  estado: 'closed',
  cotizacion: 'approved',
  facturado: true,
  ingreso: '2024-03-01',
  entrega: '2024-03-20',
  titulo: 'SERVICIO DE MANTENIMIENTO',
  diagnostico: null,
  trabajo: 'CAMBIO DE RODAMIENTOS, PALETAS',
  cierre: null,
  tecnico: 'NICOLAS',
  moneda: 'ARS',
  importe: null,
  importeAtribuible: 'shared',
  estadoStel: 'Presupuesto Cerrada + Orden Cerrada + Remito Facturada',
  equiposEnElServicio: 7,
  importeDeLaCadena: 121000,
  documentos: [],
  ...p,
})

describe('Un servicio histórico no es trabajo pendiente de hoy', () => {
  it('un presupuesto que quedó pendiente en STEL lo dice así', () => {
    expect(etiquetaDeEstadoHistorico('open_quote')).toBe('Presupuesto quedó pendiente en STEL')
  })

  it('ninguna etiqueta dice «pendiente» a secas', () => {
    for (const estado of ['closed', 'open_quote', 'in_progress']) {
      expect(etiquetaDeEstadoHistorico(estado)).not.toBe('Pendiente')
    }
  })

  it('un estado desconocido se muestra crudo en vez de desaparecer', () => {
    expect(etiquetaDeEstadoHistorico('algo_nuevo')).toBe('algo_nuevo')
  })

  it('«facturado» sólo se dice cuando el servicio terminó', () => {
    expect(tituloDeEvento(servicio())).toBe('Servicio entregado · Facturado')
    expect(tituloDeEvento(servicio({ facturado: false }))).toBe('Servicio entregado · Sin facturar')
    // En un presupuesto pendiente, «sin facturar» sugeriría que falta facturarlo.
    expect(tituloDeEvento(servicio({ estado: 'open_quote', facturado: false }))).toBe(
      'Presupuesto quedó pendiente en STEL',
    )
  })
})

describe('El importe no se reparte', () => {
  it('con un solo equipo, el importe es de ese equipo', () => {
    const i = importeDelServicio(
      servicio({ importe: 50000, importeAtribuible: 'asset', equiposEnElServicio: 1 }),
    )
    expect(i).toEqual({ propio: true, monto: 50000, moneda: 'ARS', nota: null })
  })

  it('compartido: no hay importe propio y se aclara', () => {
    const i = importeDelServicio(servicio())
    expect(i.propio).toBe(false)
    expect(i.nota).toBe('Importe compartido entre varios equipos')
    // El total de la cadena viaja como contexto, no como costo del equipo.
    expect(i.monto).toBe(121000)
  })

  it('un importe cargado con atribución compartida NO se presenta como propio', () => {
    // La base lo impide con un CHECK; acá se verifica que la pantalla tampoco
    // lo mostraría si alguna vez llegara así.
    const i = importeDelServicio(servicio({ importe: 999, importeAtribuible: 'shared' }))
    expect(i.propio).toBe(false)
  })

  it('dice con cuántos equipos se compartió, y nada cuando fue de uno solo', () => {
    expect(compartidoCon(servicio())).toBe('Servicio compartido con otros 6 equipos')
    expect(compartidoCon(servicio({ equiposEnElServicio: 2 }))).toBe('Servicio compartido con otro equipo')
    expect(compartidoCon(servicio({ equiposEnElServicio: 1 }))).toBeNull()
  })
})

describe('Los textos', () => {
  it('el resumen es el trabajo realizado, y si no hay, el título', () => {
    expect(resumenDelServicio(servicio())).toBe('CAMBIO DE RODAMIENTOS, PALETAS')
    expect(resumenDelServicio(servicio({ trabajo: null }))).toBe('SERVICIO DE MANTENIMIENTO')
  })

  it('sin nada, no se rellena con otra cosa', () => {
    expect(resumenDelServicio(servicio({ trabajo: null, titulo: null }))).toBeNull()
  })

  it('el diagnóstico importado es nulo: STEL no lo tiene', () => {
    expect(servicio().diagnostico).toBeNull()
  })

  it('los documentos se nombran como en el taller', () => {
    expect(etiquetaDeDocumento('estimate')).toBe('Presupuesto')
    expect(etiquetaDeDocumento('work_order')).toBe('Orden de trabajo')
    expect(etiquetaDeDocumento('delivery_note')).toBe('Remito de trabajo')
    expect(etiquetaDeDocumento('otra_cosa')).toBe('otra_cosa')
  })
})
