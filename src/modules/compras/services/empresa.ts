import { supabase } from '@/services/supabase/client'
import type { EmpresaImpresion } from '../lib/impresion'

/**
 * Los datos de la empresa para el encabezado impreso.
 *
 * Salen de `companies`, no de una constante: el legacy tenía los de
 * Buscatools escritos a mano en el código y armaba los del resto desde una
 * tabla, así que imprimir con la otra empresa daba dos encabezados distintos.
 *
 * Está repetido respecto de Ventas a propósito, por la misma razón que la
 * tabla de tratamientos: importarlo desde allá ataría dos secciones que no
 * tienen por qué moverse juntas. Son ocho columnas de una tabla estable.
 */
export async function datosDeEmpresa(companyId: string): Promise<EmpresaImpresion> {
  const { data, error } = await supabase
    .from('companies')
    .select('name, legal_name, tax_id, address, phone, email, website, brand_color')
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
  }
}
