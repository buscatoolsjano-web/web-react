import { decidirEvento } from './politica.js'
import type { Politica } from './politica.js'
import type { Repositorio } from './repositorio.js'
import { ocultarId, sanearError, type Registro } from './registro.js'
import type { Evento, MotivoDeDescarte } from './tipos.js'

/**
 * El corazón del listener: qué hacer con cada evento que llega.
 *
 * Es deliberadamente aburrido —decidir, guardar, contar— y no habla con la red
 * ni con OpenAI. **El listener no llama a la IA**: guarda el mensaje y el
 * trigger que ya existe encola el análisis, con el mismo debounce, los mismos
 * topes de costo y el mismo worker que la Fase 16. Si el listener llamara al
 * modelo, habría dos caminos al gasto y sólo uno con límites.
 */

export interface Contadores {
  guardados: number
  duplicados: number
  descartados: Record<MotivoDeDescarte, number>
  ediciones: number
  borrados: number
  gruposVistos: number
  errores: number
}

export function contadoresVacios(): Contadores {
  return {
    guardados: 0,
    duplicados: 0,
    descartados: {
      listener_apagado: 0,
      chat_directo: 0,
      grupo_no_autorizado: 0,
      sin_texto_ni_media: 0,
      duplicado: 0,
    },
    ediciones: 0,
    borrados: 0,
    gruposVistos: 0,
    errores: 0,
  }
}

export class Ingesta {
  readonly contadores = contadoresVacios()

  constructor(
    private readonly repositorio: Repositorio,
    private readonly politica: () => Politica,
    private readonly registro: Registro,
  ) {}

  async procesar(evento: Evento): Promise<void> {
    const decision = decidirEvento(this.politica(), evento)
    if (!decision.admitido) {
      this.contadores.descartados[decision.motivo] += 1
      // Se registra el motivo y el chat ofuscado. Nunca el texto: un mensaje
      // descartado por no estar autorizado es justo el que no hay que loguear.
      this.registro.evento('info', 'evento_descartado', {
        motivo: decision.motivo,
        clase: evento.clase,
      })
      return
    }

    try {
      await this.aplicar(evento)
    } catch (e) {
      this.contadores.errores += 1
      this.registro.evento('error', 'ingesta_fallida', {
        clase: evento.clase,
        detalle: sanearError(e),
      })
    }
  }

  private async aplicar(evento: Evento): Promise<void> {
    switch (evento.clase) {
      case 'mensaje': {
        const r = await this.repositorio.ingresarMensaje(evento.datos)
        if (r.estado === 'duplicado') {
          this.contadores.duplicados += 1
          this.registro.evento('info', 'mensaje_duplicado', {
            chat: ocultarId(evento.datos.chat.idExterno),
          })
          return
        }
        this.contadores.guardados += 1
        this.registro.evento('info', 'mensaje_guardado', {
          chat: ocultarId(evento.datos.chat.idExterno),
          tipo: evento.datos.tipoDeMensaje,
          conMedia: evento.datos.media !== null,
          esRespuesta: evento.datos.respondeA !== null,
        })
        return
      }
      case 'edicion': {
        const r = await this.repositorio.registrarEdicion(evento.datos)
        if (r === 'aplicada') this.contadores.ediciones += 1
        this.registro.evento('info', 'edicion', { resultado: r })
        return
      }
      case 'borrado': {
        const r = await this.repositorio.registrarBorrado(evento.datos)
        if (r === 'aplicada') this.contadores.borrados += 1
        this.registro.evento('info', 'borrado', { resultado: r })
        return
      }
      case 'grupo': {
        await this.repositorio.registrarGrupo(evento.datos)
        this.contadores.gruposVistos += 1
        this.registro.evento('info', 'grupo_actualizado', {
          chat: ocultarId(evento.datos.idExterno),
          participantes: evento.datos.participantes.length,
        })
        return
      }
    }
  }
}
