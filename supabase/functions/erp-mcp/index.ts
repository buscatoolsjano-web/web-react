/**
 * El servidor MCP del ERP: la frontera con el mundo (Fase 67 · E4).
 *
 * Habla MCP sobre HTTP para que una app de ChatGPT —o cualquier otro cliente
 * MCP— pueda usar las herramientas del ERP. Lo que se decide sin HTTP vive en
 * `logica.ts`, que corre en vitest; la identidad, en `../erp-api/sesion.ts`,
 * compartida con la puerta REST.
 *
 * ── El orden de una llamada ─────────────────────────────────────────────────
 *
 *  1. `GET …/.well-known/oauth-protected-resource` → sin sesión, dice quién
 *     autoriza. Es el primer paso del descubrimiento.
 *  2. `POST …/` sin token → 401 con `WWW-Authenticate`, que contiene la URL
 *     del punto 1. **Sin esa cabecera el cliente no sabe a dónde ir.**
 *  3. `POST …/` con token → se abre la sesión, se resuelve la empresa y se
 *     despacha el JSON-RPC. `tools/call` termina en el ejecutor del asistente.
 *
 * ── Por qué va sin el `verify_jwt` del gateway ──────────────────────────────
 *
 * Porque los pasos 1 y 2 tienen que salir de ACÁ. Con el gateway delante, el
 * 401 lo contesta él, sin la cabecera, y el descubrimiento no arranca nunca;
 * y el documento del paso 1 tampoco sería legible sin sesión, que es
 * justamente cuando hace falta leerlo.
 *
 * Eso NO afloja la autenticación: la validación real la hace `abrirSesion()`,
 * que le pregunta al servidor de auth por el token y después deja que la RLS
 * filtre. Es la misma postura de `whatsapp-webhook` y `whatsapp-ai-worker`,
 * que también se autentican solas.
 */
import { crearEjecutor } from '../asistente/ejecutor.ts'
import { elegirEmpresa } from '../erp-api/logica.ts'
import { abrirSesion, tokenDe } from '../erp-api/sesion.ts'
import {
  desafio,
  metadatosDelRecurso,
  PARAMS_MAL,
  resolver,
  respuestaDeHerramienta,
  sobre,
  sobreError,
} from './logica.ts'

const JSON_CAB = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

const anotar = (datos: Record<string, unknown>) =>
  console.log(JSON.stringify({ fn: 'erp-mcp', ...datos }))

const BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
/** La URI canónica de este servidor: lo que un token tiene que venir a usar. */
const RECURSO = `${BASE}/functions/v1/erp-mcp`
/**
 * Dónde servimos los metadatos del recurso.
 *
 * La forma canónica de RFC 9728 insertaría el path después del `.well-known`
 * —`/.well-known/oauth-protected-resource/functions/v1/erp-mcp`—, y eso cae
 * FUERA de esta función: no lo podemos servir. No importa, porque el cliente
 * tiene que usar la URL que le damos en `WWW-Authenticate` y ésa es ésta. Si
 * algún cliente la adivinara en vez de leerla, no la encontraría.
 */
const META = `${RECURSO}/.well-known/oauth-protected-resource`

/** El 401 que arranca el descubrimiento. */
const sinSesion = (mensaje: string) =>
  new Response(JSON.stringify({ error: 'unauthorized', error_description: mensaje }), {
    status: 401,
    headers: { ...JSON_CAB, 'WWW-Authenticate': desafio(META) },
  })

Deno.serve(async (req: Request): Promise<Response> => {
  const ruta = new URL(req.url).pathname

  // Paso 1: sin sesión, a propósito.
  if (ruta.endsWith('/.well-known/oauth-protected-resource')) {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'metodo_no_permitido' }), {
        status: 405,
        headers: JSON_CAB,
      })
    }
    return new Response(JSON.stringify(metadatosDelRecurso(RECURSO, BASE)), {
      status: 200,
      // Éste SÍ se puede cachear: cambia cuando cambia el proyecto, o sea nunca.
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
    })
  }

  /*
   * No abrimos un canal de eventos.
   *
   * Este servidor no manda nada por su cuenta: no tiene suscripciones ni
   * progreso. El protocolo permite contestar 405 al GET, y eso es más honesto
   * que mantener abierta una conexión por la que nunca va a viajar nada.
   */
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ error: 'sin_stream' }), { status: 405, headers: JSON_CAB })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'metodo_no_permitido' }), {
      status: 405,
      headers: JSON_CAB,
    })
  }

  /**
   * Sesión para TODO, incluido `initialize`.
   *
   * El 401 con `WWW-Authenticate` ante cualquier petición es el primer paso
   * del flujo del protocolo, no un caso de error: el cliente lo recibe, lee la
   * URL de los metadatos, descubre el servidor de autorización y vuelve con un
   * token.
   *
   * La alternativa era dejar `initialize` y `tools/list` abiertos para que
   * ChatGPT pudiera escanear las herramientas al configurar la app. No hace
   * falta: la documentación dice que primero completa la autorización y
   * después escanea. Y la lista de herramientas, con sus descripciones, cuenta
   * bastante de cómo opera la empresa: no hay razón para regalarla.
   */
  const token = tokenDe(req.headers.get('Authorization'))
  if (token === '') return sinSesion('Conectá tu cuenta del ERP.')

  const apertura = await abrirSesion(token)
  if (!apertura.ok) {
    if (apertura.status === 401) return sinSesion(apertura.mensaje)
    return new Response(JSON.stringify(sobreError(null, -32603, apertura.mensaje)), {
      status: 200,
      headers: JSON_CAB,
    })
  }

  let peticion: Record<string, unknown>
  try {
    const crudo: unknown = await req.json()
    if (typeof crudo !== 'object' || crudo === null) throw new Error('no es objeto')
    peticion = crudo as Record<string, unknown>
  } catch {
    return new Response(JSON.stringify(sobreError(null, -32700, 'El cuerpo no es JSON.')), {
      status: 200,
      headers: JSON_CAB,
    })
  }

  const resuelto = resolver(peticion)

  /*
   * Una notificación se acepta y no se contesta: 202 sin cuerpo. Mandarle una
   * respuesta JSON-RPC a algo que no trae `id` es un error de protocolo.
   */
  if (resuelto.clase === 'nada') return new Response(null, { status: 202 })

  if (resuelto.clase === 'resultado') {
    return new Response(JSON.stringify(sobre(resuelto.id, resuelto.resultado)), {
      status: 200,
      headers: JSON_CAB,
    })
  }
  if (resuelto.clase === 'error') {
    return new Response(
      JSON.stringify(sobreError(resuelto.id, resuelto.codigo, resuelto.mensaje)),
      { status: 200, headers: JSON_CAB },
    )
  }

  // Desde acá es `tools/call`.
  const { empresa: pedida, ...argumentos } = resuelto.argumentos
  const elegida = elegirEmpresa(
    apertura.sesion.membresias,
    typeof pedida === 'string' ? pedida : undefined,
  )
  if (!elegida.ok) {
    return new Response(JSON.stringify(sobreError(resuelto.id, PARAMS_MAL, elegida.mensaje)), {
      status: 200,
      headers: JSON_CAB,
    })
  }

  const ejecutar = crearEjecutor({
    token: apertura.sesion.token,
    companyId: elegida.empresa.companyId,
    userId: apertura.sesion.userId,
  })

  const empezo = Date.now()
  const texto = await ejecutar(resuelto.nombre, argumentos)
  anotar({
    herramienta: resuelto.nombre,
    usuario: apertura.sesion.userId,
    empresa: elegida.empresa.nombre,
    ms: Date.now() - empezo,
    bytes: texto.length,
  })

  return new Response(JSON.stringify(respuestaDeHerramienta(resuelto.id, texto)), {
    status: 200,
    headers: JSON_CAB,
  })
})
