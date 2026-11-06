import { supabase } from '@/services/supabase/client'

export type DatosClienteExtraidos = Partial<{
  razonSocial: string
  nombreComercial: string
  cuit: string
  telefono: string
  email: string
  rubro: string
  notas: string
}>

export async function extraerDatosClienteDesdeImagen(imagen: File): Promise<DatosClienteExtraidos> {
  const form = new FormData()
  form.append('imagen', imagen)
  // El SDK tipa `error` como `any`; se fija igual que en el asistente.
  const r: { data: { datos?: DatosClienteExtraidos; error?: string } | null; error: Error | null } =
    await supabase.functions.invoke<{ datos?: DatosClienteExtraidos; error?: string }>('extraer-cliente-imagen', { body: form })
  const { data, error } = r
  if (error) throw new Error(error.message)
  if (!data?.datos) throw new Error(data?.error ?? 'La IA no devolvió datos.')
  return data.datos
}
