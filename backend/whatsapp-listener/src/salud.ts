import { createServer, type Server } from 'node:http'
import type { Contadores } from './ingesta.js'
import type { EstadoDeConexion } from './tipos.js'

/**
 * `GET /health`.
 *
 * Contesta en qué anda la conexión y cuánto ingirió. **No expone credenciales,
 * ni el número, ni nombres de grupos, ni contenido**: quien monitorea necesita
 * saber si el proceso está vivo y vinculado, no qué se dijo.
 */

export interface Salud {
  estado: EstadoDeConexion
  desde: string
  ultimoEvento: string | null
  gruposActivos: number
  contadores: Contadores
  /** Por qué se cortó la última vez. Saneado: nunca trae número ni token. */
  motivo?: string | null
  /** La cuenta vinculada, OFUSCADA. Para saber que es la que tiene que ser. */
  cuenta?: string | null
}

export function cuerpoDeSalud(s: Salud): string {
  return JSON.stringify(s, null, 2)
}

export function servidorDeSalud(puerto: number, leer: () => Salud): Server {
  const servidor = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/health') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end('{"error":"no encontrado"}')
      return
    }
    const salud = leer()
    // 200 si está conectado, 503 si no: un healthcheck que siempre contesta 200
    // no sirve para reiniciar nada.
    const codigo = salud.estado === 'conectado' || salud.estado === 'apagado' ? 200 : 503
    res.writeHead(codigo, { 'Content-Type': 'application/json' })
    res.end(cuerpoDeSalud(salud))
  })
  servidor.listen(puerto)
  return servidor
}
