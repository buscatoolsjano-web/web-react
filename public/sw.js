/*
 * Service worker: guarda en el navegador el código de la app.
 *
 * Por qué existe: el sitio se sirve desde GitHub Pages, que manda TODO con
 * `cache-control: max-age=600`. Pasados diez minutos el navegador vuelve a
 * preguntar por cada archivo —uno por uno, ~250 ms cada uno— aunque no haya
 * cambiado nada. Y abrir una pantalla necesita una docena.
 *
 * Los archivos de `/assets/` llevan un hash en el nombre: si el contenido
 * cambia, cambia el nombre. Entonces un archivo guardado es válido PARA
 * SIEMPRE, y se puede servir desde acá sin preguntar.
 *
 * Todo lo demás —el HTML, los datos de Supabase, las fotos, el catálogo
 * público prerenderizado— NO pasa por acá: va a la red como siempre. Así un
 * deploy nuevo se ve en la siguiente carga, igual que sin service worker.
 */
const CACHE = 'assets-v1'
const MAXIMO = 600

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre !== CACHE) await caches.delete(nombre)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const guardada = await cache.match(req)
      if (guardada) return guardada
      const resp = await fetch(req)
      if (resp.ok && resp.type === 'basic') {
        const copia = resp.clone()
        e.waitUntil(
          (async () => {
            await cache.put(req, copia)
            // Cada deploy deja archivos viejos: se borran los más antiguos
            // cuando se pasa del tope, para no crecer sin fin.
            const claves = await cache.keys()
            for (const k of claves.slice(0, Math.max(0, claves.length - MAXIMO))) await cache.delete(k)
          })(),
        )
      }
      return resp
    })(),
  )
})
