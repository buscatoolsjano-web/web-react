import { Link } from 'react-router-dom'
import { cx } from '@/utils/cx'
import { RUTA_DE } from '../types'
import { PASOS_CADENA, type CadenaDocumento as Cadena, type PasoCadena } from '../lib/cadena'
import styles from './CadenaDocumento.module.css'

const ETIQUETA: Record<PasoCadena, string> = {
  cotizacion: 'Cotización',
  pedido: 'Pedido',
  entrega: 'Entrega',
  factura: 'Factura',
}

/**
 * Un emoji por paso, como en el sistema anterior.
 *
 * Se eligieron por lo que muestran, no por lo que nombran: el camión es una
 * entrega para cualquiera, y el recibo una factura. La palabra igual está —en
 * el `title` y en el texto para lector de pantalla—, así que el emoji no carga
 * solo con el significado.
 */
const EMOJI: Record<PasoCadena, string> = {
  cotizacion: '📝',
  pedido: '📋',
  entrega: '🚚',
  factura: '🧾',
}

/** Factura todavía no tiene pantalla propia, así que tampoco tiene ruta. */
const RUTA: Record<PasoCadena, string | null> = {
  cotizacion: RUTA_DE.cotizacion,
  pedido: RUTA_DE.pedido,
  entrega: RUTA_DE.entrega,
  factura: null,
}

export interface CadenaDocumentoProps {
  cadena: Cadena
  /** En qué paso está parado el usuario ahora. */
  actual: PasoCadena
  /**
   * Qué puede generar la pantalla, y cómo.
   *
   * Lo pone la página y no este componente a propósito: crear un pedido o un
   * remito tiene sus confirmaciones —el remito abre el modal de cantidades—,
   * y esa lógica ya vive en las páginas de detalle. Acá sólo se dibuja el
   * botón y se avisa; duplicarla sería tener dos caminos para lo mismo, y uno
   * de los dos se iba a quedar viejo.
   */
  generar?: Partial<Record<PasoCadena, { onGenerar: () => void; cargando?: boolean; motivo?: string }>>
}

/**
 * La cadena del documento: cotización → pedido → entrega → factura (Fase 29 · E6).
 *
 * Cuatro círculos con emoji, dentro de la barra de acciones (Fase 29 · E16).
 * Antes era un bloque propio arriba del documento: cuatro cajas con etiqueta y
 * número que ocupaban unos 90 px de alto para decir algo que entra en cuatro
 * círculos de 32. Metida en la barra no agrega NADA de alto —la fila ya mide
 * 40 por los botones— y todo el documento sube esa pantalla.
 *
 * El número de cada documento no se pierde: va en el `title` y en el nombre
 * accesible del círculo, que es un enlace. El del paso actual ya está en el
 * encabezado de la página, así que mostrarlo acá era decirlo dos veces.
 *
 * Va en pantalla y NO en la hoja: es una herramienta de trabajo, no parte del
 * documento que se le manda al cliente.
 */
export function CadenaDocumento({ cadena, actual, generar }: CadenaDocumentoProps) {
  return (
    <nav className={styles.cadena} aria-label="Circuito de la venta">
      <ol className={styles.pasos}>
        {PASOS_CADENA.map((paso) => {
          const eslabon = cadena[paso]
          const esActual = paso === actual
          const accion = generar?.[paso]
          const ruta = RUTA[paso]
          const nombre = ETIQUETA[paso]

          /**
           * Lo que se lee al pasar el mouse y lo que escucha un lector de
           * pantalla. Es la misma frase para los dos: el círculo solo no dice
           * de qué documento habla, y un emoji sin texto no se anuncia.
           */
          const descripcion = eslabon
            ? `${nombre} ${eslabon.numero}${eslabon.cuantos > 1 ? ` y ${eslabon.cuantos - 1} más` : ''}`
            : accion
              ? accion.cargando === true
                ? `Generando ${nombre.toLowerCase()}…`
                : `Generar ${nombre.toLowerCase()}`
              : `${nombre}: todavía no existe`

          const clases = cx(
            styles.circulo,
            eslabon && styles.hecho,
            esActual && styles.actual,
            // El paso actual nunca va apagado, aunque todavía no exista: en la
            // pantalla de alta la cotización se está armando y es el único
            // paso que importa. Sin esta condición, el círculo donde estás
            // parado era el más tenue de los cuatro.
            !eslabon && !accion && !esActual && styles.pendiente,
          )
          // El emoji es decorativo: lo que se anuncia es `descripcion`. Sin el
          // `aria-hidden` el lector lee el nombre Unicode del emoji, que en
          // medio de la frase no aporta nada.
          const cara = (
            <>
              <span className={styles.emoji} aria-hidden="true">
                {EMOJI[paso]}
              </span>
              <span className="sr-only">{descripcion}</span>
            </>
          )

          return (
            // La línea que une con el paso anterior es un `::before` del `li`
            // y no un elemento: con el rótulo debajo, el `li` es una columna, y
            // una línea metida adentro le corría el centro al círculo. Como
            // pseudo-elemento se ancla al alto del círculo y los rótulos
            // quedan centrados de verdad.
            <li key={paso} className={cx(styles.paso, eslabon && styles.pasoHecho)}>
              {eslabon && !esActual && ruta ? (
                <Link to={`${ruta}/${eslabon.id}`} className={clases} title={descripcion}>
                  {cara}
                </Link>
              ) : accion && !eslabon ? (
                <button
                  type="button"
                  className={cx(clases, styles.generable)}
                  onClick={accion.onGenerar}
                  disabled={accion.cargando === true || accion.motivo !== undefined}
                  title={accion.motivo ?? descripcion}
                >
                  {cara}
                  {/* El «+» distingue de un vistazo el paso que se puede crear
                      del que está simplemente vacío: los dos son un círculo
                      apagado y sin esto se ven igual. */}
                  <span className={styles.mas} aria-hidden="true">
                    +
                  </span>
                </button>
              ) : (
                <span className={clases} title={descripcion} aria-current={esActual ? 'step' : undefined}>
                  {cara}
                </span>
              )}

              {/* El rótulo va `aria-hidden` porque el nombre del paso ya está
                  en el texto del círculo («Pedido PDV-ERP00007»): sin esto un
                  lector de pantalla diría «Pedido» dos veces seguidas. */}
              <span className={styles.rotulo} aria-hidden="true">
                {nombre}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
