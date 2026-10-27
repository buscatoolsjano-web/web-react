import { supabase } from '@/services/supabase/client'

/**
 * Alta de empresa desde el selector del header (sólo admins).
 *
 * Todo el trabajo —empresa, series, lista de precios, depósito y la membresía
 * de quien la crea— lo hace la RPC `config_crear_empresa` en una transacción
 * (Fase 187). Acá sólo se la llama y se traducen sus códigos de error.
 */

export const MONEDAS = ['ARS', 'USD', 'EUR'] as const
export type Moneda = (typeof MONEDAS)[number]

export const ETIQUETA_MONEDA: Record<Moneda, string> = {
  ARS: 'Peso argentino (ARS)',
  USD: 'Dólar (USD)',
  EUR: 'Euro (EUR)',
}

export interface EmpresaCreada {
  companyId: string
  slug: string
  name: string
  moneda: string
}

export class ErrorCrearEmpresa extends Error {
  constructor(readonly codigo: string) {
    super(codigo)
    this.name = 'ErrorCrearEmpresa'
  }
}

const CODIGOS = ['sesion_invalida', 'sin_permiso', 'nombre_invalido', 'moneda_invalida'] as const

function deError(e: { message: string }): ErrorCrearEmpresa {
  const codigo = CODIGOS.find((c) => e.message.includes(c))
  if (codigo) return new ErrorCrearEmpresa(codigo)
  if (/failed to fetch|network/i.test(e.message)) return new ErrorCrearEmpresa('sin_red')
  return new ErrorCrearEmpresa('desconocido')
}

export async function crearEmpresa(nombre: string, moneda: string): Promise<EmpresaCreada> {
  const { data, error } = await supabase.rpc('config_crear_empresa', { p_nombre: nombre, p_moneda: moneda })
  if (error) throw deError(error)
  const r = data as { company_id?: string; slug?: string; name?: string; moneda?: string } | null
  if (!r?.company_id) throw new ErrorCrearEmpresa('desconocido')
  return { companyId: r.company_id, slug: r.slug ?? '', name: r.name ?? nombre, moneda: r.moneda ?? moneda }
}

/** El nombre que valida la UI antes de molestar al servidor. */
export function validarNombreEmpresa(nombre: string): string | null {
  const n = nombre.trim()
  if (!n) return 'Ingresá el nombre de la empresa.'
  if (n.length > 120) return 'Máximo 120 caracteres.'
  return null
}

export function mensajeErrorEmpresa(codigo: string): string {
  switch (codigo) {
    case 'sin_permiso':
      return 'Sólo un administrador puede crear empresas.'
    case 'nombre_invalido':
      return 'Ingresá un nombre válido (hasta 120 caracteres).'
    case 'moneda_invalida':
      return 'Elegí una moneda válida.'
    case 'sesion_invalida':
      return 'Tu sesión venció. Volvé a iniciar sesión.'
    case 'sin_red':
      return 'No se pudo contactar al servidor. Revisá la conexión.'
    default:
      return 'No se pudo crear la empresa. Intentá de nuevo.'
  }
}
