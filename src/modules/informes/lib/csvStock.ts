import type { FilaMovimiento, FilaStock } from '../types'
import { armar, numero, texto } from './csv'
import { etiquetaEstado, etiquetaOrigen, etiquetaTipoMovimiento } from './stock'

/**
 * Stock actual con los filtros de la pantalla. Sin moneda ni valor: son
 * cantidades físicas por producto y depósito.
 */
export function stockACsv(filas: readonly FilaStock[]): string {
  return armar(
    ['SKU', 'Producto', 'Deposito', 'En stock', 'Reservado', 'Disponible', 'Estado stock', 'Estado producto', 'Ultimo movimiento'],
    filas.map((f) => [
      texto(f.sku),
      texto(f.producto),
      texto(f.deposito_codigo ? `${f.deposito_codigo} · ${f.deposito}` : f.deposito),
      numero(f.on_hand),
      numero(f.reserved),
      numero(f.available),
      texto(etiquetaEstado(f).join(' · ')),
      texto(f.producto_activo ? 'activo' : 'inactivo'),
      texto(f.ultimo_movimiento ? f.ultimo_movimiento.slice(0, 10) : ''),
    ]),
  )
}

/**
 * Movimientos del mes con los filtros de la pantalla. La cantidad lleva su
 * signo real (entrada +, salida −); «Sentido» lo repite en palabras.
 */
export function movimientosACsv(filas: readonly FilaMovimiento[]): string {
  return armar(
    ['Fecha', 'SKU', 'Producto', 'Deposito', 'Tipo', 'Sentido', 'Cantidad', 'Origen', 'Referencia'],
    filas.map((f) => [
      texto(f.dia),
      texto(f.sku),
      texto(f.producto),
      texto(f.deposito_codigo ? `${f.deposito_codigo} · ${f.deposito ?? ''}` : f.deposito),
      texto(etiquetaTipoMovimiento(f.movement_type)),
      texto(f.sentido),
      numero(f.quantity),
      texto(f.source_id ? etiquetaOrigen(f.source_type) : `${etiquetaOrigen(f.source_type)} (sin documento origen)`),
      texto(f.referencia),
    ]),
  )
}

