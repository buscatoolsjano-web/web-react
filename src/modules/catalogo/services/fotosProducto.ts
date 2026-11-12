import { supabase } from '@/services/supabase/client'

/**
 * Las fotos de un producto, editables desde su ficha (Fase 246).
 *
 * «Quiero que se puedan modificar las fotos desde el editor.» Hasta acá una
 * foto se cargaba sólo al dar de alta el producto, o por importación.
 *
 * ── Dónde van ──────────────────────────────────────────────────────────────
 * Al bucket PÚBLICO `catalogo-publico`, bajo `productos/<empresa>/<producto>/`,
 * con su URL pública en `source_url`: es la misma forma que tienen las 14.590
 * fotos que ya se ven en el ERP y en la web, así que una foto nueva aparece en
 * los dos lados sin nada más. La empresa va en la ruta y la policy del bucket
 * sólo deja escribir en la carpeta de una empresa propia.
 *
 * ── El orden ───────────────────────────────────────────────────────────────
 * La primera es la principal: `position` 0..n y `is_primary` sólo en la 0. Es
 * lo que usan la galería, el listado y el catálogo público.
 *
 * ── Borrar ─────────────────────────────────────────────────────────────────
 * Se borra la fila, y el archivo SÓLO si lo subió el editor (está bajo
 * `productos/<esta empresa>/`). Las fotos importadas del catálogo original
 * (`catalogo-publico/speedrill/…`) las comparten Buscatools y Torquetools: el
 * archivo queda, para no dejar sin foto a la otra empresa.
 */
export interface FotoProducto {
  id: string
  url: string
  thumbUrl: string | null
  storagePath: string | null
  posicion: number
  principal: boolean
  /** La subió el editor: se puede borrar también el archivo. */
  propia: boolean
}

const BUCKET = 'catalogo-publico'
/** El límite del bucket. Lo que pase se achica antes de subir. */
const MAX_BYTES = 5 * 1024 * 1024
/** El lado más largo, en píxeles. Más que esto no se ve en ningún lado. */
const MAX_LADO = 2000
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp'])

const carpetaPropia = (companyId: string) => `${BUCKET}/productos/${companyId}/`

export async function listarFotos(companyId: string, productId: string): Promise<FotoProducto[]> {
  const { data, error } = await supabase
    .from('product_images')
    .select('id, source_url, thumb_url, storage_path, kind, position, is_primary, created_at')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .in('kind', ['product_image', 'unknown'])
  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`)
  return (data ?? [])
    .filter((f) => !!f.source_url)
    .sort(
      (a, b) =>
        a.position - b.position ||
        Number(b.is_primary) - Number(a.is_primary) ||
        a.created_at.localeCompare(b.created_at),
    )
    .map((f) => ({
      id: f.id,
      url: f.source_url!,
      thumbUrl: f.thumb_url,
      storagePath: f.storage_path,
      posicion: f.position,
      principal: f.is_primary,
      propia: (f.storage_path ?? '').startsWith(carpetaPropia(companyId)),
    }))
}

/**
 * Deja las fotos en ESTE orden: posición 0..n y la primera como principal.
 *
 * Se escribe sólo lo que cambió. Arregla de paso los productos importados que
 * tienen dos fotos en la posición 0 (una de WordPress y otra del bucket).
 *
 * La nueva principal se marca AL FINAL: hay un índice único
 * (`uq_product_images_primary`, una principal por producto), así que primero
 * se desmarca la anterior. Al revés, choca —se vio al probarlo—.
 */
export async function ordenarFotos(
  companyId: string,
  fotos: readonly FotoProducto[],
): Promise<void> {
  const enOrden = [...fotos.entries()].slice(1).concat([...fotos.entries()].slice(0, 1))
  for (const [i, f] of enOrden) {
    if (f.posicion === i && f.principal === (i === 0)) continue
    const { error } = await supabase
      .from('product_images')
      .update({ position: i, is_primary: i === 0 })
      .eq('company_id', companyId)
      .eq('id', f.id)
    if (error) throw new Error(`No se pudo ordenar las fotos: ${error.message}`)
  }
}

export async function borrarFoto(
  companyId: string,
  foto: FotoProducto,
  restantes: readonly FotoProducto[],
): Promise<void> {
  const { error } = await supabase
    .from('product_images')
    .delete()
    .eq('company_id', companyId)
    .eq('id', foto.id)
  if (error) throw new Error(`No se pudo borrar la foto: ${error.message}`)
  if (foto.propia && foto.storagePath) {
    // Si falla, queda un archivo sin fila: no se ve en ningún lado y no rompe nada.
    const ruta = foto.storagePath.slice(BUCKET.length + 1)
    await supabase.storage.from(BUCKET).remove([ruta, rutaDeMiniatura(ruta)])
  }
  await ordenarFotos(companyId, restantes)
}

/** Un archivo listo para subir: JPEG/PNG/WebP, de hasta 5 MB y 2000 px. */
export async function prepararImagen(archivo: File): Promise<Blob> {
  if (!TIPOS.has(archivo.type) && !archivo.type.startsWith('image/')) {
    throw new Error(`«${archivo.name}» no es una imagen.`)
  }
  const bitmap = await createImageBitmap(archivo).catch(() => null)
  const grande = bitmap !== null && Math.max(bitmap.width, bitmap.height) > MAX_LADO
  if (TIPOS.has(archivo.type) && archivo.size <= MAX_BYTES && !grande) {
    bitmap?.close()
    return archivo
  }
  if (bitmap === null)
    throw new Error(`No pude leer «${archivo.name}». Probá con un JPG, PNG o WebP.`)
  // Se achica en el navegador y se pasa a WebP: entra en el límite y pesa poco.
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(bitmap.width * escala)
  lienzo.height = Math.round(bitmap.height * escala)
  lienzo.getContext('2d')!.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/webp', 0.85))
  if (!blob || blob.size > MAX_BYTES)
    throw new Error(`«${archivo.name}» es demasiado pesada aun achicada.`)
  return blob
}

/**
 * La miniatura de una foto: 400 px como máximo y WebP, ~5 KB contra ~40 KB del
 * original. Es la que muestran los listados y la web (`thumb_url`). Si el
 * navegador no la puede armar, la foto se sube igual sin miniatura: los
 * listados usan el original, como antes.
 */
async function miniaturaDe(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const escala = Math.min(1, LADO_MINIATURA / Math.max(bitmap.width, bitmap.height))
    const lienzo = document.createElement('canvas')
    lienzo.width = Math.max(1, Math.round(bitmap.width * escala))
    lienzo.height = Math.max(1, Math.round(bitmap.height * escala))
    lienzo.getContext('2d')!.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height)
    bitmap.close()
    return await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/webp', 0.72))
  } catch {
    return null
  }
}

const LADO_MINIATURA = 400

/** Dónde va la miniatura de un archivo propio: al lado, con `.mini.webp`. */
const rutaDeMiniatura = (ruta: string) => ruta.replace(/\.[a-z0-9]+$/i, '') + '.mini.webp'

function extensionDe(tipo: string): string {
  if (tipo === 'image/png') return 'png'
  if (tipo === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * Sube las fotos y las agrega AL FINAL; si el producto no tenía ninguna, la
 * primera queda como principal.
 */
export async function subirFotos(
  companyId: string,
  productId: string,
  archivos: readonly File[],
  existentes: readonly FotoProducto[],
): Promise<number> {
  let posicion = existentes.length
  let subidas = 0
  for (const archivo of archivos) {
    const blob = await prepararImagen(archivo)
    const ruta = `productos/${companyId}/${productId}/${crypto.randomUUID()}.${extensionDe(blob.type)}`
    const { error: eSubida } = await supabase.storage.from(BUCKET).upload(ruta, blob, {
      contentType: blob.type,
      upsert: false,
      cacheControl: '31536000',
    })
    if (eSubida) throw new Error(`No se pudo subir «${archivo.name}»: ${eSubida.message}`)
    const url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
    // La miniatura no es imprescindible: si no se arma o no sube, va sin ella.
    let thumbUrl: string | null = null
    const mini = await miniaturaDe(blob)
    if (mini) {
      const rutaMini = rutaDeMiniatura(ruta)
      const { error: eMini } = await supabase.storage
        .from(BUCKET)
        .upload(rutaMini, mini, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
      if (!eMini) thumbUrl = supabase.storage.from(BUCKET).getPublicUrl(rutaMini).data.publicUrl
    }
    const { error } = await supabase.from('product_images').insert({
      company_id: companyId,
      product_id: productId,
      source_url: url,
      thumb_url: thumbUrl,
      storage_path: `${BUCKET}/${ruta}`,
      kind: 'product_image',
      position: posicion,
      is_primary: posicion === 0,
      bytes: blob.size,
      alt_text: null,
    })
    if (error) {
      await supabase.storage.from(BUCKET).remove([ruta, rutaDeMiniatura(ruta)])
      throw new Error(`Se subió «${archivo.name}» pero no se pudo registrar: ${error.message}`)
    }
    posicion += 1
    subidas += 1
  }
  return subidas
}
