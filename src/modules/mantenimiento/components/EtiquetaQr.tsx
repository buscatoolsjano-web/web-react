import { useMemo } from 'react'
import { matrizQr, modeloDeEtiqueta, urlDeEquipo } from '../lib/etiquetaQr'
import styles from './EtiquetasQr.module.css'

export interface DatosEtiqueta {
  id: string
  referencia: string
  nombre: string | null
  marca: string | null
  modelo: string | null
  serie: string | null
  dueno: string | null
}

/**
 * El código como SVG de cuadraditos: nítido a cualquier tamaño y en cualquier
 * impresora, sin imagen que cargar.
 */
function CodigoQr({ texto }: { texto: string }) {
  const matriz = useMemo(() => matrizQr(texto), [texto])
  const n = matriz.length
  // Margen de 2 módulos: lo mínimo para que el lector lo separe del texto.
  const total = n + 4
  const camino = matriz
    .flatMap((fila, f) => fila.map((oscuro, c) => (oscuro ? `M${c + 2} ${f + 2}h1v1h-1z` : '')))
    .join('')
  return (
    <svg className={styles.qr} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" aria-hidden="true">
      <rect width={total} height={total} fill="#fff" />
      <path d={camino} fill="#000" />
    </svg>
  )
}

/**
 * Una etiqueta: el QR que abre la ficha, y al lado lo que se lee a simple vista
 * para saber de qué equipo se trata sin escanear nada.
 */
export function EtiquetaQr({ equipo, empresa, origen }: { equipo: DatosEtiqueta; empresa: string; origen: string }) {
  const completo = modeloDeEtiqueta(equipo.marca, equipo.modelo)
  // Muchos equipos tienen de nombre el mismo texto que el modelo: una vez basta.
  const mismo = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  const modelo = mismo(completo, equipo.nombre) || mismo(equipo.modelo, equipo.nombre) ? null : completo
  return (
    <div className={styles.etiqueta}>
      <CodigoQr texto={urlDeEquipo(origen, equipo.id)} />
      <div className={styles.datos}>
        <span className={styles.empresa}>{empresa}</span>
        <strong className={styles.referencia}>{equipo.referencia}</strong>
        {equipo.nombre ? <span className={styles.renglon}>{equipo.nombre}</span> : null}
        {modelo ? <span className={styles.renglon}>{modelo}</span> : null}
        {equipo.serie ? <span className={styles.renglon}>N/S {equipo.serie}</span> : null}
        {/* Un equipo propio tiene de dueño a la misma empresa del encabezado. */}
        {equipo.dueno && !mismo(equipo.dueno, empresa) ? <span className={styles.dueno}>{equipo.dueno}</span> : null}
      </div>
    </div>
  )
}
