import { Link } from 'react-router-dom'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { RUTA_DE, type DocumentoRelacionado, type Relacionados, type TipoDocumento } from '../types'
import styles from './PanelRelacionados.module.css'

export interface PanelRelacionadosProps {
  relacionados: Relacionados | undefined
  cargando: boolean
  /** Para no listar el documento que se está mirando como relacionado de sí mismo. */
  idActual: string
  /** El tipo del documento que se está mirando (Fase 19 · E4). */
  tipoActual: TipoDocumento
}

interface Seccion {
  clave: keyof Relacionados
  titulo: string
  navegable: boolean
  /**
   * `true` cuando la sección se muestra aunque esté vacía.
   *
   * La cadena cotización → pedido → entregas se muestra siempre: que un
   * documento NO tenga pedido es información. Facturas y cobranzas, en cambio,
   * todavía no existen como documento en el sistema —cero filas en las dos
   * tablas—, así que una sección vacía sólo prometería una pantalla que no hay.
   */
  siempre: boolean
}

/** El tipo del documento → la sección que sería «él mismo». */
const SECCION_DEL_TIPO: Record<TipoDocumento, keyof Relacionados> = {
  cotizacion: 'cotizaciones',
  pedido: 'pedidos',
  entrega: 'entregas',
}

const SECCIONES: Seccion[] = [
  { clave: 'cotizaciones', titulo: 'Cotización', navegable: true, siempre: true },
  { clave: 'pedidos', titulo: 'Pedido', navegable: true, siempre: true },
  { clave: 'entregas', titulo: 'Entregas', navegable: true, siempre: true },
  { clave: 'facturas', titulo: 'Facturas', navegable: false, siempre: false },
  { clave: 'pagos', titulo: 'Cobranzas', navegable: false, siempre: false },
]

function Fila({ d, navegable }: { d: DocumentoRelacionado; navegable: boolean }) {
  const contenido = (
    <>
      <span className={styles.numero}>{d.numero}</span>
      <span className={styles.fecha}>{formatearFecha(d.fecha)}</span>
      <span className={styles.total}>{formatearImporte(d.total, d.moneda)}</span>
    </>
  )

  if (!navegable || (d.tipo !== 'cotizacion' && d.tipo !== 'pedido' && d.tipo !== 'entrega')) {
    return <span className={styles.item}>{contenido}</span>
  }

  return (
    <Link to={`${RUTA_DE[d.tipo]}/${d.id}`} className={styles.item}>
      {contenido}
      <span className={styles.estado}>{presentarEstado(d.tipo, d.estado).etiqueta}</span>
    </Link>
  )
}

/**
 * La cadena del documento: cotización → pedido → entregas, y después factura
 * y cobranza.
 *
 * En el legacy los vínculos eran textos (`fromCotizacion` guardaba la
 * referencia como string); acá son claves foráneas, así que la cadena se
 * recorre en las dos direcciones sin ambigüedad.
 *
 * Las secciones vacías **se muestran igual**. «No hay facturas» es
 * información; esconder la sección haría parecer que el concepto no existe.
 */
export function PanelRelacionados({ relacionados, cargando, idActual, tipoActual }: PanelRelacionadosProps) {
  if (cargando || !relacionados) {
    return <p className={styles.nota}>Buscando documentos relacionados…</p>
  }

  // Fase 19 · E4: la sección del PROPIO tipo sólo aparece si tiene algo que
  // mostrar. «Cotización — No hay» en la pantalla de una cotización no es
  // información: es el documento relacionado consigo mismo, y vacío.
  const propia = SECCION_DEL_TIPO[tipoActual]
  const visibles = SECCIONES.map((s) => ({
    ...s,
    items: relacionados[s.clave].filter((d) => d.id !== idActual),
  })).filter((s) => (s.siempre && s.clave !== propia) || s.items.length > 0)

  return (
    <div className={styles.grilla}>
      {visibles.map(({ clave, titulo, navegable, items }) => {
        return (
          <section key={clave} className={styles.seccion}>
            <h3 className={styles.titulo}>{titulo}</h3>
            {items.length === 0 ? (
              <p className={styles.vacio}>No hay</p>
            ) : (
              <ul className={styles.lista}>
                {items.map((d) => (
                  <li key={d.id}>
                    <Fila d={d} navegable={navegable} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
