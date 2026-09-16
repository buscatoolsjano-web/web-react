/** Lo que la bandeja necesita de una conversación. Nunca la fila entera. */
export interface ConversacionListado {
  id: string
  /** Nombre de perfil de WhatsApp; lo elige el cliente y puede faltar. */
  perfil: string | null
  telefono: string | null
  clienteId: string | null
  clienteNombre: string | null
  asignadoA: string | null
  asignadoNombre: string | null
  ultimoMensajeEn: string | null
  /** 160 caracteres, no el mensaje entero: esto se pide de a 50 filas. */
  ultimoMensaje: string | null
  ultimaDireccion: 'in' | 'out' | null
  ventanaVenceEn: string | null
  archivada: boolean
  noLeidos: number
}

export interface DetalleConversacion extends ConversacionListado {
  cuentaId: string
  companyId: string
  contactoId: string | null
  contactoNombre: string | null
  vinculoOrigen: string | null
  clienteCuit: string | null
}

export interface MensajeAdjunto {
  id: string
  mime: string
  nombre: string | null
  bytes: number | null
  estado: 'pendiente' | 'descargada' | 'fallida' | 'vencida'
  rutaStorage: string | null
}

export interface Mensaje {
  id: string
  direccion: 'in' | 'out'
  tipo: string
  texto: string | null
  caption: string | null
  /** El estado derivado por la base, no el de la cola. */
  estadoVisible: string | null
  errorDetalle: string | null
  /** `coalesce(provider_timestamp, created_at)`: el orden del hilo. */
  ordenadoEn: string
  respondeA: string | null
  proveedorId: string | null
  adjunto: MensajeAdjunto | null
}

export type FiltroBandeja = 'todos' | 'no_leidos' | 'sin_asignar' | 'mios'

export const FILTROS: { valor: FiltroBandeja; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'no_leidos', etiqueta: 'No leídos' },
  { valor: 'sin_asignar', etiqueta: 'Sin asignar' },
  { valor: 'mios', etiqueta: 'Míos' },
]
