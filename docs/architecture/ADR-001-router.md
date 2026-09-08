# ADR-001 — Estrategia de routing

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Fase:** 1

## Contexto

La aplicación se hospeda inicialmente en GitHub Pages, que sirve archivos
estáticos y **no permite reescrituras del lado del servidor**. Con
`BrowserRouter`, entrar directo a `/web-react/ventas/pedidos` o refrescar
esa URL devuelve 404, porque no existe ese archivo.

El workaround conocido es un `404.html` que redirige a `index.html`
guardando la ruta en el query string.

## Decisión

Usamos **`createHashRouter`** mientras estemos en GitHub Pages.

Toda la aplicación importa el router desde `src/app/router.tsx`. Ese
archivo es el **único** que sabe qué tipo de router usamos.

## Razones

1. **El refresh funciona sin trucos.** Verificado en Fase 1: un refresh
   duro sobre `#/auth/login` devuelve 200 y sirve `index.html`.
2. **El hack de `404.html` tiene costos reales**: doble navegación con
   parpadeo visible, y ensucia el query string.
3. **Compatibilidad con las notificaciones push.** El sistema legacy manda
   deep links con formato `?chat=<user>&msg=<id>`. El redirect de Pages
   interfiere con ese formato; el hash no.
4. **Consistencia con el legacy**, que ya usa hash routing para las fichas
   públicas de producto.
5. **Las rutas relativas de assets son estables.** Con hash, la parte de
   *path* de la URL nunca cambia, así que `manifest.webmanifest` e iconos
   resuelven siempre bien.

## Costos aceptados

- **SEO.** Las rutas con hash no se indexan bien. Se acepta porque esta es
  una aplicación interna con login. El catálogo público con SEO es una
  superficie distinta, que hoy cubre `buscatool.com` y que —si alguna vez
  se migra— necesita prerender, cosa que `BrowserRouter` sobre GitHub Pages
  tampoco resolvería.
- **URLs menos limpias** (`/web-react/#/ventas/pedidos`).

## Cómo revertirla

Cuando migremos a un hosting con reescrituras (Cloudflare Pages, Vercel,
Netlify, `app.buscatools.com`):

1. En `src/app/router.tsx`, cambiar `createHashRouter` por
   `createBrowserRouter`. **Es la única línea de código a tocar.**
2. Ajustar `base` en `vite.config.ts`.
3. Configurar el fallback a `index.html` en el hosting nuevo.
4. Redirigir las URLs con hash viejas si hubiera enlaces guardados.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| `BrowserRouter` + `404.html` | Doble navegación, parpadeo, rompe los deep links de push |
| `MemoryRouter` | Sin URLs compartibles ni navegación del browser. Inaceptable |
| Esperar a mover el hosting | Bloquearía toda la migración por una decisión de infraestructura |
