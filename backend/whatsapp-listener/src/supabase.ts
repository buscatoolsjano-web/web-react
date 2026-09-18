import type { Config } from './config.js'
import type { Repositorio, ResultadoDeIngreso } from './repositorio.js'
import type { BorradoObservado, EdicionObservada, GrupoObservado, MensajeObservado } from './tipos.js'

/**
 * El repositorio real, contra Supabase.
 *
 * ⚠️ **TODAVÍA NO FUNCIONA, y es a propósito.** Las RPC que llama no existen:
 * se proponen en `docs/database/PHASE_18_WHATSAPP_INTERNO_E0_PROPUESTA.sql` y
 * no se aplicó ninguna migración en esta entrega. Está escrito para que se vea
 * el camino de escritura completo y para que la migración se revise contra un
 * llamador concreto, no contra una idea.
 *
 * Por qué RPC y no `insert` directo: `whatsapp_messages` y
 * `whatsapp_conversations` sólo tienen policies de SELECT, así que hoy se
 * escribe con `security definer` o con service role. Una RPC deja la validación
 * —cuenta, empresa, allowlist, idempotencia— del lado del servidor, donde no la
 * puede saltear un proceso mal configurado. El webhook oficial ya hace
 * exactamente esto con `registrar_entrante_whatsapp`.
 *
 * Sin dependencias: `fetch` alcanza, igual que en `backend/emails`.
 */
export class RepositorioSupabase implements Repositorio {
  constructor(private readonly config: Config) {}

  private async rpc<T>(nombre: string, cuerpo: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${this.config.supabaseUrl}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
      },
      body: JSON.stringify(cuerpo),
    })
    if (!r.ok) {
      // El cuerpo del error puede traer datos de la fila: no se propaga tal
      // cual, se queda en el código y el estado.
      throw new Error(`${nombre} respondió ${r.status}`)
    }
    return (await r.json()) as T
  }

  async ingresarMensaje(m: MensajeObservado): Promise<ResultadoDeIngreso> {
    const r = await this.rpc<{
      estado: 'guardado' | 'duplicado' | 'cuenta_desconocida' | 'grupo_no_autorizado'
      mensaje_id?: string
      conversacion_id?: string
    }>('ingresar_mensaje_grupo_whatsapp', {
      // La empresa y la cuenta salen de la config, NO del evento.
      p_account: this.config.accountId,
      p_group_id: m.chat.idExterno,
      p_group_name: m.chat.nombre,
      p_provider_message_id: m.idExterno,
      p_sender_wa_id: m.autor.idExterno,
      p_sender_name: m.autor.nombreVisible,
      p_direction: m.sentido === 'saliente' ? 'out' : 'in',
      p_sent_at: m.enviadoEn.toISOString(),
      p_message_type: m.tipoDeMensaje,
      p_text: m.texto,
      p_reply_to: m.respondeA,
      p_media: m.media
        ? {
            tipo: m.media.tipo,
            mime: m.media.mime,
            bytes: m.media.bytes,
            provider_media_id: m.media.idExterno,
            file_name: m.media.nombreArchivo,
          }
        : null,
    })
    if (r.estado === 'guardado') {
      return { estado: 'guardado', mensajeId: r.mensaje_id!, conversacionId: r.conversacion_id! }
    }
    if (r.estado === 'duplicado') return { estado: 'duplicado' }
    // `cuenta_desconocida` y `grupo_no_autorizado` son errores de
    // configuración, no duplicados. Tratarlos como duplicado sería tirar
    // mensajes en silencio hasta que alguien mire la base y no encuentre nada.
    throw new Error(`ingresar_mensaje_grupo_whatsapp: ${r.estado}`)
  }

  async registrarEdicion(e: EdicionObservada): Promise<'aplicada' | 'sin_efecto'> {
    const r = await this.rpc<{ estado: 'aplicada' | 'sin_efecto' }>(
      'editar_mensaje_grupo_whatsapp',
      {
        p_account: this.config.accountId,
        p_provider_message_id: e.idExterno,
        p_text: e.textoNuevo,
        p_edited_at: e.editadoEn.toISOString(),
      },
    )
    return r.estado
  }

  async registrarBorrado(b: BorradoObservado): Promise<'aplicada' | 'sin_efecto'> {
    const r = await this.rpc<{ estado: 'aplicada' | 'sin_efecto' }>(
      'borrar_mensaje_grupo_whatsapp',
      {
        p_account: this.config.accountId,
        p_provider_message_id: b.idExterno,
        p_deleted_by: b.borradoPor,
        p_deleted_at: b.borradoEn.toISOString(),
      },
    )
    return r.estado
  }

  async registrarGrupo(g: GrupoObservado): Promise<void> {
    const r = await this.rpc<{ estado: string }>('registrar_grupo_whatsapp', {
      p_account: this.config.accountId,
      p_group_id: g.idExterno,
      p_group_name: g.nombre,
      p_participantes: g.participantes.map((p) => ({
        wa_id: p.idExterno,
        display_name: p.nombreVisible,
      })),
    })
    if (r.estado !== 'ok') throw new Error(`registrar_grupo_whatsapp: ${r.estado}`)
  }
}
