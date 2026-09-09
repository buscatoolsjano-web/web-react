import { Link } from 'react-router-dom'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { RUTA_DE, type DocumentoRelacionado, type Relacionados } from '../types'
import styles from './PanelRelacionados.module.css'

export interface PanelRelacionadosProps {
  relacionados: Relacionados | undefined
  cargando: boolean
  /** Para no listar el documento que se está mirando como relacionado de sí mismo. */
  idActual: string
}

const SECCIONES: { clave: keyof Relacionados; titulo: string; navegable: boolean }[] = [
  { clave: 'cotizaciones', titulo: 'Cotización', navegable: true },
  { clave: 'pedidos', titulo: 'Pedido', navegable: true },
  { clave: 'entregas', titulo: 'Entregas', navegable: true },
  { clave: 'facturas', titulo: 'Facturas', navegable: false },
  { clave: 'pagos', titulo: 'Cobranzas', navegable: false },
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
export function PanelRelacionados({ relacionados, cargando, idActual }: PanelRelacionadosProps) {
  if (cargando || !relacionados) {
    return <p className={styles.nota}>Buscando documentos relacionados…</p>
  }

  return (
    <div className={styles.grilla}>
      {SECCIONES.map(({ clave, titulo, navegable }) => {
        const items = relacionados[clave].filter((d) => d.id !== idActual)
        return (
          <section key={clave} className={styles.seccion}>
            <h3 className={styles.titulo}>{titulo}</h3>
            {items.length === 0 ? (
              <p className={styles.vacio}>
                {clave === 'facturas' || clave === 'pagos' ? 'Sin registrar' : 'No hay'}
              </p>
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
