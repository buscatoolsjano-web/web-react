import type { UltimoPrecio } from '@/modules/clientes/types'
import type { LineaDocumento } from '../types'
import { TablaLineas, type CampoLinea } from './TablaLineas'

/**
 * El editor de líneas (Fase 155): ahora es la MISMA tabla que la lectura.
 *
 * Antes era un componente aparte —primero diez columnas, después una ficha por
 * línea— y editar se veía distinto de ver. El pedido fue claro: «que no se rompa
 * el formato al apretar Editar». Así que el editor pasa a ser `TablaLineas` en
 * modo edición: la misma maqueta, los mismos anchos y las mismas columnas; lo
 * único que cambia es que las celdas editables son inputs. Imposible que
 * diverjan, porque es un solo componente.
 *
 * Se conserva esta cáscara con su API —la usan cuatro pantallas— para no tocar
 * las páginas: traduce `documento`/`editable` a lo que `TablaLineas` entiende.
 */
export type { CampoLinea }

export interface EditorLineasProps {
  lineas: readonly LineaDocumento[]
  moneda: string
  /** `false` deja la tabla en sólo lectura (la misma vista). */
  editable: boolean
  /** Cómo se nombra el documento; de ahí sale el tipo para la tabla. */
  documento?: 'de la cotización' | 'del pedido' | undefined
  historicos?: Map<string, UltimoPrecio> | undefined
  onCambiar: (lineaId: string, campo: CampoLinea, valor: string | number | null) => void
  onEliminar: (lineaId: string) => void
  onMover: (lineaId: string, direccion: -1 | 1) => void
}

export function EditorLineas({
  lineas,
  moneda,
  editable,
  documento = 'de la cotización',
  historicos,
  onCambiar,
  onEliminar,
  onMover,
}: EditorLineasProps) {
  return (
    <TablaLineas
      lineas={lineas}
      moneda={moneda}
      tipo={documento === 'del pedido' ? 'pedido' : 'cotizacion'}
      edicion={editable ? { onCambiar, onEliminar, onMover, historicos } : null}
    />
  )
}
