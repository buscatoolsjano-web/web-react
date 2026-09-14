/**
 * Lógica pura de `config-empresa-logo`: validación del pedido y del archivo.
 * Sin Deno ni red, para testearla desde Node.
 */

export const ORIGENES_PERMITIDOS = [
  'https://app.buscatools.com',
  'http://localhost:5173',
  'http://localhost:3000',
] as const

export const BUCKET = 'empresa-logos'
export const TAMANO_MAXIMO = 2 * 1024 * 1024

export type TipoImagen = 'image/png' | 'image/jpeg' | 'image/webp'
export const EXTENSION: Record<TipoImagen, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El tipo REAL del archivo, por sus primeros bytes. El nombre y el
 * Content-Type que manda el navegador no se usan para decidir.
 * SVG no se acepta: puede llevar script y no hay sanitizador confiable acá.
 */
export function detectarTipo(bytes: Uint8Array): TipoImagen | null {
  const b = (i: number) => bytes[i]
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a)
    return 'image/png'
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 12 &&
    b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
    b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  )
    return 'image/webp'
  return null
}

export type Pedido =
  | { accion: 'subir'; companyId: string; version: string }
  | { accion: 'eliminar'; companyId: string; version: string }

export type ErrorPedido = { error: string; campo?: string }

const CAMPOS = {
  subir: ['accion', 'company_id', 'version', 'archivo'],
  eliminar: ['accion', 'company_id', 'version'],
} as const

/** Valida los campos de texto del formulario. Cualquier campo extra se rechaza. */
export function validarCampos(campos: Record<string, string | null>, claves: string[]): Pedido | ErrorPedido {
  const accion = campos.accion
  if (accion !== 'subir' && accion !== 'eliminar') return { error: 'datos_invalidos', campo: 'accion' }
  const extra = claves.find((k) => !(CAMPOS[accion] as readonly string[]).includes(k))
  if (extra) return { error: 'campos_no_permitidos', campo: extra }
  const dup = claves.find((k, i) => claves.indexOf(k) !== i)
  if (dup) return { error: 'campos_no_permitidos', campo: dup }
  const companyId = campos.company_id ?? ''
  if (!UUID.test(companyId)) return { error: 'datos_invalidos', campo: 'company_id' }
  const version = campos.version ?? ''
  if (!version || version.length > 40 || Number.isNaN(Date.parse(version))) return { error: 'datos_invalidos', campo: 'version' }
  return { accion, companyId, version }
}

/** Valida el archivo ya leído. Devuelve el tipo real o un error. */
export function validarArchivo(bytes: Uint8Array, tipoDeclarado: string): { tipo: TipoImagen } | ErrorPedido {
  if (bytes.length === 0) return { error: 'archivo_vacio' }
  if (bytes.length > TAMANO_MAXIMO) return { error: 'archivo_grande' }
  const tipo = detectarTipo(bytes)
  if (!tipo) return { error: 'formato_no_permitido' }
  // Si el navegador declaró otro tipo, algo no cuadra: no se adivina.
  const declarado = tipoDeclarado === 'image/jpg' ? 'image/jpeg' : tipoDeclarado
  if (declarado !== tipo) return { error: 'tipo_no_coincide' }
  return { tipo }
}

/** Ruta controlada: nunca el nombre del usuario. Versión por timestamp para no servir caché vieja. */
export function rutaLogo(companyId: string, tipo: TipoImagen, ahora: number): string {
  return `${companyId}/logo-${String(ahora).padStart(13, '0')}.${EXTENSION[tipo]}`
}

export function statusDe(codigo: string): number {
  switch (codigo) {
    case 'sin_permiso':
      return 403
    case 'conflicto_version':
      return 409
    case 'archivo_grande':
      return 413
    case 'formato_no_permitido':
    case 'tipo_no_coincide':
    case 'archivo_vacio':
    case 'ruta_invalida':
      return 422
    default:
      return 400
  }
}

export const ERRORES_BASE = ['sin_permiso', 'conflicto_version', 'ruta_invalida'] as const

export function codigoDeErrorBase(mensaje: string | undefined): string | null {
  const m = (mensaje ?? '').trim()
  return (ERRORES_BASE as readonly string[]).includes(m) ? m : null
}
