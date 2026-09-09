const CLAVE = 'bt-empresa-activa'

/**
 * Preferencia de empresa activa.
 *
 * Es SÓLO una comodidad de interfaz: se valida siempre contra las
 * membresías reales que devuelve el servidor, y escribir un company_id acá
 * no otorga ningún permiso — RLS devuelve cero filas para una empresa
 * ajena.
 *
 * Vive en su propio módulo para que AuthProvider pueda limpiarla al cerrar
 * sesión sin importar el provider de empresa (evita un ciclo entre los
 * dos) y para que la clave esté declarada en un solo lugar.
 */

export function leerEmpresaPreferida(): string | null {
  try {
    return localStorage.getItem(CLAVE)
  } catch {
    // Modo privado o storage bloqueado: no hay preferencia, nada más.
    return null
  }
}

export function guardarEmpresaPreferida(companyId: string): void {
  try {
    localStorage.setItem(CLAVE, companyId)
  } catch {
    /* sin persistencia; la sesión funciona igual */
  }
}

/**
 * Se llama al cerrar sesión.
 *
 * Si no se borra, la preferencia del usuario anterior sobrevive al cambio
 * de usuario. No es explotable —la empresa se valida contra las membresías
 * del nuevo usuario y se descarta si no coincide— pero es un residuo de
 * otra sesión, y el navegador no tiene por qué conservarlo.
 */
export function olvidarEmpresaPreferida(): void {
  try {
    localStorage.removeItem(CLAVE)
  } catch {
    /* nada que limpiar */
  }
}
