/**
 * Qué atributos comparan a un producto con otro, según su familia.
 *
 * Fase 22 · Etapa B. Es la ÚNICA definición: la usan el comparador del hover y
 * los relacionados del modal. Tener dos listas era la forma segura de que el
 * hover y el modal dijeran cosas distintas del mismo par de productos.
 *
 * La auditoría de la Etapa A midió qué tiene cargado cada familia, y esto sale
 * de ahí, no de una lista deseable:
 *
 *   · Puntas y tubos (8.623) — encastre 8.281, largo 7.763, medida 4.367
 *   · Balanceadores (376)    — min_kg, max_kg, longitud, carcasa al 100 %
 *   · Atornilladores (129)   — torq_min, torq_max, ergonomía al 100 %
 *   · Otros (12.588)         — **ninguno**: no hay con qué comparar
 *
 * Por eso `otros` no está en este mapa. Un comparador que muestre seis
 * columnas vacías para 12.588 productos no informa: simula que informa.
 */

/** El `slug` de `product_categories`, que es lo estable. */
export type FamiliaCatalogo =
  | 'punta'
  | 'balanceador'
  | 'atornillador'
  | 'accesorio'
  | 'llave-de-impacto'
  | 'remachadora'
  | 'llave-dinamometrica'

/**
 * Una columna del comparador.
 *
 * `origen` dice de dónde sale el valor: una columna propia de `products` o una
 * clave de su `attributes`. Sin esto habría que adivinar, y «modelo» existe en
 * los dos lados con significados distintos.
 */
export interface ColumnaComparable {
  clave: string
  /** Etiqueta por defecto; la de `product_attribute_definitions` gana si existe. */
  etiqueta: string
  origen: 'columna' | 'atributo'
  /** La columna identifica la fila y no se pinta verde/rojo. */
  identidad?: boolean
  /** Unidad para normalizar antes de comparar (B9). */
  magnitud?: 'longitud' | 'masa' | 'torque' | 'velocidad'
  unidad?: string
}

const MARCA: ColumnaComparable = { clave: 'marca', etiqueta: 'Marca', origen: 'columna' }
/**
 * El modelo identifica la fila, no se compara.
 *
 * Dos productos distintos SIEMPRE tienen modelo distinto, así que pintarlo de
 * rojo es una tautología: ocupa el lugar de un dato sin decir nada, y encima
 * compite con las celdas que sí señalan una diferencia real. La marca no:
 * «mismo modelo de otra marca» es exactamente lo que uno busca.
 */
const MODELO: ColumnaComparable = {
  clave: 'sku',
  etiqueta: 'Modelo',
  origen: 'columna',
  identidad: true,
}

/**
 * Las columnas que se comparan, por familia y en el orden en que se leen.
 *
 * Marca y modelo van primero en todas: identifican la fila. Después, lo que
 * distingue técnicamente a esa familia y nada más — un balanceador no tiene
 * encastre y una punta no tiene capacidad de carga.
 */
export const ATRIBUTOS_POR_FAMILIA: Record<FamiliaCatalogo, ColumnaComparable[]> = {
  punta: [
    MARCA,
    MODELO,
    { clave: 'tipo', etiqueta: 'Tipo', origen: 'columna' },
    { clave: 'medida', etiqueta: 'Medida', origen: 'atributo' },
    { clave: 'encastre', etiqueta: 'Encastre', origen: 'atributo' },
    { clave: 'largo', etiqueta: 'Largo', origen: 'atributo', magnitud: 'longitud', unidad: 'mm' },
    { clave: 'serie', etiqueta: 'Serie', origen: 'columna' },
  ],
  balanceador: [
    MARCA,
    MODELO,
    { clave: 'min_kg', etiqueta: 'Capacidad mínima', origen: 'atributo', magnitud: 'masa', unidad: 'kg' },
    { clave: 'max_kg', etiqueta: 'Capacidad máxima', origen: 'atributo', magnitud: 'masa', unidad: 'kg' },
    { clave: 'longitud', etiqueta: 'Recorrido', origen: 'atributo', magnitud: 'longitud', unidad: 'm' },
    { clave: 'carcasa', etiqueta: 'Carcasa', origen: 'atributo' },
  ],
  atornillador: [
    MARCA,
    MODELO,
    { clave: 'torq_min', etiqueta: 'Torque mínimo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'torq_max', etiqueta: 'Torque máximo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'rpm', etiqueta: 'Revoluciones', origen: 'atributo', magnitud: 'velocidad', unidad: 'rpm' },
    { clave: 'alimentacion', etiqueta: 'Alimentación', origen: 'atributo' },
    { clave: 'ergonomia', etiqueta: 'Ergonomía', origen: 'atributo' },
    { clave: 'encastre', etiqueta: 'Encastre', origen: 'atributo' },
  ],
  accesorio: [
    MARCA,
    MODELO,
    { clave: 'tipo', etiqueta: 'Tipo', origen: 'columna' },
    { clave: 'torq_min', etiqueta: 'Torque mínimo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'torq_max', etiqueta: 'Torque máximo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'ergonomia', etiqueta: 'Ergonomía', origen: 'atributo' },
  ],
  'llave-de-impacto': [
    MARCA,
    MODELO,
    { clave: 'encastre', etiqueta: 'Encastre', origen: 'atributo' },
    { clave: 'torq_min', etiqueta: 'Torque mínimo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'torq_max', etiqueta: 'Torque máximo', origen: 'atributo', magnitud: 'torque', unidad: 'Nm' },
    { clave: 'rpm', etiqueta: 'Revoluciones', origen: 'atributo', magnitud: 'velocidad', unidad: 'rpm' },
    { clave: 'voltaje', etiqueta: 'Voltaje', origen: 'atributo' },
  ],
  remachadora: [
    MARCA,
    MODELO,
    { clave: 'encastre', etiqueta: 'Encastre', origen: 'atributo' },
    { clave: 'rpm', etiqueta: 'Revoluciones', origen: 'atributo', magnitud: 'velocidad', unidad: 'rpm' },
    { clave: 'voltaje', etiqueta: 'Voltaje', origen: 'atributo' },
    { clave: 'peso_kg', etiqueta: 'Peso', origen: 'atributo', magnitud: 'masa', unidad: 'kg' },
  ],
  'llave-dinamometrica': [
    MARCA,
    MODELO,
    { clave: 'medida', etiqueta: 'Medida', origen: 'atributo' },
    { clave: 'encastre', etiqueta: 'Encastre', origen: 'atributo' },
    { clave: 'largo', etiqueta: 'Largo', origen: 'atributo', magnitud: 'longitud', unidad: 'mm' },
  ],
}

/** `null` cuando la familia no tiene con qué comparar (o no la conocemos). */
export function familiaDe(slug: string | null | undefined): FamiliaCatalogo | null {
  if (!slug) return null
  return slug in ATRIBUTOS_POR_FAMILIA ? (slug as FamiliaCatalogo) : null
}

/** Las columnas del comparador para esa familia; vacío si no es comparable. */
export function columnasDe(slug: string | null | undefined): ColumnaComparable[] {
  const f = familiaDe(slug)
  return f ? ATRIBUTOS_POR_FAMILIA[f] : []
}

/**
 * Las columnas cuando el usuario elige los productos a mano (Fase 22 ·
 * paridad, #42).
 *
 * El legacy NO impide comparar productos de familias distintas: arma filas
 * fijas —marca, modelo, categoría, tipo, medida, encastre, largo, precio,
 * stock— y les suma todas las claves que tenga cualquiera de los elegidos
 * (`openCatCompare`, `ALWAYS_SKIP` y `dynKeys` en app.js:17086). Es decir,
 * **permite comparación parcial**. Esto replica eso.
 *
 * Si todos son de la misma familia, devuelve exactamente lo de siempre: el
 * comparador automático y el manual no pueden decir cosas distintas del mismo
 * par de productos. Si hay mezcla, devuelve la unión, con una base que existe
 * para cualquier producto —incluidos los 12.588 de «otros», que no tienen
 * familia comparable y en el comparador automático no se dibujan—.
 */
export const COLUMNAS_BASE: ColumnaComparable[] = [
  MARCA,
  MODELO,
  { clave: 'categoria', etiqueta: 'Categoría', origen: 'columna' },
  { clave: 'tipo', etiqueta: 'Tipo', origen: 'columna' },
]

export function columnasDeVarias(slugs: readonly (string | null | undefined)[]): ColumnaComparable[] {
  const familias = [...new Set(slugs.map(familiaDe))]
  // Una sola familia conocida: el mismo comparador de siempre.
  const unica = familias.length === 1 ? familias[0] : null
  if (unica) return ATRIBUTOS_POR_FAMILIA[unica]

  const union: ColumnaComparable[] = [...COLUMNAS_BASE]
  const vistas = new Set(union.map((c) => c.clave))
  for (const f of familias) {
    if (f === null) continue
    for (const col of ATRIBUTOS_POR_FAMILIA[f]) {
      if (vistas.has(col.clave)) continue
      vistas.add(col.clave)
      union.push(col)
    }
  }
  return union
}
