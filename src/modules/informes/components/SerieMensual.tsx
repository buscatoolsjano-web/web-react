import { useId, useState } from 'react'
import {
  ETIQUETA_TIPO,
  etiquetaMesCorta,
  etiquetaMesLarga,
  formatearImporte,
  monedasDeEvolucion,
  puntosDeEvolucion,
} from '../lib/actividad'
import type { Moneda, SerieActividad, TipoActividad } from '../types'
import styles from './Informes.module.css'

interface Props {
  series: SerieActividad[]
  /**
   * La métrica y la moneda las manda la pantalla (Fase 21 · E3.1).
   *
   * Antes este bloque tenía sus propios selectores, así que uno podía estar
   * mirando «Entregado en USD» arriba y «Cotizado en ARS» en el gráfico sin
   * darse cuenta. Dos controles para lo mismo es una forma de mentir.
   */
  metrica: TipoActividad
  moneda: Moneda | null
}

/**
 * Los últimos 12 meses de la métrica y la moneda que se está mirando.
 *
 * Cada moneda tiene su propia escala y nunca se suman: si el mes tuvo pesos y
 * dólares son dos series, no un total. Las barras son decorativas —los números
 * están escritos al lado— así que se lee en un teléfono y con lector de
 * pantalla sin perder nada.
 *
 * Los puntos del gráfico y los de la tabla salen de la MISMA función. Que se
 * calcularan por separado era la forma segura de que un día dijeran cosas
 * distintas del mismo mes.
 */
export function SerieMensual({ series, metrica, moneda }: Props) {
  const idTitulo = useId()
  const [verNumeros, setVerNumeros] = useState(false)

  const monedas = monedasDeEvolucion(series, metrica)
  // Si la moneda de la pantalla no tuvo documentos de ESTA métrica, se cae a
  // la primera que sí: un gráfico vacío sin explicación no informa nada.
  const monedaEfectiva = moneda && monedas.includes(moneda) ? moneda : (monedas[0] ?? null)
  const puntos = puntosDeEvolucion(series, metrica, monedaEfectiva)
  const { titulo, documento } = ETIQUETA_TIPO[metrica]
  const maximo = Math.max(0, ...puntos.map((p) => p.importe))

  return (
    <section className={styles.panel} aria-labelledby={idTitulo}>
      <header className={styles.panelCabecera}>
        <h2 id={idTitulo} className={styles.panelTitulo}>
          {titulo} · últimos 12 meses
        </h2>
        <p className={styles.tarjetaSub}>
          {monedaEfectiva ? `En ${monedaEfectiva}, sin convertir.` : 'Sin documentos en el período.'}
          {moneda && monedaEfectiva && moneda !== monedaEfectiva
            ? ` No hubo ${documento[1]} en ${moneda}: se muestra ${monedaEfectiva}.`
            : ''}
        </p>
      </header>

      {!monedaEfectiva ? (
        <p className={styles.vacio}>Sin {documento[1]} en los últimos 12 meses.</p>
      ) : (
        <>
          <ol className={styles.barras} aria-label={`${titulo} por mes, en ${monedaEfectiva}`}>
            {puntos.map((p) => {
              const ancho = maximo > 0 ? Math.max(p.importe > 0 ? 1.5 : 0, (p.importe / maximo) * 100) : 0
              return (
                <li key={p.mes} className={styles.barraFila}>
                  <span className={styles.barraMes} title={etiquetaMesLarga(p.mes)}>
                    {etiquetaMesCorta(p.mes)}
                  </span>
                  <span className={styles.barraPista} aria-hidden="true">
                    <span className={styles.barraRelleno} style={{ width: `${ancho}%` }} />
                  </span>
                  <span className={styles.barraValor}>
                    <span className={styles.importe}>
                      {monedaEfectiva} {formatearImporte(p.importe)}
                    </span>
                    <span className={styles.docs}>
                      {p.documentos} {p.documentos === 1 ? documento[0] : documento[1]}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>

          {/* Los mismos puntos, en forma de tabla: se copian, se pegan en una
              planilla y se leen con lector de pantalla sin depender del ancho
              de una barra. */}
          <details
            className={styles.reglas}
            open={verNumeros}
            onToggle={(e) => setVerNumeros((e.target as HTMLDetailsElement).open)}
          >
            <summary>Ver los números</summary>
            <table className={styles.tablaKpi}>
              <thead>
                <tr>
                  <th scope="col">Período</th>
                  <th scope="col" className={styles.num}>Importe</th>
                  <th scope="col" className={styles.num}>Documentos</th>
                </tr>
              </thead>
              <tbody>
                {puntos.map((p) => (
                  <tr key={p.mes}>
                    <th scope="row">{etiquetaMesLarga(p.mes)}</th>
                    <td className={styles.num} data-etiqueta="Importe">
                      <span className={styles.importe}>
                        {monedaEfectiva} {formatearImporte(p.importe)}
                      </span>
                    </td>
                    <td className={styles.num} data-etiqueta="Documentos">
                      {p.documentos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  )
}
