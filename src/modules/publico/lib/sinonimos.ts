/**
 * Cómo busca la gente cada producto (Fase 88 · SEO). PURO.
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
 *
 * «Capaz embocadura muchos lo buscan como tubo, otro como boca llave.» El
 * catálogo nombra las cosas con el término técnico del fabricante —SPEEDRILL
 * le dice «embocadura» a lo que medio país busca como «tubo» o «dado»—, y una
 * página que sólo dice «embocadura» no aparece cuando alguien escribe «dado de
 * impacto 1/2».
 *
 * Acá vive el diccionario: para cada término del catálogo, cómo lo escribe la
 * gente. Se usa para enriquecer el título, la descripción, el alt de la imagen
 * y un renglón visible de «también buscado como…», que es la forma HONESTA de
 * sumar las palabras —son de verdad otros nombres del producto, no relleno—.
 *
 * ── POR QUÉ ES UN ARCHIVO Y NO UNA TABLA ────────────────────────────────────
 *
 * Porque es contenido EDITORIAL, no un dato del catálogo. Lo escribe alguien
 * que sabe cómo se pide una herramienta en un taller argentino, y se corrige
 * leyéndolo, no con una consulta. Las claves son pocas y fijas —diez
 * categorías, veinte tipos, una docena de series que importan—.
 *
 * ── LA REGLA QUE NO SE CRUZA ────────────────────────────────────────────────
 *
 * Un sinónimo tiene que ser VERDAD. «Tubo» es un nombre real de una
 * embocadura; «barato» o «oferta» no son nombres del producto, son cebo, y
 * meterlos es lo que Google castiga como keyword stuffing. Si no es otra forma
 * legítima de nombrar la cosa, no entra.
 */

/** Sin acentos y en minúscula, que es como se compara y como se busca. */
function normal(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * El diccionario. La clave es el término del catálogo, normalizado; el valor,
 * cómo lo escribe la gente. Los términos del catálogo salen de los valores
 * reales de categoría, serie y tipo.
 */
const SINONIMOS: Record<string, string[]> = {
  // ── Categorías ───────────────────────────────────────────────────────────
  'puntas y tubos': ['puntas', 'tubos', 'bits', 'dados', 'insertos de atornillar'],
  balanceadores: ['balancin', 'balanceador de herramientas', 'equilibrador', 'retractor', 'porta herramienta a resorte'],
  atornilladores: ['atornilladora', 'destornillador', 'desatornillador', 'atornillador electrico', 'atornillador neumatico'],
  'llaves de impacto': ['llave de impacto', 'pistola de impacto', 'llave neumatica', 'aprieta tuercas', 'pistola neumatica'],
  remachadoras: ['remachadora', 'remachadora de tuercas', 'remachadora neumatica', 'maquina de remaches', 'pop'],
  'llaves dinamometricas': ['torquimetro', 'llave de torque', 'llave dinamometrica', 'medidor de torque'],
  accesorios: ['accesorio', 'repuesto', 'recambio'],

  // ── Series y tipos: la forma de la pieza ───────────────────────────────────
  embocadura: ['tubo', 'dado', 'vaso', 'socket', 'boca de llave', 'boca llave', 'cubo', 'tubo de impacto'],
  punta: ['bit', 'inserto', 'punta de atornillar', 'punta para atornillador'],
  extension: ['alargue', 'prolongador', 'extensor', 'alargador'],
  adaptador: ['reduccion', 'acople', 'conversor', 'ampliacion'],
  rotula: ['cardanico', 'junta universal', 'articulada', 'flexible'],
  cardanico: ['cardan', 'junta universal', 'rotula', 'articulado'],
  phillips: ['cruz', 'cruceta', 'philips', 'pilips', 'estrella cruz'],
  pozidrive: ['pozidriv', 'posidrive', 'pz'],
  torx: ['estrella', 'estriada', 'torks', 'star'],
  'torx plus': ['torx plus', 'ip', 'torx ip'],
  allen: ['hexagonal interior', 'hexagono interior', 'hex', 'bristol', 'exagono'],
  plana: ['pala', 'paleta', 'ranurada', 'recta', 'paleta plana'],
  cuadrado: ['robertson', 'square', 'cuadrada'],
  'tri-wing': ['tri wing', 'triwing', 'tres alas'],
  'bi-hexagonal': ['doble hexagono', '12 puntas', 'doce puntas', 'estria'],
  hexagonal: ['hexagono', '6 puntas', 'seis puntas', 'exagonal', 'hex'],
  nutsetter: ['nut setter', 'llave de tuerca', 'porta tuerca', 'tubo magnetico'],
  'holder bit': ['portapuntas', 'porta bit', 'porta inserto'],
  portapuntas: ['porta bit', 'holder bit', 'porta puntas', 'porta inserto'],
  balanceador: ['balancin', 'equilibrador', 'retractor', 'porta herramienta a resorte'],
  'atornillador pistola': ['pistola', 'atornillador de pistola'],
  'atornillador angular': ['angular', 'atornillador de codo'],
  'atornillador recto neumatico': ['atornillador recto', 'atornillador a aire', 'recto neumatico'],
  'atornillador angular neumatico': ['angular neumatico', 'atornillador a aire angular'],
  'destornillador manual': ['destornillador', 'atornillador manual'],
  'llave dinamometrica': ['torquimetro', 'llave de torque', 'medidor de torque'],
  'llave tuercas ranuradas': ['llave de tuercas', 'llave ranurada'],
  casquillo: ['buje', 'cubo'],
  husillo: ['eje', 'mandril'],
  gatillo: ['disparador'],
  bateria: ['pila', 'acumulador'],
  cargador: ['cargador de bateria'],
  iman: ['magnetico', 'magnetizador'],
}

/**
 * Los sinónimos de un término del catálogo. Lista vacía si no está en el
 * diccionario, que es la mayoría de los modelos puntuales.
 */
export function sinonimosDe(termino: string | null | undefined): string[] {
  if (!termino) return []
  return SINONIMOS[normal(termino)] ?? []
}

/**
 * Todas las palabras por las que se puede buscar UN producto.
 *
 * Junta lo que lo identifica —marca, categoría, serie, tipo— con los sinónimos
 * de cada uno, sin repetir y sin lo que ya está en el nombre. Es la materia
 * prima del alt, de las keywords y del renglón de «también buscado como».
 *
 * NO incluye el nombre entero ni el SKU: ésos ya están en el título y en el
 * cuerpo. Acá va lo que el nombre NO dice con las palabras de la calle.
 */
export function palabrasClaveDe(p: {
  categoria?: string | null
  serie?: string | null
  tipo?: string | null
}): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []

  const sumar = (termino: string | null | undefined) => {
    if (!termino) return
    for (const s of sinonimosDe(termino)) {
      const k = normal(s)
      if (k === '' || vistos.has(k)) continue
      vistos.add(k)
      salida.push(s)
    }
  }

  // Tipo primero: es lo más específico y lo que más se busca.
  sumar(p.tipo)
  sumar(p.serie)
  sumar(p.categoria)
  return salida
}

/**
 * La frase de «también buscado como…», para el cuerpo de la ficha.
 *
 * Es contenido VISIBLE y verdadero: son otros nombres del mismo producto, que
 * además le sirven a una persona que no sabe cómo se llama técnicamente. Vacía
 * si no hay sinónimos, para no escribir «también buscado como:» y nada.
 */
export function tambienBuscadoComo(p: {
  categoria?: string | null
  serie?: string | null
  tipo?: string | null
}): string {
  const claves = palabrasClaveDe(p).slice(0, 8)
  if (claves.length === 0) return ''
  return `También buscado como: ${claves.join(', ')}.`
}
