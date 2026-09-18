import { Listener } from '../listener.js'
import type { Politica } from '../politica.js'
import { RegistroEnMemoria } from '../registro.js'
import { RepositorioEnMemoria } from '../repositorio.js'
import { TransporteMock } from '../transporte.js'
import type { BorradoObservado, EdicionObservada, Evento, MensajeObservado } from '../tipos.js'

/**
 * El armado de un escenario de prueba: un grupo, tres personas y una cuenta que
 * escucha. Nada de esto toca la red, WhatsApp ni Supabase.
 */

export const GRUPO_AUTORIZADO = '120363000000000001@g.us'
export const GRUPO_AJENO = '120363000000000099@g.us'

export const JUAN = { idExterno: '5491111111111@s.whatsapp.net', nombreVisible: 'Juan' }
export const JANO = { idExterno: '5492222222222@s.whatsapp.net', nombreVisible: 'Jano' }
export const FACUNDO = { idExterno: '5493333333333@s.whatsapp.net', nombreVisible: 'Facundo' }

export function politica(cambios: Partial<Politica> = {}): Politica {
  return {
    listenerHabilitado: true,
    grupos: [{ idExterno: GRUPO_AUTORIZADO, habilitado: true, iaHabilitada: true }],
    ...cambios,
  }
}

let n = 0

export function mensaje(cambios: Partial<MensajeObservado> = {}): MensajeObservado {
  n += 1
  return {
    idExterno: `WAMSG-${n}`,
    chat: { idExterno: GRUPO_AUTORIZADO, tipo: 'grupo', nombre: 'Importaciones' },
    autor: JUAN,
    sentido: 'entrante',
    enviadoEn: new Date('2026-09-18T12:00:00Z'),
    tipoDeMensaje: 'texto',
    texto: 'un mensaje',
    respondeA: null,
    media: null,
    ...cambios,
  }
}

export function edicion(cambios: Partial<EdicionObservada> = {}): EdicionObservada {
  return {
    idExterno: 'WAMSG-1',
    chat: { idExterno: GRUPO_AUTORIZADO, tipo: 'grupo' },
    textoNuevo: 'corregido',
    editadoEn: new Date('2026-09-18T12:05:00Z'),
    ...cambios,
  }
}

export function borrado(cambios: Partial<BorradoObservado> = {}): BorradoObservado {
  return {
    idExterno: 'WAMSG-1',
    chat: { idExterno: GRUPO_AUTORIZADO, tipo: 'grupo' },
    borradoPor: JUAN.idExterno,
    borradoEn: new Date('2026-09-18T12:06:00Z'),
    ...cambios,
  }
}

export interface Escenario {
  listener: Listener
  transporte: TransporteMock
  repositorio: RepositorioEnMemoria
  registro: RegistroEnMemoria
  /** Empuja un evento y espera a que termine de procesarse. */
  emitir(evento: Evento): Promise<void>
  /** Atajo para el caso más común. */
  emitirMensaje(m: MensajeObservado): Promise<void>
}

export async function montar(p: Politica = politica()): Promise<Escenario> {
  const transporte = new TransporteMock()
  const repositorio = new RepositorioEnMemoria()
  const registro = new RegistroEnMemoria()
  // `dormir` instantáneo: los tests no esperan el backoff de verdad.
  const listener = new Listener(transporte, repositorio, () => p, registro, () => Promise.resolve())
  await listener.iniciar()

  return {
    listener,
    transporte,
    repositorio,
    registro,
    emitir: (evento) => transporte.emitir(evento),
    emitirMensaje: (m) => transporte.emitir({ clase: 'mensaje', datos: m }),
  }
}
