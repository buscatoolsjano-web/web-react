/**
 * Datos de empresa: campos editables, normalización, validación y cambios.
 *
 * Espeja las reglas de `config_empresa_actualizar`, que es la que decide. Acá
 * sólo se evita mandar algo que la base va a rechazar y se arma el pedido con
 * los campos que cambiaron (nunca el objeto entero).
 */

/** Los únicos campos que se editan. Coinciden con la lista blanca de la RPC. */
export const CAMPOS_EDITABLES = ['name', 'legal_name', 'tax_id', 'address', 'phone', 'email', 'website', 'brand_color'] as const
export type CampoEditable = (typeof CAMPOS_EDITABLES)[number]
export type FormularioEmpresa = Record<CampoEditable, string>

export interface DefinicionCampo {
  campo: CampoEditable
  etiqueta: string
  requerido: boolean
  max: number
  ayuda?: string
  tipo?: 'text' | 'email' | 'tel' | 'url' | 'color'
  multilinea?: boolean
  autoComplete?: string
}

export const SECCIONES_EMPRESA: { titulo: string; campos: DefinicionCampo[] }[] = [
  {
    titulo: 'Identidad',
    campos: [
      { campo: 'name', etiqueta: 'Nombre comercial', requerido: true, max: 120, autoComplete: 'organization' },
      { campo: 'legal_name', etiqueta: 'Razón social', requerido: false, max: 200 },
      {
        campo: 'tax_id',
        etiqueta: 'CUIT / NIF',
        requerido: false,
        max: 30,
        ayuda: 'Sólo se controla la forma (letras, números, puntos, guiones). No se verifica el dígito ni el padrón.',
      },
    ],
  },
  {
    titulo: 'Contacto',
    campos: [
      { campo: 'email', etiqueta: 'Email', requerido: false, max: 254, tipo: 'email', autoComplete: 'email' },
      { campo: 'phone', etiqueta: 'Teléfono', requerido: false, max: 50, tipo: 'tel', autoComplete: 'tel' },
      { campo: 'website', etiqueta: 'Sitio web', requerido: false, max: 200, tipo: 'url', autoComplete: 'url' },
    ],
  },
  {
    titulo: 'Dirección',
    campos: [
      {
        campo: 'address',
        etiqueta: 'Dirección completa',
        requerido: false,
        max: 300,
        multilinea: true,
        ayuda: 'Un solo campo: calle, ciudad, código postal, provincia y país. La base no tiene columnas separadas.',
      },
    ],
  },
  {
    titulo: 'Branding',
    campos: [{ campo: 'brand_color', etiqueta: 'Color de marca', requerido: false, max: 7, tipo: 'color', ayuda: 'Formato #RRGGBB.' }],
  },
]

export interface DatosEmpresa {
  id: string
  slug: string
  name: string
  legal_name: string | null
  tax_id: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  brand_color: string | null
  default_currency: string
  is_active: boolean
  logo_path: string | null
  updated_at: string
  puede_editar: boolean
}

export function formularioDesde(d: DatosEmpresa): FormularioEmpresa {
  return Object.fromEntries(CAMPOS_EDITABLES.map((c) => [c, d[c] ?? ''])) as FormularioEmpresa
}

/** Cómo lo va a guardar la base: recortado, vacío → null, email en minúsculas, color en mayúsculas. */
export function normalizar(campo: CampoEditable, valor: string): string | null {
  const v = valor.trim()
  if (v === '') return null
  if (campo === 'email') return v.toLowerCase()
  if (campo === 'brand_color') return v.toUpperCase()
  return v
}

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/
const TAX = /^[A-Za-z0-9][A-Za-z0-9./ -]{1,29}$/
const PHONE = /^[0-9+() ./-]{4,50}$/
const WEB = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i
const COLOR = /^#[0-9A-F]{6}$/

export function validarCampo(campo: CampoEditable, valor: string): string | null {
  const v = normalizar(campo, valor)
  const def = SECCIONES_EMPRESA.flatMap((s) => s.campos).find((d) => d.campo === campo)!
  if (v === null) return def.requerido ? 'Obligatorio.' : null
  if (v.length > def.max) return `Máximo ${def.max} caracteres.`
  switch (campo) {
    case 'email':
      return EMAIL.test(v) ? null : 'El email no parece válido.'
    case 'tax_id':
      return TAX.test(v) ? null : 'Usá sólo letras, números, puntos, barras o guiones.'
    case 'phone':
      return PHONE.test(v) ? null : 'Usá sólo números, espacios y + ( ) . - /'
    case 'website':
      return WEB.test(v) ? null : 'Ejemplo: www.empresa.com'
    case 'brand_color':
      return COLOR.test(v) ? null : 'Formato #RRGGBB.'
    default:
      return null
  }
}

/**
 * Sólo los campos que cambiaron respecto de lo guardado, ya normalizados. Un
 * campo que no se tocó no se valida: un dato histórico que no cumpla una regla
 * nueva no bloquea editar los demás.
 */
export function cambios(inicial: FormularioEmpresa, actual: FormularioEmpresa): Partial<Record<CampoEditable, string | null>> {
  const out: Partial<Record<CampoEditable, string | null>> = {}
  for (const c of CAMPOS_EDITABLES) {
    const antes = normalizar(c, inicial[c])
    const ahora = normalizar(c, actual[c])
    if (antes !== ahora) out[c] = ahora
  }
  return out
}

export function erroresDe(inicial: FormularioEmpresa, actual: FormularioEmpresa): Partial<Record<CampoEditable, string>> {
  const out: Partial<Record<CampoEditable, string>> = {}
  for (const c of Object.keys(cambios(inicial, actual)) as CampoEditable[]) {
    const e = validarCampo(c, actual[c])
    if (e) out[c] = e
  }
  return out
}

const ETIQUETA: Record<CampoEditable, string> = Object.fromEntries(
  SECCIONES_EMPRESA.flatMap((s) => s.campos).map((d) => [d.campo, d.etiqueta]),
) as Record<CampoEditable, string>

export function etiquetaCampo(c: string): string {
  return (ETIQUETA as Record<string, string>)[c] ?? (c === 'logo_path' ? 'Logo' : c)
}

/** Texto para los códigos de la RPC y de la Edge Function del logo. */
export function mensajeErrorEmpresa(codigo: string): string {
  const [base, campo] = codigo.split(':')
  switch (base) {
    case 'sin_permiso':
      return 'No tenés permiso para editar esta empresa.'
    case 'conflicto_version':
      return 'Otro administrador cambió los datos mientras editabas. Recargá para ver la versión actual.'
    case 'datos_invalidos':
      return campo ? `${etiquetaCampo(campo)}: valor inválido.` : 'Los datos enviados no son válidos.'
    case 'campos_no_permitidos':
      return 'Se intentó guardar un campo que no se puede editar.'
    case 'formato_no_permitido':
      return 'Formato no permitido. Usá PNG, JPEG o WEBP.'
    case 'tipo_no_coincide':
      return 'El archivo no es del tipo que dice ser.'
    case 'archivo_grande':
      return 'La imagen supera 2 MB.'
    case 'archivo_vacio':
      return 'El archivo está vacío.'
    case 'sin_logo':
      return 'La empresa no tiene logo.'
    case 'subida_fallida':
      return 'No se pudo guardar la imagen. Intentá de nuevo.'
    case 'sesion_invalida':
      return 'Tu sesión venció. Volvé a iniciar sesión.'
    case 'sin_red':
      return 'No se pudo contactar al servidor. Revisá la conexión.'
    default:
      return 'Ocurrió un error inesperado. Intentá de nuevo.'
  }
}

// ── Logo ────────────────────────────────────────────────────────────────────

export const LOGO_TAMANO_MAXIMO = 2 * 1024 * 1024
export const LOGO_TIPOS = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Tipo real por los primeros bytes (el mismo criterio que la Edge Function). */
export function detectarTipoImagen(b: Uint8Array): (typeof LOGO_TIPOS)[number] | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

/** Validación previa en el navegador; el servidor la repite sobre los bytes. */
export function validarLogo(tipoDeclarado: string, tamano: number, primerosBytes: Uint8Array): string | null {
  if (tamano === 0) return 'archivo_vacio'
  if (tamano > LOGO_TAMANO_MAXIMO) return 'archivo_grande'
  const real = detectarTipoImagen(primerosBytes)
  if (!real) return 'formato_no_permitido'
  if ((tipoDeclarado === 'image/jpg' ? 'image/jpeg' : tipoDeclarado) !== real) return 'tipo_no_coincide'
  return null
}
