import {
  CARPETAS_BANDEJA,
  ESTADOS_TRABAJO,
  FILTROS_INICIALES,
  type CarpetaBandeja,
  type EstadoTrabajo,
  type FiltrosEmails,
} from '../types'

/**
 * Los filtros de la bandeja viven en la URL, como en el resto de los módulos:
 * un listado filtrado es un link, y «atrás» deshace el filtro.
 */

export const TAMANOS_BANDEJA = [25, 50, 100] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function entero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function estado(v: string | null): EstadoTrabajo | null {
  return (ESTADOS_TRABAJO as readonly string[]).includes(v ?? '') ? (v as EstadoTrabajo) : null
}

/** Una carpeta inventada en la URL cae en «Todos», que no esconde nada. */
function carpeta(v: string | null): CarpetaBandeja {
  return (CARPETAS_BANDEJA as readonly string[]).includes(v ?? '') ? (v as CarpetaBandeja) : 'todos'
}

export function leerFiltros(p: URLSearchParams): FiltrosEmails {
  const asignado = p.get('asignado')
  const cliente = p.get('cliente')
  const cuenta = p.get('cuenta')
  const etiqueta = p.get('etiqueta')
  const porPagina = entero(p.get('per'), FILTROS_INICIALES.porPagina)
  return {
    q: (p.get('q') ?? '').slice(0, 200),
    soloNoLeidos: p.get('noleidos') === '1',
    estado: estado(p.get('estado')),
    // Un valor que no es `yo`, `nadie` ni un uuid se ignora: no llega al servidor.
    asignado:
      asignado === 'yo' || asignado === 'nadie' || (asignado && UUID.test(asignado)) ? asignado : null,
    cliente: cliente === 'con' || cliente === 'sin' ? cliente : null,
    soloConAdjuntos: p.get('adjuntos') === '1',
    cuenta: cuenta && UUID.test(cuenta) ? cuenta : null,
    carpeta: carpeta(p.get('carpeta')),
    // Una etiqueta inventada se ignora: no llega al servidor.
    etiqueta: etiqueta && UUID.test(etiqueta) ? etiqueta : null,
    pagina: entero(p.get('page'), 1),
    porPagina: (TAMANOS_BANDEJA as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_INICIALES.porPagina,
  }
}

export function escribirFiltros(f: FiltrosEmails): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.soloNoLeidos) p.set('noleidos', '1')
  if (f.estado) p.set('estado', f.estado)
  if (f.asignado) p.set('asignado', f.asignado)
  if (f.cliente) p.set('cliente', f.cliente)
  if (f.soloConAdjuntos) p.set('adjuntos', '1')
  if (f.cuenta) p.set('cuenta', f.cuenta)
  if (f.carpeta !== 'todos') p.set('carpeta', f.carpeta)
  if (f.etiqueta) p.set('etiqueta', f.etiqueta)
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  return p
}

/**
 * La carpeta NO cuenta como filtro: es dónde estás parado, no qué recortaste.
 * Si contara, «Limpiar filtros» te sacaría de Enviados sin avisar.
 */
export function hayFiltrosActivos(f: FiltrosEmails): boolean {
  return (
    f.q.trim() !== '' ||
    f.soloNoLeidos ||
    f.estado !== null ||
    f.asignado !== null ||
    f.cliente !== null ||
    f.soloConAdjuntos ||
    f.etiqueta !== null ||
    f.cuenta !== null
  )
}

/**
 * ¿Un cambio de estado, asignación o vínculo puede sacar una fila de esta vista?
 * Si sí, no alcanza con parchear la fila: hay que volver a pedir la página.
 */
export function dependeDelTrabajo(f: FiltrosEmails): boolean {
  return f.estado !== null || f.asignado !== null || f.cliente !== null || f.q.trim() !== ''
}
