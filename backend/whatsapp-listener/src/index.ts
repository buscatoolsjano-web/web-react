import qr from 'qrcode-terminal'
import { leerConfig, configParaLog, ConfigInvalida, type Config } from './config.js'
import { Listener } from './listener.js'
import type { Politica } from './politica.js'
import { registroDeConsola } from './registro.js'
import { RepositorioEnMemoria } from './repositorio.js'
import type { Repositorio } from './repositorio.js'
import { servidorDeSalud } from './salud.js'
import { RepositorioSupabase } from './supabase.js'
import { TransporteMock } from './transporte.js'
import type { Transporte } from './transporte.js'
import { TransporteBaileys } from './transporteBaileys.js'

/**
 * El proceso.
 *
 * Arranca con el transporte que diga `WHATSAPP_TRANSPORTE`:
 *
 * - `mock` (el default) — no se conecta a nada. Sirve para ver la config, el
 *   healthcheck y el apagado limpio sin tocar ningún teléfono.
 * - `baileys` — se conecta de verdad. La primera vez imprime un QR **en esta
 *   terminal y en ningún otro lado**: no se guarda, no se manda a ninguna API
 *   y no vuelve a aparecer en los logs.
 *
 * Con `--grupos` no escucha: se conecta, lista los grupos de los que la cuenta
 * es miembro —**sólo id y nombre, sin una línea de contenido**— y se va. Es
 * para poder elegir cuál autorizar.
 */

function politicaDesdeEntorno(config: Config, entorno = process.env): Politica {
  const crudo = (entorno['WHATSAPP_GROUPS_ALLOWLIST'] ?? '').trim()
  const ids = crudo === '' ? [] : crudo.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    listenerHabilitado: config.listenerHabilitado,
    grupos: ids.map((idExterno) => ({ idExterno, habilitado: true, iaHabilitada: false })),
  }
}

/**
 * El QR, en la terminal y nada más.
 *
 * Se dibuja con `qrcode-terminal` en vez de loguear la cadena: una cadena de
 * QR en un log es una sesión regalada a quien lea el log. Y se dibuja con
 * `console.log` directo, no con el registro, justo para que NO quede guardado
 * en ningún lado.
 */
function mostrarQr(cadena: string): void {
  console.log('\n  Escaneá este QR desde WhatsApp Business (Dispositivos vinculados).')
  console.log('  Caduca en unos segundos: si se borra, aparece uno nuevo solo.\n')
  qr.generate(cadena, { small: true })
  console.log('\n  AUTH_REQUIRED — esperando el escaneo…\n')
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

  const usaBaileys = (process.env['WHATSAPP_TRANSPORTE'] ?? 'mock').trim() === 'baileys'
  const usaSupabase = (process.env['WHATSAPP_REPOSITORIO'] ?? 'memoria').trim() === 'supabase'
  const soloGrupos = process.argv.includes('--grupos')

  const politica = politicaDesdeEntorno(config)
  registroDeConsola.evento('info', 'arrancando', {
    ...configParaLog(config),
    gruposAutorizados: politica.grupos.length,
    transporte: usaBaileys ? 'baileys' : 'mock',
    repositorio: usaSupabase ? 'supabase' : 'memoria',
  })

  if (!config.listenerHabilitado) {
    // No es un error: es el estado normal mientras nadie lo encendió. El
    // proceso igual queda vivo para que el healthcheck tenga a quién preguntar,
    // y para poder vincular el teléfono antes de encender la ingesta.
    registroDeConsola.evento('aviso', 'listener_apagado', { detalle: 'LISTENER_ENABLED != true' })
  }

  const baileys = usaBaileys
    ? new TransporteBaileys({
        rutaDeSesion: config.rutaDeSesion,
        registro: registroDeConsola,
        alPedirQr: mostrarQr,
      })
    : null
  const transporte: Transporte = baileys ?? new TransporteMock()
  const repositorio: Repositorio = usaSupabase
    ? new RepositorioSupabase(config)
    : new RepositorioEnMemoria()

  const listener = new Listener(transporte, repositorio, () => politica, registroDeConsola)

  const desde = new Date().toISOString()
  const salud = servidorDeSalud(config.puertoDeSalud, () => ({
    estado: listener.estado(),
    desde,
    ultimoEvento: listener.ultimoEvento,
    gruposActivos: politica.grupos.filter((g) => g.habilitado).length,
    contadores: listener.contadores,
    motivo: listener.motivo,
    cuenta: baileys?.cuenta ?? null,
  }))

  await listener.iniciar()

  if (soloGrupos) {
    // Descubrimiento: id y nombre, nada más. No autoriza a nadie.
    const grupos = (await baileys?.listarGrupos()) ?? []
    console.log(`\n  ${grupos.length} grupo(s) con esta cuenta:\n`)
    for (const g of grupos) console.log(`    ${g.idExterno}  ${g.nombre ?? '(sin nombre)'}`)
    console.log('\n  Ninguno está autorizado por estar en esta lista.\n')
    salud.close()
    await listener.detener()
    return
  }

  const cerrar = (senal: string) => {
    void (async () => {
      registroDeConsola.evento('info', 'cerrando', { senal })
      salud.close()
      await listener.detener()
      process.exit(0)
    })()
  }
  process.on('SIGINT', () => cerrar('SIGINT'))
  process.on('SIGTERM', () => cerrar('SIGTERM'))
}

void principal()
