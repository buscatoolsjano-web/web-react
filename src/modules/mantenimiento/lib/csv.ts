import type { ActivoListado, OrdenListado } from '../types'

/**
 * Exportación a CSV de Mantenimiento.
 *
 * **Esto sí es migración.** El Mantenimiento legacy tenía una pantalla
 * «Exportar» de verdad (`_mantExportarView`) con cuatro CSV —histórico,
 * activos, clientes y fichas activas— y un backup JSON de las nueve
 * colecciones de `localStorage`.
 *
 * De eso se migran **los CSV de equipos y de órdenes**, que son los dos
 * listados que existen acá. Los otros dos no tienen equivalente: los clientes
 * se exportan desde Clientes, que es donde viven ahora, y el «histórico» del
 * legacy era una colección aparte que acá es simplemente una orden cerrada,
 * así que sale del mismo CSV de órdenes filtrando por estado.
 *
 * El **backup JSON con su importador no se migra**, y no por olvido: era el
 * mecanismo de respaldo de una aplicación que vivía en el navegador. Un botón
 * que sobrescribe nueve colecciones enteras desde un archivo que trae el
 * usuario no tiene lugar contra una base multiempresa con RLS. El respaldo lo
 * hace Supabase.
 */

/** Escapa un campo. La coma, el punto y coma y las comillas rompen un CSV. */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  const s = String(valor)
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Un importe listo para una planilla: punto decimal, sin miles, sin símbolo. */
export function importe(n: number | null): string {
  return n !== null && Number.isFinite(n) ? n.toFixed(2) : ''
}

const COLUMNAS_EQUIPOS = [
  'Referencia',
  'Identificador',
  'Serie',
  'Marca',
  'Modelo',
  'Tipo',
  'Dueno actual',
  'SKU',
  'Ciudad',
  'Bajo contrato',
  'Ordenes',
  'Estado',
  'Alta',
] as const

export function equiposACsv(filas: readonly ActivoListado[]): string {
  const lineas = [COLUMNAS_EQUIPOS.join(';')]
  for (const a of filas) {
    lineas.push(
      [
        celda(a.referencia),
        celda(a.identificador),
        celda(a.serie),
        celda(a.marca),
        celda(a.modelo),
        celda(a.tipo),
        celda(a.dueno),
        celda(a.productoSku),
        celda(a.ciudad),
        celda(a.bajoContrato ? 'si' : 'no'),
        celda(a.ordenes),
        celda(a.dadoDeBaja ? 'baja' : 'activo'),
        celda(a.creadoEn.slice(0, 10)),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

const COLUMNAS_ORDENES = [
  'Numero',
  'Ingreso',
  'Entrega',
  'Cliente',
  'Equipo',
  'Serie',
  'Servicio',
  'Etapa',
  'Estado',
  'En espera',
  'Cotizacion',
  'Moneda',
  'Total',
] as const

/**
 * La moneda va en su **propia columna** y el total sin símbolo.
 *
 * Cada orden cotiza en la suya —`quote_currency_code` es por orden—, así que
 * quien abra el archivo agrupa por esa columna antes de sumar. Una columna
 * «Total» sola, con pesos y dólares mezclados, invita a sumar lo que no se
 * suma.
 */
export function ordenesACsv(
  filas: readonly OrdenListado[],
  etiquetaEtapa: (e: string) => string,
  etiquetaEstado: (e: string) => string,
  etiquetaServicio: (e: string) => string,
  etiquetaCotizacion: (e: string) => string,
): string {
  const lineas = [COLUMNAS_ORDENES.join(';')]
  for (const o of filas) {
    lineas.push(
      [
        celda(o.numero),
        celda(o.fechaIngreso),
        celda(o.fechaEntrega),
        celda(o.cliente),
        celda(o.activoReferencia),
        celda(o.activoSerie),
        celda(etiquetaServicio(o.tipoServicio)),
        celda(etiquetaEtapa(o.etapa)),
        celda(etiquetaEstado(o.estado)),
        celda(o.enEspera ? 'si' : 'no'),
        celda(etiquetaCotizacion(o.estadoCotizacion)),
        celda(o.moneda),
        celda(importe(o.total)),
      ].join(';'),
    )
  }
  return lineas.join('\r\n')
}

/**
 * Dispara la descarga.
 *
 * El BOM va adelante a propósito: sin él Excel en Windows abre las tildes
 * rotas, y acá hay «Diagnóstico», «Cotización» y «Reparación».
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
