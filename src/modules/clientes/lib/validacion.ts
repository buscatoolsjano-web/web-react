/**
 * Validación y normalización del formulario de cliente.
 *
 * Todo lo de acá es función pura: no toca la red ni el DOM, y está probado
 * aparte. Lo que **impide** guardar mal no es esto —es la base: el índice
 * único del CUIT normalizado, los NOT NULL y RLS. Esto es para que la persona
 * se entere antes de apretar Guardar.
 */

/** El CUIT, reducido a sus dígitos. Es la forma en la que se compara. */
export function normalizarCuit(cuit: string | null | undefined): string {
  return (cuit ?? '').replace(/\D/g, '')
}

/** Un CUIT informado tiene once dígitos. Ni diez ni doce. */
export function pareceCuit(cuit: string | null | undefined): boolean {
  return normalizarCuit(cuit).length === 11
}

/**
 * Los emails de un cliente.
 *
 * Se recortan, se pasan a minúscula —así se guardaron los 877 del legacy— y
 * se sacan los repetidos comparando sin distinguir mayúsculas. Lo que no
 * tiene forma de email se descarta acá y se avisa en `validarCliente`.
 */
export function normalizarEmails(entrada: readonly string[]): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const e of entrada) {
    const limpio = e.trim().toLowerCase()
    if (limpio === '' || !esEmail(limpio)) continue
    if (vistos.has(limpio)) continue
    vistos.add(limpio)
    salida.push(limpio)
  }
  return salida
}

export function esEmail(texto: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim())
}

/** Un dominio: sin `@`, sin protocolo, sin barra final, en minúscula. */
export function normalizarDominios(entrada: readonly string[]): string[] {
  const vistos = new Set<string>()
  const salida: string[] = []
  for (const d of entrada) {
    const limpio = d
      .trim()
      .toLowerCase()
      .replace(/^@/, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
    if (limpio === '' || !limpio.includes('.')) continue
    if (vistos.has(limpio)) continue
    vistos.add(limpio)
    salida.push(limpio)
  }
  return salida
}

export interface DatosCliente {
  razonSocial: string
  nombreComercial: string
  cuit: string
  emails: string[]
  dominios: string[]
  rubro: string
  telefono: string
  tipo: string
  condicionDePago: string
  monedaPorDefecto: string
  notas: string
}

export const CLIENTE_VACIO: DatosCliente = {
  razonSocial: '',
  nombreComercial: '',
  cuit: '',
  emails: [],
  dominios: [],
  rubro: '',
  telefono: '',
  tipo: 'business',
  condicionDePago: '',
  monedaPorDefecto: '',
  notas: '',
}

export interface ErrorDeCampo {
  campo: keyof DatosCliente
  mensaje: string
}

/**
 * Qué está mal antes de guardar.
 *
 * `cuitOriginal` es el que tenía el cliente cuando se abrió el formulario. Si
 * el CUIT **no cambió**, no se valida el formato: el histórico trae 21
 * `tax_id` que no son un CUIT —«Básculas Magris S.A», «?», un teléfono— y
 * exigir que se arreglen para poder corregir un teléfono sería obligar a
 * inventar un dato. Se corrige cuando alguien sepa cuál es, no de rebote.
 */
export function validarCliente(
  datos: DatosCliente,
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

  for (const e of datos.emails) {
    if (e.trim() !== '' && !esEmail(e)) {
      errores.push({ campo: 'emails', mensaje: `«${e.trim()}» no parece un email.` })
      break
    }
  }

  const emails = datos.emails.map((e) => e.trim().toLowerCase()).filter((e) => e !== '')
  if (new Set(emails).size !== emails.length) {
    errores.push({ campo: 'emails', mensaje: 'Hay un email repetido en la lista.' })
  }

  if (datos.tipo !== 'business' && datos.tipo !== 'individual') {
    errores.push({ campo: 'tipo', mensaje: 'El tipo de cliente no es válido.' })
  }

  return errores
}

export interface DatosContacto {
  nombre: string
  cargo: string
  email: string
  telefono: string
  fax: string
  esPrincipal: boolean
  notas: string
}

export const CONTACTO_VACIO: DatosContacto = {
  nombre: '',
  cargo: '',
  email: '',
  telefono: '',
  fax: '',
  esPrincipal: false,
  notas: '',
}

export function validarContacto(datos: DatosContacto): string[] {
  const errores: string[] = []
  if (datos.nombre.trim() === '') errores.push('El nombre del contacto es obligatorio.')
  if (datos.email.trim() !== '' && !esEmail(datos.email)) {
    errores.push(`«${datos.email.trim()}» no parece un email.`)
  }
  return errores
}

/**
 * Los cuatro tipos de dirección que admite el CHECK de
 * `customer_addresses.kind`: `shipping`, `billing`, `both` y `other`.
 *
 * `other` se agregó en el cierre de la entrega 3, autorizado y sin tocar un
 * solo dato. Sirve para lo que no es ni entrega ni facturación —un depósito,
 * una planta, una oficina— sin obligar a etiquetarlo mal.
 */
export const TIPOS_DE_DIRECCION = [
  { valor: 'shipping', etiqueta: 'Entrega' },
  { valor: 'billing', etiqueta: 'Facturación' },
  { valor: 'both', etiqueta: 'Entrega y facturación' },
  { valor: 'other', etiqueta: 'Otra' },
] as const

export interface DatosDireccion {
  tipo: string
  calle: string
  ciudad: string
  provincia: string
  codigoPostal: string
  pais: string
  notas: string
  esPrincipal: boolean
}

export const DIRECCION_VACIA: DatosDireccion = {
  tipo: 'shipping',
  calle: '',
  ciudad: '',
  provincia: '',
  codigoPostal: '',
  pais: '',
  notas: '',
  esPrincipal: false,
}

export function validarDireccion(datos: DatosDireccion): string[] {
  const errores: string[] = []
  if (datos.calle.trim() === '') errores.push('La calle es obligatoria.')
  if (!TIPOS_DE_DIRECCION.some((t) => t.valor === datos.tipo)) {
    errores.push('El tipo de dirección no es válido.')
  }
  // Un país se escribe con su código de dos letras (AR, BR, UY): es lo que
  // guarda `country_code`.
  const pais = datos.pais.trim()
  if (pais !== '' && !/^[A-Za-z]{2}$/.test(pais)) {
    errores.push('El país va con su código de dos letras: AR, BR, UY…')
  }
  return errores
}
