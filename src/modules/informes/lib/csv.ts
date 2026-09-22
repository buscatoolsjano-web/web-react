import type { FilaDocumentoInforme } from '../services/documentos'
import type { FilaActividad, FilaPipeline, FilaRanking, ParametrosRanking } from '../types'

/**
 * CSV de Informes.
 *
 * Sin imports de código propio a propósito: la suite de base de la Entrega 3
 * importa este archivo directo con Node (type stripping), y un import sin
 * extensión rompería ahí. Los CSV de stock viven en `csvStock.ts`.
 *
 * Los datos salen del servidor ya filtrados y agregados (las mismas RPC que la
 * pantalla, con el mes elegido; el ranking completo, paginado de a 500). Acá
 * sólo se escribe el archivo, con las convenciones del resto del ERP:
 *
 *   · separador `;`, fin de línea CRLF, UTF-8 con BOM (Excel en Windows);
 *   · la moneda en su propia columna, nunca «Total USD»; `SIN MONEDA` escrito;
 *   · importes con punto decimal, 2 decimales, sin miles ni símbolo;
 *     cantidades con hasta 4 decimales; fechas ISO `YYYY-MM-DD`;
 *   · texto protegido contra inyección de fórmulas (ver `texto`).
 */

/**
 * Un campo de TEXTO. Si empieza con `=`, `+`, `-`, `@`, tabulación o retorno,
 * una planilla lo puede ejecutar como fórmula: se antepone `'`. Después se
 * escapa el separador, las comillas y los saltos de línea.
 *
 * Los números NO pasan por acá: un importe negativo tiene que seguir siendo
 * un número.
 */
export function texto(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return ''
  let s = String(valor)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** Un importe: punto decimal, 2 decimales. Vacío si no hay dato. */
export function importe(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return ''
  const v = Number(n)
  return Number.isFinite(v) ? v.toFixed(2) : ''
}

/** Una cantidad o un conteo: hasta 4 decimales, sin ceros de sobra. */
export function numero(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return ''
  const v = Number(n)
  return Number.isFinite(v) ? String(Math.round(v * 10_000) / 10_000) : ''
}

const siNo = (b: boolean | null) => (b === null ? '' : b ? 'si' : 'no')

export function armar(columnas: readonly string[], filas: string[][]): string {
  return [columnas.map(texto).join(';'), ...filas.map((f) => f.join(';'))].join('\r\n')
}

const ETIQUETA_TIPO_CSV: Record<string, string> = {
  entregas: 'Entregado',
  pedidos: 'Pedido confirmado',
  cotizaciones: 'Cotizado',
}

/** Actividad comercial: las filas de `informe_actividad_comercial`, tal cual. */
export function actividadACsv(filas: readonly FilaActividad[]): string {
  const datos = filas.filter((f) => f.tipo !== null)
  return armar(
    ['Periodo', 'Tipo', 'Mes', 'Desde', 'Hasta', 'Moneda', 'Documentos', 'Importe', 'En revision'],
    datos.map((f) => [
      texto(f.periodo),
      texto(ETIQUETA_TIPO_CSV[f.tipo ?? ''] ?? f.tipo),
      texto(f.mes),
      texto(f.desde),
      texto(f.hasta),
      texto(f.moneda ?? 'SIN MONEDA'),
      numero(f.documentos),
      importe(f.importe),
      numero(f.en_revision),
    ]),
  )
}

/**
 * Pipeline, conversión y cumplimiento: las filas de `informe_pipeline_comercial`.
 * `Moneda` sólo existe en las secciones con dinero; en cumplimiento e
 * inconsistencias dice `no aplica`. `TODAS` en conversión son sólo cantidades.
 */
export function pipelineACsv(filas: readonly FilaPipeline[]): string {
  const conMoneda = new Set(['cotizaciones_abiertas', 'conversion', 'pedidos_pendientes'])
  const datos = filas.filter((f) => !f.seccion.startsWith('rango_'))
  return armar(
    ['Seccion', 'Periodo', 'Desde', 'Hasta', 'Categoria', 'Moneda', 'Documentos', 'Importe', 'Convertidas', 'Importe convertido', 'Abiertas', 'Aceptadas'],
    datos.map((f) => [
      texto(f.seccion),
      texto(f.periodo),
      texto(f.desde),
      texto(f.hasta),
      texto(f.categoria),
      texto(conMoneda.has(f.seccion) ? (f.moneda ?? 'SIN MONEDA') : 'no aplica'),
      numero(f.documentos),
      importe(f.importe),
      numero(f.convertidas),
      importe(f.importe_convertido),
      numero(f.abiertas),
      numero(f.aceptadas),
    ]),
  )
}

/** El ranking COMPLETO con los filtros de la pantalla, no sólo el Top 10. */
export function rankingACsv(p: ParametrosRanking, filas: readonly FilaRanking[]): string {
  const esCliente = p.dimension === 'clientes'
  const columnas = esCliente
    ? ['Posicion', 'Cliente ID', 'Cliente', 'Activo', 'Fuente', 'Desde', 'Hasta', 'Moneda', 'Importe', 'Documentos']
    : ['Posicion', 'Producto ID', 'SKU', 'Producto', 'Vinculado al catalogo', 'Activo', 'Fuente', 'Medida', 'Desde', 'Hasta', 'Moneda', 'Importe', 'Cantidad', 'Documentos', 'Lineas atipicas', 'Cantidad atipica']
  return armar(
    columnas,
    filas.map((f) =>
      esCliente
        ? [numero(f.posicion), texto(f.cliente_id), texto(f.etiqueta), siNo(f.activo), texto(p.fuente), texto(f.desde), texto(f.hasta), texto(f.moneda ?? 'SIN MONEDA'), importe(f.importe), numero(f.documentos)]
        : [
            numero(f.posicion), texto(f.producto_id), texto(f.codigo), texto(f.etiqueta), siNo(f.vinculado), siNo(f.activo),
            texto(p.fuente), texto(p.medida), texto(f.desde), texto(f.hasta),
            texto(p.medida === 'importe' ? (f.moneda ?? 'SIN MONEDA') : 'no aplica'),
            importe(f.importe), numero(f.cantidad), numero(f.documentos), numero(f.lineas_atipicas), numero(f.cantidad_atipica),
          ],
    ),
  )
}

/** Sólo letras, dígitos, punto, guion y guion bajo. `SIN MONEDA` → `SIN-MONEDA`. */
export function nombreArchivo(partes: readonly (string | null | undefined)[]): string {
  const base = ['informe', ...partes]
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter((x) => x !== '')
    .join('-')
  return `${base}.csv`
}

/** El contenido del archivo: BOM + CSV. Separado de la descarga para poder probarlo. */
export function contenidoConBom(csv: string): string {
  return '﻿' + csv
}

/** Dispara la descarga. El BOM va adelante: sin él Excel en Windows rompe las tildes. */
export function descargarCsv(nombre: string, csv: string): void {
  const blob = new Blob([contenidoConBom(csv)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Los documentos del universo que se está viendo (Fase 21 · E3.1).
 *
 * El CSV anterior exportaba el informe agregado ENTERO: todas las métricas,
 * todas las monedas, todos los meses. Si uno estaba mirando «USD · Entregado ·
 * septiembre · serie RT», el archivo traía pesos, pedidos y agosto. Un export
 * que no es lo que está en pantalla es peor que no tenerlo: nadie lo revisa
 * contra la pantalla antes de mandarlo.
 *
 * Las filas vienen de `informe_documentos` con los MISMOS filtros que la
 * sección Documentos, así que la cantidad y la suma del archivo son las que
 * muestra la pantalla. No se reconstruye ninguna regla comercial acá.
 */
export function documentosACsv(filas: readonly FilaDocumentoInforme[]): string {
  return armar(
    ['fecha', 'tipo', 'numero', 'cliente', 'estado', 'serie', 'origen', 'importe', 'moneda', 'en_revision'],
    filas.map((d) => [
      texto(d.fecha),
      texto(d.tipo),
      texto(d.numero),
      texto(d.cliente),
      texto(d.estado),
      texto(d.serie),
      // Vacío y «ERP» no son lo mismo: el origen nulo significa que lo emitió
      // el ERP, y escribirlo evita que alguien lo lea como dato faltante.
      texto(d.origen ?? 'ERP'),
      importe(d.importe),
      texto(d.moneda),
      d.enRevision ? 'si' : 'no',
    ]),
  )
}
