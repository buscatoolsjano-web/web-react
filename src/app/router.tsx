import { createBrowserRouter } from 'react-router-dom'
import { routes } from './routes'

/**
 * ÚNICO lugar del proyecto que sabe qué tipo de router usamos.
 *
 * BrowserRouter desde la Fase 88: las URL son de verdad —`/inicio`,
 * `/productos/puntas-y-tubos/speedrill-ph2-phillips`— y no `/#/inicio`. El
 * cambio es por SEO: con hash, todo lo que va después del `#` es la MISMA
 * URL para un buscador, así que los 9.185 productos eran una sola página.
 * Sin hash, cada ficha es una dirección que se indexa, se comparte y se
 * previsualiza.
 *
 * Esto NO alcanza solo: un path suelto en GitHub Pages da 404. Lo que lo
 * hace funcionar es el par que vive FUERA de este archivo:
 *   · `public/404.html` rescata a quien pide un path que no es un archivo
 *     —las rutas dinámicas del ERP y del carrito— y lo manda a la app con
 *     la ruta intacta.
 *   · el build PRERENDERIZA las fichas y las categorías a HTML real
 *     (`dist/productos/.../index.html`), que GitHub sirve con 200, que es
 *     lo único que un buscador indexa. Ver `scripts/fase88-prerender/`.
 *
 * El árbol de rutas no cambia ni una línea: `routes` es el mismo para hash
 * o para browser, porque lo único que cambia es de dónde se lee la ubicación
 * —del `location.hash` o del `location.pathname`—.
 */
export const router = createBrowserRouter(routes)
