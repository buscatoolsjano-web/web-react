/**
 * Validación y normalización del formulario de proveedor.
 *
 * Todo función pura: no toca la red ni el DOM. Lo que **impide** guardar mal
 * no es esto —es la base: `uq_suppliers_cuit_norm`, el CHECK del país, los
 * NOT NULL y RLS—. Esto es para que la persona se entere antes de apretar
 * Guardar.
 */

/** El CUIT, reducido a sus dígitos. Es la forma en la que se compara. */
export function normalizarCuit(cuit: string | null | undefined): string {
  return (cuit ?? '').replace(/\D/g, '')
}

/** Un CUIT informado tiene once dígitos. Ni diez ni doce. */
export function pareceCuit(cuit: string | null | undefined): boolean {
  return normalizarCuit(cuit).length === 11
}

export function esEmail(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim())
}

/** El país va en mayúsculas: es lo que exige `suppliers_country_code_check`. */
export function normalizarPais(pais: string | null | undefined): string {
  return (pais ?? '').trim().toUpperCase()
}

export interface DatosProveedor {
  razonSocial: string
  nombreComercial: string
  cuit: string
  email: string
  telefono: string
  /** Dirección en una sola línea. NO se parte en calle / ciudad / CP. */
  direccion: string
  pais: string
  actividad: string
  agente: string
  formaPago: string
  monedaPorDefecto: string
  notas: string
}

export const PROVEEDOR_VACIO: DatosProveedor = {
  razonSocial: '',
  nombreComercial: '',
  cuit: '',
  email: '',
  telefono: '',
  direccion: '',
  pais: '',
  actividad: '',
  agente: '',
  formaPago: '',
  monedaPorDefecto: '',
  notas: '',
}

export interface ErrorDeCampo {
  campo: keyof DatosProveedor
  mensaje: string
}

/**
 * Qué está mal antes de guardar.
 *
 * `cuitOriginal` es el que tenía el proveedor cuando se abrió el formulario.
 * Si el CUIT **no cambió**, no se valida el formato. Hoy los 142 migrados no
 * tienen ninguno, así que la regla no se usa; está por la misma razón que en
 * Clientes: el día que aparezca un dato legacy raro, corregir un teléfono no
 * tiene que obligar a inventar un CUIT.
 */
export function validarProveedor(
  datos: DatosProveedor,
  cuitOriginal: string | null = null,
): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = []

  if (datos.razonSocial.trim() === '') {
    errores.push({ campo: 'razonSocial', mensaje: 'La razón social es obligatoria.' })
  }

  const cuit = datos.cuit.trim()
  const cambio = normalizarCuit(cuit) !== normalizarCuit(cuitOriginal)
  if (cuit !== '' && cambio && !pareceCuit(cuit)) {
    errores.push({
      campo: 'cuit',
      mensaje: `Un CUIT tiene 11 dígitos y éste tiene ${normalizarCuit(cuit).length}.`,
    })
  }

  if (datos.email.trim() !== '' && !esEmail(datos.email)) {
    errores.push({ campo: 'email', mensaje: `«${datos.email.trim()}» no parece un email.` })
  }

  const pais = normalizarPais(datos.pais)
  if (pais !== '' && !/^[A-Z]{2}$/.test(pais)) {
    errores.push({ campo: 'pais', mensaje: 'El país va con su código de dos letras: AR, ES, IT…' })
  }

  return errores
}
