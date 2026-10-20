import { useEffect } from 'react'
import { NOMBRE_SITIO } from '../lib/seo'

/**
 * Las etiquetas que leen los buscadores, puestas por página (Fase 87 · E2).
 *
 * ── POR QUÉ A MANO Y NO CON UNA LIBRERÍA ────────────────────────────────────
 *
 * Porque son cinco etiquetas y una librería de `head` son cuarenta kilobytes
 * y un contexto más en el árbol. Lo que hace falta acá es escribir en el
 * `<head>` y limpiar al salir, que son veinte líneas.
 *
 * ── Y POR QUÉ ESTO NO ALCANZA PARA POSICIONAR ───────────────────────────────
 *
 * Porque corre DESPUÉS de que el JavaScript se bajó y se ejecutó. Google
 * ejecuta JavaScript y termina viéndolo, pero tarde y con menos peso; y lo
 * que arma la vista previa de un enlace en WhatsApp, en LinkedIn o en un
 * cliente de correo NO ejecuta nada: lee el HTML que vino del servidor y se
 * va. Para ésos, esta página todavía no tiene título.
 *
 * El arreglo de fondo es generar el HTML de cada URL en el build (E4). Esto
 * es lo que hace que la navegación DENTRO del sitio —que no vuelve a pedir
 * el HTML— no deje el título de la página anterior puesto.
 */
export interface MetaDePagina {
  titulo: string
  descripcion: string
  /** La ruta, sin el dominio. Se completa con el origen al escribirla. */
  canonica: string
  /** La foto para la vista previa del enlace. */
  imagen?: string | null
  /** Datos estructurados, ya armados. Ver `seo.datosEstructurados`. */
  datos?: Record<string, unknown> | null
  /**
   * Para páginas que no deberían competir en el buscador: resultados de una
   * búsqueda, páginas dos y siguientes. No son malas, son repetidas.
   */
  sinIndexar?: boolean
}

/** Pone o actualiza un `<meta>`, y devuelve cómo deshacerlo. */
function etiqueta(buscar: string, valor: string): () => void {
  const [atributo, nombre] = buscar.startsWith('og:') ? ['property', buscar] : ['name', buscar]
  const existente = document.head.querySelector<HTMLMetaElement>(`meta[${atributo}="${nombre}"]`)
  if (existente) {
    const antes = existente.content
    existente.content = valor
    return () => {
      existente.content = antes
    }
  }
  const nueva = document.createElement('meta')
  nueva.setAttribute(atributo, nombre)
  nueva.content = valor
  document.head.appendChild(nueva)
  return () => nueva.remove()
}

function enlace(rel: string, href: string): () => void {
  const existente = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (existente) {
    const antes = existente.href
    existente.href = href
    return () => {
      existente.href = antes
    }
  }
  const nuevo = document.createElement('link')
  nuevo.rel = rel
  nuevo.href = href
  document.head.appendChild(nuevo)
  return () => nuevo.remove()
}

export function useMeta(meta: MetaDePagina | null): void {
  const { titulo, descripcion, canonica, imagen, datos, sinIndexar } = meta ?? {}

  useEffect(() => {
    if (!titulo || !descripcion || !canonica) return
    const origen = window.location.origin
    const url = `${origen}${canonica}`
    const tituloAnterior = document.title
    document.title = titulo

    const deshacer: Array<() => void> = [
      etiqueta('description', descripcion),
      etiqueta('og:title', titulo),
      etiqueta('og:description', descripcion),
      etiqueta('og:url', url),
      etiqueta('og:type', 'website'),
      etiqueta('og:site_name', NOMBRE_SITIO),
      etiqueta('twitter:card', imagen ? 'summary_large_image' : 'summary'),
      enlace('canonical', url),
    ]
    if (imagen) deshacer.push(etiqueta('og:image', imagen))
    if (sinIndexar) deshacer.push(etiqueta('robots', 'noindex, follow'))

    let script: HTMLScriptElement | null = null
    if (datos) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      // `textContent` y no `innerHTML`: el contenido sale de la base y con
      // `innerHTML` un nombre de producto con `</script>` adentro cerraría la
      // etiqueta y lo que siguiera se ejecutaría. Es el único lugar de este
      // módulo donde entra texto que no escribimos nosotros.
      script.textContent = JSON.stringify(datos)
      document.head.appendChild(script)
    }

    return () => {
      document.title = tituloAnterior
      for (const f of deshacer) f()
      script?.remove()
    }
  }, [titulo, descripcion, canonica, imagen, datos, sinIndexar])
}
