import type {
  FacturaListado,
  PedidoCompraListado,
  ProveedorListado,
  RecepcionListado,
} from '../types'

/**
 * Exportación del listado de proveedores a CSV.
 *
 * Las columnas son las del listado. Las notas NO se exportan: son fichas de
 * contacto de varias líneas —hay una de 773 caracteres— y meterlas en una
 * celda convierte el CSV en algo ilegible. Quien las necesite las lee en la
 * ficha, que es donde están enteras.
 */

/** Escapa un campo. La coma, el punto y coma y las comillas rompen un CSV. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const COLUMNAS = [
  'Referencia',
  'Razon social',
  'Nombre comercial',
  'Pais',
  'Telefono',
  'Email',
  'Forma de pago',
  'Estado',
  'Origen',
  'Observaciones',
] as const

export function aCsv(filas: readonly ProveedorListado[]): string {
  const lineas = [COLUMNAS.join(';')]
  for (const p of filas) {
    lineas.push(
      [
        celda(p.referencia),
        celda(p.razonSocial),
        celda(p.nombreComercial),
        celda(p.pais),
        celda(p.telefono),
        celda(p.email),
        celda(p.formaPago),
        celda(p.dadoDeBaja ? 'baja' : p.estado),
        celda(p.esHistorico ? 'migrado' : 'nuevo'),
        celda(p.motivosRevision.join(' | ')),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM va adelante a propósito: sin él Excel en Windows abre las tildes
 * rotas, y varios proveedores las tienen.
 */
export function descargarCsv(nombre: string, contenido: string): void {
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Los tres documentos del circuito ───────────────────────────────────────
//
// Un CSV por documento, con las columnas del listado. **Los importes van sin
// separador de miles y con punto decimal**: un «1.234,56» en una celda lo lee
// Excel como texto y deja de poder sumarse. La moneda va en su propia columna
// y NUNCA se suman dos monedas distintas: quien abra el archivo agrupa por
// esa columna.

/** Un importe listo para una planilla: punto decimal, sin miles, sin símbolo. */
export function importe(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

const COLUMNAS_PEDIDOS = [
  'Numero',
  'Fecha',
  'ETA',
  'Proveedor',
  'Moneda',
  'Total',
  'Estado',
  'Recepcion',
  'Lineas',
  'Creado por',
] as const

export function pedidosACsv(
  filas: readonly PedidoCompraListado[],
  etiquetaEstado: (e: string) => string,
  etiquetaRecepcion: (e: string) => string,
): string {
  const lineas = [COLUMNAS_PEDIDOS.join(';')]
  for (const p of filas) {
    lineas.push(
      [
        celda(p.numero),
        celda(p.fecha),
        celda(p.fechaEstimada),
        celda(p.proveedor),
        celda(p.moneda),
        celda(importe(p.total)),
        celda(etiquetaEstado(p.estado)),
        celda(etiquetaRecepcion(p.estadoRecepcion)),
        celda(p.lineas),
        celda(p.autor),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

const COLUMNAS_RECEPCIONES = [
  'Numero',
  'Fecha',
  'Proveedor',
  'Pedido',
  'Deposito',
  'Estado',
  'Lineas',
  'Unidades',
  'Creado por',
] as const

/**
 * Las recepciones **no llevan importe**: no están valorizadas. Poner una
 * columna de precio acá obligaría a inventarlo o a ir a buscarlo al pedido, y
 * las dos cosas mienten sobre lo que es el documento.
 */
export function recepcionesACsv(filas: readonly RecepcionListado[]): string {
  const lineas = [COLUMNAS_RECEPCIONES.join(';')]
  for (const r of filas) {
    lineas.push(
      [
        celda(r.numero),
        celda(r.fecha),
        celda(r.proveedor),
        celda(r.pedidoNumero),
        celda(r.deposito),
        celda(r.estado === 'confirmed' ? 'Confirmada' : 'Borrador'),
        celda(r.lineas),
        celda(r.unidades),
        celda(r.autor),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

const COLUMNAS_FACTURAS = [
  'Numero del proveedor',
  'Referencia interna',
  'Fecha',
  'Vencimiento',
  'Proveedor',
  'Moneda',
  'Total',
  'Estado',
  'Lineas',
  'Recepciones',
  'Creado por',
] as const

/** El número del proveedor va primero: es el que se busca en el papel. */
export function facturasACsv(
  filas: readonly FacturaListado[],
  etiquetaEstado: (e: string) => string,
): string {
  const lineas = [COLUMNAS_FACTURAS.join(';')]
  for (const f of filas) {
    lineas.push(
      [
        celda(f.numeroProveedor),
        celda(f.numero),
        celda(f.fecha),
        celda(f.vencimiento),
        celda(f.proveedor),
        celda(f.moneda),
        celda(importe(f.total)),
        celda(etiquetaEstado(f.estado)),
        celda(f.lineas),
        celda(f.recepciones),
        celda(f.autor),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}
