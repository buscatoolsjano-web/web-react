import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { formatearFecha, formatearImporte, formatearNumero } from '../lib/formato'
import {
  compartidoCon,
  etiquetaDeDocumento,
  importeDelServicio,
  resumenDelServicio,
  tieneDetalle,
  tituloDeEvento,
} from '../lib/historial'
import type { DocumentoFuente, ServicioHistorico } from '../types'
import styles from './TimelineServicios.module.css'

export interface TimelineServiciosProps {
  servicios: readonly ServicioHistorico[]
  cargando: boolean
}

/**
 * El historial de servicio del equipo, importado de STEL (Fase 20 · E2).
 *
 * Un evento por servicio, no uno por documento: el presupuesto, la orden y el
 * remito de un mismo trabajo son **el mismo servicio**, y mostrarlos como tres
 * eventos haría parecer que la llave entró tres veces.
 *
 * Todo lo que se ve acá es de sólo lectura. No hay acciones, y no es una
 * decisión de esta pantalla: las tablas no tienen policy de escritura.
 */
export function TimelineServicios({ servicios, cargando }: TimelineServiciosProps) {
  if (cargando) return <SkeletonRows rows={3} />

  if (servicios.length === 0) {
    return (
      <EmptyState
        icon="wrench"
        title="Este equipo no tiene servicios en el historial"
        description="El historial importado cubre los trabajos que quedaron registrados en STEL. Un equipo puede no tener ninguno."
      />
    )
  }

  return (
    <ol className={styles.linea}>
      {servicios.map((s) => (
        <Evento key={s.id} servicio={s} />
      ))}
    </ol>
  )
}

function Evento({ servicio: s }: { servicio: ServicioHistorico }) {
  const [verDocumentos, setVerDocumentos] = useState(false)
  const importe = importeDelServicio(s)
  const compartido = compartidoCon(s)
  const resumen = resumenDelServicio(s)

  return (
    <li className={styles.evento}>
      <div className={styles.cabecera}>
        <div className={styles.identidad}>
          <span className={styles.fecha}>{formatearFecha(s.entrega ?? s.ingreso)}</span>
          <span className={styles.referencia}>{s.referencia}</span>
        </div>
        <span className={styles.estado}>{tituloDeEvento(s)}</span>
      </div>

      {resumen ? (
        <p className={styles.trabajo}>{resumen}</p>
      ) : (
        <p className={styles.sinTexto}>Sin descripción del trabajo en el documento.</p>
      )}

      <dl className={styles.datos}>
        <div>
          <dt>Ingresó</dt>
          <dd>{formatearFecha(s.ingreso)}</dd>
        </div>
        <div>
          <dt>Entregado</dt>
          <dd>{s.entrega ? formatearFecha(s.entrega) : 'Sin remito registrado'}</dd>
        </div>
        <div>
          <dt>Técnico</dt>
          <dd>{s.tecnico ?? 'Sin registrar'}</dd>
        </div>
        <div>
          <dt>Importe</dt>
          <dd>
            {importe.propio ? (
              formatearImporte(importe.monto, importe.moneda)
            ) : (
              <span className={styles.compartido}>
                {importe.nota}
                {importe.monto !== null ? (
                  <span className={styles.contexto}>
                    {' '}
                    (total del servicio: {formatearImporte(importe.monto, importe.moneda)})
                  </span>
                ) : null}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {compartido ? <p className={styles.nota}>{compartido}</p> : null}

      {s.documentos.length > 0 ? (
        <>
          <button
            type="button"
            className={styles.verDocs}
            onClick={() => setVerDocumentos((v) => !v)}
            aria-expanded={verDocumentos}
          >
            <Icon name={verDocumentos ? 'chevron-up' : 'chevron-down'} size={16} />
            {s.documentos.length === 1 ? '1 documento' : `${s.documentos.length} documentos`}
            <span className={styles.refsDocs}>{s.documentos.map((d) => d.referencia).join(' · ')}</span>
          </button>
          {verDocumentos ? (
            <ul className={styles.documentos}>
              {s.documentos.map((d) => (
                <Documento key={d.id} doc={d} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/* El estado crudo de STEL, discreto: sirve para auditar la traducción
          sin competir con lo que se lee arriba. */}
      <p className={styles.origen}>En STEL: {s.estadoStel}</p>
    </li>
  )
}

function Documento({ doc }: { doc: DocumentoFuente }) {
  const [verLineas, setVerLineas] = useState(false)
  return (
    <li className={styles.documento}>
      <div className={styles.docCabecera}>
        <span className={styles.docTipo}>{etiquetaDeDocumento(doc.tipo)}</span>
        <span className={styles.docRef}>{doc.referencia}</span>
        <span className={styles.docFecha}>{formatearFecha(doc.fecha)}</span>
        {doc.estadoStel ? <span className={styles.docEstado}>{doc.estadoStel}</span> : null}
        {doc.total !== null ? (
          <span className={styles.docTotal}>{formatearImporte(doc.total, doc.moneda)}</span>
        ) : null}
        {doc.pdf ? (
          <a className={styles.docPdf} href={doc.pdf} target="_blank" rel="noreferrer noopener">
            <Icon name="external-link" size={16} /> PDF
          </a>
        ) : null}
      </div>
      {tieneDetalle(doc) ? (
        <>
          <button type="button" className={styles.verLineas} onClick={() => setVerLineas((v) => !v)} aria-expanded={verLineas}>
            {verLineas ? 'Ocultar detalle' : `Ver detalle (${doc.lineas.length})`}
          </button>
          {verLineas ? (
            <ul className={styles.lineas}>
              {doc.lineas.map((l) => (
                <li key={l.id} className={styles.lineaDoc}>
                  <span className={styles.lineaTexto}>
                    {l.sku ? (
                      l.productoId ? (
                        <Link to={`/catalogo?producto=${l.productoId}`} className={styles.sku}>
                          {l.sku}
                        </Link>
                      ) : (
                        <span className={styles.sku}>{l.sku}</span>
                      )
                    ) : null}
                    {l.descripcion}
                  </span>
                  {l.cantidad !== null && l.tipo !== 'section' ? (
                    <span className={styles.lineaCantidad}>×{formatearNumero(l.cantidad)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  )
}
