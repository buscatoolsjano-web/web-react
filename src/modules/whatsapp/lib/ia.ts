/**
 * Cómo se cuenta en pantalla lo que dijo la IA.
 *
 * Todo lo de acá es presentación pura: etiquetas, agrupaciones y períodos.
 * Nada decide permisos ni escribe. La regla que atraviesa el archivo: una
 * sugerencia se muestra COMO sugerencia —con su confianza y su fuente— y nunca
 * como un hecho del sistema.
 */

export type TipoItemIA = 'pending' | 'commitment' | 'decision' | 'next_step' | 'important' | 'follow_up'
export type ActorIA = 'company' | 'contact' | 'unknown'
export type EstadoItemIA = 'open' | 'resolved' | 'dismissed'
export type EstadoConversacionIA = 'esperando_empresa' | 'esperando_contacto' | 'en_curso' | 'cerrada'

export interface ResumenIA {
  conversacionId: string
  resumen: string | null
  temas: string[]
  estadoConversacion: EstadoConversacionIA | null
  requiereAtencion: boolean
  ultimoMensajeAnalizadoId: string | null
  ultimoMensajeAnalizadoEn: string | null
  estado: 'ok' | 'error'
  ultimoError: string | null
  modelo: string | null
  analisis: number
  generadoEn: string | null
}

export interface ItemIA {
  id: string
  conversacionId: string
  tipo: TipoItemIA
  actor: ActorIA
  descripcion: string
  fuentes: string[]
  confianza: number
  venceEn: string | null
  estado: EstadoItemIA
  generadoEn: string
  resueltoEn: string | null
}

export type MotivoAtencion = 'sin_respuesta' | 'pregunta' | 'demora' | 'error_envio' | 'pendiente_abierto' | 'ia'

// ── Etiquetas ─────────────────────────────────────────────────────────────

export const ETIQUETA_TIPO: Record<TipoItemIA, string> = {
  pending: 'Pendiente',
  commitment: 'Compromiso',
  decision: 'Decisión',
  next_step: 'Próximo paso',
  important: 'Importante',
  follow_up: 'Seguimiento',
}

export const ETIQUETA_ACTOR: Record<ActorIA, string> = {
  company: 'Buscatools',
  contact: 'Contacto',
  unknown: 'Sin determinar',
}

export const ETIQUETA_ESTADO_CONVERSACION: Record<EstadoConversacionIA, string> = {
  esperando_empresa: 'Espera respuesta nuestra',
  esperando_contacto: 'Esperamos al contacto',
  en_curso: 'En curso',
  cerrada: 'Cerrada',
}

/** Orden y texto de los motivos. Las reglas primero; la IA al final. */
export const MOTIVOS: { clave: MotivoAtencion; etiqueta: string }[] = [
  { clave: 'error_envio', etiqueta: 'Falló un envío' },
  { clave: 'pregunta', etiqueta: 'Pregunta sin responder' },
  { clave: 'demora', etiqueta: 'Sin respuesta hace horas' },
  { clave: 'sin_respuesta', etiqueta: 'Último mensaje del contacto' },
  { clave: 'pendiente_abierto', etiqueta: 'Pendiente abierto' },
  { clave: 'ia', etiqueta: 'Marcada por el análisis' },
]

export function presentarMotivos(motivos: readonly string[]): string[] {
  return MOTIVOS.filter((m) => motivos.includes(m.clave)).map((m) => m.etiqueta)
}

/**
 * Confianza en palabras. El número crudo («0,73») sugiere una precisión que
 * no existe; tres niveles alcanzan para decidir si mirar la fuente.
 */
export function nivelDeConfianza(c: number): { etiqueta: string; tono: 'success' | 'info' | 'warning' } {
  if (c >= 0.85) return { etiqueta: 'Confianza alta', tono: 'success' }
  if (c >= 0.65) return { etiqueta: 'Confianza media', tono: 'info' }
  return { etiqueta: 'Confianza baja', tono: 'warning' }
}

/** Mensajes de error del análisis, sin jerga del proveedor. */
export function textoDeErrorIA(codigo: string | null): string {
  if (!codigo) return 'El último análisis no se pudo completar.'
  if (codigo.startsWith('proveedor_sin_configurar')) return 'El análisis con IA no está configurado todavía.'
  if (codigo.startsWith('proveedor_limite')) return 'El servicio de IA está limitando pedidos. Probá en un rato.'
  if (codigo.startsWith('proveedor_modelo_no_disponible')) return 'El modelo de IA configurado no está disponible.'
  if (codigo.startsWith('proveedor_auth')) return 'El servicio de IA rechazó la credencial del servidor.'
  if (codigo.startsWith('proveedor_timeout')) return 'El servicio de IA tardó demasiado en responder.'
  if (codigo.startsWith('proveedor_red')) return 'No se pudo conectar con el servicio de IA.'
  if (codigo.startsWith('proveedor_truncado')) return 'La respuesta del análisis quedó incompleta y se descartó.'
  if (codigo.startsWith('proveedor_rechazo')) return 'El servicio de IA rechazó el pedido.'
  if (codigo.startsWith('proveedor_refusal')) return 'El servicio de IA declinó analizar esta conversación.'
  if (codigo.startsWith('proveedor')) return 'El servicio de IA no respondió.'
  if (codigo.startsWith('salida')) return 'La respuesta del análisis no era válida y se descartó.'
  return 'El último análisis no se pudo completar.'
}

// ── Secciones del panel ───────────────────────────────────────────────────

export interface SeccionIA {
  clave: string
  titulo: string
  items: ItemIA[]
}

/**
 * Los ítems en las secciones del panel. Los compromisos se separan por quién
 * se comprometió: lo que prometió Buscatools y lo que prometió el contacto
 * piden cosas distintas.
 */
export function seccionesIA(items: readonly ItemIA[]): SeccionIA[] {
  const abiertos = items.filter((i) => i.estado === 'open')
  const de = (f: (i: ItemIA) => boolean) =>
    abiertos.filter(f).sort((a, b) => (a.venceEn ?? '9999').localeCompare(b.venceEn ?? '9999'))
  return [
    { clave: 'pendientes', titulo: 'Pendientes', items: de((i) => i.tipo === 'pending' || i.tipo === 'follow_up') },
    { clave: 'compromisos-empresa', titulo: 'Compromisos de Buscatools', items: de((i) => i.tipo === 'commitment' && i.actor === 'company') },
    { clave: 'compromisos-contacto', titulo: 'Compromisos del contacto', items: de((i) => i.tipo === 'commitment' && i.actor !== 'company') },
    { clave: 'decisiones', titulo: 'Decisiones', items: de((i) => i.tipo === 'decision') },
    { clave: 'proximos', titulo: 'Próximos pasos', items: de((i) => i.tipo === 'next_step') },
    { clave: 'importantes', titulo: 'Importante', items: de((i) => i.tipo === 'important') },
  ]
}

// ── Fechas ────────────────────────────────────────────────────────────────

export const ZONA = 'America/Argentina/Buenos_Aires'

/** «vie 18/09». Un vencimiento es un día, no una hora. */
export function fechaCorta(iso: string): string {
  const soloFecha = iso.length === 10
  const d = new Date(soloFecha ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return ''
  // Por partes: el formato corto de es-AR pone «17-09», que se lee como un rango.
  const partes = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short', day: '2-digit', month: '2-digit', timeZone: soloFecha ? 'UTC' : ZONA,
  }).formatToParts(d)
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
  return `${v('weekday').replace('.', '')} ${v('day')}/${v('month')}`
}

/** «16/09/2026 14:05», en la hora de Argentina. */
export function momento(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA,
  }).format(d)
}

/** `AAAA-MM-DD` de un instante en Argentina. */
export function diaLocal(fecha: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(fecha)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}`
}

export interface Periodo {
  desde: string
  hasta: string
  etiqueta: string
}

/**
 * Argentina no tiene horario de verano desde 2009: medianoche local es 03:00
 * UTC todo el año. Si eso cambiara, esto es lo que hay que tocar.
 */
const OFFSET = '-03:00'

function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

const etiquetaDia = (dia: string) =>
  new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${dia}T12:00:00Z`))

/** Un día calendario argentino, de 00:00 a 00:00. */
export function periodoDiario(dia: string): Periodo {
  return {
    desde: new Date(`${dia}T00:00:00${OFFSET}`).toISOString(),
    hasta: new Date(`${sumarDias(dia, 1)}T00:00:00${OFFSET}`).toISOString(),
    etiqueta: etiquetaDia(dia),
  }
}

export type AtajoPeriodo = 'hoy' | 'ayer' | 'semana_actual' | 'semana_anterior'

export const ATAJOS_PERIODO: { clave: AtajoPeriodo; etiqueta: string }[] = [
  { clave: 'hoy', etiqueta: 'Hoy' },
  { clave: 'ayer', etiqueta: 'Ayer' },
  { clave: 'semana_actual', etiqueta: 'Semana actual' },
  { clave: 'semana_anterior', etiqueta: 'Semana anterior' },
]

/** A qué vista y día lleva cada atajo, contado desde el día de hoy en Argentina. */
export function atajoPeriodo(clave: AtajoPeriodo, hoy: string): { vista: 'diario' | 'semanal'; dia: string } {
  switch (clave) {
    case 'hoy': return { vista: 'diario', dia: hoy }
    case 'ayer': return { vista: 'diario', dia: sumarDias(hoy, -1) }
    case 'semana_actual': return { vista: 'semanal', dia: hoy }
    case 'semana_anterior': return { vista: 'semanal', dia: sumarDias(hoy, -7) }
  }
}

/** La semana de lunes a lunes que contiene el día. */
export function periodoSemanal(dia: string): Periodo {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  const lunes = sumarDias(dia, -((semana + 6) % 7))
  const domingo = sumarDias(lunes, 6)
  const corto = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}`
  return {
    desde: new Date(`${lunes}T00:00:00${OFFSET}`).toISOString(),
    hasta: new Date(`${sumarDias(lunes, 7)}T00:00:00${OFFSET}`).toISOString(),
    etiqueta: `Semana del ${corto(lunes)} al ${corto(domingo)}`,
  }
}

// ── Informe ───────────────────────────────────────────────────────────────

export interface ConversacionInforme {
  id: string
  contacto: string | null
  clienteId: string | null
  cliente: string | null
  asignadoId: string | null
  asignado: string | null
  nueva: boolean
  ultimoMensajeEn: string | null
  motivos: MotivoAtencion[]
  resumen: string | null
  estadoIA: EstadoConversacionIA | null
}

export interface InformeWhatsapp {
  desde: string
  hasta: string
  totales: {
    conversacionesActivas: number
    conversacionesNuevas: number
    mensajesEntrantes: number
    mensajesSalientes: number
    erroresEnvio: number
    sinRespuesta: number
    sinAsignar: number
    pendientesAbiertos: number
    pendientesResueltos: number
    compromisos: number
    compromisosVencidos: number
    decisiones: number
  }
  conversaciones: ConversacionInforme[]
  items: ItemIA[]
  temas: { tema: string; veces: number }[]
  porAsignado: { asignadoId: string | null; asignado: string | null; conversaciones: number }[]
}

export type Agrupacion = 'contacto' | 'cliente' | 'asignado'

export interface GrupoInforme {
  clave: string
  titulo: string
  conversaciones: ConversacionInforme[]
}

/** Las conversaciones del informe agrupadas. Sin cliente o sin asignar es un grupo propio, al final. */
export function agruparConversaciones(cs: readonly ConversacionInforme[], por: Agrupacion): GrupoInforme[] {
  if (por === 'contacto') {
    return cs.map((c) => ({ clave: c.id, titulo: c.contacto ?? 'Sin nombre', conversaciones: [c] }))
  }
  const grupos = new Map<string, GrupoInforme>()
  for (const c of cs) {
    const id = por === 'cliente' ? c.clienteId : c.asignadoId
    const nombre = por === 'cliente' ? c.cliente : c.asignado
    const clave = id ?? '__sin__'
    const titulo = id ? (nombre ?? 'Sin nombre') : por === 'cliente' ? 'Sin cliente vinculado' : 'Sin asignar'
    const g = grupos.get(clave) ?? { clave, titulo, conversaciones: [] }
    g.conversaciones.push(c)
    grupos.set(clave, g)
  }
  return [...grupos.values()].sort((a, b) =>
    a.clave === '__sin__' ? 1 : b.clave === '__sin__' ? -1 : a.titulo.localeCompare(b.titulo, 'es'),
  )
}

/**
 * Los compromisos vencidos: abiertos, con fecha ESCRITA y ya pasada. Sin
 * fecha no hay vencimiento — no se infiere uno.
 */
export function compromisosVencidos(items: readonly ItemIA[], hoy: string): ItemIA[] {
  return items.filter((i) => i.tipo === 'commitment' && i.estado === 'open' && i.venceEn !== null && i.venceEn.slice(0, 10) < hoy)
}
