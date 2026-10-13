import { useId, useMemo, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/feedback/ErrorState'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import type { ActividadComercial, Moneda, TipoActividad } from '@/modules/informes/types'
import { ETIQUETA_SERIE, mesLargo, serieDeMoneda } from '../lib/panel'
import { DesgloseDelMes } from './DesgloseDelMes'
import {
  alternarSerie,
  escalaY,
  maximoDe,
  monedaPrincipal,
  monedasDisponibles,
  SERIES,
  type PuntoSerie,
} from '../lib/evolucion'
import styles from './Evolucion.module.css'

export interface EvolucionComercialProps {
  actividad: ActividadComercial | undefined
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiquetaCorta = (iso: string) => MES_CORTO[Number(iso.split('-')[1]) - 1] ?? ''

/** Las marcas del eje, cortas: 500 k se lee, 500.000,00 ocupa media pantalla. */
function marcaCorta(v: number): string {
  if (v === 0) return '0'
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
  if (v >= 1000) return `${(v / 1000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} k`
  return v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

/**
 * Doce meses, hasta TRES series, UNA moneda (Fase 62).
 *
 * QUÉ CAMBIÓ Y POR QUÉ.
 *
 * 1. Dejó de verse aplastado. Era un SVG con `viewBox` de 720 y
 *    `preserveAspectRatio="none"` dentro de una caja de ~1500 px: el navegador
 *    lo estiraba al doble a lo ancho y dejaba las barras chatas y anchas. Ahora
 *    son barras de CSS, así que no hay relación de aspecto que deformar — el
 *    problema no puede volver.
 *
 * 2. Se comparan las tres. Antes los botones eran excluyentes: o cotizado, o
 *    pedidos, o entregado. Ahora se prenden y apagan, y es el embudo completo
 *    en un gráfico. La última encendida no se apaga.
 *
 * 3. Hay color, y sigue a la serie. Tres hues categóricos validados contra las
 *    superficies claras y oscuras del proyecto (ver `Evolucion.module.css`).
 *    El color va atado al TIPO, no a la posición: apagar «Pedidos» no
 *    repinta a las otras dos.
 *
 * 4. El mes se puede consultar con el mouse Y con el teclado. Cada mes es un
 *    botón: al pasarle el mouse o al enfocarlo muestra los importes de todas
 *    las series visibles. El tooltip no es la única vía —«Ver los números»
 *    sigue abriendo la tabla—, que es lo que lo hace legítimo.
 *
 * LO QUE NO CAMBIÓ: **nunca hay dos monedas en el mismo gráfico**. Una barra
 * que sume ARS con USD no es más alta, es falsa. Las tres series se comparan
 * en la MISMA moneda, y lo que una no tenga en esa moneda sale sin barra.
 */
export function EvolucionComercial({ actividad, cargando, error, onReintentar }: EvolucionComercialProps) {
  const id = useId()
  const [visibles, setVisibles] = useState<TipoActividad[]>(['cotizaciones', 'pedidos', 'entregas'])
  const [monedaElegida, setMonedaElegida] = useState<Moneda | null | undefined>(undefined)
  const [verNumeros, setVerNumeros] = useState(false)
  const [mesActivo, setMesActivo] = useState<number | null>(null)
  /*
   * El mes ELEGIDO, que es otra cosa que el señalado: señalar muestra el
   * tooltip y se va con el puntero; elegir abre el desglose de abajo y se
   * queda hasta que se cierre. Dos estados porque son dos intenciones.
   */
  const [mesElegido, setMesElegido] = useState<string | null>(null)

  const seriesVisibles = useMemo(
    () => SERIES.filter((s) => visibles.includes(s.tipo)).map((s) => ({
      ...s,
      datos: actividad?.series.find((x) => x.tipo === s.tipo),
    })),
    [visibles, actividad],
  )

  const monedas = useMemo(
    () => monedasDisponibles(seriesVisibles.flatMap((s) => (s.datos ? [s.datos] : []))),
    [seriesVisibles],
  )
  const moneda = monedaElegida === undefined
    ? monedaPrincipal(seriesVisibles.flatMap((s) => (s.datos ? [s.datos] : [])))
    : monedaElegida

  /** Una fila por serie visible, con sus doce puntos en la moneda elegida. */
  const trazos = useMemo(
    () => seriesVisibles.map((s) => ({ ...s, puntos: serieDeMoneda(s.datos, moneda) })),
    [seriesVisibles, moneda],
  )

  const maximo = maximoDe(trazos.map((t) => t.puntos))
  const { tope, marcas } = escalaY(maximo)

  /** Los doce meses, del más viejo al más nuevo. Sale de la primera serie que tenga datos. */
  const meses: string[] = trazos.find((t) => t.puntos.length > 0)?.puntos.map((p) => p.mes) ?? []
  const hayDatos = meses.length > 0 && maximo > 0

  const puntoDe = (t: { puntos: PuntoSerie[] }, i: number) => t.puntos[i]

  return (
    <section className={styles.bloque} aria-labelledby={`${id}-t`}>
      <div className={styles.cabecera}>
        <h2 id={`${id}-t`} className={styles.titulo}>
          Evolución · últimos 12 meses
        </h2>
        {monedas.length > 1 ? (
          <label className={styles.selector}>
            <span className={styles.selectorLabel}>Moneda</span>
            <select className={styles.select} value={moneda ?? ''} onChange={(e) => setMonedaElegida(e.target.value || null)}>
              {monedas.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {/*
        LA LEYENDA ES TAMBIÉN EL CONTROL. Con dos o más series la leyenda es
        obligatoria —la identidad nunca puede depender sólo del color— y acá
        además es lo que prende y apaga cada una: un solo lugar para saber qué
        es cada color y para elegir qué se mira.

        El texto NO lleva el color de la serie: lo lleva la muestra de al lado.
        Un hue claro como texto sobre el fondo es ilegible.
      */}
      <div className={styles.leyenda} role="group" aria-label="Series a comparar">
        {SERIES.map(({ tipo, slot }) => {
          const encendida = visibles.includes(tipo)
          return (
            <button
              key={tipo}
              type="button"
              className={encendida ? styles.serieActiva : styles.serie}
              data-slot={slot}
              aria-pressed={encendida}
              onClick={() => {
                setVisibles((v) => alternarSerie(v, tipo))
                // La moneda vuelve a elegirse sola: la que más documentos tiene
                // en cotizado puede no tener ninguno en entregado.
                setMonedaElegida(undefined)
              }}
            >
              <span className={styles.muestra} aria-hidden="true" />
              {ETIQUETA_SERIE[tipo].titulo}
            </button>
          )
        })}
      </div>

      {cargando ? (
        <SkeletonRows rows={3} columns={4} label="Cargando la evolución…" />
      ) : error ? (
        <ErrorState compact title="No se pudo leer la evolución." onRetry={onReintentar} />
      ) : !hayDatos ? (
        <p className={styles.vacio}>
          Sin movimientos {moneda ? `en ${moneda} ` : ''}en los últimos 12 meses.
        </p>
      ) : (
        <>
          <p className={styles.escala} id={`${id}-esc`}>
            Importes en {moneda} · de 0 a {formatearImporte(tope, moneda)}
          </p>

          <div className={styles.grafico}>
            {/* Las referencias: líneas enteras de 1 px, un escalón por encima
                del fondo. Punteadas se leerían como «proyección» o «límite». */}
            <div className={styles.rejilla} aria-hidden="true">
              {[...marcas].reverse().map((v) => (
                <div key={v} className={styles.referencia}>
                  <span className={styles.marcaY}>{marcaCorta(v)}</span>
                </div>
              ))}
            </div>

            <div className={styles.meses}>
              {meses.map((mes, i) => {
                const activo = mesActivo === i
                const elegido = mesElegido === mes
                return (
                  <div
                    key={mes}
                    /* Elegido pesa más que señalado: el desglose de abajo
                       sigue siendo de ESTE mes aunque el puntero ya se haya
                       ido a otro, y la marca tiene que decir cuál. */
                    className={elegido ? styles.bandaElegida : activo ? styles.bandaActiva : styles.banda}
                  >
                    <button
                      type="button"
                      className={styles.zona}
                      /* El mes es el blanco, no cada barra: así el puntero no
                         tiene que acertarle a una barra de 17 px para leer un
                         número, y el tooltip muestra las tres de una. */
                      onClick={() => setMesElegido((m) => (m === mes ? null : mes))}
                      aria-expanded={mesElegido === mes}
                      onMouseEnter={() => setMesActivo(i)}
                      onMouseLeave={() => setMesActivo((a) => (a === i ? null : a))}
                      onFocus={() => setMesActivo(i)}
                      onBlur={() => setMesActivo((a) => (a === i ? null : a))}
                      aria-describedby={activo ? `${id}-tip` : undefined}
                    >
                      <span className="sr-only">{detalleDelMes(mes, trazos, i, moneda)}</span>
                    </button>

                    <div className={styles.barras} aria-hidden="true">
                      {trazos.map((t) => {
                        const p = puntoDe(t, i)
                        const alto = p && p.importe > 0 && tope > 0 ? (p.importe / tope) * 100 : 0
                        return (
                          <span
                            key={t.tipo}
                            className={styles.barra}
                            data-slot={t.slot}
                            /* Lo que no llega a 1,5 % igual se ve: una barra
                               invisible se lee como «no hubo», que es otra cosa
                               que «hubo poco». El número exacto está en el
                               tooltip y en la tabla. */
                            style={{ height: alto > 0 ? `max(${alto}%, 3px)` : '0' }}
                          />
                        )
                      })}
                    </div>

                    {activo ? (
                      <div id={`${id}-tip`} role="tooltip" className={i > 7 ? styles.tipIzquierda : styles.tip}>
                        <p className={styles.tipMes}>{mesLargo(mes)}</p>
                        {trazos.map((t) => {
                          const p = puntoDe(t, i)
                          const etiqueta = ETIQUETA_SERIE[t.tipo]
                          return (
                            <p key={t.tipo} className={styles.tipFila}>
                              {/* Una raya del color de la serie, no un bloque:
                                  a este tamaño un cuadrado relleno es tinta de
                                  peso de dato haciendo el trabajo de un rótulo. */}
                              <span className={styles.tipClave} data-slot={t.slot} aria-hidden="true" />
                              {/* El valor manda y el nombre acompaña: acá el
                                  lector ya sabe de qué serie es y quiere el número. */}
                              <strong className={styles.tipValor}>
                                {p && p.documentos > 0 ? formatearImporte(p.importe, moneda) : '—'}
                              </strong>
                              <span className={styles.tipSerie}>
                                {etiqueta.titulo}
                                {p && p.documentos > 0 ? ` · ${p.documentos} ${p.documentos === 1 ? etiqueta.singular : etiqueta.plural}` : ''}
                              </span>
                            </p>
                          )
                        })}
                      </div>
                    ) : null}

                    <span className={styles.mes}>{etiquetaCorta(mes)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/*
            El desglose del mes elegido, DEBAJO del gráfico (Fase 63). Acá y no
            en un modal: lo que se pidió fue poder mirar las dos cosas a la
            vez, y un modal taparía justo la barra que se acaba de tocar.

            Las cuentas se las pasa el GRÁFICO, no las vuelve a contar: así el
            desglose no puede decir un total distinto del que mide la barra.
          */}
          {mesElegido ? (
            <DesgloseDelMes
              mes={mesElegido}
              moneda={moneda}
              cuentas={Object.fromEntries(
                trazos.map((t) => [t.tipo, t.puntos[meses.indexOf(mesElegido)]?.documentos ?? 0]),
              )}
              onCerrar={() => setMesElegido(null)}
            />
          ) : (
            <p className={styles.pista}>Tocá un mes para ver qué hay adentro.</p>
          )}

          <button type="button" className={styles.verNumeros} onClick={() => setVerNumeros((v) => !v)} aria-expanded={verNumeros}>
            {verNumeros ? 'Ocultar los números' : 'Ver los números'}
          </button>
          {verNumeros ? (
            <table className={styles.tabla}>
              <caption className="sr-only">Importes por mes en {moneda}</caption>
              <thead>
                <tr>
                  <th scope="col">Mes</th>
                  {trazos.map((t) => (
                    <th key={t.tipo} scope="col">
                      {ETIQUETA_SERIE[t.tipo].titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meses.map((mes, i) => (
                  <tr key={mes}>
                    <th scope="row">{mesLargo(mes)}</th>
                    {trazos.map((t) => {
                      const p = puntoDe(t, i)
                      return (
                        <td key={t.tipo}>{p && p.documentos > 0 ? formatearImporte(p.importe, moneda) : '—'}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  )
}

/** Lo mismo que dice el tooltip, para quien no ve el gráfico. */
function detalleDelMes(
  mes: string,
  trazos: readonly { tipo: TipoActividad; puntos: PuntoSerie[] }[],
  i: number,
  moneda: Moneda | null,
): string {
  const partes = trazos.map((t) => {
    const p = t.puntos[i]
    const titulo = ETIQUETA_SERIE[t.tipo].titulo
    if (!p || p.documentos === 0) return `${titulo}: sin movimientos`
    return `${titulo}: ${formatearImporte(p.importe, moneda)}, ${p.documentos} ${p.documentos === 1 ? ETIQUETA_SERIE[t.tipo].singular : ETIQUETA_SERIE[t.tipo].plural}`
  })
  return `${mesLargo(mes)}. ${partes.join('. ')}`
}
