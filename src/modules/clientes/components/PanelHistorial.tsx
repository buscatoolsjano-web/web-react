import { Link } from 'react-router-dom'
import { etiquetaDeEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { totalesPorMoneda } from '../lib/totalesPorMoneda'
import type { DocumentoDeCliente } from '../types'
import styles from './PanelHistorial.module.css'

export interface PanelHistorialProps {
  clienteId: string
  documentos: readonly DocumentoDeCliente[]
  cargando: boolean
}

const RUTA = {
  cotizacion: '/ventas/cotizaciones',
  pedido: '/ventas/pedidos',
  entrega: '/ventas/entregas',
} as const

const ETIQUETA = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Nota de entrega',
} as const

/**
 * El historial del cliente.
 *
 * Dos cosas que el legacy hacía distinto:
 *
 * 1. Los documentos se traen por `customer_id`. `getDocumentosCliente`
 *    comparaba el nombre del cliente normalizado contra el que estaba escrito
 *    en cada documento; con eso, corregir una tilde borraba media historia.
 *
 * 2. Los totales van **por moneda**. El panel rápido del legacy sumaba ARS,
 *    USD y EUR en un solo importe.
 */
export function PanelHistorial({ clienteId, documentos, cargando }: PanelHistorialProps) {
  if (cargando) return <p className={styles.nota}>Cargando historial…</p>

  if (documentos.length === 0) {
    return <p className={styles.nota}>Este cliente todavía no tiene documentos.</p>
  }

  const totales = totalesPorMoneda(documentos)
  const porTipo = {
    cotizacion: documentos.filter((d) => d.tipo === 'cotizacion').length,
    pedido: documentos.filter((d) => d.tipo === 'pedido').length,
    entrega: documentos.filter((d) => d.tipo === 'entrega').length,
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.resumen}>
        {totales.map((t) => (
          <div key={t.moneda ?? 'sin'} className={styles.moneda}>
            <span className={styles.monedaEtiqueta}>{t.moneda ?? 'Sin moneda'}</span>
            <span className={styles.monedaTotal}>{formatearImporte(t.total, t.moneda)}</span>
            <span className={styles.monedaDocs}>
              {t.documentos} {t.documentos === 1 ? 'documento' : 'documentos'}
            </span>
          </div>
        ))}
      </div>
      <p className={styles.aclaracion}>
        Los importes no se suman entre monedas: cada una va por su lado y no se convierte nada.
      </p>

      <div className={styles.atajos}>
        {(['cotizacion', 'pedido', 'entrega'] as const).map((tipo) =>
          porTipo[tipo] > 0 ? (
            <Link key={tipo} className={styles.atajo} to={`${RUTA[tipo]}?cliente=${clienteId}`}>
              Ver {porTipo[tipo]} {ETIQUETA[tipo].toLowerCase()}
              {porTipo[tipo] === 1 ? '' : 's'} en Ventas →
            </Link>
          ) : null,
        )}
      </div>

      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Número</th>
              <th scope="col">Fecha</th>
              <th scope="col">Estado</th>
              <th scope="col" className={styles.derecha}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => (
              <tr key={`${d.tipo}-${d.id}`}>
                <td>{ETIQUETA[d.tipo]}</td>
                <td>
                  <Link className={styles.enlace} to={`${RUTA[d.tipo]}/${d.id}`}>
                    {d.numero}
                  </Link>
                </td>
                <td className={styles.nowrap}>{formatearFecha(d.fecha)}</td>
                <td>{etiquetaDeEstado(d.tipo, d.estado)}</td>
                <td className={styles.derecha}>{formatearImporte(d.total, d.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
