import { describe, expect, it } from 'vitest'
import { rutaDelDocumento, ultimosDocumentos } from './documentos'
import type { DocumentoListado, TipoDocumento } from '@/modules/ventas/types'

/**
 * Los últimos documentos del Dashboard (Fase 21 · E2).
 *
 * La granularidad real es el día —el `created_at` de 669 de los 674
 * documentos es la hora de la importación—, así que los empates son la regla y
 * no la excepción. Lo que se prueba es que el orden sea siempre el mismo: una
 * lista que se reordena sola entre dos cargas se lee como si hubiera pasado
 * algo.
 */
const doc = (tipo: TipoDocumento, fecha: string, numero: string, id = numero): DocumentoListado => ({
    id,
    tipo,
    numero,
    fecha,
    clienteId: 'c1',
    clienteNombre: 'Cliente',
    titulo: null,
    moneda: 'USD',
    total: 100,
    estado: 'sent',
    estadoSecundario: null,
    vendedor: null,
    serie: null,
    origen: null,
    necesitaRevision: false,
    motivosRevision: [],
    numeroFueraDeSerie: false,
    esHistorico: true,
})

describe('Los últimos documentos se ordenan por fecha del documento', () => {
  it('el más nuevo primero, mezclando los tres tipos', () => {
    const out = ultimosDocumentos(
      [
        [doc('cotizacion', '2026-09-10', 'COTI-1')],
        [doc('pedido', '2026-09-21', 'PDV-1')],
        [doc('entrega', '2026-09-15', 'RT-1')],
      ],
      10,
    )
    expect(out.map((d) => d.numero)).toEqual(['PDV-1', 'RT-1', 'COTI-1'])
  })

  it('con la misma fecha el orden es determinista: entrega, pedido, cotización', () => {
    const out = ultimosDocumentos(
      [
        [doc('cotizacion', '2026-09-21', 'COTI-1')],
        [doc('pedido', '2026-09-21', 'PDV-1')],
        [doc('entrega', '2026-09-21', 'RT-1')],
      ],
      10,
    )
    expect(out.map((d) => d.numero)).toEqual(['RT-1', 'PDV-1', 'COTI-1'])
  })

  it('mismo día y mismo tipo: desempata el número, y después el id', () => {
    const out = ultimosDocumentos([[doc('cotizacion', '2026-09-21', 'COTI-2'), doc('cotizacion', '2026-09-21', 'COTI-9')]], 10)
    expect(out.map((d) => d.numero)).toEqual(['COTI-9', 'COTI-2'])

    const mismoNumero = ultimosDocumentos(
      [[doc('cotizacion', '2026-09-21', 'COTI-1', 'b'), doc('cotizacion', '2026-09-21', 'COTI-1', 'a')]],
      10,
    )
    expect(mismoNumero.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('el mismo conjunto en otro orden de entrada da el MISMO resultado', () => {
    const a = [doc('cotizacion', '2026-09-21', 'COTI-1'), doc('pedido', '2026-09-21', 'PDV-1')]
    const uno = ultimosDocumentos([a, []], 10).map((d) => d.numero)
    const otro = ultimosDocumentos([[], [...a].reverse()], 10).map((d) => d.numero)
    expect(uno).toEqual(otro)
  })

  it('respeta el límite', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => doc('cotizacion', `2026-09-${String(i + 1).padStart(2, '0')}`, `COTI-${i}`))
    expect(ultimosDocumentos([muchos], 8)).toHaveLength(8)
  })

  it('sin documentos devuelve vacío, no explota', () => {
    expect(ultimosDocumentos([[], [], []], 8)).toEqual([])
  })
})

describe('Cada documento abre su ficha real', () => {
  it('cada tipo va a su listado de Ventas', () => {
    expect(rutaDelDocumento({ tipo: 'cotizacion', id: 'x' })).toBe('/ventas/cotizaciones/x')
    expect(rutaDelDocumento({ tipo: 'pedido', id: 'x' })).toBe('/ventas/pedidos/x')
    expect(rutaDelDocumento({ tipo: 'entrega', id: 'x' })).toBe('/ventas/entregas/x')
  })
})
