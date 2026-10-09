/**
 * Los permisos de cada rol (Fase 58 · E2).
 *
 * EL PEDIDO. «Ahora está administrador, empleado, vendedor y técnico pero yo no
 * sé a qué tiene acceso cada cosa. Quiero poder configurar eso como yo quiera».
 * Son dos cosas: MOSTRAR qué puede cada rol, y poder CAMBIARLO.
 *
 * DÓNDE VIVE LA VERDAD. En la base, en `role_capabilities`, que leen las cinco
 * funciones `app.current_*_company_ids()` usadas por 104 políticas RLS. O sea
 * que apagar una casilla acá no esconde un menú: la base deja de devolver esos
 * datos. Es a propósito —una pantalla de permisos que sólo esconda botones
 * miente— y es la razón por la que esta pantalla no tiene su propia lista de
 * roles cableada: la pide.
 *
 * EL ADMIN NO SE CONFIGURA. Tiene todo siempre y no figura en la tabla. Es lo
 * que vuelve imposible el error más feo que podría tener esta pantalla: un
 * admin que se quita a sí mismo el permiso de entrar a los permisos y deja a la
 * empresa sin nadie que pueda devolverlo.
 */

/** Los roles cuyos permisos se editan. Coincide con el CHECK de la tabla. */
export const ROLES_CONFIGURABLES = ['employee', 'salesperson', 'technician'] as const
export type RolConfigurable = (typeof ROLES_CONFIGURABLES)[number]

/** El rol que tiene todo sin figurar en la tabla. */
export const ROL_CON_TODO = 'admin'

export interface Capacidad {
  clave: string
  etiqueta: string
  descripcion: string
  posicion: number
}

/** Una concesión: este rol, en esta empresa, tiene este permiso. */
export interface Concesion {
  rol: string
  capacidad: string
}

export function esRolConfigurable(rol: string): rol is RolConfigurable {
  return (ROLES_CONFIGURABLES as readonly string[]).includes(rol)
}

/**
 * Qué permisos tiene un rol, según las concesiones de la empresa.
 *
 * El admin devuelve TODO el catálogo, no lo que haya en la tabla: así la
 * pantalla muestra lo mismo que hace `app.rol_tiene`, que también lo resuelve
 * antes de consultarla.
 */
export function capacidadesDeRol(
  rol: string,
  catalogo: readonly Capacidad[],
  concesiones: readonly Concesion[],
): string[] {
  if (rol === ROL_CON_TODO) return catalogo.map((c) => c.clave)
  return concesiones.filter((c) => c.rol === rol).map((c) => c.capacidad)
}

/**
 * Prende o apaga una casilla.
 *
 * Devuelve una lista nueva y ORDENADA como el catálogo: el orden es lo que
 * después permite comparar con `hayCambios` sin preocuparse por el orden en que
 * se tocaron las casillas.
 */
export function alternar(
  actuales: readonly string[],
  catalogo: readonly Capacidad[],
  clave: string,
  prendido: boolean,
): string[] {
  const set = new Set(actuales)
  if (prendido) set.add(clave)
  else set.delete(clave)
  // Sólo las del catálogo: si quedó guardada una clave de un permiso que ya no
  // existe, no se reenvía —la base la rechazaría con `permiso_desconocido`—.
  return catalogo.filter((c) => set.has(c.clave)).map((c) => c.clave)
}

/** ¿Cambió algo? Compara como conjuntos, sin importar el orden. */
export function hayCambios(original: readonly string[], editado: readonly string[]): boolean {
  if (original.length !== editado.length) return true
  const set = new Set(original)
  return editado.some((c) => !set.has(c))
}

/**
 * El resumen de un rol en una línea, para leerlo de un vistazo.
 *
 * «Sin permisos» y no una cadena vacía: un rol al que no se le dio nada entra
 * al sistema y no ve nada, y eso hay que poder leerlo. Es un estado válido
 * —un técnico recién creado, por ejemplo— no un error.
 */
export function resumenDeRol(claves: readonly string[], catalogo: readonly Capacidad[]): string {
  const etiquetas = catalogo.filter((c) => claves.includes(c.clave)).map((c) => c.etiqueta)
  if (etiquetas.length === 0) return 'Sin permisos'
  if (etiquetas.length === catalogo.length) return 'Todos los permisos'
  return etiquetas.join(' · ')
}

/**
 * Lo que NO se configura acá, y por qué.
 *
 * La mitad del pedido era entender qué puede cada rol, así que lo que queda
 * fijo tiene que estar escrito y no simplemente ausente: si falta, la pantalla
 * parece decir que esto es todo lo que hay.
 */
export const PERMISOS_FIJOS = [
  {
    titulo: 'Configuración',
    quien: 'Administrador y empleado',
    porque: 'Cada pantalla de Configuración lo vuelve a validar en el servidor. Usuarios y los permisos de abajo, sólo el administrador.',
  },
  {
    titulo: 'Chat interno',
    quien: 'Quien esté en la conversación',
    porque: 'No depende del rol: se ve una conversación si uno es participante.',
  },
  {
    titulo: 'Informes',
    quien: 'Administrador y empleado',
    porque: 'Resumen lo comercial de toda la empresa, así que siguen a «Ver lo comercial» del empleado.',
  },
  {
    titulo: 'Clientes, proveedores y distribuidores',
    quien: 'Según su vínculo con la empresa',
    porque: 'Un cliente ve lo suyo —sus pedidos, sus remitos— y nada más. Eso lo decide el vínculo, no un interruptor.',
  },
] as const

/** Texto para cada código que devuelve `config_permisos_rol_guardar`. */
export function mensajeErrorPermisos(codigo: string): string {
  switch (codigo) {
    case 'sin_permiso':
      return 'Sólo un administrador de esta empresa puede cambiar los permisos.'
    case 'rol_no_configurable':
      return 'El administrador tiene todos los permisos siempre, y los clientes y proveedores no se configuran acá.'
    case 'permiso_desconocido':
      return 'Se intentó guardar un permiso que no existe. Recargá la página y volvé a probar.'
    case 'sin_red':
      return 'No se pudo contactar al servidor. Revisá la conexión.'
    default:
      return 'No se pudieron guardar los permisos. Intentá de nuevo.'
  }
}
