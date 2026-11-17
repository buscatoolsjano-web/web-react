/**
 * Importar una lista de precios desde un Excel o un CSV. PURO.
 *
 * Cada fabricante manda su lista a su manera: un logo y tres renglones de
 * título arriba, la referencia como «Part No.», «Código» o «Referencia», el
 * precio como «List Price USD», «PVP 2026 €» o «Precio». Esto mira la planilla
 * y decide, sin preguntar lo que se puede deducir:
 *
 *   1. dónde está el renglón de encabezados (`detectarEncabezado`);
 *   2. qué columna es la referencia, cuál la descripción, cuál el modelo y
 *      cuáles son precios, con su moneda (`detectarColumnas`);
 *   3. de qué fecha es, por el nombre del archivo (`fechaDelNombre`);
 *   4. qué marcas nombra el archivo, por su nombre y su título
 *      (`marcasEnTexto`). La otra mitad de la detección de marca —cuántas
 *      referencias existen en el catálogo de cada una— la hace la base.
 *
 * Todo lo que decide se muestra y se puede cambiar antes de cargar.
 */

export type Celda = string | number | null

export interface ColumnaDePrecio {
  indice: number
  encabezado: string
  /** La clave con la que queda en `prices` (jsonb): «list_price_usd». */
  clave: string
  moneda: string | null
}

export interface Columnas {
  referencia: number | null
  descripcion: number | null
  modelo: number | null
  precios: ColumnaDePrecio[]
}

export interface Renglon {
  reference: string
  description: string | null
  anchor: number | null
  prices: Record<string, number | string>
}

// ── Texto ────────────────────────────────────────────────────────────────────

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function texto(c: Celda): string {
  return c === null ? '' : String(c).trim()
}

// ── Números ──────────────────────────────────────────────────────────────────

/**
 * Un precio escrito de cualquier manera: «1.234,56», «1,234.56», «€ 12,5»,
 * «USD 1 250.00», «$1250». Lo que no es un número da null.
 */
export function aNumero(c: Celda): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (c === null) return null
  let s = c.replace(/[^\d.,-]/g, '')
  if (s === '' || s === '-' || !/\d/.test(s)) return null
  const coma = s.lastIndexOf(',')
  const punto = s.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) {
    // El último separador es el decimal; el otro, de miles.
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (coma >= 0) {
    // Sólo comas: decimal si son 1 o 2 dígitos al final («12,5», «12,50»);
    // si no, separador de miles («1,250»).
    s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (punto >= 0 && s.split('.').length > 2) {
    // «1.250.000»: varios puntos son miles.
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ── Moneda ───────────────────────────────────────────────────────────────────

export function monedaDe(s: string): string | null {
  const t = ` ${s.toUpperCase()} `
  if (/USD|U\$S|US\$|DOLAR|DÓLAR|DOLLAR/.test(t)) return 'USD'
  if (/EUR|€|EURO/.test(t)) return 'EUR'
  if (/\bARS\b|PESO/.test(t)) return 'ARS'
  if (/\bGBP\b|£/.test(t)) return 'GBP'
  return null
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Un CSV con el separador que traiga: `;` (Excel en castellano), `,` o
 * tabulador. Se elige el que más aparece en las primeras líneas, fuera de
 * comillas. Comillas con `""` escapado, CRLF o LF, BOM.
 */
export function leerCsv(contenido: string): Celda[][] {
  const limpio = contenido.charCodeAt(0) === 0xfeff ? contenido.slice(1) : contenido
  const muestra = limpio.split(/\r?\n/).slice(0, 10).join('\n').replace(/"[^"]*"/g, '')
  const contar = (sep: string) => muestra.split(sep).length - 1
  const sep = [';', ',', '\t'].reduce((a, b) => (contar(b) > contar(a) ? b : a), ';')

  const filas: Celda[][] = []
  let campo = ''
  let fila: Celda[] = []
  let enComillas = false
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (enComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"'
          i++
        } else enComillas = false
      } else campo += c
    } else if (c === '"') enComillas = true
    else if (c === sep) {
      fila.push(campo)
      campo = ''
    } else if (c === '\n') {
      fila.push(campo)
      campo = ''
      filas.push(fila)
      fila = []
    } else if (c !== '\r') campo += c
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }
  return filas.filter((f) => f.some((x) => texto(x) !== ''))
}

// ── Encabezados y columnas ───────────────────────────────────────────────────

const PALABRAS_REFERENCIA = [
  'referencia', 'ref', 'codigo', 'cod', 'code', 'part', 'p/n', 'pn', 'part number', 'part no',
  'article', 'articulo', 'art', 'item', 'sku', 'material', 'order no', 'catalog', 'numero',
]
const PALABRAS_DESCRIPCION = ['descripcion', 'description', 'desc', 'designation', 'denominacion', 'nombre', 'producto', 'product name', 'detalle']
const PALABRAS_MODELO = ['modelo', 'model', 'tipo', 'type']
const PALABRAS_PRECIO = ['precio', 'price', 'pvp', 'lista', 'list', 'neto', 'net', 'costo', 'cost', 'importe', 'valor', 'tarifa', 'usd', 'eur', '€', 'u$s', '$']

function contienePalabra(t: string, palabras: readonly string[]): boolean {
  const n = normalizar(t)
  return palabras.some((p) => {
    const q = normalizar(p)
    if (/^[a-z0-9 ]+$/.test(q)) return new RegExp(`(^|[^a-z0-9])${q}([^a-z0-9]|$)`).test(n)
    return n.includes(q)
  })
}

/**
 * El renglón de encabezados: entre los primeros 30, el que más celdas tiene
 * que suenan a «referencia», «descripción» o «precio». Los proveedores ponen
 * logo y título arriba; no se puede suponer que es el primero.
 */
export function detectarEncabezado(filas: readonly Celda[][]): number {
  let mejor = 0
  let puntaje = -1
  filas.slice(0, 30).forEach((f, i) => {
    // Distintos: un título combinado en todas las columnas llega repetido en
    // cada celda y, contado varias veces, parecería un renglón de encabezados.
    const textos = [...new Set(f.map(texto).filter((t) => t !== '' && aNumero(t) === null))]
    // Un encabezado es corto; un título largo no lo es aunque diga «precio».
    if (textos.length < 2 && textos.every((t) => t.length > 30)) return
    const p =
      textos.filter((t) => contienePalabra(t, PALABRAS_REFERENCIA)).length * 3 +
      textos.filter((t) => contienePalabra(t, PALABRAS_DESCRIPCION)).length * 2 +
      textos.filter((t) => contienePalabra(t, PALABRAS_PRECIO)).length * 2 +
      Math.min(textos.length, 6) * 0.1
    if (p > puntaje) {
      puntaje = p
      mejor = i
    }
  })
  return mejor
}

/** «List Price 2024 (USD)» → «list_price_2024_usd». */
export function claveDePrecio(encabezado: string): string {
  const base = normalizar(encabezado)
    .replace(/€/g, ' eur ')
    .replace(/u\$s|us\$/g, ' usd ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base === '' ? 'precio' : base
}

/**
 * Qué es cada columna. Una columna es de precio si su encabezado lo dice o si
 * casi todos sus valores son números (y no es la referencia: hay referencias
 * que son números largos, como las de Chicago Pneumatic).
 */
export function detectarColumnas(encabezados: readonly Celda[], datos: readonly Celda[][], monedaDelArchivo: string | null): Columnas {
  const nombres = encabezados.map(texto)
  const muestra = datos.slice(0, 200)
  const ancho = Math.max(nombres.length, ...muestra.map((f) => f.length))

  const proporcionNumerica = (i: number) => {
    const vals = muestra.map((f) => f[i] ?? null).filter((v) => texto(v) !== '')
    if (vals.length === 0) return 0
    return vals.filter((v) => aNumero(v) !== null).length / vals.length
  }
  const largoPromedio = (i: number) => {
    const vals = muestra.map((f) => texto(f[i] ?? null)).filter((v) => v !== '')
    return vals.length ? vals.reduce((a, v) => a + v.length, 0) / vals.length : 0
  }
  const decimales = (i: number) =>
    muestra.some((f) => {
      const v = f[i] ?? null
      const n = aNumero(v)
      return n !== null && (!Number.isInteger(n) || /[.,]\d{1,2}$/.test(texto(v)))
    })

  const indices = Array.from({ length: ancho }, (_, i) => i)
  const primera = (pred: (i: number) => boolean, excluir: (number | null)[] = []) =>
    indices.find((i) => !excluir.includes(i) && pred(i)) ?? null

  const referencia =
    primera((i) => contienePalabra(nombres[i] ?? '', PALABRAS_REFERENCIA) && !contienePalabra(nombres[i] ?? '', PALABRAS_PRECIO)) ??
    primera((i) => proporcionNumerica(i) < 1 && largoPromedio(i) > 0 && largoPromedio(i) < 25)
  // Una descripción es TEXTO. «Peso del producto (kg)» dice «producto» y es
  // un número: tomarla mostraba 0,43 como descripción (lista de TECNA).
  const esTexto = (i: number) => proporcionNumerica(i) < 0.5
  // Links, observaciones y notas son texto largo pero no describen el producto.
  const noDescribe = (i: number) =>
    /(link|url|web|observ|nota|coment|manual|origen|fuente|pack|dimension|peso|weight|marca|brand)/.test(normalizar(nombres[i] ?? '')) ||
    muestra.some((f) => /^https?:\/\//i.test(texto(f[i] ?? null))) ||
    // El mismo valor en todos los renglones («TECNA») no describe a ninguno.
    (muestra.length > 1 && new Set(muestra.map((f) => texto(f[i] ?? null))).size === 1)
  const descripcion =
    primera((i) => contienePalabra(nombres[i] ?? '', PALABRAS_DESCRIPCION) && esTexto(i) && !noDescribe(i), [referencia]) ??
    // Si no hay encabezado que la nombre, la columna de texto más larga.
    indices
      .filter((i) => i !== referencia && esTexto(i) && !noDescribe(i) && !contienePalabra(nombres[i] ?? '', PALABRAS_MODELO))
      .sort((a, b) => largoPromedio(b) - largoPromedio(a))[0] ??
    null
  const modelo = primera((i) => contienePalabra(nombres[i] ?? '', PALABRAS_MODELO), [referencia, descripcion])

  const precios: ColumnaDePrecio[] = []
  const usadas = new Set<string>()
  for (const i of indices) {
    if (i === referencia || i === descripcion || i === modelo) continue
    const nombre = nombres[i] ?? ''
    const diceSerPrecio = contienePalabra(nombre, PALABRAS_PRECIO)
    const numerica = proporcionNumerica(i) >= 0.8
    // Cantidades, porcentajes, años o pesos no son precios aunque sean números.
    const noEsPrecio = /cant|qty|quantity|%|desc|discount|peso|weight|kg|stock|año|year|pag|page|unid|pack|moq|ean|hs code|ncm/i.test(normalizar(nombre))
    if (!numerica || noEsPrecio) continue
    if (!diceSerPrecio && !decimales(i)) continue
    let clave = claveDePrecio(nombre || `precio_${i + 1}`)
    while (usadas.has(clave)) clave = `${clave}_2`
    usadas.add(clave)
    precios.push({ indice: i, encabezado: nombre || `Columna ${i + 1}`, clave, moneda: monedaDe(nombre) ?? monedaDelArchivo })
  }
  return { referencia, descripcion, modelo, precios }
}

export type RolDePrecio = 'costo' | 'venta'

/** ¿Qué dice ser la columna? «Costo Argentina» → costo; «PVP Buscatools» → venta. */
export function rolDe(encabezado: string): RolDePrecio | null {
  const n = normalizar(encabezado)
  if (/(cost|neto|net\b|net |compra|purchase|dealer|distribuidor|importe de factura)/.test(n)) return 'costo'
  if (/(pvp|venta|retail|msrp|lista|list|publico|sale|tarifa)/.test(n)) return 'venta'
  return null
}

/**
 * La columna de costo y la de venta. Entre varias candidatas gana la que
 * nombra a Argentina o a la empresa (una lista de TECNA trae el PVP de España
 * y el nuestro), y si no, la primera. Una referencia («— ref.») no gana.
 */
export function elegirRoles(
  precios: readonly ColumnaDePrecio[],
  preferidas: readonly string[] = [],
): { costo: ColumnaDePrecio | null; venta: ColumnaDePrecio | null } {
  const claves = ['argentina', 'arg', ...preferidas.map(normalizar)].filter((p) => p !== '')
  const puntaje = (c: ColumnaDePrecio) => {
    const n = normalizar(c.encabezado)
    let p = 0
    if (claves.some((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(n))) p += 2
    if (/\bref\b|referencia|\d{4}/.test(n)) p -= 1
    return p
  }
  const mejor = (rol: RolDePrecio) =>
    [...precios].filter((c) => rolDe(c.encabezado) === rol).sort((a, b) => puntaje(b) - puntaje(a) || a.indice - b.indice)[0] ?? null
  return { costo: mejor('costo'), venta: mejor('venta') }
}

/**
 * La columna de precio principal (la «ancla»: la que compara contra la lista
 * anterior). Preferencia: la que dice lista/PVP/precio de lista; si no, la
 * primera de precio.
 */
export function elegirAncla(precios: readonly ColumnaDePrecio[]): ColumnaDePrecio | null {
  const puntaje = (c: ColumnaDePrecio) => {
    const n = normalizar(c.encabezado)
    if (/(list|lista|pvp|tarifa|retail)/.test(n)) return 3
    if (/(precio|price)/.test(n) && !/(net|neto|cost|costo)/.test(n)) return 2
    if (/(net|neto|cost|costo)/.test(n)) return 0
    return 1
  }
  return [...precios].sort((a, b) => puntaje(b) - puntaje(a) || a.indice - b.indice)[0] ?? null
}

// ── Renglones ────────────────────────────────────────────────────────────────

export interface ResultadoRenglones {
  renglones: Renglon[]
  /** Renglones con una referencia que ya había aparecido (se queda la primera). */
  repetidas: number
  /** Renglones sin referencia o sin ningún precio. */
  descartados: number
}

export function armarRenglones(datos: readonly Celda[][], cols: Columnas, ancla: ColumnaDePrecio | null): ResultadoRenglones {
  const vistas = new Set<string>()
  const renglones: Renglon[] = []
  let repetidas = 0
  let descartados = 0
  for (const f of datos) {
    const ref = cols.referencia === null ? '' : texto(f[cols.referencia] ?? null)
    const prices: Record<string, number | string> = {}
    for (const p of cols.precios) {
      const n = aNumero(f[p.indice] ?? null)
      if (n !== null) prices[p.clave] = n
    }
    if (ref === '' || Object.keys(prices).length === 0) {
      descartados++
      continue
    }
    const clave = ref.toUpperCase()
    if (vistas.has(clave)) {
      repetidas++
      continue
    }
    vistas.add(clave)
    const modelo = cols.modelo === null ? '' : texto(f[cols.modelo] ?? null)
    if (modelo !== '') prices['modelo'] = modelo
    const desc = cols.descripcion === null ? '' : texto(f[cols.descripcion] ?? null)
    renglones.push({
      reference: ref,
      description: desc === '' ? null : desc,
      anchor: ancla ? (aNumero(f[ancla.indice] ?? null) ?? null) : null,
      prices,
    })
  }
  return { renglones, repetidas, descartados }
}

// ── Fecha y marca ────────────────────────────────────────────────────────────

/**
 * La fecha de la lista por el nombre del archivo: «2025 12 18 - …»,
 * «Price_List_2024_01_USD», «Lista 2026.xlsx» (→ 1 de enero), «15-03-2026».
 * Sin nada reconocible, hoy.
 */
export function fechaDelNombre(nombre: string, hoy: Date): string {
  const iso = (a: number, m: number, d: number) =>
    `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const valida = (a: number, m: number, d: number) => a >= 2000 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
  let r = nombre.match(/(20\d{2})[ _.\-/]?(\d{1,2})[ _.\-/]?(\d{1,2})(?!\d)/)
  if (r && valida(+r[1]!, +r[2]!, +r[3]!)) return iso(+r[1]!, +r[2]!, +r[3]!)
  r = nombre.match(/(?<!\d)(\d{1,2})[ _.\-/](\d{1,2})[ _.\-/](20\d{2})/)
  if (r && valida(+r[3]!, +r[2]!, +r[1]!)) return iso(+r[3]!, +r[2]!, +r[1]!)
  r = nombre.match(/(20\d{2})[ _.\-/](\d{1,2})(?!\d)/)
  if (r && valida(+r[1]!, +r[2]!, 1)) return iso(+r[1]!, +r[2]!, 1)
  r = nombre.match(/(?<!\d)(20\d{2})(?!\d)/)
  if (r) return iso(+r[1]!, 1, 1)
  return iso(hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate())
}

/**
 * Las marcas que nombra un texto (el nombre del archivo y los renglones de
 * título). Se compara normalizado y por palabra entera: «CP» no tiene que
 * encontrarse dentro de «PCP».
 */
export function marcasEnTexto<M extends { id: string; nombre: string }>(t: string, marcas: readonly M[]): M[] {
  const n = ` ${normalizar(t).replace(/[_\-.]+/g, ' ')} `
  return marcas.filter((m) => {
    const q = normalizar(m.nombre)
    if (q.length < 3) return false
    return n.includes(` ${q} `) || (q.length >= 6 && n.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')))
  })
}

export interface CandidataMarca {
  id: string
  nombre: string
  coincidencias: number
  enElTexto: boolean
}

/**
 * La marca más probable. Nombrarla en el archivo pesa como 50 referencias
 * encontradas: el nombre del archivo casi nunca miente, pero una lista con
 * cientos de referencias en el catálogo de una marca es todavía más clara.
 */
export function elegirMarca(candidatas: readonly CandidataMarca[]): CandidataMarca | null {
  const puntaje = (c: CandidataMarca) => c.coincidencias + (c.enElTexto ? 50 : 0)
  const mejor = [...candidatas].sort((a, b) => puntaje(b) - puntaje(a))[0]
  return mejor && puntaje(mejor) > 0 ? mejor : null
}
