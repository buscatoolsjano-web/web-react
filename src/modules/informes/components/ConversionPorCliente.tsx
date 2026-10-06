import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { formatearImporte } from '../lib/actividad'
import {
  CONVERSION_INICIAL,
  detalleDeFila,
  explicacionDelOrden,
  formatearFecha,
  formatearTasa,
  MINIMO_COTIZACIONES,
  normalizar,
  ORDENES,
  PERIODOS,
  tonoDeFila,
} from '../lib/conversionClientes'
import { conversionClientesACsv } from '../lib/csvConversion'
import { descargarCsv, nombreArchivo } from '../lib/csv'
import { monedasDisponibles } from '../lib/rankings'
import { POR_PAGINA_CONVERSION, useConversionClientes } from '../hooks/useConversionClientes'
import { exportarConversionPorCliente } from '../services/conversionClientes'
import { ErrorInforme } from '../services/actividad'
import type { ActividadComercial, ParametrosConversion } from '../types'
import { Paginador } from './Paginador'
import { SelectorMoneda } from './SelectorMoneda'
import styles from './Informes.module.css'
import propios from './ConversionPorCliente.module.css'

interface Props {
  actividad: ActividadComercial
  /** `YYYY-MM` elegido en la URL, o `null` = mes en curso. */
  mes: string | null
  /** `YYYY-MM` del mes que se está mirando, para el nombre del archivo. */
  mesEfectivo: string
  etiquetaMes: string
  etiquetaDoceMeses: string
  elegidos: ParametrosConversion
  onCambiar: (cambios: Partial<ParametrosConversion>) => void
}

const CLIENTES = { singular: 'cliente', plural: 'clientes' }

/**
 * Comparativa cotizaciones ↔ pedidos, cliente por cliente (Fase 40).
 *
 * La conversión ya se informaba, pero sólo en total: «132 de 288 · 46 %». Ese
 * número no deja hacer nada, porque no dice A QUIÉN le cotizamos de más. La
 * pregunta que se hace el que vende es otra: quién pide mucho y compra poco.
 *
 * Las definiciones son las mismas del informe general —convertida = la
 * cotización tiene un pedido confirmado enlazado, no «estado aceptada»; los
 * borradores no cuentan—: dos informes que cuentan distinto no se pueden leer
 * juntos.
 *
 * Las abiertas se muestran aparte y no se descuentan de nada: son la
 * diferencia entre «nos dijo que no» y «todavía no contestó». Sin ellas, una
 * conversión baja parece siempre una pérdida y muchas veces es trabajo sin
 * terminar.
 */
export function ConversionPorCliente({
  actividad,
  mes,
  mesEfectivo,
  etiquetaMes,
  etiquetaDoceMeses,
  elegidos,
  onCambiar,
}: Props) {
  const idTitulo = useId()
  const companyId = useEmpresa().activa?.companyId ?? null
  const [pagina, setPagina] = useState(0)
  const p = normalizar(elegidos)
  const consulta = useConversionClientes(mes, p, pagina)

  const monedas = monedasDisponibles(actividad, 'cotizado', p.periodo)
  const filas = consulta.data ?? []
  const total = Number(filas[0]?.total_filas ?? 0)
  const conImporte = p.moneda !== null

  const cambiar = (cambios: Partial<ParametrosConversion>) => {
    setPagina(0)
    onCambiar(cambios)
  }

  const exportar = useMutation({
    mutationFn: async () => {
      const todas = await exportarConversionPorCliente(companyId!, mes, p)
      descargarCsv(
        nombreArchivo(['conversion-clientes', mesEfectivo, p.periodo, p.moneda, p.orden]),
        conversionClientesACsv(todas, p),
      )
    },
  })

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>
          Cotizaciones y pedidos, cliente por cliente
        </h2>
        <p className={styles.nota}>
          Cuántas cotizaciones pidió cada cliente en {p.periodo === 'mes' ? etiquetaMes : etiquetaDoceMeses} y cuántas
          terminaron en un pedido confirmado. <b>Convertida</b> quiere decir que la cotización tiene un pedido enlazado,
          no que esté marcada «aceptada».
        </p>
      </header>

      <div className={styles.tarjeta}>
        <div className={styles.controlesRanking} role="group" aria-label="Qué comparar">
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Ordenar por</span>
            <select
              className={styles.select}
              value={p.orden}
              onChange={(e) => cambiar({ orden: e.target.value as ParametrosConversion['orden'] })}
            >
              {ORDENES.map((o) => (
                <option key={o.valor} value={o.valor} disabled={o.valor === 'importe' && !conImporte}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Período</span>
            <select
              className={styles.select}
              value={p.periodo}
              onChange={(e) => cambiar({ periodo: e.target.value as ParametrosConversion['periodo'] })}
            >
              {PERIODOS.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.valor === 'mes' ? etiquetaMes : etiquetaDoceMeses}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="secondary"
            size="sm"
            className={styles.exportar}
            loading={exportar.isPending}
            disabled={total === 0 || exportar.isPending}
            icon={<Icon name="download" size={16} />}
            onClick={() => exportar.mutate()}
          >
            CSV
          </Button>
        </div>

        {/* Los importes son de UNA moneda. Sin elegir una, la tabla muestra
            sólo cantidades: sumar pesos con dólares inventaría el número más
            importante de la pantalla. */}
        <div className={propios.moneda}>
          <SelectorMoneda monedas={monedas} valor={p.moneda} onCambiar={(m) => cambiar({ moneda: m === p.moneda ? null : m })} />
          <p className={styles.nota}>
            {conImporte
              ? `Los importes son de los documentos en ${p.moneda}. Las cantidades son de todos.`
              : 'Elegí una moneda para ver también los importes. Sin elegir, sólo cantidades.'}
          </p>
        </div>

        <p className={styles.nota}>{explicacionDelOrden(p.orden)}</p>

        {exportar.error ? (
          <p className={styles.errorEnLinea} role="alert">
            No se pudo armar el CSV: {exportar.error.message}
          </p>
        ) : null}

        {consulta.isError ? (
          <ErrorState
            title={
              consulta.error instanceof ErrorInforme && consulta.error.codigo === 'sin_permiso'
                ? 'Tu rol no ve esta comparativa.'
                : 'No se pudo leer la comparativa.'
            }
            onRetry={() => void consulta.refetch()}
            retrying={consulta.isFetching}
          />
        ) : consulta.isPending ? (
          <SkeletonRows rows={6} columns={5} label="Cargando la comparativa…" />
        ) : filas.length === 0 ? (
          <p className={styles.vacio}>
            {p.orden === 'piden_mucho' || p.orden === 'mejor_conversion'
              ? `Ningún cliente pidió ${MINIMO_COTIZACIONES} cotizaciones o más en este período.`
              : 'No hay cotizaciones en este período.'}
          </p>
        ) : (
          <>
            <div className={styles.tablaScroll}>
              <table className={styles.tablaKpi}>
                <caption className={styles.oculto}>
                  Cotizaciones y pedidos por cliente, {p.periodo === 'mes' ? etiquetaMes : etiquetaDoceMeses}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col" className={styles.num}>Cotizaciones</th>
                    <th scope="col" className={styles.num}>Con pedido</th>
                    <th scope="col" className={styles.num}>Conversión</th>
                    {conImporte ? (
                      <th scope="col" className={styles.num}>Cotizado / pedido</th>
                    ) : null}
                    <th scope="col" className={styles.num}>Última cotización</th>
                    <th scope="col" className={styles.num}>Último pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const tono = tonoDeFila(f)
                    const detalle = detalleDeFila(f)
                    return (
                      <tr key={f.customer_id} className={tono ? propios[tono] : undefined}>
                        <th scope="row" className={propios.cliente}>
                          <Link to={`/clientes/${f.customer_id}`} className={styles.enlaceTabla}>
                            {f.cliente}
                          </Link>
                          {f.referencia ? <span className={styles.docs}>{f.referencia}</span> : null}
                        </th>
                        <td className={styles.num} data-etiqueta="Cotizaciones">
                          <span className={styles.importe}>{f.cotizaciones}</span>
                          {detalle ? <span className={styles.docs}>{detalle}</span> : null}
                        </td>
                        <td className={styles.num} data-etiqueta="Con pedido">
                          <span className={styles.importe}>{f.convertidas}</span>
                        </td>
                        <td className={styles.num} data-etiqueta="Conversión">
                          <span className={propios.tasa}>{formatearTasa(f.tasa)}</span>
                        </td>
                        {conImporte ? (
                          <td className={styles.num} data-etiqueta="Cotizado / pedido">
                            <span className={styles.importe}>
                              {formatearImporte(f.importe_convertido ?? 0)}
                            </span>
                            <span className={styles.docs}>
                              de {formatearImporte(f.importe_cotizado ?? 0)}
                            </span>
                          </td>
                        ) : null}
                        <td className={styles.num} data-etiqueta="Última cotización">
                          {formatearFecha(f.ultima_cotizacion)}
                        </td>
                        <td className={styles.num} data-etiqueta="Último pedido">
                          {formatearFecha(f.ultimo_pedido)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Paginador
              pagina={pagina}
              porPagina={POR_PAGINA_CONVERSION}
              total={total}
              onCambiar={setPagina}
              cargando={consulta.isFetching}
              sustantivo={CLIENTES}
            />
          </>
        )}
      </div>
    </section>
  )
}

export { CONVERSION_INICIAL }
