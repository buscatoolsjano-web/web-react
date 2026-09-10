import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AccionesDocumento } from '../components/AccionesDocumento'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { ChipEstado } from '../components/ChipEstado'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { TablaLineas } from '../components/TablaLineas'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { useDocumento, useRelacionados } from '../hooks/useDocumentos'
import { confirmarEntrega, editabilidadEntrega } from '../services/entregas'
import styles from './DetallePage.module.css'
import editor from './EditorCotizacion.module.css'

/**
 * Detalle del remito.
 *
 * Un remito no se edita: se emite con lo que se entrega y después se
 * despacha. Lo único que hace esta pantalla, además de mostrarlo, es
 * confirmarlo — y esa confirmación es una función del servidor que mueve el
 * stock, libera reservas y actualiza el pedido en una sola transacción.
 */
export function EntregaDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('entrega', id)
  const relacionados = useRelacionados('entrega', id)
  const [ultimoError, setUltimoError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false

  const confirmar = useMutation({
    mutationFn: () => confirmarEntrega(id!),
    onSuccess: (r) => {
      setUltimoError(null)
      setResultado(
        r.yaConfirmada
          ? 'El remito ya estaba despachado: no se repitió ningún movimiento de stock.'
          : `Despachado. ${r.movimientos} movimiento(s) de stock` +
            (r.reservasLiberadas > 0 ? `, ${r.reservasLiberadas} reserva(s) liberada(s)` : '') +
            '.',
      )
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
    },
    onError: (e: Error) => {
      setResultado(null)
      setUltimoError(e.message)
    },
  })

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el remito: {error.message}
      </p>
    )
  }

  if (!doc) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró la nota de entrega. Puede que no exista o que no tengas acceso.
        </p>
        <Link to="/ventas/entregas" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const permiso = editabilidadEntrega(doc.estado, esInterno)

  return (
    <div className={styles.page}>
      <Link to="/ventas/entregas" className={styles.volver}>
        ← Notas de entrega
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{doc.numero}</h1>
          <div className={styles.chips}>
            <ChipEstado estado={presentarEstado('entrega', doc.estado)} />
            {doc.serie ? <span className={styles.historico}>Serie {doc.serie}</span> : null}
            {doc.esHistorico ? (
              <span className={styles.historico}>Migrado del sistema anterior</span>
            ) : null}
            {confirmar.isPending ? <span className={editor.guardando}>Despachando…</span> : null}
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

      {ultimoError ? (
        <p className={styles.error} role="alert">
          {ultimoError}
        </p>
      ) : null}
      {resultado ? (
        <p className={styles.notas} role="status">
          {resultado}
        </p>
      ) : null}

      <section className={styles.bloque}>
        <dl className={styles.datos}>
          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Cliente</dt>
            <dd className={styles.datoValor}>{doc.clienteNombre}</dd>
          </div>
          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Contacto</dt>
            <dd className={styles.datoValor}>{doc.contactoNombre ?? '—'}</dd>
          </div>
          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Fecha</dt>
            <dd className={styles.datoValor}>{formatearFecha(doc.fecha)}</dd>
          </div>
          <div className={styles.dato}>
            <dt className={styles.datoEtiqueta}>Moneda</dt>
            <dd className={styles.datoValor}>
              {doc.moneda ?? <span className={styles.falta}>Sin registrar</span>}
            </dd>
          </div>
          {doc.origen ? (
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Pedido de origen</dt>
              <dd className={styles.datoValor}>
                <Link to={`/ventas/pedidos/${doc.origen.id}`} className={styles.enlace}>
                  {doc.origen.numero}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {doc.notas ? <p className={styles.notas}>{doc.notas}</p> : null}
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Líneas</h2>
        <TablaLineas lineas={doc.lineas} moneda={doc.moneda} tipo="entrega" />
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

      <div className={editor.barra}>
        {permiso.confirmable ? (
          <>
            <button
              type="button"
              className={editor.primario}
              disabled={confirmar.isPending}
              onClick={() => confirmar.mutate()}
            >
              {confirmar.isPending ? 'Despachando…' : 'Confirmar y despachar'}
            </button>
            <span className={editor.aviso}>
              Descuenta el stock de cada línea y libera las reservas del pedido. Se puede apretar
              una sola vez: el servidor no repite el movimiento.
            </span>
          </>
        ) : (
          <span className={editor.candado}>{permiso.motivo}</span>
        )}
      </div>

      <AccionesDocumento doc={doc} />

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Adjuntos</h2>
        <PanelAdjuntos tipo="entrega" documentoId={doc.id} />
      </section>

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
