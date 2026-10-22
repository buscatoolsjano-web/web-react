/*
 * Prerender del sitio público (Fase 88 · SEO).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 *
 * El router de browser (Fase 88) le da a cada ficha una URL de verdad, pero
 * GitHub Pages sólo sirve archivos: a `/productos/x/y` contesta 404. El
 * `404.html` rescata a las PERSONAS —les reconstruye la ruta con JavaScript—,
 * pero un buscador que recibe un 404 no indexa nada. Lo único que un buscador
 * indexa es un archivo servido con 200.
 *
 * Entonces esto escribe ese archivo: para cada producto y cada categoría, un
 * `index.html` real, con el título, la descripción, la imagen con su alt, los
 * atributos, los sinónimos y los datos estructurados ya ADENTRO del HTML. Lo
 * sirve GitHub con 200; el buscador lo lee sin ejecutar nada; y cuando una
 * persona lo abre, el mismo HTML arranca la app encima y sigue como siempre.
 *
 * ── POR QUÉ `ssrLoadModule` Y NO COPIAR LA LÓGICA ───────────────────────────
 *
 * El título, la descripción, el alt y los datos estructurados los arma
 * `seo.ts`, y la pantalla usa ESAS mismas funciones en vivo. Si acá se
 * copiara la lógica, las dos mitades se separarían y la mitad de las páginas
 * tendría un título en el HTML y otro en la pantalla —que es peor que no
 * tener ninguno, y es justo lo que el encabezado de `seo.ts` advierte—. Vite
 * transpila y resuelve el TypeScript al vuelo con `ssrLoadModule`, así que acá
 * corren las funciones de verdad, sin build aparte y sin duplicar nada.
 *
 * ── CÓMO SE ALIMENTA ────────────────────────────────────────────────────────
 *
 * De las mismas tres RPC públicas que usa la pantalla: `catalogo_publico_*`.
 * No toca ninguna tabla, no necesita sesión, no ve precio ni stock. La clave
 * anónima es pública por diseño.
 *
 * Corre DESPUÉS de `vite build`, sobre `dist/`: usa el `index.html` ya armado
 * —con los hashes de los assets y el script de la app— como molde, y sólo le
 * cambia la cabeza y el contenido de `#root`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createServer } from 'vite'

;(async () => {
  const RAIZ = resolve(import.meta.dirname, '..')
  const DIST = join(RAIZ, 'dist')
  const SITIO = (process.env.VITE_SITE_URL ?? 'https://app.buscatools.com').replace(/\/+$/, '')

  // ── Credenciales: del entorno (CI) o del .env (local) ──────────────────────
  function leerEnv(nombre) {
    if (process.env[nombre]) return process.env[nombre]
    const archivo = join(RAIZ, '.env')
    if (!existsSync(archivo)) return undefined
    for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && m[1] === nombre) return m[2].replace(/^["']|["']$/g, '').trim()
    }
    return undefined
  }

  const SUPABASE_URL = leerEnv('VITE_SUPABASE_URL')
  const SUPABASE_ANON = leerEnv('VITE_SUPABASE_ANON_KEY')
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.error('[prerender] faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
    process.exit(1)
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[prerender] no existe dist/index.html — corré `npm run build` primero')
    process.exit(1)
  }

  // ── Las funciones de SEO de verdad, transpiladas al vuelo por Vite ──────────
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'warn',
  })
  /** @type {typeof import('../src/modules/publico/lib/seo')} */
  const seo = await vite.ssrLoadModule('/src/modules/publico/lib/seo.ts')
  /** @type {typeof import('../src/modules/publico/lib/sinonimos')} */
  const sin = await vite.ssrLoadModule('/src/modules/publico/lib/sinonimos.ts')
  /** @type {typeof import('../src/modules/publico/lib/rutas')} */
  const rutas = await vite.ssrLoadModule('/src/modules/publico/lib/rutas.ts')

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // La base vive en São Paulo y la PRIMERA consulta desde el runner de CI puede
  // pegar un cold start que supera el statement_timeout (medido: la función
  // corre en ~240 ms en caliente, pero en frío a veces se cancela). Un reintento
  // con pausa corta lo salva sin tirar el deploy entero por un timeout transitorio.
  async function rpc(nombre, args) {
    for (let intento = 1; ; intento++) {
      const r = await supabase.rpc(nombre, args)
      const transitorio =
        r.error && /timeout|canceling statement|fetch failed|ECONN|network|socket/i.test(r.error.message || '')
      if (!r.error || !transitorio || intento >= 4) return r
      console.warn(`[prerender] ${nombre} intento ${intento} falló (${r.error.message}); reintento…`)
      await new Promise((res) => setTimeout(res, 2000 * intento))
    }
  }

  // ── Escape: todo lo que entra al HTML sale de la base ───────────────────────
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  const plantilla = readFileSync(join(DIST, 'index.html'), 'utf8')

  /**
   * Arma un `index.html` a partir del molde: cambia título, descripción,
   * canónica, Open Graph, datos estructurados y el contenido visible de
   * `#root`. Todo lo demás del molde —assets, script de la app, preconnect—
   * queda intacto, que es lo que hace que la app arranque igual encima.
   */
  function pagina({ titulo, descripcion, canonica, imagen, datos, cuerpo }) {
    const url = `${SITIO}${canonica}`
    const cabeza = [
      `<link rel="canonical" href="${esc(url)}" />`,
      `<meta property="og:title" content="${esc(titulo)}" />`,
      `<meta property="og:description" content="${esc(descripcion)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(seo.NOMBRE_SITIO)}" />`,
      `<meta name="twitter:card" content="${imagen ? 'summary_large_image' : 'summary'}" />`,
    ]
    if (imagen) cabeza.push(`<meta property="og:image" content="${esc(imagen)}" />`)
    if (datos) {
      // `</script>` dentro del JSON cerraría la etiqueta: se escapa el `<`.
      const json = JSON.stringify(datos).replace(/</g, '\\u003c')
      cabeza.push(`<script type="application/ld+json">${json}</script>`)
    }

    return plantilla
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`)
      .replace(
        /<meta name="description" content="[^"]*"\s*\/>/,
        `<meta name="description" content="${esc(descripcion)}" />`,
      )
      .replace('</head>', `    ${cabeza.join('\n    ')}\n  </head>`)
      .replace('<div id="root"></div>', `<div id="root">${cuerpo}</div>`)
  }

  function escribir(rutaRelativa, html) {
    // `rutaRelativa` empieza con barra; el archivo es `<ruta>/index.html`.
    const destino = join(DIST, rutaRelativa.replace(/^\/+/, ''), 'index.html')
    mkdirSync(dirname(destino), { recursive: true })
    writeFileSync(destino, html, 'utf8')
  }

  // ── El contenido visible de una ficha ──────────────────────────────────────
  function cuerpoProducto(p, foto, alt) {
    const atributos = Object.entries(p.atributos ?? {})
      .map(([k, v]) => [seo.nombreDeAtributo(k), seo.valorLegible(v)])
      .filter(([, v]) => v !== '')
    const tambien = sin.tambienBuscadoComo(p)

    return (
      `<main>` +
      `<nav aria-label="Dónde estás"><a href="/">Catálogo</a> › ` +
      `<a href="/productos/${esc(p.categoriaSlug)}/">${esc(p.categoria ?? 'Productos')}</a></nav>` +
      `<article>` +
      (foto ? `<img src="${esc(foto)}" alt="${esc(alt)}" width="520" height="520" />` : '') +
      (p.marca ? `<p>${esc(p.marca)}</p>` : '') +
      `<h1>${esc(p.nombre)}</h1>` +
      `<p>${esc(p.sku)}</p>` +
      (atributos.length > 0
        ? `<dl>${atributos.map(([n, v]) => `<dt>${esc(n)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
        : '') +
      (tambien !== '' ? `<p>${esc(tambien)}</p>` : '') +
      `<p>Los precios y la disponibilidad los informamos a pedido, según cantidad.</p>` +
      `<a href="/cotizar">Pedir cotización</a>` +
      `</article></main>`
    )
  }

  // ── El contenido visible de una categoría ──────────────────────────────────
  function cuerpoCategoria(nombre, slug, productos) {
    const enlaces = productos
      .slice(0, 200)
      .map(
        (p) =>
          `<li><a href="/productos/${esc(p.categoriaSlug)}/${esc(p.slug)}/">${esc(p.nombre)}</a></li>`,
      )
      .join('')
    return (
      `<main>` +
      `<nav aria-label="Dónde estás"><a href="/">Catálogo</a> › ${esc(nombre)}</nav>` +
      `<h1>${esc(nombre)}</h1>` +
      `<p>${esc(seo.descripcionDeCategoria(nombre, productos.length))}</p>` +
      `<ul>${enlaces}</ul>` +
      `</main>`
    )
  }

  // ── Traer TODO el catálogo, página por página (tope del server: 48) ─────────
  async function traerTodo() {
    const todos = []
    let pagina = 1
    for (;;) {
      const { data, error } = await rpc('catalogo_publico_listar', {
        p_categoria: null,
        p_marca: null,
        p_serie: null,
        p_tipo: null,
        p_texto: null,
        p_modelo: null,
        p_atributos: null,
        p_pagina: pagina,
        p_por_pagina: 48,
      })
      if (error) throw new Error(`catalogo_publico_listar p${pagina}: ${error.message}`)
      const filas = Array.isArray(data?.productos) ? data.productos : []
      todos.push(...filas)
      const total = Number(data?.total ?? 0)
      if (filas.length < 48 || todos.length >= total) break
      pagina += 1
    }
    return todos
  }

  console.log('[prerender] leyendo catálogo…')
  const productos = await traerTodo()
  const { data: catData, error: catErr } = await rpc('catalogo_publico_categorias')
  if (catErr) throw new Error(`catalogo_publico_categorias: ${catErr.message}`)
  const categorias = Array.isArray(catData) ? catData : []
  console.log(`[prerender] ${productos.length} productos, ${categorias.length} categorías`)

  // ── Las fichas ──────────────────────────────────────────────────────────────
  const urls = [`${SITIO}/`]
  for (const p of productos) {
    if (!p.slug || !p.categoriaSlug) continue
    const foto = p.imagenUrl ?? null
    const alt = p.imagenAlt ?? seo.altDeImagen(p)
    const canonica = rutas.conBarraFinal(rutas.rutaProductoPublico(p.categoriaSlug, p.slug))
    escribir(
      canonica,
      pagina({
        titulo: seo.tituloDeProducto(p),
        descripcion: seo.descripcionDeProducto(p),
        canonica,
        imagen: foto,
        datos: seo.datosEstructurados({ ...p, imagen: foto }, `${SITIO}${canonica}`),
        cuerpo: cuerpoProducto(p, foto, alt),
      }),
    )
    urls.push(`${SITIO}${canonica}`)
  }

  // ── Las categorías ────────────────────────────────────────────────────────
  const porCategoria = new Map()
  for (const p of productos) {
    if (!p.categoriaSlug) continue
    const lista = porCategoria.get(p.categoriaSlug) ?? []
    lista.push(p)
    porCategoria.set(p.categoriaSlug, lista)
  }
  for (const c of categorias) {
    if (!c.slug) continue
    const lista = porCategoria.get(c.slug) ?? []
    const canonica = rutas.conBarraFinal(rutas.rutaCategoria(c.slug))
    escribir(
      canonica,
      pagina({
        titulo: seo.tituloDeCategoria(c.nombre),
        descripcion: seo.descripcionDeCategoria(c.nombre, Number(c.productos ?? lista.length)),
        canonica,
        imagen: null,
        datos: null,
        cuerpo: cuerpoCategoria(c.nombre, c.slug, lista),
      }),
    )
    urls.push(`${SITIO}${canonica}`)
  }

  // ── La portada: es el catálogo, así que lista las categorías como caminos ───
  const enlacesCat = categorias
    .map(
      (c) =>
        `<li><a href="/productos/${esc(c.slug)}/">${esc(c.nombre)}</a> (${Number(c.productos ?? 0)})</li>`,
    )
    .join('')
  escribir(
    '/',
    pagina({
      titulo: `Herramientas industriales y de montaje${seo.SUFIJO}`,
      descripcion: seo.descripcionDeCategoria('productos', productos.length),
      canonica: '/',
      imagen: null,
      datos: null,
      cuerpo:
        `<main><h1>Catálogo Buscatools</h1>` +
        `<p>Puntas, tubos, embocaduras, balanceadores, atornilladores, llaves de impacto ` +
        `y dinamométricas. Importación directa, entrega en todo el país.</p>` +
        `<ul>${enlacesCat}</ul></main>`,
    }),
  )

  // ── sitemap.xml ─────────────────────────────────────────────────────────────
  const hoy = new Date().toISOString().slice(0, 10)
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${hoy}</lastmod></url>`)
      .join('\n') +
    `\n</urlset>\n`
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8')

  // ── robots.txt ──────────────────────────────────────────────────────────────
  const robots =
    `User-agent: *\n` +
    `Allow: /\n` +
    // El ERP y el carrito no son contenido: son herramientas. Que no compitan
    // en el buscador ni gasten presupuesto de rastreo.
    `Disallow: /inicio\n` +
    `Disallow: /catalogo\n` +
    `Disallow: /ventas\n` +
    `Disallow: /compras\n` +
    `Disallow: /clientes\n` +
    `Disallow: /mantenimiento\n` +
    `Disallow: /emails\n` +
    `Disallow: /whatsapp\n` +
    `Disallow: /chat\n` +
    `Disallow: /informes\n` +
    `Disallow: /configuracion\n` +
    `Disallow: /auth\n` +
    `Disallow: /oauth\n` +
    `Disallow: /cotizar\n` +
    `\nSitemap: ${SITIO}/sitemap.xml\n`
  writeFileSync(join(DIST, 'robots.txt'), robots, 'utf8')

  await vite.close()
  console.log(`[prerender] listo: ${urls.length} URLs, sitemap.xml y robots.txt`)
})().catch((e) => {
  console.error('[prerender]', e)
  process.exit(1)
})
