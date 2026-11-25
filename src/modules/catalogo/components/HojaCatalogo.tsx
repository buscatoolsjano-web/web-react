import { useState } from 'react'
import type { HojaDeCatalogo } from '../types'
import { useAlAparecer } from '../hooks/useAlAparecer'
import { VisorImagenZoom } from './VisorImagenZoom'
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
 * La imagen se carga **al llegar con el scroll** (2026-11: «que se vea siempre
 * cuando scrolleás, que no tenga que tocar el botón»), no al abrir el
 * producto: son páginas de catálogo completas y cargarlas en cada apertura
 * sería pagar un escaneo por producto mirado. Tocarla la abre AHÍ, en un visor
 * con zoom, y no en otra pestaña.
 */
export function HojaCatalogo({ hoja, marca }: HojaCatalogoProps) {
  const [verPagina, setVerPagina] = useState(false)
  const [ampliada, setAmpliada] = useState(false)
  const aviso = useAlAparecer<HTMLButtonElement>(!verPagina && Boolean(hoja?.imagenUrl), () => setVerPagina(true))

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
          <button
            type="button"
            className={styles.marco}
            onClick={() => setAmpliada(true)}
            aria-label="Ampliar la página del catálogo"
          >
            <img
              src={hoja.imagenUrl}
              alt={`Página ${hoja.pagina ?? ''} del catálogo`.trim()}
              className={styles.pagina}
            />
          </button>
        ) : (
          <button ref={aviso} type="button" className={styles.boton} onClick={() => setVerPagina(true)}>
            Ver la página del catálogo
          </button>
        )
      ) : (
        <p className={styles.nota}>
          El catálogo y la página están registrados, pero la hoja escaneada no está cargada.
        </p>
      )}

      {ampliada && hoja.imagenUrl ? (
        <VisorImagenZoom
          src={hoja.imagenUrl}
          alt={`Página ${hoja.pagina ?? ''} del catálogo`.trim()}
          titulo={titulo || 'Hoja del catálogo'}
          onCerrar={() => setAmpliada(false)}
        />
      ) : null}
    </div>
  )
}
