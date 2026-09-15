/**
 * Cliente de SÓLO LECTURA para la API de STEL Order (Fase 14 · E1).
 *
 * Contrato (especificación pública `app.stelorder.com/app/api/openapi.json` y
 * las Edge Functions `stel-daily-sync` / `stel-products-scan` del legacy):
 *   · base `https://app.stelorder.com/app`, autenticación con el header `APIKEY`;
 *   · listados con `limit` + `start` (paginación por desplazamiento) y `sort`;
 *   · fechas ISO 8601 `yyyy-MM-dd'T'HH:mm:ssZ` (con sólo la fecha, error E000003);
 *   · cupo: 60 llamadas/minuto y 300/1000/2000 por día según el plan, COMPARTIDO
 *     con el escenario de Make que usa la misma clave.
 *
 * Seguridad:
 *   · la clave se lee de `.env.stel.local` (ignorado por git) o de la variable
 *     de entorno; nunca se imprime, nunca va en la URL (sólo en el header) y
 *     cualquier texto de error se limpia antes de mostrarlo;
 *   · sólo GET: no existe método para escribir en STEL;
 *   · la cache va a `.stel-cache/` (ignorada), sin la clave.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://app.stelorder.com/app'
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
export const CACHE_DIR = path.join(RAIZ, '.stel-cache')

/** Pausa mínima entre llamadas: 60/min con margen. */
const PAUSA_MS = 1250
const TIMEOUT_MS = 45_000
const REINTENTOS = 3

let clave = null
function leerClave() {
  if (clave) return clave
  const archivo = path.join(RAIZ, '.env.stel.local')
  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = linea.match(/^\s*STEL_API_KEY\s*=\s*(.*)\s*$/)
      if (m) clave = m[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  if (!clave && process.env.STEL_API_KEY) clave = process.env.STEL_API_KEY.trim()
  if (!clave) throw new Error('Falta STEL_API_KEY (.env.stel.local o entorno). No se muestra ningún valor.')
  return clave
}

/** Quita la clave de cualquier texto antes de mostrarlo o guardarlo. */
export function limpiar(texto) {
  let t = String(texto ?? '')
  if (clave) t = t.split(clave).join('[REDACTADO]')
  return t.replace(/APIKEY[=:]\s*\S+/gi, 'APIKEY=[REDACTADO]')
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

export function crearCliente({ maxLlamadas = 150, usarCache = true, log = console.log } = {}) {
  let llamadas = 0
  let ultima = 0
  const registro = []

  async function get(ruta, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    const id = `${ruta}?${qs.toString()}`
    const archivoCache = path.join(CACHE_DIR, createHash('sha1').update(id).digest('hex') + '.json')
    if (usarCache && fs.existsSync(archivoCache)) {
      return JSON.parse(fs.readFileSync(archivoCache, 'utf8')).datos
    }
    if (llamadas >= maxLlamadas) throw new Error(`Presupuesto de llamadas agotado (${maxLlamadas}); no se llama a ${ruta}`)

    for (let intento = 1; ; intento++) {
      const espera = ultima + PAUSA_MS - Date.now()
      if (espera > 0) await esperar(espera)
      ultima = Date.now()
      llamadas++
      const t0 = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      let res
      try {
        res = await fetch(`${BASE}/${ruta}${qs.size ? '?' + qs : ''}`, {
          method: 'GET',
          headers: { APIKEY: leerClave(), Accept: 'application/json' },
          signal: ctrl.signal,
        })
      } catch (e) {
        clearTimeout(timer)
        if (intento < REINTENTOS) { await esperar(2000 * 2 ** intento); continue }
        throw new Error(`STEL ${ruta}: ${limpiar(e.name === 'AbortError' ? 'timeout' : e.message)}`)
      }
      clearTimeout(timer)
      const ms = Date.now() - t0
      if (res.status === 429 || res.status >= 500) {
        registro.push({ ruta, estado: res.status, ms })
        log(`  · STEL ${ruta} → HTTP ${res.status} (${ms} ms), intento ${intento}/${REINTENTOS}`)
        if (intento < REINTENTOS) { await esperar(res.status === 429 ? 61_000 : 3000 * 2 ** intento); continue }
      }
      if (!res.ok) {
        const cuerpo = limpiar((await res.text().catch(() => '')).slice(0, 200))
        registro.push({ ruta, estado: res.status, ms })
        throw new Error(`STEL ${ruta} → HTTP ${res.status}: ${cuerpo}`)
      }
      const datos = await res.json()
      const n = Array.isArray(datos) ? datos.length : 1
      registro.push({ ruta, params: { ...params }, estado: res.status, ms, n })
      log(`  · STEL ${ruta} ${params.start ? `start=${params.start} ` : ''}→ ${n} (${ms} ms)`)
      if (usarCache) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(archivoCache, JSON.stringify({ id, datos }))
      }
      return datos
    }
  }

  /** Listado completo por páginas de `limite`, con tope de páginas. */
  async function todos(ruta, params = {}, { limite = 200, maxPaginas = 50 } = {}) {
    const out = []
    for (let p = 0; p < maxPaginas; p++) {
      const pagina = await get(ruta, { ...params, limit: limite, start: p * limite })
      const arr = Array.isArray(pagina) ? pagina : []
      out.push(...arr)
      if (arr.length < limite) return out
    }
    throw new Error(`STEL ${ruta}: más de ${maxPaginas} páginas; subir el tope a propósito`)
  }

  return { get, todos, llamadas: () => llamadas, registro }
}

/** Fecha en el formato que exige STEL. */
export const fechaStel = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, '+0000')
