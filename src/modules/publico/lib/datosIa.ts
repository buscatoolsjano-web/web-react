/**
 * Lo que leen las máquinas: buscadores y asistentes de IA.
 *
 * ── PARA QUÉ ────────────────────────────────────────────────────────────────
 *
 * Una persona entiende la pantalla; un modelo de IA (ChatGPT, Perplexity,
 * Gemini, Claude) o un buscador entiende mucho mejor datos con estructura:
 * qué es un producto, de qué marca, en qué categoría, con qué medidas, y cómo
 * se llega a cada cosa. Nada de esto se ve en la pantalla:
 *
 *  - **schema.org (JSON-LD)** en el `<head>` de cada página: el producto con
 *    sus atributos, la miga de pan, la lista de productos de una categoría o
 *    de una marca, la empresa y cómo contactarla.
 *  - **`/llms.txt`**: el resumen del sitio en Markdown, el formato que leen
 *    los asistentes para entender un sitio de un vistazo (llmstxt.org).
 *  - **`/datos/*.json`**: el catálogo entero en JSON, por categoría, con las
 *    URL de cada ficha.
 *
 * Lo usan el prerender (el HTML que sirve GitHub Pages) y la app (al navegar
 * adentro), con las MISMAS funciones: si se escribieran dos veces, el HTML y
 * la pantalla terminarían diciendo cosas distintas.
 *
 * ── LO QUE NO VA ────────────────────────────────────────────────────────────
 *
 * Precio y stock. No son públicos: se cotizan. Una oferta sin precio, o con
 * precio cero, es un dato falso para el buscador. Se dice en texto —«precio a
 * pedido»— y en ningún lado se inventa un número.
 */
import { NOMBRE_SITIO, datosEstructurados, nombreDeAtributo, valorLegible } from './seo'

export const CONTACTO = {
  email: 'info@buscatools.com.ar',
  telefono: '+54 9 11 2169-3304',
  whatsapp: 'https://wa.me/5491121693304',
} as const

const CONTEXTO = 'https://schema.org'

/** Una entrada de la miga de pan: el nombre y la ruta (sin dominio). */
export interface Miga {
  nombre: string
  ruta: string
}

export function migaDePan(sitio: string, migas: readonly Miga[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: migas.map((m, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: m.nombre,
      item: `${sitio}${m.ruta}`,
    })),
  }
}

/** La empresa, siempre con el mismo `@id` para que todo apunte a ella. */
export function organizacion(sitio: string): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': `${sitio}/#organizacion`,
    name: NOMBRE_SITIO,
    url: `${sitio}/`,
    logo: `${sitio}/icon-512.png`,
    email: CONTACTO.email,
    telephone: CONTACTO.telefono,
    areaServed: { '@type': 'Country', name: 'Argentina' },
    description:
      'Importación y distribución de herramientas industriales de montaje y torque: atornilladores, balanceadores, puntas, tubos, llaves de impacto y dinamométricas.',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      email: CONTACTO.email,
      telephone: CONTACTO.telefono,
      availableLanguage: ['es'],
      areaServed: 'AR',
    },
  }
}

/** El sitio, con su buscador: le dice al asistente cómo buscar un producto. */
export function sitioWeb(sitio: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${sitio}/#sitio`,
    name: NOMBRE_SITIO,
    url: `${sitio}/`,
    inLanguage: 'es-AR',
    publisher: { '@id': `${sitio}/#organizacion` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${sitio}/productos?q={busqueda}` },
      'query-input': 'required name=busqueda',
    },
  }
}

/** Un producto tal como lo trae el catálogo público. */
export interface ProductoParaIa {
  nombre: string
  sku: string
  slug: string
  categoriaSlug: string
  categoria?: string | null
  marca?: string | null
  serie?: string | null
  tipo?: string | null
  descripcion?: string | null
  imagen?: string | null
  atributos?: Record<string, unknown> | null
}

export function rutaDeFicha(p: { categoriaSlug: string; slug: string }): string {
  return `/productos/${p.categoriaSlug}/${p.slug}/`
}

/** La ficha: el producto, su miga de pan y quién lo vende. */
export function datosDeFicha(p: ProductoParaIa, sitio: string): Record<string, unknown> {
  const url = `${sitio}${rutaDeFicha(p)}`
  // Adentro de un `@graph` el contexto va una sola vez, arriba.
  const producto = { ...datosEstructurados(p, url) }
  delete producto['@context']
  return {
    '@context': CONTEXTO,
    '@graph': [
      {
        ...producto,
        '@id': `${url}#producto`,
        mainEntityOfPage: url,
        // Sin `offers` (ver `seo.datosEstructurados`); quién lo vende sí.
        ...(p.descripcion ? {} : { description: descripcionCorta(p) }),
      },
      migaDePan(sitio, [
        { nombre: 'Inicio', ruta: '/' },
        { nombre: 'Catálogo', ruta: '/productos/' },
        { nombre: p.categoria ?? 'Productos', ruta: `/productos/${p.categoriaSlug}/` },
        { nombre: p.nombre, ruta: rutaDeFicha(p) },
      ]),
    ],
  }
}

/** Una línea que describe el producto con lo que se sabe de él. */
export function descripcionCorta(p: ProductoParaIa): string {
  const partes = [p.nombre]
  if (p.marca) partes.push(`marca ${p.marca}`)
  if (p.categoria) partes.push(`categoría ${p.categoria}`)
  partes.push(`código ${p.sku}`)
  return `${partes.join(', ')}. Precio y disponibilidad a pedido.`
}

/** Una lista de productos (categoría o marca), con la URL de cada uno. */
function listaDeProductos(sitio: string, productos: readonly ProductoParaIa[], tope: number) {
  return {
    '@type': 'ItemList',
    numberOfItems: productos.length,
    itemListElement: productos.slice(0, tope).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${sitio}${rutaDeFicha(p)}`,
      name: p.nombre,
    })),
  }
}

export function datosDeCategoria(
  sitio: string,
  c: { nombre: string; slug: string; descripcion: string },
  productos: readonly ProductoParaIa[],
): Record<string, unknown> {
  const url = `${sitio}/productos/${c.slug}/`
  return {
    '@context': CONTEXTO,
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: c.nombre,
        description: c.descripcion,
        inLanguage: 'es-AR',
        isPartOf: { '@id': `${sitio}/#sitio` },
        mainEntity: listaDeProductos(sitio, productos, 200),
      },
      migaDePan(sitio, [
        { nombre: 'Inicio', ruta: '/' },
        { nombre: 'Catálogo', ruta: '/productos/' },
        { nombre: c.nombre, ruta: `/productos/${c.slug}/` },
      ]),
    ],
  }
}

export function datosDeMarca(
  sitio: string,
  m: { nombre: string; slug: string; descripcion: string },
  productos: readonly ProductoParaIa[],
): Record<string, unknown> {
  const url = `${sitio}/marcas/${m.slug}/`
  return {
    '@context': CONTEXTO,
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: `${m.nombre} en ${NOMBRE_SITIO}`,
        description: m.descripcion,
        inLanguage: 'es-AR',
        about: { '@type': 'Brand', name: m.nombre },
        isPartOf: { '@id': `${sitio}/#sitio` },
        mainEntity: listaDeProductos(sitio, productos, 100),
      },
      migaDePan(sitio, [
        { nombre: 'Inicio', ruta: '/' },
        { nombre: 'Marcas', ruta: '/marcas/' },
        { nombre: m.nombre, ruta: `/marcas/${m.slug}/` },
      ]),
    ],
  }
}

/** Una lista de enlaces con nombre: categorías del catálogo, marcas. */
export function datosDeIndice(
  sitio: string,
  ruta: string,
  nombre: string,
  descripcion: string,
  items: readonly { nombre: string; ruta: string }[],
): Record<string, unknown> {
  const url = `${sitio}${ruta}`
  return {
    '@context': CONTEXTO,
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: nombre,
        description: descripcion,
        inLanguage: 'es-AR',
        isPartOf: { '@id': `${sitio}/#sitio` },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: items.length,
          itemListElement: items.map((it, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: it.nombre,
            url: `${sitio}${it.ruta}`,
          })),
        },
      },
      migaDePan(sitio, [
        { nombre: 'Inicio', ruta: '/' },
        { nombre, ruta },
      ]),
    ],
  }
}

/** Nosotros, servicios, contacto: la página y la empresa. */
export function datosInstitucionales(
  sitio: string,
  ruta: string,
  tipo: 'AboutPage' | 'ContactPage' | 'WebPage',
  nombre: string,
  descripcion: string,
): Record<string, unknown> {
  const url = `${sitio}${ruta}`
  return {
    '@context': CONTEXTO,
    '@graph': [
      {
        '@type': tipo,
        '@id': url,
        url,
        name: nombre,
        description: descripcion,
        inLanguage: 'es-AR',
        isPartOf: { '@id': `${sitio}/#sitio` },
        about: { '@id': `${sitio}/#organizacion` },
      },
      organizacion(sitio),
      migaDePan(sitio, [
        { nombre: 'Inicio', ruta: '/' },
        { nombre, ruta },
      ]),
    ],
  }
}

// ── El catálogo en JSON (/datos/) ────────────────────────────────────────────

/** Un producto en el JSON del catálogo: lo justo, con nombres claros. */
export interface ProductoJson {
  nombre: string
  codigo: string
  marca: string | null
  categoria: string | null
  serie: string | null
  tipo: string | null
  url: string
  imagen: string | null
  atributos: Record<string, string>
}

export function productoJson(p: ProductoParaIa, sitio: string): ProductoJson {
  const atributos: Record<string, string> = {}
  for (const [clave, valor] of Object.entries(p.atributos ?? {})) {
    const legible = valorLegible(valor)
    if (legible !== '') atributos[nombreDeAtributo(clave)] = legible
  }
  return {
    nombre: p.nombre,
    codigo: p.sku,
    marca: p.marca ?? null,
    categoria: p.categoria ?? null,
    serie: p.serie ?? null,
    tipo: p.tipo ?? null,
    url: `${sitio}${rutaDeFicha(p)}`,
    imagen: p.imagen ?? null,
    atributos,
  }
}

/** Lo que dice cada archivo de `/datos/` sobre sí mismo. */
export const AVISO_DATOS =
  'Catálogo público de Buscatools (Argentina). Precio y disponibilidad no se publican: se cotizan a pedido por WhatsApp, email o el formulario de contacto.'

// ── /llms.txt ────────────────────────────────────────────────────────────────

export interface EntradaLlms {
  nombre: string
  ruta: string
  detalle?: string
}

/**
 * El `llms.txt`: un Markdown corto que cuenta qué es el sitio y dónde está
 * cada cosa. Formato de llmstxt.org: título, cita con el resumen, secciones
 * de enlaces.
 */
export function llmsTxt(
  sitio: string,
  datos: {
    totalProductos: number
    categorias: readonly EntradaLlms[]
    marcas: readonly EntradaLlms[]
    preguntas: readonly { pregunta: string; respuesta: string }[]
  },
): string {
  const enlace = (e: EntradaLlms) =>
    `- [${e.nombre}](${sitio}${e.ruta})${e.detalle ? `: ${e.detalle}` : ''}`
  const lineas = [
    `# ${NOMBRE_SITIO}`,
    '',
    `> ${NOMBRE_SITIO} importa y distribuye herramientas industriales de montaje y torque en Argentina: atornilladores, balanceadores, puntas, tubos, embocaduras, llaves de impacto y dinamométricas, para líneas de producción. ${datos.totalProductos.toLocaleString('es-AR')} productos en catálogo. Factura A o B y envíos a todo el país.`,
    '',
    'Datos clave:',
    '',
    '- Los precios y la disponibilidad NO se publican: se cotizan a pedido, según cantidad. Para cotizar: WhatsApp, email o el formulario de contacto.',
    `- WhatsApp: ${CONTACTO.telefono} (${CONTACTO.whatsapp})`,
    `- Email: ${CONTACTO.email}`,
    '- Idioma del sitio: español (Argentina).',
    '- Cada producto tiene una ficha con marca, código, categoría y atributos técnicos (medidas, encastre, torque, etc.).',
    '',
    '## Páginas principales',
    '',
    enlace({ nombre: 'Inicio', ruta: '/' }),
    enlace({ nombre: 'Catálogo completo', ruta: '/productos/' }),
    enlace({ nombre: 'Marcas', ruta: '/marcas/' }),
    enlace({ nombre: 'Servicios', ruta: '/servicios/', detalle: 'asesoramiento técnico, repuestos, compras programadas' }),
    enlace({ nombre: 'Quiénes somos', ruta: '/nosotros/' }),
    enlace({ nombre: 'Contacto', ruta: '/contacto/' }),
    '',
    '## Datos para máquinas',
    '',
    enlace({ nombre: 'Índice del catálogo (JSON)', ruta: '/datos/catalogo.json', detalle: 'categorías y marcas, con cantidades y el archivo de productos de cada categoría' }),
    enlace({ nombre: 'Sitemap', ruta: '/sitemap.xml', detalle: 'todas las URL del sitio' }),
    `- Búsqueda: ${sitio}/productos?q={texto}`,
    '',
    '## Categorías',
    '',
    ...datos.categorias.map(enlace),
    '',
    '## Marcas',
    '',
    ...datos.marcas.map(enlace),
    '',
    '## Preguntas frecuentes',
    '',
    ...datos.preguntas.flatMap((p) => [`### ${p.pregunta}`, '', p.respuesta, '']),
  ]
  return `${lineas.join('\n').trimEnd()}\n`
}
