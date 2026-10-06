import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useActividad } from '../hooks/useActividad'
import { useMesInformes } from '../hooks/useMesInformes'
import { etiquetaTramo } from '../lib/actividad'
import { leerParametros } from '../lib/conversionClientes'
import { etiquetaDoceMeses } from '../lib/pipeline'
import { ErrorInforme } from '../services/actividad'
import type { ParametrosConversion } from '../types'
import { ConversionPorCliente } from './ConversionPorCliente'
import { SelectorMes } from './SelectorMes'
import styles from './Informes.module.css'

/**
 * Informes · Clientes (Fase 40).
 *
 * Una sola pregunta, la que se hace el que vende todos los días: a quién le
 * cotizamos mucho y nos compra poco. La conversión ya se informaba, pero sólo
 * en total —«132 de 288 · 46 %»—, y un promedio no deja hacer nada porque no
 * dice a quién.
 *
 * Vive en su propia pestaña y no dentro de Actividad comercial a propósito:
 * aquélla contesta «cómo venimos este mes» y ésta «con quién hay que hablar».
 * Son dos lecturas distintas y mezclarlas haría una pantalla más larga, no más
 * útil.
 *
 * Lo elegido viaja en la URL: un link a «piden mucho, 12 meses, en dólares»
 * abre exactamente eso.
 */
export function ClientesVista() {
  const { mes, tope } = useMesInformes()
  const [params, setParams] = useSearchParams()
  const companyId = useEmpresa().activa?.companyId ?? null
  const queryClient = useQueryClient()
  const actividad = useActividad(mes)
  const actualizando = useIsFetching({ queryKey: ['informes', companyId] }) > 0

  const elegidos = leerParametros(params)
  const cambiar = (c: Partial<ParametrosConversion>) => {
    const n = new URLSearchParams(params)
    if (c.orden !== undefined) n.set('orden', c.orden)
    if (c.periodo !== undefined) n.set('periodo', c.periodo)
    if (c.moneda !== undefined) {
      if (c.moneda === null) n.delete('moneda')
      else n.set('moneda', c.moneda)
    }
    setParams(n, { replace: true })
  }

  return (
    <div className={styles.vista}>
      <header className={styles.encabezado}>
        <div>
          <h2 className={styles.tituloVista}>Clientes</h2>
          <p className={styles.subtitulo}>
            Cotizaciones contra pedidos, cliente por cliente: quién pide mucho y compra poco.
          </p>
        </div>
        <div className={styles.accionesEncabezado}>
          <SelectorMes />
          <Button
            variant="ghost"
            icon={<Icon name="refresh" size={16} />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['informes'] })}
            loading={actualizando && !actividad.isPending}
            disabled={actualizando}
          >
            {actualizando && !actividad.isPending ? 'Actualizando…' : 'Actualizar'}
          </Button>
        </div>
      </header>

      <details className={styles.reglas}>
        <summary>Cómo se calcula</summary>
        <ul>
          <li>
            <b>Convertida</b>: la cotización tiene un <b>pedido confirmado enlazado</b>. El estado «aceptada» no alcanza
            —son las mismas reglas que el informe de conversión general, para que los dos se puedan leer juntos—.
          </li>
          <li>
            <b>Denominador</b>: todas las cotizaciones emitidas en el período (no borradores), incluidas las rechazadas y
            las vencidas.
          </li>
          <li>
            <b>Abiertas</b>: enviadas o aceptadas y todavía sin pedido. Se muestran aparte y no se descuentan de nada:
            son la diferencia entre «nos dijo que no» y «todavía no contestó».
          </li>
          <li>
            Cada moneda por separado y <b>sin conversión</b>. Sin moneda elegida se muestran sólo cantidades: sumar pesos
            con dólares inventaría el número más importante de la pantalla.
          </li>
          <li>
            El orden <b>«piden mucho y compran poco»</b> exige un mínimo de cotizaciones. Sin ese piso el primer puesto
            se lo lleva siempre alguien con una sola cotización y cero pedidos, que no es un problema: es un cliente
            nuevo.
          </li>
          <li>
            El <b>último pedido</b> es el último pedido confirmado del cliente en el período, venga o no de una
            cotización.
          </li>
        </ul>
      </details>

      {actividad.isPending ? (
        <div className={styles.cargando}>
          <SkeletonRows rows={4} columns={4} label="Leyendo el informe…" />
        </div>
      ) : actividad.error ? (
        <ErrorState
          title={actividad.error instanceof ErrorInforme ? actividad.error.message : 'No se pudo leer el informe.'}
          onRetry={
            actividad.error instanceof ErrorInforme && actividad.error.codigo !== 'desconocido'
              ? undefined
              : () => void actividad.refetch()
          }
          retrying={actividad.isFetching}
        />
      ) : (
        <ConversionPorCliente
          actividad={actividad.data}
          mes={mes}
          mesEfectivo={mes ?? tope}
          etiquetaMes={etiquetaTramo(actividad.data.actual)}
          etiquetaDoceMeses={`12 meses (${etiquetaDoceMeses({
            desde: actividad.data.series[0]?.meses[0]?.mes ?? actividad.data.actual.desde,
            hasta: actividad.data.actual.hasta,
            parcial: actividad.data.actual.parcial,
          })})`}
          elegidos={elegidos}
          onCambiar={cambiar}
        />
      )}
    </div>
  )
}
