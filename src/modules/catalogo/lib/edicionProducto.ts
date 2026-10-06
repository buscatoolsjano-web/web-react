import type { EdicionProducto } from '../services/edicionProducto'
import type { ProductoDetalle } from '../types'

/**
 * Las reglas de pantalla de la edición de un producto (Fase 40).
 *
 * Puro: no sabe de React ni de la base. Lo que decide es qué se puede guardar
 * y qué se muestra como error.
 */

/**
 * Un valor del jsonb de atributos, como texto para un input.
 *
 * `String(objeto)` da «[object Object]», que el formulario guardaría tal cual:
 * el atributo quedaría con esa basura adentro y nadie sabría de dónde salió.
 */
function aTexto(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null || v === undefined) return ''
  return JSON.stringify(v) ?? ''
}

/** El formulario, armado con lo que el producto tiene hoy. */
export function edicionDesdeProducto(p: ProductoDetalle): EdicionProducto {
  /*
   * Los atributos arrancan con TODOS los que el producto ya tiene, no sólo
   * con los que su categoría define. En el maestro migrado hay productos con
   * atributos que su categoría actual no declara; si el formulario mandara
   * únicamente los declarados, guardar borraría los otros sin avisar.
   */
  const atributos: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.atributos ?? {})) {
    if (k === 'barcode') continue
    atributos[k] = aTexto(v)
  }

  const barras = (p.atributos as Record<string, unknown> | undefined)?.['barcode']

  return {
    nombre: p.nombre,
    descripcion: p.descripcion ?? '',
    descripcionLarga: p.descripcionLarga ?? '',
    modelo: p.modelo ?? '',
    marcaId: p.marca?.id ?? '',
    categoriaId: p.categoria?.id ?? '',
    tipo: p.tipo ?? '',
    serie: p.serie ?? '',
    origen: p.origen ?? '',
    ncm: p.ncm ?? '',
    pesoG: p.pesoG === null ? '' : String(p.pesoG),
    volumenCm3: p.volumenCm3 === null ? '' : String(p.volumenCm3),
    atributos,
    codigoBarras: aTexto(barras),
    notasPrivadas: p.notasPrivadas ?? '',
    links: (p.linksDeCompra ?? []).map((l) => ({
      label: l.label,
      url: l.url,
      notas: l.notas ?? '',
    })),
  }
}

/**
 * Qué está mal, en castellano.
 *
 * El nombre y la categoría son NOT NULL en la base: sin ellos el update falla
 * con un error de Postgres que no le dice nada a nadie. Mejor decirlo acá.
 *
 * La URL se valida contra el mismo patrón que el CHECK de la tabla: sólo
 * `http` y `https`. Un `javascript:` guardado sería un clic a una ejecución,
 * porque lo que entra a la base vuelve a salir a un `href`.
 */
export function validarEdicion(e: EdicionProducto): string[] {
  const errores: string[] = []
  if (e.nombre.trim() === '') errores.push('El nombre no puede quedar vacío.')
  if (e.categoriaId === '') errores.push('Elegí una categoría: la base no acepta un producto sin ella.')

  for (const l of e.links) {
    const url = l.url.trim()
    if (url === '') continue
    if (!/^https?:\/\//i.test(url)) {
      errores.push(`«${url}» no es un link: tiene que empezar con http:// o https://`)
    }
  }
  return errores
}

/** `https://www.acme.com/x?y=1` → `acme.com`. Para etiquetar un link sin nombre. */
export function dominioDeUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Quién puede editar un producto. Lo vuelve a decidir RLS (`products_write`). */
export function puedeEditarProductos(rol: string | undefined): boolean {
  return rol === 'admin' || rol === 'employee'
}
