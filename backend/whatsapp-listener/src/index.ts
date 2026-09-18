import { leerConfig, configParaLog, ConfigInvalida, type Config } from './config.js'
import { Listener } from './listener.js'
import type { Politica } from './politica.js'
import { registroDeConsola } from './registro.js'
import { RepositorioEnMemoria } from './repositorio.js'
import { servidorDeSalud } from './salud.js'
import { TransporteMock } from './transporte.js'

/**
 * El proceso.
 *
 * ⚠️ **En esta entrega arranca con el transporte de mentira.** No hay ninguna
 * conexión a WhatsApp, no se escanea ningún QR y no se toca el número
 * +54 9 11 2186-6133. Sirve para tener el proceso completo —config, salud,
 * apagado limpio— andando y medido antes de que exista una cuenta descartable
 * con la cual probar Baileys de verdad.
 *
 * El día que exista, lo único que cambia es la línea del transporte: el resto
 * del archivo queda igual. Ese es el punto de haber puesto la frontera ahí.
 */

/**
 * La allowlist, por ahora del entorno.
 *
 * En la entrega siguiente sale de `whatsapp_group_allowlist` y se refresca
 * sola, para poder habilitar un grupo sin reiniciar el proceso. Se deja acá
 * como variable porque la tabla todavía no existe: la migración se propone en
 * `docs/database/PHASE_18_WHATSAPP_INTERNO_E0_PROPUESTA.sql` y **no se aplicó**.
 *
 * Formato: `WHATSAPP_GROUPS_ALLOWLIST=1203...@g.us,1203...@g.us`
 */
function politicaDesdeEntorno(config: Config, entorno = process.env): Politica {
  const crudo = (entorno['WHATSAPP_GROUPS_ALLOWLIST'] ?? '').trim()
  const ids = crudo === '' ? [] : crudo.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    listenerHabilitado: config.listenerHabilitado,
    grupos: ids.map((idExterno) => ({ idExterno, habilitado: true, iaHabilitada: false })),
  }
}

async function principal(): Promise<void> {
  let config: Config
  try {
    config = leerConfig()
  } catch (e) {
    if (e instanceof ConfigInvalida) {
      registroDeConsola.evento('error', 'config_invalida', { faltantes: e.faltantes.join(',') })
      process.exitCode = 1
      return
    }
    throw e
  }

  const politica = politicaDesdeEntorno(config)
  registroDeConsola.evento('info', 'arrancando', {
    ...configParaLog(config),
    gruposAutorizados: politica.grupos.length,
    transporte: 'mock',
  })

  if (!config.listenerHabilitado) {
    // No es un error: es el estado normal mientras nadie lo encendió. El
    // proceso igual queda vivo para que el healthcheck tenga a quién preguntar.
    registroDeConsola.evento('aviso', 'listener_apagado', { detalle: 'LISTENER_ENABLED != true' })
  }

  const transporte = new TransporteMock()
  // El repositorio real es `RepositorioSupabase`, y todavía no se puede usar:
  // las RPC que llama no existen. Hasta entonces, en memoria.
  const repositorio = new RepositorioEnMemoria()
  const listener = new Listener(transporte, repositorio, () => politica, registroDeConsola)

  const desde = new Date().toISOString()
  const salud = servidorDeSalud(config.puertoDeSalud, () => ({
    estado: listener.estado(),
    desde,
    ultimoEvento: listener.ultimoEvento,
    gruposActivos: politica.grupos.filter((g) => g.habilitado).length,
    contadores: listener.contadores,
  }))

  await listener.iniciar()

  const cerrar = (senal: string) => {
    void (async () => {
      registroDeConsola.evento('info', 'cerrando', { senal })
      salud.close()
      await listener.detener()
    })()
  }
  process.on('SIGINT', () => cerrar('SIGINT'))
  process.on('SIGTERM', () => cerrar('SIGTERM'))
}

void principal()
