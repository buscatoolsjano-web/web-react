/**
 * Lo que leen los buscadores (Fase 87 · E2). PURO.
 *
 * ── POR QUÉ ES UN MÓDULO Y NO UNAS LÍNEAS EN CADA PÁGINA ────────────────────
 *
 * Porque esto se va a generar DOS veces: acá, cuando alguien navega por el
 * sitio, y en el build, cuando se escriba el HTML de cada URL para que el
 * buscador lo encuentre hecho (E4). Si cada página armara su propio título,
 * las dos copias se separarían y la mitad de las páginas quedaría con un
 * título en el HTML y otro en la pantalla, que es peor que no tener ninguno.
 *
 * Una sola definición, pura, y las dos la usan.
 *
 * ── LAS REGLAS QUE NO SON OPINIÓN ───────────────────────────────────────────
 *
 * El título se corta a los ~60 caracteres en el resultado de búsqueda y la
 * descripción a los ~155. Lo que pase de ahí no es que se vea feo: no se ve.
 * Así que lo importante va ADELANTE —el producto, no la marca de la casa— y
 * el nombre de la empresa va al final, donde si se corta no se pierde nada.
 */

/** Lo que entra en un título antes de que el buscador lo corte. */
export const LARGO_TITULO = 60
/** Y en una descripción. */
export const LARGO_DESCRIPCION = 155

export const NOMBRE_SITIO = 'Buscatools'
export const SUFIJO = ` | ${NOMBRE_SITIO}`

export interface Meta {
  titulo: string
  descripcion: string
  /** La dirección única de esta página, para que no compita consigo misma. */
  canonica: string
}

/**
 * Recorta sin partir una palabra al medio.
 *
 * Cortar en seco deja «Embocadura SPEEDRILL J2310H, calidad y durabil», que
 * se lee como un error. Cortar en el espacio anterior deja una frase que
 * termina, y el buscador le agrega los puntos suspensivos solo.
 */
export function recortar(texto: string, largo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  if (limpio.length <= largo) return limpio
  const corte = limpio.slice(0, largo)
  const espacio = corte.lastIndexOf(' ')
  return (espacio > largo * 0.6 ? corte.slice(0, espacio) : corte).trim()
}

/**
 * El título de una ficha.
 *
 * Primero el nombre del producto, que es lo que se buscó, y después el SKU,
 * que es lo que busca quien ya lo conoce. Los dos antes del nombre de la
 * casa: si el buscador corta, que corte por «Buscatools» y no por el SKU.
 */
export function tituloDeProducto(p: { nombre: string; sku: string }): string {
  const base = `${p.nombre} — ${p.sku}`
  return `${recortar(base, LARGO_TITULO - SUFIJO.length)}${SUFIJO}`
}

/**
 * La descripción de una ficha.
 *
 * Se arma con lo que distingue al producto —marca, categoría, y los atributos
 * cargados— y no con una frase de relleno repetida en nueve mil páginas.
 * Nueve mil descripciones iguales le dicen al buscador que el sitio tiene una
 * sola página repetida nueve mil veces.
 *
 * La descripción del catálogo va primero cuando existe: está escrita para que
 * la lea una persona.
 */
export function descripcionDeProducto(p: {
  nombre: string
  sku: string
  marca?: string | null
  categoria?: string | null
  descripcion?: string | null
  atributos?: Record<string, unknown> | null
}): string {
  const partes: string[] = []
  if (p.descripcion && p.descripcion.trim() !== '') partes.push(p.descripcion.trim())
  else if (p.marca && p.categoria) partes.push(`${p.categoria} ${p.marca} ${p.sku}.`)

  const rasgos = rasgosLegibles(p.atributos ?? null)
  if (rasgos !== '') partes.push(rasgos + '.')
  partes.push('Consultá disponibilidad y precio.')

  return recortar(partes.join(' '), LARGO_DESCRIPCION)
}

/**
 * Los atributos, dichos como los diría alguien.
 *
 * `{encastre: '1/4 HEX', medida: '2'}` es un objeto; «Encastre 1/4 HEX,
 * medida 2» es una frase. Y las claves se traducen porque `torq_max` no es
 * una palabra que nadie busque.
 */
const NOMBRES: Record<string, string> = {
  encastre: 'Encastre',
  medida: 'Medida',
  largo: 'Largo',
  longitud: 'Longitud',
  torq_min: 'Torque mínimo',
  torq_max: 'Torque máximo',
  min_kg: 'Desde',
  max_kg: 'Hasta',
  rpm: 'RPM',
  voltaje: 'Voltaje',
  peso_kg: 'Peso',
  carcasa: 'Carcasa',
  ergonomia: 'Ergonomía',
  alimentacion: 'Alimentación',
  eslinga: 'Eslinga',
  sufijos: 'Variante',
}

/** El nombre legible de un atributo. Sin traducción, se deja como está. */
export function nombreDeAtributo(clave: string): string {
  return NOMBRES[clave] ?? clave.charAt(0).toUpperCase() + clave.slice(1).replace(/_/g, ' ')
}

export function rasgosLegibles(atributos: Record<string, unknown> | null): string {
  if (!atributos) return ''
  const partes: string[] = []
  for (const [clave, valor] of Object.entries(atributos)) {
    const texto = valorLegible(valor)
    if (texto === '') continue
    partes.push(`${nombreDeAtributo(clave).toLowerCase()} ${texto}`)
  }
  if (partes.length === 0) return ''
  // Mayúscula en la primera, que es donde arranca la frase.
  const frase = partes.join(', ')
  return frase.charAt(0).toUpperCase() + frase.slice(1)
}

/** Un valor de atributo como texto. Las listas se unen; lo raro se descarta. */
export function valorLegible(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no'
  if (Array.isArray(valor)) return valor.map(valorLegible).filter((v) => v !== '').join(', ')
  return ''
}

/** El título de una categoría. «Puntas y tubos» ya es lo que se busca. */
export function tituloDeCategoria(nombre: string): string {
  return `${recortar(nombre, LARGO_TITULO - SUFIJO.length)}${SUFIJO}`
}

export function descripcionDeCategoria(nombre: string, cuantos: number): string {
  return recortar(
    `${cuantos.toLocaleString('es-AR')} ${nombre.toLowerCase()} de las mejores marcas, ` +
      'para la industria y el montaje. Importación directa y entrega en todo el país. ' +
      'Consultá disponibilidad y precio.',
    LARGO_DESCRIPCION,
  )
}

/**
 * Los datos estructurados de una ficha.
 *
 * Es lo que hace que el buscador entienda que esto es un PRODUCTO y no un
 * texto cualquiera, y lo que le permite mostrar la marca y el código debajo
 * del resultado.
 *
 * SIN `offers`, a propósito. `offers` es donde va el precio, y acá no hay
 * precio: declarar una oferta vacía —o con precio cero— es decirle al
 * buscador algo falso sobre el producto, y eso se castiga.
 */
export function datosEstructurados(
  p: {
    nombre: string
    sku: string
    marca?: string | null
    categoria?: string | null
    descripcion?: string | null
    imagen?: string | null
    atributos?: Record<string, unknown> | null
  },
  url: string,
): Record<string, unknown> {
  const propiedades = Object.entries(p.atributos ?? {})
    .map(([clave, valor]) => ({
      '@type': 'PropertyValue',
      name: nombreDeAtributo(clave),
      value: valorLegible(valor),
    }))
    .filter((x) => x.value !== '')

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nombre,
    sku: p.sku,
    url,
    ...(p.descripcion ? { description: p.descripcion } : {}),
    ...(p.marca ? { brand: { '@type': 'Brand', name: p.marca } } : {}),
    ...(p.categoria ? { category: p.categoria } : {}),
    ...(p.imagen ? { image: p.imagen } : {}),
    ...(propiedades.length > 0 ? { additionalProperty: propiedades } : {}),
  }
}
