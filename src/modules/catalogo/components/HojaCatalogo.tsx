import { useState } from 'react'
import type { HojaDeCatalogo } from '../types'
import styles from './HojaCatalogo.module.css'

export interface HojaCatalogoProps {
  hoja: HojaDeCatalogo | null
  marca: string | null
}

/**
 * La página del catálogo donde aparece el producto.
 *
 * Dos fuentes reales, ninguna inventada (ver `lib/hojaCatalogo.ts`): la página
 * escaneada que varios productos comparten —3.526 productos— y el par
 * catálogo + página que traía el sistema anterior —48 productos—. Para el
 * resto **no hay hoja**, y se dice.
 *
 * La imagen se carga **cuando se la pide**, no al abrir el producto: son
 * páginas de catálogo completas y cargarlas en cada apertura sería pagar un
 * escaneo por producto mirado.
 */
export function HojaCatalogo({ hoja, marca }: HojaCatalogoProps) {
  const [verPagina, setVerPagina] = useState(false)

  if (!hoja) {
    return <p className={styles.vacio}>Sin hoja de catálogo vinculada.</p>
  }

  // El mismo encabezado del legacy (`app.js:16824`): marca · catálogo · página.
  const titulo = [
    marca,
    hoja.etiqueta ?? (hoja.catalogo ? `Catálogo ${hoja.catalogo}` : null),
    hoja.pagina !== null ? `página ${hoja.pagina}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={styles.wrap}>
      <p className={styles.titulo}>{titulo || 'Hoja del catálogo'}</p>

      {hoja.imagenUrl ? (
        verPagina ? (
          <a href={hoja.imagenUrl} target="_blank" rel="noreferrer" className={styles.marco}>
            <img
              src={hoja.imagenUrl}
              alt={`Página ${hoja.pagina ?? ''} del catálogo`.trim()}
              className={styles.pagina}
            />
          </a>
        ) : (
          <button type="button" className={styles.boton} onClick={() => setVerPagina(true)}>
            Ver la página del catálogo
          </button>
        )
      ) : (
        <p className={styles.nota}>
          El catálogo y la página están registrados, pero la hoja escaneada no está cargada.
        </p>
      )}
    </div>
  )
}
