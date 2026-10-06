import { supabase } from '@/services/supabase/client'
import { atributosParaGuardar } from '../lib/nuevoProducto'
import type { LinkDeCompra } from '../types'

/**
 * Editar un producto desde su ficha (Fase 40).
 *
 * Hasta ahora un producto sólo se podía crear: una vez cargado, corregirle el
 * modelo o completarle un atributo exigía entrar a la base. Ahora se edita
 * donde se lo mira.
 *
 * Tres cosas se guardan juntas y en este orden:
 *
 *  1. las columnas de `products`,
 *  2. la observación privada,
 *  3. los links de compra.
 *
 * No es una transacción y no puede serlo desde el navegador: son tres tablas
 * distintas. El orden importa porque lo primero es lo que el cliente ve —el
 * nombre, los atributos— y lo demás es interno: si algo falla a mitad de
 * camino, lo que queda guardado es lo que más se nota, y la pantalla avisa.
 */

/** Lo editable de un producto, tal como lo maneja el formulario. */
export interface EdicionProducto {
  nombre: string
  descripcion: string
  descripcionLarga: string
  modelo: string
  marcaId: string
  categoriaId: string
  tipo: string
  serie: string
  origen: string
  ncm: string
  /** En gramos, como la columna. Vacío es «sin dato», no cero. */
  pesoG: string
  volumenCm3: string
  /**
   * TODOS los atributos del producto, por clave y como texto.
   *
   * Arranca con los que el producto ya tenía —incluidos los que su categoría
   * actual no define, que existen de la migración— y la pantalla muestra
   * inputs sólo para los de la categoría. Los otros viajan igual: dejar de
   * mandarlos los borraría en silencio, que es la peor forma de perder un
   * dato.
   */
  atributos: Record<string, string>
  /** El código de barras vive DENTRO de los atributos, como en el alta. */
  codigoBarras: string
  notasPrivadas: string
  links: { label: string; url: string; notas: string }[]
}

const vacioANulo = (s: string) => {
  const t = s.trim()
  return t === '' ? null : t
}

const enteroONulo = (s: string) => {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n) : null
}

export async function guardarProducto(
  companyId: string,
  productoId: string,
  e: EdicionProducto,
): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({
      name: e.nombre.trim(),
      description: vacioANulo(e.descripcion),
      description_long: vacioANulo(e.descripcionLarga),
      model_code: vacioANulo(e.modelo),
      brand_id: e.marcaId === '' ? null : e.marcaId,
      category_id: e.categoriaId,
      product_type: vacioANulo(e.tipo),
      series: vacioANulo(e.serie),
      origin_country: vacioANulo(e.origen),
      ncm_code: vacioANulo(e.ncm),
      weight_g: enteroONulo(e.pesoG),
      volume_cm3: enteroONulo(e.volumenCm3),
      /* `status` NO se toca acá, y es a propósito: la ficha no lo muestra, así
         que escribirlo significaría mandar siempre el mismo valor y reactivar
         en silencio un producto discontinuado cada vez que alguien le corrige
         una medida. Lo que no se ve, no se escribe. */
      /* La MISMA función que el alta: un atributo vacío se borra del jsonb, y
         lo que parece un número se guarda como número. No es cosmético: los
         filtros por rango del catálogo comparan números, y «8» guardado como
         texto no entra en «de 5 a 10». */
      attributes: atributosParaGuardar(e.atributos, e.codigoBarras),
    })
    .eq('company_id', companyId)
    .eq('id', productoId)
  if (error) throw new Error(`No se pudo guardar el producto: ${error.message}`)

  await guardarNotaPrivada(companyId, productoId, e.notasPrivadas)
  await guardarLinksDeCompra(companyId, productoId, e.links)
}

/**
 * La observación privada.
 *
 * Una fila por producto, así que es un upsert. Vacía se BORRA en vez de
 * guardarse como cadena vacía: una nota en blanco y la ausencia de nota son lo
 * mismo, y dejar la fila haría que la ficha mostrara un bloque vacío.
 */
export async function guardarNotaPrivada(
  companyId: string,
  productoId: string,
  notas: string,
): Promise<void> {
  const limpio = notas.trim()
  if (limpio === '') {
    const { error } = await supabase
      .from('product_private_notes')
      .delete()
      .eq('company_id', companyId)
      .eq('product_id', productoId)
    if (error) throw new Error(`No se pudo borrar la observación: ${error.message}`)
    return
  }

  const { error } = await supabase
    .from('product_private_notes')
    .upsert(
      { product_id: productoId, company_id: companyId, notes: limpio, updated_at: new Date().toISOString() },
      { onConflict: 'product_id' },
    )
  if (error) throw new Error(`No se pudo guardar la observación: ${error.message}`)
}

/**
 * Los links de compra: se reemplazan enteros.
 *
 * Borrar y volver a insertar, y no un diff fila por fila. Son dos o tres
 * links, el orden importa y reconstruirlo con altas, bajas y cambios de
 * posición sería mucho más código para el mismo resultado. Los ids cambian en
 * cada guardado, y no los usa nadie más que esta pantalla.
 */
export async function guardarLinksDeCompra(
  companyId: string,
  productoId: string,
  links: readonly { label: string; url: string; notas: string }[],
): Promise<void> {
  const utiles = links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim(), notas: l.notas.trim() }))
    // Sin URL no hay link. Sin etiqueta sí: se le pone el dominio al mostrarlo.
    .filter((l) => l.url !== '')

  const { error: eBorrar } = await supabase
    .from('product_purchase_links')
    .delete()
    .eq('company_id', companyId)
    .eq('product_id', productoId)
  if (eBorrar) throw new Error(`No se pudieron guardar los links: ${eBorrar.message}`)

  if (utiles.length === 0) return

  const { error } = await supabase.from('product_purchase_links').insert(
    utiles.map((l, i) => ({
      company_id: companyId,
      product_id: productoId,
      label: l.label === '' ? dominioDe(l.url) : l.label,
      url: l.url,
      notes: l.notas === '' ? null : l.notas,
      position: i + 1,
    })),
  )
  if (error) throw new Error(`No se pudieron guardar los links: ${error.message}`)
}

/** `https://www.acme.com/x?y=1` → `acme.com`. Para etiquetar un link sin nombre. */
export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Para mostrar: los links tal como los devuelve la consulta del detalle. */
export type { LinkDeCompra }
