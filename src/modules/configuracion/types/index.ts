/** Una membresía de la empresa activa, con el estado de su cuenta de Auth. */
export interface UsuarioEmpresa {
  membershipId: string
  userId: string
  nombre: string | null
  email: string
  rol: string
  estado: 'active' | 'suspended'
  /** Sólo roles externos: el cliente al que representa. */
  cliente: string | null
  alta: string
  invitadoEl: string | null
  emailConfirmado: boolean
  /** Último inicio de sesión según Supabase Auth. Null: nunca. */
  ultimoIngreso: string | null
  bloqueada: boolean
  esPropia: boolean
}

export type EstadoVisible = 'activo' | 'invitacion_pendiente' | 'sin_confirmar' | 'suspendido' | 'bloqueada'

export interface DatosInvitacion {
  companyId: string
  email: string
  nombre: string | null
  rol: string
}

export interface ResultadoInvitacion {
  resultado: 'invitado' | 'agregado_existente' | 'agregado_pendiente' | 'reenviada'
  membershipId: string
  emailEnviado: boolean
  errorEnvio: string | null
}
