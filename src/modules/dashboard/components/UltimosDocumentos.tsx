import { useId } from 'react'
import { Link } from 'react-router-dom'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { ChipEstado } from '@/modules/ventas/components/ChipEstado'
import { presentarEstado } from '@/modules/ventas/lib/estados'
import { formatearFecha, formatearImporte } from '@/modules/ventas/lib/formato'
import type { DocumentoListado } from '@/modules/ventas/types'
import { ETIQUETA_DOCUMENTO, rutaDelDocumento } from '../lib/documentos'
import styles from './Panel.module.css'

export interface UltimosDocumentosProps {
  documentos: readonly DocumentoListado[]
  cargando: boolean
  error: boolean
  parcial: boolean
  onReintentar: () => void
}

/**
 * Los últimos documentos emitidos (Fase 21 · E2).
 *
 * No se llama «actividad reciente» y no muestra horas, y las dos cosas son la
 * misma decisión: se ordena por la FECHA DEL DOCUMENTO. El `created_at` de 669
 * de los 674 documentos es la hora en que corrió la importación, así que un
 * feed con hora mostraría toda la empresa creada el mismo minuto.
 *
 * Con granularidad de día hay empates: el desempate es determinista —tipo,
 * número, id— para que la lista no se reordene sola entre dos cargas.
 */
export function UltimosDocumentos({ documentos, cargando, error, parcial, onReintentar }: UltimosDocumentosProps) {
  const id = useId()

  return (
    <section className={styles.seccion} aria-labelledby={`${id}-t`}>
      <div className={styles.seccionCabecera}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          Últimos documentos
        </h2>
        <Link to="/ventas/cotizaciones" className={styles.enlaceSeccion}>
          Ver Ventas
        </Link>
      </div>

      {cargando ? (
        <SkeletonRows rows={4} columns={4} label="Cargando los últimos documentos…" />
      ) : error ? (
        <ErrorState compact title="No se pudieron leer los últimos documentos." onRetry={onReintentar} />
      ) : documentos.length === 0 ? (
        <p className={styles.vacio}>Todavía no hay documentos emitidos.</p>
      ) : (
        <>
          {parcial ? <p className={styles.aviso}>Falta algún tipo de documento: no se pudo leer uno de los tres listados.</p> : null}
          <ul className={styles.documentos}>
            {documentos.map((d) => {
              const estado = presentarEstado(d.tipo, d.estado)
              return (
                <li key={`${d.tipo}-${d.id}`}>
                  <Link to={rutaDelDocumento(d)} className={styles.documento}>
                    <span className={styles.docFecha}>{formatearFecha(d.fecha)}</span>
                    <span className={styles.docTipo}>{ETIQUETA_DOCUMENTO[d.tipo]}</span>
                    <span className={styles.docNumero}>{d.numero}</span>
                    <span className={styles.docCliente}>{d.clienteNombre}</span>
                    <span className={styles.docEstado}>
                      <ChipEstado estado={estado} />
                    </span>
                    <span className={styles.docImporte}>{formatearImporte(d.total, d.moneda)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
