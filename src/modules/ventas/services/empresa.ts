import { supabase } from '@/services/supabase/client'
import type { EmpresaImpresion } from '../lib/impresion'

/**
 * Los datos de la empresa que van en el encabezado del documento impreso.
 *
 * Salen de `companies`, no de una constante: el legacy tenía los de Buscatools
 * escritos a mano en el código y armaba los del resto desde una tabla, así que
 * imprimir con la otra empresa daba dos encabezados distintos.
 */

/**
 * El logo de la empresa, embebido como `data:` URL.
 *
 * NO es la URL firmada del bucket usada directo: el PDF se saca con html2canvas,
 * y una imagen cross-origin del storage mancha el canvas y sale en blanco. Al
 * bajarla y embeberla queda same-origin y html2canvas la dibuja. Cada empresa
 * usa el SUYO: si no tiene logo, o no se pudo bajar, devuelve null y el
 * documento va sin logo —nunca cae al de otra empresa— (Fase 188).
 */
async function logoDataUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from('empresa-logos').createSignedUrl(path, 600)
    if (error || !data) return null
    const resp = await fetch(data.signedUrl)
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function datosDeEmpresa(companyId: string): Promise<EmpresaImpresion> {
  const { data, error } = await supabase
    .from('companies')
    .select('name, legal_name, tax_id, address, phone, email, website, brand_color, logo_path')
    .eq('id', companyId)
    .single()
  if (error) throw new Error(`No se pudieron leer los datos de la empresa: ${error.message}`)

  return {
    nombre: data.name,
    razonSocial: data.legal_name,
    cuit: data.tax_id,
    direccion: data.address,
    telefono: data.phone,
    email: data.email,
    web: data.website,
    color: data.brand_color ?? '#f37021',
    logoUrl: data.logo_path ? await logoDataUrl(data.logo_path) : null,
  }
}
