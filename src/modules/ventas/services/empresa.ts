import { supabase } from '@/services/supabase/client'
import type { EmpresaImpresion } from '../lib/impresion'

/**
 * Los datos de la empresa que van en el encabezado del documento impreso.
 *
 * Salen de `companies`, no de una constante: el legacy tenía los de
 * Buscatools escritos a mano en el código y armaba los del resto desde una
 * tabla, así que imprimir con la otra empresa daba dos encabezados distintos.
 */
/**
 * El logo de cada empresa, bundleado en `public/brand`. Por empresa y no por la
 * URL firmada del bucket: el PDF se saca con html2canvas y una imagen
 * cross-origin del storage sale en blanco. El `slug` es estable; una empresa
 * nueva sin entrada cae al de Buscatools hasta que se agregue su archivo.
 */
const LOGO_POR_EMPRESA: Record<string, string> = {
  buscatools: 'buscatools-logo.png',
  torquetools: 'torquetools-logo.webp',
}

export async function datosDeEmpresa(companyId: string): Promise<EmpresaImpresion> {
  const { data, error } = await supabase
    .from('companies')
    .select('slug, name, legal_name, tax_id, address, phone, email, website, brand_color')
    .eq('id', companyId)
    .single()
  if (error) throw new Error(`No se pudieron leer los datos de la empresa: ${error.message}`)

  const archivoLogo = LOGO_POR_EMPRESA[data.slug] ?? LOGO_POR_EMPRESA.buscatools
  return {
    nombre: data.name,
    razonSocial: data.legal_name,
    cuit: data.tax_id,
    direccion: data.address,
    telefono: data.phone,
    email: data.email,
    web: data.website,
    color: data.brand_color ?? '#f37021',
    logoUrl: `${import.meta.env.BASE_URL}brand/${archivoLogo}`,
  }
}
