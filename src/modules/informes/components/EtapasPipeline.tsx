import { useId } from 'react'
import { formatearImporte } from '../lib/actividad'
import { ETIQUETA_ANTIGUEDAD } from '../lib/pipeline'
import { SIN_MONEDA, type ActividadComercial, type PipelineComercial } from '../types'
import styles from './Informes.module.css'

interface Props {
  pipeline: PipelineComercial
  actividad: ActividadComercial
  etiquetaActual: string
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/**
 * Tres etapas con datos reales, NO un embudo: las dos primeras son el estado
 * de hoy (lo abierto y lo pendiente, sin importar cuándo empezó) y la tercera
 * es lo entregado en el período elegido. No se restan entre sí.
 */
export function EtapasPipeline({ pipeline, actividad, etiquetaActual }: Props) {
  const idTitulo = useId()
  const entregas = actividad.kpis.find((k) => k.tipo === 'entregas')
  const entregadoActual = entregas?.monedas.filter((m) => m.actual.documentos > 0) ?? []
  const hoy = pipeline.cumplimiento.todos
  const aceptadasSinPedido = pipeline.abiertas.reduce((s, a) => s + a.aceptadas, 0)

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Pipeline</h2>
        <p className={styles.nota}>
          No es un embudo: cotizaciones abiertas y pedidos pendientes son el estado de <b>hoy</b>; lo entregado es de {etiquetaActual}.
        </p>
      </header>

      <div className={styles.etapas}>
        <article className={styles.tarjeta} aria-labelledby={`${idTitulo}-a`}>
          <h3 id={`${idTitulo}-a`} className={styles.tarjetaTitulo}>Cotizaciones abiertas · hoy</h3>
          <p className={styles.tarjetaSub}>
            Enviadas o aceptadas, sin pedido confirmado.
            {aceptadasSinPedido > 0
              ? ` Incluye ${plural(aceptadasSinPedido, 'aceptada', 'aceptadas')} que todavía no ${aceptadasSinPedido === 1 ? 'tiene' : 'tienen'} pedido.`
              : ''}
          </p>
          {pipeline.abiertas.length === 0 ? (
            <p className={styles.vacio}>No hay cotizaciones abiertas.</p>
          ) : (
            <div className={styles.tablaScroll}>
              <table className={styles.tablaKpi}>
                <caption className={styles.oculto}>Cotizaciones abiertas hoy, por moneda y antigüedad</caption>
                <thead>
                  <tr>
                    <th scope="col">Moneda</th>
                    <th scope="col" className={styles.num}>Abiertas</th>
                    <th scope="col" className={styles.num}>Antigüedad</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.abiertas.map((a) => (
                    <tr key={a.moneda} className={a.moneda === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
                      <th scope="row" className={styles.moneda}>{a.moneda}</th>
                      <td className={styles.num} data-etiqueta="Abiertas">
                        <span className={styles.importe}>{formatearImporte(a.importe)}</span>
                        <span className={styles.docs}>{plural(a.documentos, 'cotización', 'cotizaciones')}</span>
                      </td>
                      <td className={styles.num} data-etiqueta="Antigüedad">
                        <span className={styles.lista}>
                          {(['hasta_30', '31_90', 'mas_90'] as const).map((k) => (
                            <span key={k} className={styles.docs}>{a.porAntiguedad[k]} · {ETIQUETA_ANTIGUEDAD[k]}</span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className={styles.tarjeta} aria-labelledby={`${idTitulo}-b`}>
          <h3 id={`${idTitulo}-b`} className={styles.tarjetaTitulo}>Pedidos pendientes de completar · hoy</h3>
          <p className={styles.tarjetaSub}>
            Confirmados, con evidencia de lo que falta. Importe pendiente <b>neto de impuestos</b>, a precio del pedido.
          </p>
          {pipeline.pendientes.length === 0 ? (
            <p className={styles.vacio}>No hay pedidos pendientes con evidencia.</p>
          ) : (
            <div className={styles.tablaScroll}>
              <table className={styles.tablaKpi}>
                <caption className={styles.oculto}>Pedidos pendientes de completar hoy, por moneda del pedido</caption>
                <thead>
                  <tr>
                    <th scope="col">Moneda</th>
                    <th scope="col" className={styles.num}>Pendiente neto</th>
                    <th scope="col" className={styles.num}>Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.pendientes.map((p) => (
                    <tr key={p.moneda} className={p.moneda === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
                      <th scope="row" className={styles.moneda}>{p.moneda}</th>
                      <td className={styles.num} data-etiqueta="Pendiente neto">
                        <span className={styles.importe}>{formatearImporte(p.sinEntrega.importe + p.parcial.importe)}</span>
                      </td>
                      <td className={styles.num} data-etiqueta="Pedidos">
                        <span className={styles.lista}>
                          <span className={styles.docs}>{plural(p.sinEntrega.documentos, 'sin entrega', 'sin entrega')}</span>
                          <span className={styles.docs}>{plural(p.parcial.documentos, 'parcial', 'parciales')}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hoy.noDeterminables > 0 ? (
            <p className={styles.notaAviso}>
              Además, {plural(hoy.noDeterminables, 'pedido', 'pedidos')} sin evidencia suficiente
              ({hoy.porCategoria.no_consta_entrega} no consta entrega · {hoy.porCategoria.detalle_no_reconstruido} detalle no reconstruido
              {hoy.porCategoria.sin_lineas > 0 ? ` · ${hoy.porCategoria.sin_lineas} sin líneas` : ''}): no se sabe qué falta, así que no suman importe pendiente.
            </p>
          ) : null}
        </article>

        <article className={styles.tarjeta} aria-labelledby={`${idTitulo}-c`}>
          <h3 id={`${idTitulo}-c`} className={styles.tarjetaTitulo}>Entregado · {etiquetaActual}</h3>
          <p className={styles.tarjetaSub}>Remitos confirmados, con impuestos. Igual que «Vendido (entregado)».</p>
          {entregadoActual.length === 0 ? (
            <p className={styles.vacio}>Sin remitos en {etiquetaActual}.</p>
          ) : (
            <div className={styles.tablaScroll}>
              <table className={styles.tablaKpi}>
                <caption className={styles.oculto}>Entregado en {etiquetaActual}, por moneda</caption>
                <thead>
                  <tr>
                    <th scope="col">Moneda</th>
                    <th scope="col" className={styles.num}>Entregado</th>
                  </tr>
                </thead>
                <tbody>
                  {entregadoActual.map((m) => (
                    <tr key={m.moneda} className={m.moneda === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
                      <th scope="row" className={styles.moneda}>{m.moneda}</th>
                      <td className={styles.num} data-etiqueta="Entregado">
                        <span className={styles.importe}>{formatearImporte(m.actual.importe)}</span>
                        <span className={styles.docs}>{plural(m.actual.documentos, 'remito', 'remitos')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
