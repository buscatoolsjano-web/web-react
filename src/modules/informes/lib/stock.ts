import type {
  CatalogoStock,
  ConteoEstados,
  FilaResumenStock,
  FilaStock,
  ResumenStock,
  TramoUltimoMovimiento,
} from '../types'

/**
 * Informes de stock: sólo cantidades físicas del ERP nuevo. Ningún valor, costo
 * ni «stock crítico»: no hay datos aprobados para eso.
 */

/** Los valores del CHECK de `stock_movements.movement_type`, en castellano. */
export const ETIQUETA_TIPO_MOVIMIENTO: Record<string, string> = {
  opening_balance: 'Saldo inicial',
  purchase_receipt: 'Recepción de compra',
  sale_delivery: 'Entrega de venta',
  adjustment: 'Ajuste',
  transfer_in: 'Transferencia entrante',
  transfer_out: 'Transferencia saliente',
  return_in: 'Devolución recibida',
  return_out: 'Devolución enviada',
  service_consumption: 'Consumo en servicio técnico',
}

/** Los `source_type` que escriben las funciones de Ventas, Compras y Mantenimiento, más los del histórico. */
export const ETIQUETA_ORIGEN: Record<string, string> = {
  delivery: 'Remito',
  goods_receipt: 'Recepción de compra',
  maintenance_order: 'Orden de servicio',
  migration: 'Migración del legacy',
  test: 'Prueba',
}

export const SIN_ORIGEN = 'sin_origen'

export function etiquetaTipoMovimiento(tipo: string): string {
  return ETIQUETA_TIPO_MOVIMIENTO[tipo] ?? tipo
}

export function etiquetaOrigen(origen: string | null): string {
  if (origen === null || origen === SIN_ORIGEN) return 'Sin origen'
  return ETIQUETA_ORIGEN[origen] ?? origen
}

/** Rutas reales de documento, sólo para los orígenes que tienen pantalla. Nunca un enlace roto. */
const RUTA_ORIGEN: Record<string, string> = {
  delivery: '/ventas/entregas',
  goods_receipt: '/compras/recepciones',
  maintenance_order: '/mantenimiento/ordenes',
}

export function enlaceOrigen(origen: string | null, id: string | null): string | null {
  if (!origen || !id) return null
  const base = RUTA_ORIGEN[origen]
  return base ? `${base}/${id}` : null
}

/** Texto del origen de un movimiento: el tipo de documento y su número, o «Sin documento origen». */
export function textoOrigen(origen: string | null, id: string | null, referencia: string | null): string {
  if (!id) return origen ? `${etiquetaOrigen(origen)} · sin documento origen` : 'Sin documento origen'
  return referencia ? `${etiquetaOrigen(origen)} ${referencia}` : etiquetaOrigen(origen)
}

/** Estado del saldo, en palabras: el negativo no se comunica sólo con color. */
export function etiquetaEstado(f: Pick<FilaStock, 'estado' | 'disponible_negativo'>): string[] {
  const base = f.estado === 'negativo' ? 'Stock negativo' : f.estado === 'cero' ? 'En cero' : 'Con stock'
  return f.disponible_negativo ? [base, 'Disponible negativo'] : [base]
}

export const ETIQUETA_FILTRO_ESTADO: Record<string, string> = {
  con_stock: 'Con stock',
  cero: 'En cero',
  negativo: 'Stock negativo',
  disponible_negativo: 'Disponible negativo',
  reservado: 'Con reservas',
}

export const ETIQUETA_TRAMO: Record<TramoUltimoMovimiento, string> = {
  '0_30': 'hasta 30 días',
  '31_90': '31 a 90 días',
  '91_180': '91 a 180 días',
  '181_365': '181 a 365 días',
  mas_365: 'más de 365 días',
}

const TRAMOS: readonly TramoUltimoMovimiento[] = ['0_30', '31_90', '91_180', '181_365', 'mas_365']

const conteo = (filas: FilaResumenStock[], wid: string | null): ConteoEstados => {
  const de = (cat: keyof ConteoEstados) =>
    Number(filas.find((f) => f.seccion === 'estado' && f.warehouse_id === wid && f.categoria === cat)?.cantidad ?? 0)
  return {
    balances: de('balances'),
    con_stock: de('con_stock'),
    en_cero: de('en_cero'),
    negativo: de('negativo'),
    disponible_negativo: de('disponible_negativo'),
    con_reservas: de('con_reservas'),
  }
}

export function armarResumenStock(filas: FilaResumenStock[]): ResumenStock {
  const rango = filas.find((f) => f.seccion === 'rango')
  if (!rango?.desde || !rango.hasta) throw new Error('El informe no trajo el período')
  const valor = (seccion: string, categoria: string) =>
    Number(filas.find((f) => f.seccion === seccion && f.categoria === categoria)?.cantidad ?? 0)
  const lista = (seccion: string) =>
    filas
      .filter((f) => f.seccion === seccion && f.categoria !== null)
      .map((f) => ({ clave: f.categoria!, cantidad: Number(f.cantidad) }))
      .sort((a, b) => b.cantidad - a.cantidad || a.clave.localeCompare(b.clave))

  return {
    mes: { desde: rango.desde, hasta: rango.hasta },
    total: conteo(filas, null),
    depositos: filas
      .filter((f) => f.seccion === 'deposito' && f.warehouse_id)
      .map((f) => ({ id: f.warehouse_id!, codigo: f.codigo ?? '', nombre: f.deposito ?? '', activo: f.activo !== false, estados: conteo(filas, f.warehouse_id) }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo)),
    productos: {
      conBalance: valor('productos', 'con_balance'),
      conMovimientos: valor('productos', 'con_movimientos'),
      movidoHoyEnCero: valor('productos', 'movido_hoy_en_cero'),
    },
    ultimoMovimiento: Object.fromEntries(TRAMOS.map((t) => [t, valor('ultimo_movimiento', t)])) as Record<TramoUltimoMovimiento, number>,
    movimientosMes: {
      movimientos: valor('mes', 'movimientos'),
      entradas: valor('mes', 'entradas'),
      salidas: valor('mes', 'salidas'),
      productos: valor('mes', 'productos'),
      depositos: valor('mes', 'depositos'),
      sinDocumento: valor('mes', 'sin_documento'),
    },
    porTipo: lista('mes_tipo'),
    porOrigen: lista('mes_origen'),
  }
}

export function armarCatalogo(filas: { categoria: string; cantidad: number }[]): CatalogoStock {
  const v = (c: string) => Number(filas.find((f) => f.categoria === c)?.cantidad ?? 0)
  return { catalogo: v('catalogo'), sinMovimientos: v('sin_movimientos'), sinBalance: v('sin_balance') }
}

/** Una cantidad física: hasta 3 decimales (los de la base), con signo si se pide. */
export function formatearCantidad(n: number | null, conSigno = false): string {
  if (n === null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const txt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Math.abs(v))
  if (v < 0) return `−${txt}`
  return conSigno && v > 0 ? `+${txt}` : txt
}

/** Saldo del kardex: sólo si el servidor lo pudo verificar contra stock_balances. */
export function formatearSaldo(saldo: number | null, verificado: boolean): string {
  return verificado && saldo !== null ? formatearCantidad(saldo) : '—'
}

/** `2026-09-09T13:59:23Z` → `09/09/2026 10:59` en hora de Argentina. */
export function formatearFechaHora(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

/** Hoy en Argentina, `YYYY-MM-DD`, para el nombre del CSV de stock actual. */
export function hoyAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
}
