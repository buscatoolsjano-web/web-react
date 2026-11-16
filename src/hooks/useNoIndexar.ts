import { useEffect } from 'react'

/**
 * `<meta name="robots" content="noindex, nofollow">` mientras la pantalla esté
 * montada.
 *
 * Para el ERP y las pantallas de acceso: no son contenido público y no tienen
 * que aparecer en ningún buscador. Hoy GitHub Pages las sirve con 404 y el
 * `robots.txt` las bloquea, así que esto es la tercera capa: si algún día una
 * se sirve con 200, la etiqueta igual le dice al buscador que no la guarde.
 *
 * Se saca al desmontar porque la misma app sirve el sitio público, que sí se
 * indexa: navegar del ERP a la web no puede dejar la web marcada.
 */
export function useNoIndexar(): void {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    meta.dataset.erp = ''
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}
