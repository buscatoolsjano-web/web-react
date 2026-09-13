import { describe, expect, it } from 'vitest'
import { movimientosACsv, stockACsv } from './csvStock'
import { contenidoConBom, nombreArchivo } from './csv'
import {
  armarCatalogo,
  armarResumenStock,
  enlaceOrigen,
  etiquetaEstado,
  etiquetaOrigen,
  etiquetaTipoMovimiento,
  formatearCantidad,
  formatearSaldo,
  textoOrigen,
} from './stock'
import { leerVista } from './vista'
import type { FilaMovimiento, FilaResumenStock, FilaStock } from '../types'

const r = (p: Partial<FilaResumenStock> & Pick<FilaResumenStock, 'seccion'>): FilaResumenStock => ({
  warehouse_id: null, codigo: null, deposito: null, activo: null, categoria: null, cantidad: 0, desde: null, hasta: null, ...p,
})

describe('resumen de stock', () => {
  const W = 'w-1'
  const filas: FilaResumenStock[] = [
    r({ seccion: 'rango', desde: '2026-09-01', hasta: '2026-09-13' }),
    r({ seccion: 'deposito', warehouse_id: W, codigo: 'PRIN', deposito: 'Depósito principal', activo: true, cantidad: 379 }),
    ...(['balances', 'con_stock', 'en_cero', 'negativo', 'disponible_negativo', 'con_reservas'] as const).map((c, i) =>
      r({ seccion: 'estado', warehouse_id: W, codigo: 'PRIN', categoria: c, cantidad: [381, 377, 1, 1, 2, 3][i]! })),
    ...(['balances', 'con_stock', 'en_cero', 'negativo', 'disponible_negativo', 'con_reservas'] as const).map((c, i) =>
      r({ seccion: 'estado', deposito: 'TODOS', categoria: c, cantidad: [381, 377, 1, 1, 2, 3][i]! })),
    r({ seccion: 'productos', categoria: 'con_balance', cantidad: 380 }),
    r({ seccion: 'productos', categoria: 'con_movimientos', cantidad: 379 }),
    r({ seccion: 'productos', categoria: 'movido_hoy_en_cero', cantidad: 1 }),
    r({ seccion: 'ultimo_movimiento', categoria: '0_30', cantidad: 379 }),
    r({ seccion: 'mes', categoria: 'movimientos', cantidad: 381, desde: '2026-09-01', hasta: '2026-09-13' }),
    r({ seccion: 'mes', categoria: 'entradas', cantidad: 379 }),
    r({ seccion: 'mes', categoria: 'salidas', cantidad: 2 }),
    r({ seccion: 'mes', categoria: 'sin_documento', cantidad: 381 }),
    r({ seccion: 'mes_tipo', categoria: 'adjustment', cantidad: 1 }),
    r({ seccion: 'mes_tipo', categoria: 'opening_balance', cantidad: 379 }),
    r({ seccion: 'mes_origen', categoria: 'sin_origen', cantidad: 2 }),
  ]
  const res = armarResumenStock(filas)

  it('total y por depósito, con el negativo y el disponible negativo por separado', () => {
    expect(res.total).toEqual({ balances: 381, con_stock: 377, en_cero: 1, negativo: 1, disponible_negativo: 2, con_reservas: 3 })
    expect(res.depositos).toEqual([{ id: W, codigo: 'PRIN', nombre: 'Depósito principal', activo: true, estados: res.total }])
  })

  it('tramos de último movimiento completos con ceros; tipos ordenados por cantidad', () => {
    expect(res.ultimoMovimiento).toEqual({ '0_30': 379, '31_90': 0, '91_180': 0, '181_365': 0, mas_365: 0 })
    expect(res.porTipo.map((t) => t.clave)).toEqual(['opening_balance', 'adjustment'])
    expect(res.movimientosMes).toMatchObject({ movimientos: 381, entradas: 379, salidas: 2, productos: 0, sinDocumento: 381 })
  })

  it('sin período no inventa fechas; catálogo aparte', () => {
    expect(() => armarResumenStock([])).toThrow()
    expect(armarCatalogo([{ categoria: 'catalogo', cantidad: 21772 }, { categoria: 'sin_movimientos', cantidad: 21393 }])).toEqual({ catalogo: 21772, sinMovimientos: 21393, sinBalance: 0 })
  })
})

describe('estado y disponible', () => {
  it('stock negativo y disponible negativo son etiquetas distintas, en texto', () => {
    expect(etiquetaEstado({ estado: 'con_stock', disponible_negativo: false })).toEqual(['Con stock'])
    expect(etiquetaEstado({ estado: 'con_stock', disponible_negativo: true })).toEqual(['Con stock', 'Disponible negativo'])
    expect(etiquetaEstado({ estado: 'negativo', disponible_negativo: true })).toEqual(['Stock negativo', 'Disponible negativo'])
    expect(etiquetaEstado({ estado: 'cero', disponible_negativo: false })).toEqual(['En cero'])
  })

  it('cantidades con signo real y hasta 3 decimales', () => {
    expect(formatearCantidad(-30)).toBe('−30')
    expect(formatearCantidad(100, true)).toBe('+100')
    expect(formatearCantidad(1.5)).toBe('1,5')
    expect(formatearCantidad(1598510)).toBe('1.598.510')
    expect(formatearCantidad(null)).toBe('—')
  })

  it('saldo del kardex sólo si está verificado', () => {
    expect(formatearSaldo(65, true)).toBe('65')
    expect(formatearSaldo(65, false)).toBe('—')
    expect(formatearSaldo(null, true)).toBe('—')
  })
})

describe('movimientos: tipos, origen y enlaces', () => {
  it('etiquetas en castellano de los valores reales; desconocido tal cual', () => {
    expect(etiquetaTipoMovimiento('opening_balance')).toBe('Saldo inicial')
    expect(etiquetaTipoMovimiento('service_consumption')).toBe('Consumo en servicio técnico')
    expect(etiquetaTipoMovimiento('otro_futuro')).toBe('otro_futuro')
    expect(etiquetaOrigen('migration')).toBe('Migración del legacy')
    expect(etiquetaOrigen(null)).toBe('Sin origen')
  })

  it('enlace sólo con documento y ruta real; nunca un enlace roto', () => {
    expect(enlaceOrigen('delivery', 'd-1')).toBe('/ventas/entregas/d-1')
    expect(enlaceOrigen('goods_receipt', 'r-1')).toBe('/compras/recepciones/r-1')
    expect(enlaceOrigen('maintenance_order', 'm-1')).toBe('/mantenimiento/ordenes/m-1')
    expect(enlaceOrigen('migration', null)).toBeNull()
    expect(enlaceOrigen('test', 'x')).toBeNull()
    expect(enlaceOrigen(null, 'x')).toBeNull()
  })

  it('«Sin documento origen» explícito', () => {
    expect(textoOrigen('migration', null, null)).toBe('Migración del legacy · sin documento origen')
    expect(textoOrigen(null, null, null)).toBe('Sin documento origen')
    expect(textoOrigen('delivery', 'd-1', 'RT0001')).toBe('Remito RT0001')
  })
})

describe('CSV de stock y movimientos', () => {
  const stock: FilaStock = {
    posicion: 1, total_filas: 1, producto_id: 'p', sku: '=SKU', producto: 'Pinza 4" (100mm)', producto_activo: false,
    warehouse_id: 'w', deposito_codigo: 'PRIN', deposito: 'Depósito principal', on_hand: -2.5, reserved: 1, available: -3.5,
    estado: 'negativo', disponible_negativo: true, ultimo_movimiento: '2026-09-08T19:21:19Z',
  }

  it('stock: sin moneda ni valor; negativos como número; SKU con fórmula neutralizado', () => {
    const [cab, fila] = stockACsv([stock]).split('\r\n')
    expect(cab).toBe('SKU;Producto;Deposito;En stock;Reservado;Disponible;Estado stock;Estado producto;Ultimo movimiento')
    expect(fila).toBe(`'=SKU;"Pinza 4"" (100mm)";PRIN · Depósito principal;-2.5;1;-3.5;Stock negativo · Disponible negativo;inactivo;2026-09-08`)
    expect(cab).not.toMatch(/moneda|valor|costo/i)
  })

  it('movimientos: fecha ISO, signo real, origen sin documento explícito', () => {
    const m: FilaMovimiento = {
      posicion: 1, total_filas: 1, movimiento_id: 53, fecha: '2026-09-08T19:21:19Z', dia: '2026-09-08', producto_id: 'p', sku: 'SP.S23-BH6',
      producto: '@producto', producto_activo: true, warehouse_id: 'w', deposito_codigo: 'PRIN', deposito: 'Depósito principal',
      movement_type: 'adjustment', sentido: 'salida', quantity: -5, source_type: 'test', source_id: null, referencia: null, notas: null,
      desde: '2026-09-01', hasta: '2026-09-13',
    }
    expect(movimientosACsv([m]).split('\r\n')).toEqual([
      'Fecha;SKU;Producto;Deposito;Tipo;Sentido;Cantidad;Origen;Referencia',
      "2026-09-08;SP.S23-BH6;'@producto;PRIN · Depósito principal;Ajuste;salida;-5;Prueba (sin documento origen);",
    ])
  })

  it('BOM y nombres de archivo', () => {
    expect(contenidoConBom('x').charCodeAt(0)).toBe(0xfeff)
    expect(nombreArchivo(['stock', 'disponible_negativo', 'PRIN', null, '2026-09-13'])).toBe('informe-stock-disponible_negativo-PRIN-2026-09-13.csv')
    expect(nombreArchivo(['movimientos-stock', '2026-09', null, 'salida'])).toBe('informe-movimientos-stock-2026-09-salida.csv')
  })
})

describe('pestañas', () => {
  it('?vista=stock; cualquier otra cosa es Comercial', () => {
    expect(leerVista('stock')).toBe('stock')
    expect(leerVista(null)).toBe('comercial')
    expect(leerVista('STOCK')).toBe('comercial')
    expect(leerVista('x')).toBe('comercial')
  })
})
