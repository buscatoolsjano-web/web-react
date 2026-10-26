import type { QueMostrar } from './impresion'

/**
 * Plantillas de impresión que los admins arman (Fase 152). PURO.
 *
 * Una plantilla es un `config`: qué columnas de producto se muestran y en qué
 * orden, qué bloques de la hoja aparecen y qué textos propios lleva. Se aplica a
 * la MISMA `VistaImpresion` que los formatos fijos —no hay una segunda maqueta
 * que pueda divergir—: la plantilla sólo decide qué se ve y qué dice.
 *
 * El config vive en jsonb y puede llegar incompleto (una plantilla vieja, un
 * campo nuevo). Por eso todo se lee con `normalizarConfig`, que completa lo que
 * falte con el valor por defecto: una plantilla nunca rompe la hoja.
 */

/** Las columnas de producto que una plantilla puede mostrar u ocultar y ordenar.
 *  Referencia, Nombre y Unidades son FIJAS: sin ellas la línea no se entiende. */
export type ClaveColumna = 'foto' | 'descripcion' | 'precio' | 'descuento' | 'impuesto' | 'subtotal'

export const COLUMNAS: { clave: ClaveColumna; etiqueta: string }[] = [
  { clave: 'foto', etiqueta: 'Foto' },
  { clave: 'descripcion', etiqueta: 'Descripción' },
  { clave: 'precio', etiqueta: 'Precio y subtotal' },
  { clave: 'descuento', etiqueta: 'Descuento' },
  { clave: 'impuesto', etiqueta: 'Impuesto' },
  { clave: 'subtotal', etiqueta: 'Subtotal' },
]

export type ClaveBloque = 'empresa' | 'cliente' | 'datos' | 'totales' | 'firmas' | 'notas'

export const BLOQUES: { clave: ClaveBloque; etiqueta: string }[] = [
  { clave: 'empresa', etiqueta: 'Datos de la empresa' },
  { clave: 'cliente', etiqueta: 'Datos del cliente' },
  { clave: 'datos', etiqueta: 'Datos del documento' },
  { clave: 'totales', etiqueta: 'Totales' },
  { clave: 'firmas', etiqueta: 'Firmas (preparó / recibió)' },
  { clave: 'notas', etiqueta: 'Notas entre líneas' },
]

export interface ConfigPlantilla {
  /** Reemplaza el título de la hoja; `null` deja el del tipo de documento. */
  titulo: string | null
  /** Qué columnas se muestran. */
  columnas: Record<ClaveColumna, boolean>
  /** El orden de las columnas opcionales (las fijas van siempre primero). */
  orden: ClaveColumna[]
  /** Qué bloques de la hoja aparecen. */
  bloques: Record<ClaveBloque, boolean>
  /** Texto libre arriba de los productos. */
  encabezado: string | null
  /** Texto libre al pie. */
  pie: string | null
}

/** El orden natural de las columnas opcionales, y el que se usa si no hay otro. */
const ORDEN_NATURAL: ClaveColumna[] = ['foto', 'descripcion', 'precio', 'descuento', 'impuesto', 'subtotal']

/** Una plantilla nueva arranca como el documento «valorado» completo. */
export const CONFIG_POR_DEFECTO: ConfigPlantilla = {
  titulo: null,
  columnas: { foto: true, descripcion: true, precio: true, descuento: true, impuesto: true, subtotal: true },
  orden: ORDEN_NATURAL,
  bloques: { empresa: true, cliente: true, datos: true, totales: true, firmas: false, notas: true },
  encabezado: null,
  pie: null,
}

function comoBool(v: unknown, porDefecto: boolean): boolean {
  return typeof v === 'boolean' ? v : porDefecto
}

function comoTextoONulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Completa un config que viene de la base con los valores por defecto. */
export function normalizarConfig(raw: unknown): ConfigPlantilla {
  const o = (raw ?? {}) as Record<string, unknown>
  const col = (o['columnas'] ?? {}) as Record<string, unknown>
  const blo = (o['bloques'] ?? {}) as Record<string, unknown>
  const ordenCrudo = Array.isArray(o['orden']) ? (o['orden'] as unknown[]).filter((x): x is ClaveColumna => ORDEN_NATURAL.includes(x as ClaveColumna)) : []
  // El orden guardado, más las columnas que falten al final (robustez ante una
  // columna nueva que una plantilla vieja no conoce).
  const orden = [...ordenCrudo, ...ORDEN_NATURAL.filter((c) => !ordenCrudo.includes(c))]
  return {
    titulo: comoTextoONulo(o['titulo']),
    columnas: {
      foto: comoBool(col['foto'], CONFIG_POR_DEFECTO.columnas.foto),
      descripcion: comoBool(col['descripcion'], CONFIG_POR_DEFECTO.columnas.descripcion),
      precio: comoBool(col['precio'], CONFIG_POR_DEFECTO.columnas.precio),
      descuento: comoBool(col['descuento'], CONFIG_POR_DEFECTO.columnas.descuento),
      impuesto: comoBool(col['impuesto'], CONFIG_POR_DEFECTO.columnas.impuesto),
      subtotal: comoBool(col['subtotal'], CONFIG_POR_DEFECTO.columnas.subtotal),
    },
    orden,
    bloques: {
      empresa: comoBool(blo['empresa'], CONFIG_POR_DEFECTO.bloques.empresa),
      cliente: comoBool(blo['cliente'], CONFIG_POR_DEFECTO.bloques.cliente),
      datos: comoBool(blo['datos'], CONFIG_POR_DEFECTO.bloques.datos),
      totales: comoBool(blo['totales'], CONFIG_POR_DEFECTO.bloques.totales),
      firmas: comoBool(blo['firmas'], CONFIG_POR_DEFECTO.bloques.firmas),
      notas: comoBool(blo['notas'], CONFIG_POR_DEFECTO.bloques.notas),
    },
    encabezado: comoTextoONulo(o['encabezado']),
    pie: comoTextoONulo(o['pie']),
  }
}

/**
 * Lo que una plantilla le dice a la hoja, en la misma forma que `queMostrar`.
 *
 * Así `VistaImpresion` no necesita saber si lo que la gobierna es un formato fijo
 * o una plantilla: las dos le llegan como un `QueMostrar`. Una plantilla nunca es
 * ticket ni pro-forma ni packing —esos son los formatos de fábrica—.
 */
export function verDePlantilla(c: ConfigPlantilla): QueMostrar {
  return {
    precios: c.columnas.precio,
    impuestos: c.columnas.impuesto,
    totales: c.bloques.totales,
    ticket: false,
    proForma: false,
    packing: 'no',
  }
}
