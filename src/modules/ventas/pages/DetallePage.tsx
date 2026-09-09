import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { ChipEstado } from '../components/ChipEstado'
import { PanelPendientes } from '../components/PanelPendientes'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { TablaLineas } from '../components/TablaLineas'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { useDocumento, usePendientes, useRelacionados } from '../hooks/useDocumentos'
import { ETIQUETA_DE, RUTA_DE, type TipoDocumento } from '../types'
import styles from './DetallePage.module.css'

export interface DetallePageProps {
  tipo: TipoDocumento
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={styles.dato}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={styles.datoValor}>{children}</dd>
    </div>
  )
}

/**
 * Detalle en modo lectura. Todavía no escribe nada.
 *
 * El editor del legacy era uno solo para los tres documentos, con un borrador
 * global en localStorage que decidía qué pantalla se veía. Acá cada documento
 * tiene su URL, así que recargar o compartir el link funciona.
 */
export function DetallePage({ tipo }: DetallePageProps) {
  const { id } = useParams<{ id: string }>()
  const { data: doc, isPending, error } = useDocumento(tipo, id)
  const relacionados = useRelacionados(tipo, id)
  const pendientes = usePendientes(tipo === 'pedido' ? doc : null)

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el documento: {error.message}
      </p>
    )
  }

  if (!doc) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró {ETIQUETA_DE[tipo].singular === 'entrega' ? 'la' : 'el'}{' '}
          {ETIQUETA_DE[tipo].singular}. Puede que no exista o que no tengas acceso.
        </p>
        <Link to={RUTA_DE[tipo]} className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to={RUTA_DE[tipo]} className={styles.volver}>
        ← {ETIQUETA_DE[tipo].plural}
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{doc.numero}</h1>
          <div className={styles.chips}>
            <ChipEstado estado={presentarEstado(tipo, doc.estado)} />
            {doc.estadoSecundario ? (
              <ChipEstado estado={presentarCumplimiento(doc.estadoSecundario)} />
            ) : null}
            {doc.esHistorico ? <span className={styles.historico}>Migrado del sistema anterior</span> : null}
          </div>
          {doc.titulo ? <p className={styles.subtitulo}>{doc.titulo}</p> : null}
        </div>
        <div className={styles.importe}>
          <span className={styles.importeValor}>{formatearImporte(doc.total, doc.moneda)}</span>
          <span className={styles.importeEtiqueta}>Total</span>
        </div>
      </header>

      <AvisosHistoricos
        motivos={doc.motivosRevision}
        numeroFueraDeSerie={doc.numeroFueraDeSerie}
        numeroSospechado={doc.numeroSospechado}
        esHistorico={doc.esHistorico}
      />

      <section className={styles.bloque}>
        <dl className={styles.datos}>
          <Dato etiqueta="Cliente">
            {doc.clienteId ? doc.clienteNombre : <span className={styles.falta}>Sin cliente</span>}
          </Dato>
          <Dato etiqueta="Contacto">{doc.contactoNombre ?? '—'}</Dato>
          <Dato etiqueta="Fecha">{formatearFecha(doc.fecha)}</Dato>
          <Dato etiqueta="Moneda">
            {doc.moneda ?? <span className={styles.falta}>Sin registrar</span>}
          </Dato>
          <Dato etiqueta="Tipo de cambio">
            {doc.tipoCambio ?? <span className={styles.falta}>Sin registrar</span>}
          </Dato>
          <Dato etiqueta="Serie">{doc.serie ?? '—'}</Dato>
          <Dato etiqueta="Vendedor">
            {doc.vendedor ?? <span className={styles.falta}>Sin registrar</span>}
          </Dato>
          {doc.origen ? (
            <Dato etiqueta={doc.origen.tipo === 'cotizacion' ? 'Cotización de origen' : 'Pedido de origen'}>
              <Link to={`${RUTA_DE[doc.origen.tipo]}/${doc.origen.id}`} className={styles.enlace}>
                {doc.origen.numero}
              </Link>
            </Dato>
          ) : null}
        </dl>
        {doc.notas ? <p className={styles.notas}>{doc.notas}</p> : null}
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Líneas</h2>
        <TablaLineas lineas={doc.lineas} moneda={doc.moneda} tipo={tipo} />
        <dl className={styles.totales}>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatearImporte(doc.subtotal, doc.moneda)}</dd>
          </div>
          <div>
            <dt>Impuestos</dt>
            <dd>{formatearImporte(doc.impuesto, doc.moneda)}</dd>
          </div>
          <div className={styles.totalFinal}>
            <dt>Total</dt>
            <dd>{formatearImporte(doc.total, doc.moneda)}</dd>
          </div>
        </dl>
      </section>

      {tipo === 'pedido' ? (
        <section className={styles.bloque}>
          <h2 className={styles.h2}>Entregas</h2>
          <PanelPendientes
            lineas={doc.lineas}
            resultado={pendientes.data}
            cargando={pendientes.isPending}
          />
        </section>
      ) : null}

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Relacionados</h2>
        <PanelRelacionados
          relacionados={relacionados.data}
          cargando={relacionados.isPending}
          idActual={doc.id}
        />
      </section>
    </div>
  )
}
