import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/icons/Icon'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { formatearFecha } from '@/modules/ventas/lib/formato'
import { ETIQUETA_DOCUMENTO, rutaDelDocumento } from '../lib/documentos'
import type { Atencion } from '../services/atencion'
import styles from './Panel.module.css'

export interface TarjetaAtencion {
  clave: string
  icono: IconName
  titulo: string
  valor: number | null
  detalle: string | null
  /** A dónde lleva, y qué se va a ver ahí exactamente. */
  destino: string
  etiquetaDestino: string
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

export interface AtencionHoyProps {
  tarjetas: readonly TarjetaAtencion[]
  atencion: Atencion | undefined
}

/**
 * Lo que hay que ir a resolver hoy (Fase 21 · E2).
 *
 * Cada número contesta cuatro cosas: qué es, cuántos son, por qué importa y a
 * dónde se entra. El link va **siempre filtrado** —mandar al listado completo
 * es hacerle buscar a la persona lo que el Dashboard ya encontró— y la
 * etiqueta dice exactamente qué va a ver, aunque no coincida con el titular.
 *
 * Nada entra acá «porque el dato existe». Mantenimiento con 0 órdenes no es
 * trabajo pendiente, y un cero al lado de cuatro números que sí piden trabajo
 * es ruido: si no hay nada que hacer, la tarjeta no se dibuja.
 */
export function AtencionHoy({ tarjetas, atencion }: AtencionHoyProps) {
  const id = useId()
  const visibles = tarjetas.filter((t) => t.cargando || t.error || (t.valor ?? 0) > 0)

  if (visibles.length === 0) {
    return (
      <section className={styles.seccion} aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className={styles.seccionTitulo}>
          Atención hoy
        </h2>
        <p className={styles.vacio}>Nada pendiente: sin cotizaciones abiertas, sin pedidos por entregar y sin documentos para revisar.</p>
      </section>
    )
  }

  return (
    <section className={styles.seccion} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.seccionTitulo}>
        Atención hoy
      </h2>
      <div className={styles.atencion}>
        {visibles.map((t) => (
          <article key={t.clave} className={styles.tarjeta}>
            <span className={styles.tarjetaIcono} aria-hidden="true">
              <Icon name={t.icono} size={16} />
            </span>
            {t.cargando ? (
              <Skeleton width="50%" height="2rem" />
            ) : t.error ? (
              <ErrorState compact title="No se pudo leer." onRetry={t.onReintentar} />
            ) : (
              <>
                <p className={styles.tarjetaValor}>{t.valor}</p>
                <h3 className={styles.tarjetaTitulo}>{t.titulo}</h3>
                {t.detalle ? <p className={styles.tarjetaDetalle}>{t.detalle}</p> : null}
                <Link to={t.destino} className={styles.tarjetaEnlace}>
                  {t.etiquetaDestino} <span aria-hidden="true">→</span>
                </Link>
                {t.clave === 'revision' && atencion ? <ListaRevision atencion={atencion} /> : null}
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

/**
 * El detalle del número de revisión, acá mismo.
 *
 * No hay listado de Ventas que filtre por «requiere atención hoy»: el filtro
 * que existe es `needs_review`, que son los 241 marcados por la migración —de
 * los cuales 126 ya se resolvieron—. Mandar ahí mostraría otros documentos que
 * los contados. Como las filas ya vinieron con el conteo, el detalle se abre
 * acá y cada documento se abre en su ficha.
 */
function ListaRevision({ atencion }: { atencion: Atencion }) {
  const [abierto, setAbierto] = useState(false)
  const primeros = atencion.documentos.slice(0, 8)

  return (
    <>
      <button type="button" className={styles.verDetalle} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} />
        {abierto ? 'Ocultar' : 'Ver cuáles son'}
      </button>
      {abierto ? (
        <ul className={styles.listaRevision}>
          {primeros.map((d) => (
            <li key={d.id}>
              <Link to={rutaDelDocumento(d)} className={styles.filaRevision}>
                <span className={styles.revisionNumero}>{d.numero}</span>
                <span className={styles.revisionTipo}>{ETIQUETA_DOCUMENTO[d.tipo]}</span>
                <span className={styles.revisionFecha}>{formatearFecha(d.fecha)}</span>
              </Link>
            </li>
          ))}
          {atencion.documentos.length > primeros.length ? (
            <li className={styles.revisionResto}>
              y {atencion.documentos.length - primeros.length} más
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  )
}
