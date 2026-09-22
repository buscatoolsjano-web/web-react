import { useMutation } from '@tanstack/react-query'
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useRanking } from '../hooks/useActividad'
import { clickDeFicha, type FichaAbierta } from '../lib/ficha'
import { formatearImporte } from '../lib/actividad'
import { descargarCsv, rankingACsv } from '../lib/csv'
import {
  archivoRanking,
  enlaceFicha,
  fichaDeFila,
  esAtipica,
  ETIQUETA_FUENTE,
  medidasPosibles,
  monedasDisponibles,
  normalizarParametros,
  TOP_N,
} from '../lib/rankings'
import { ErrorInforme } from '../services/actividad'
import { exportarRanking } from '../services/rankings'
import { SIN_MONEDA, type ActividadComercial, type FilaRanking, type ParametrosRanking } from '../types'
import styles from './Informes.module.css'

interface Props {
  actividad: ActividadComercial
  /** `YYYY-MM` elegido en la URL, o `null` = mes en curso. */
  mes: string | null
  /** `YYYY-MM` del mes que se está mirando, para el nombre del archivo. */
  mesEfectivo: string
  etiquetaMes: string
  etiquetaDoceMeses: string
  /**
   * Lo elegido vive en la página, no acá: al cambiar de mes esta sección se
   * vuelve a montar mientras carga la actividad, y no tiene que perder la
   * selección.
   */
  elegidos: ParametrosRanking
  onCambiar: (cambios: Partial<ParametrosRanking>) => void
  /**
   * Abrir la ficha de un cliente o un producto.
   *
   * Fase 21 · E3: la ficha abierta pasó a vivir en la URL, así que ya no es
   * estado de este componente. Cambiar de moneda con la ficha abierta ya no
   * la cierra, y el link comparte las dos cosas.
   */
  onAbrirFicha: (tipo: 'cliente' | 'producto', id: string) => void
}


const cantidad = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(n)

/**
 * Top 10 de clientes o productos, UN ranking a la vez: importe (por moneda,
 * nunca sumando monedas) o cantidad física (productos, sin moneda). Todo
 * ordenado y cortado por el servidor; el CSV baja el ranking completo.
 */
export function RankingComercial({ actividad, mes, mesEfectivo, etiquetaMes, etiquetaDoceMeses, elegidos, onCambiar, onAbrirFicha }: Props) {
  const idTitulo = useId()
  const companyId = useEmpresa().activa?.companyId ?? null
  const monedas = monedasDisponibles(actividad, elegidos.fuente, elegidos.periodo)
  const p = normalizarParametros(elegidos, monedas)
  const medidas = medidasPosibles(p.dimension, p.fuente)
  const sinMonedas = p.medida === 'importe' && p.moneda === null
  const ranking = useRanking(mes, p, TOP_N)
  const filas = sinMonedas ? [] : (ranking.data ?? [])
  const total = Number(filas[0]?.total_filas ?? 0)
  const esProducto = p.dimension === 'productos'
  const etiquetaPeriodo = p.periodo === 'mes' ? etiquetaMes : etiquetaDoceMeses
  const fuente = ETIQUETA_FUENTE[p.fuente]

  const exportar = useMutation({
    mutationFn: () => exportarRanking(companyId!, mes, p),
    onSuccess: (todas) => descargarCsv(archivoRanking(p, mesEfectivo), rankingACsv(p, todas)),
  })

  const cambiar = onCambiar

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Rankings</h2>
        <p className={styles.nota}>
          Por <b>importe</b> en una moneda a la vez, o por <b>cantidad física</b> (productos, sin moneda). Nunca se suman
          monedas ni unidades de productos distintos.
        </p>
      </header>

      <div className={styles.tarjeta}>
        <div className={styles.controlesRanking}>
          <div className={styles.monedas} role="group" aria-label="Qué rankear">
            {(['clientes', 'productos'] as const).map((d) => (
              <button key={d} type="button" className={p.dimension === d ? styles.chipActivo : styles.chip} aria-pressed={p.dimension === d} onClick={() => cambiar({ dimension: d })}>
                {d === 'clientes' ? 'Clientes' : 'Productos'}
              </button>
            ))}
          </div>
          <label className={styles.control}>
            <span className={styles.controlEtiqueta}>Documentos</span>
            <select className={styles.select} value={p.fuente} onChange={(e) => cambiar({ fuente: e.target.value as ParametrosRanking['fuente'] })}>
              <option value="entregado">Entregado (remitos)</option>
              <option value="pedido">Pedido confirmado</option>
              <option value="cotizado">Cotizado</option>
            </select>
          </label>
          {esProducto ? (
            <div className={styles.monedas} role="group" aria-label="Medida">
              {(['importe', 'cantidad'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={p.medida === m ? styles.chipActivo : styles.chip}
                  aria-pressed={p.medida === m}
                  disabled={!medidas.includes(m)}
                  onClick={() => cambiar({ medida: m })}
                >
                  {m === 'importe' ? 'Importe' : 'Cantidad'}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.monedas} role="group" aria-label="Período">
            {(['mes', '12m'] as const).map((x) => (
              <button key={x} type="button" className={p.periodo === x ? styles.chipActivo : styles.chip} aria-pressed={p.periodo === x} onClick={() => cambiar({ periodo: x })}>
                {x === 'mes' ? etiquetaMes : '12 meses'}
              </button>
            ))}
          </div>
          {p.medida === 'importe' && monedas.length > 0 ? (
            <div className={styles.monedas} role="group" aria-label="Moneda">
              {monedas.map((m) => (
                <button key={m} type="button" className={p.moneda === m ? styles.chipActivo : styles.chip} aria-pressed={p.moneda === m} onClick={() => cambiar({ moneda: m })}>
                  {m}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {esProducto && p.fuente === 'entregado' ? (
          <p className={styles.nota}>Los remitos no tienen precio: los productos entregados se rankean sólo por cantidad.</p>
        ) : null}

        <p className={styles.tarjetaSub}>
          {esProducto ? 'Productos' : 'Clientes'} · {fuente.titulo} · {etiquetaPeriodo}
          {p.medida === 'importe' && p.moneda ? ` · ${p.moneda}, con impuestos` : ' · unidades'}
          {total > 0 ? ` · ${Math.min(TOP_N, total)} de ${total}` : ''}
        </p>

        {sinMonedas ? (
          <p className={styles.vacio}>Sin documentos de {fuente.titulo.toLowerCase()} en {etiquetaPeriodo}.</p>
        ) : ranking.isPending ? (
          <SkeletonRows rows={5} columns={4} label="Leyendo el ranking…" />
        ) : ranking.error ? (
          <ErrorState
            compact
            title={ranking.error instanceof ErrorInforme ? ranking.error.message : 'No se pudo leer el ranking.'}
            onRetry={ranking.error instanceof ErrorInforme && ranking.error.codigo !== 'desconocido' ? undefined : () => void ranking.refetch()}
            retrying={ranking.isFetching}
          />
        ) : filas.length === 0 ? (
          <p className={styles.vacio}>Sin datos para este ranking en {etiquetaPeriodo}.</p>
        ) : (
          <div className={`${styles.tablaScroll} ${styles.tarjetaPeriodos}`}>
            <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
              <caption className={styles.oculto}>
                Top {TOP_N} de {esProducto ? 'productos' : 'clientes'} por {p.medida === 'importe' ? `importe en ${p.moneda}` : 'cantidad'}, {fuente.titulo.toLowerCase()}, {etiquetaPeriodo}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.num}>Puesto</th>
                  <th scope="col">{esProducto ? 'Producto' : 'Cliente'}</th>
                  {p.medida === 'importe' ? <th scope="col" className={styles.num}>Importe {p.moneda}</th> : null}
                  {esProducto ? <th scope="col" className={styles.num}>Cantidad</th> : null}
                  <th scope="col" className={styles.num}>{fuente.documentos}</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <FilaDeRanking key={f.clave} f={f} p={p} documentos={fuente.documentos} onAbrirFicha={(x) => onAbrirFicha(x.tipo, x.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.accionesRanking}>
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            loading={exportar.isPending}
            disabled={exportar.isPending || sinMonedas || filas.length === 0}
            onClick={() => exportar.mutate()}
            aria-label={`Exportar el ranking completo de ${esProducto ? 'productos' : 'clientes'} a CSV`}
          >
            {exportar.isPending ? 'Exportando…' : `Exportar ranking completo (CSV${total > 0 ? `, ${total} filas` : ''})`}
          </Button>
          {exportar.error ? (
            <span className={styles.errorEnLinea} role="alert">
              No se pudo exportar: {exportar.error.message}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function FilaDeRanking({
  f,
  p,
  documentos,
  onAbrirFicha,
}: {
  f: FilaRanking
  p: ParametrosRanking
  documentos: string
  onAbrirFicha: (ficha: FichaAbierta) => void
}) {
  const enlace = enlaceFicha(f)
  const ficha = fichaDeFila(f)
  const atipica = esAtipica(f)
  return (
    <tr className={f.moneda === SIN_MONEDA ? styles.filaSinMoneda : undefined}>
      <td className={styles.num} data-etiqueta="Puesto">
        <span className={styles.importe}>{f.posicion}</span>
      </td>
      <th scope="row" className={styles.categoria}>
        {/* Sigue siendo un enlace de verdad: ctrl/cmd-click abre la ficha
            completa en otra pestaña. El click común la abre encima del
            informe, que es lo que uno quiere el 95% de las veces. */}
        {enlace ? (
          <Link
            to={enlace}
            className={styles.enlaceTabla}
            onClick={ficha ? clickDeFicha(() => onAbrirFicha(ficha)) : undefined}
          >
            {f.etiqueta}
          </Link>
        ) : (
          f.etiqueta
        )}
        {f.codigo ? <span className={styles.docs}>{f.codigo}</span> : null}
        <span className={styles.marcas}>
          {atipica ? (
            <span className={styles.marcaAtipica}>
              Dato atípico · revisar ({cantidad(f.cantidad_atipica)} u. en {f.lineas_atipicas} {f.lineas_atipicas === 1 ? 'línea' : 'líneas'} con importe 0)
            </span>
          ) : null}
          {!f.vinculado ? <span className={styles.marca}>{f.cliente_id === null && p.dimension === 'clientes' ? 'Sin cliente vinculado' : 'Línea histórica sin producto del catálogo'}</span> : null}
          {f.vinculado && f.activo === false ? <span className={styles.marca}>Inactivo</span> : null}
        </span>
      </th>
      {p.medida === 'importe' ? (
        <td className={styles.num} data-etiqueta={`Importe ${p.moneda ?? ''}`}>
          <span className={styles.importe}>{formatearImporte(Number(f.importe ?? 0))}</span>
        </td>
      ) : null}
      {p.dimension === 'productos' ? (
        <td className={styles.num} data-etiqueta="Cantidad">
          <span className={p.medida === 'cantidad' ? styles.importe : styles.conteo}>{cantidad(f.cantidad === null ? null : Number(f.cantidad))}</span>
        </td>
      ) : null}
      <td className={styles.num} data-etiqueta={documentos}>
        <span className={styles.conteo}>{f.documentos}</span>
      </td>
    </tr>
  )
}
