import { describe, expect, it } from 'vitest'
import { aHojaDeVentas } from './hojaVentas'
import type { DocumentoImprimible } from './impresion'

const pedido: DocumentoImprimible = {
  tipo: 'pedido',
  titulo: 'PEDIDO A PROVEEDOR',
  numero: 'PC00002',
  fecha: '2026-11-12',
  proveedor: 'TECNA',
  moneda: 'EUR',
  datos: [
    { etiqueta: 'Proveedor', valor: 'TECNA' },
    { etiqueta: 'Para venta', valor: 'COT-BTS00010' },
    { etiqueta: 'Referencia del proveedor', valor: 'PROV00074' },
    { etiqueta: 'Moneda', valor: 'EUR' },
    { etiqueta: 'Entrega estimada', valor: '25/11/2026' },
    { etiqueta: 'Condición de pago', valor: '50% adelanto' },
  ],
  lineas: [],
  totales: null,
  notas: null,
  relacionados: [],
}

describe('aHojaDeVentas: los dos bloques de datos quedan parejos', () => {
  it('lo del proveedor va en su bloque, con rótulo corto', () => {
    const extra = aHojaDeVentas(pedido).datosExtra ?? []
    expect(extra.filter((d) => d.lado === 'contraparte')).toEqual([
      { etiqueta: 'Código', valor: 'PROV00074', lado: 'contraparte' },
      { etiqueta: 'Entrega estimada', valor: '25/11/2026', lado: 'contraparte' },
    ])
    expect(extra.filter((d) => d.lado !== 'contraparte').map((d) => d.etiqueta)).toEqual(['Para venta'])
  })
})
