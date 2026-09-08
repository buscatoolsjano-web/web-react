import { createHashRouter } from 'react-router-dom'
import { routes } from './routes'

/**
 * ÚNICO lugar del proyecto que sabe qué tipo de router usamos.
 *
 * HashRouter mientras estemos en GitHub Pages — ver ADR-001. Cuando
 * migremos a un hosting con reescritura de rutas (Cloudflare Pages,
 * Vercel, app.buscatools.com), acá se cambia `createHashRouter` por
 * `createBrowserRouter` y nada más del proyecto se entera.
 */
export const router = createHashRouter(routes)
