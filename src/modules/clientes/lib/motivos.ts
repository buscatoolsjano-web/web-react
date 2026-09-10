/**
 * Los motivos de revisión que dejó la migración, en castellano.
 *
 * Un motivo desconocido se muestra crudo: es preferible un código raro en
 * pantalla a esconder que el cliente está marcado.
 *
 * Los tres primeros son **verificables** —el trigger `trg_cliente_revision`
 * los da de baja solo cuando el dato que faltaba aparece—; los demás sólo los
 * resuelve una persona que mire los dos clientes y decida.
 */
const TEXTOS: Record<string, string> = {
  CUIT_REPETIDO_EN_LEGACY:
    'El sistema anterior usaba este CUIT en más de una ficha de cliente.',
  CUIT_NO_ASIGNADO:
    'El CUIT del sistema anterior no se cargó porque ya lo tenía otro cliente. Está sin asignar, no reemplazado.',
  REF_DUPLICADA: 'La referencia CLI del sistema anterior ya estaba en uso por otro cliente.',
  VARIOS_LEGACY_AL_MISMO_CLIENTE:
    'Más de una ficha del sistema anterior apuntaba al mismo cliente. No se fusionó ninguna.',
  SOLO_EN_CONTACTOS: 'No estaba en el maestro de clientes: apareció al cargar un contacto suyo.',
  AMBIGUO_NOMBRE: 'Había más de un cliente con este nombre y no se unió con ninguno.',
  AMBIGUO_CUIT: 'Había más de un cliente con este CUIT y no se unió con ninguno.',
  AMBIGUO_EMAIL: 'Había más de un cliente con este email y no se unió con ninguno.',
  AMBIGUO_DOMINIO: 'Había más de un cliente con este dominio y no se unió con ninguno.',
  CONFLICTO_DE_DATO:
    'Un dato del sistema anterior no coincide con el que ya estaba. No se pisó ninguno.',
}

export function explicarMotivo(motivo: string): string {
  return TEXTOS[motivo] ?? motivo
}

/**
 * Los motivos que se caen solos cuando el dato aparece.
 *
 * Está acá para poder explicarlo en pantalla, pero **quien decide es el
 * trigger**: la aplicación no puede borrar la marca escribiendo la columna.
 */
export const MOTIVOS_VERIFICABLES = [
  'CUIT_NO_ASIGNADO',
  'CUIT_REPETIDO_EN_LEGACY',
  'REF_DUPLICADA',
] as const

export function esVerificable(motivo: string): boolean {
  return (MOTIVOS_VERIFICABLES as readonly string[]).includes(motivo)
}
