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
import { elegirEmpresa, perfil } from '../erp-api/logica.ts'
import { abrirSesion, tokenDe } from '../erp-api/sesion.ts'
import {
  desafio,
  metadatosDelRecurso,
  recursoDe,
  PARAMS_MAL,
  resolver,
  respuestaDeHerramienta,
  SUFIJO_META,
  sobre,
  sobreError,
} from './logica.ts'
import { SKILL_MD } from './skill.ts'

/**
 * El SHA-256 del SKILL.md, en el formato que pide el manifiesto.
 *
 * Se calcula UNA vez al arrancar, no por llamada: el contenido es una
 * constante del módulo. OpenAI verifica este digest contra el archivo que
 * después descarga por `resources/read`, así que tiene que salir del mismo
 * texto que se sirve —de ahí que se hashee la constante y no una copia.
 */
async function sha256(texto: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

const DIGEST_SKILL = await sha256(SKILL_MD)

const JSON_CAB = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

const anotar = (datos: Record<string, unknown>) =>
  console.log(JSON.stringify({ fn: 'erp-mcp', ...datos }))

const BASE = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')

/** El 401 que arranca el descubrimiento. */
const sinSesion = (mensaje: string, recurso: string) =>
  new Response(JSON.stringify({ error: 'unauthorized', error_description: mensaje }), {
    status: 401,
    headers: { ...JSON_CAB, 'WWW-Authenticate': desafio(`${recurso}${SUFIJO_META}`) },
  })

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const ruta = url.pathname
  const recurso = recursoDe(BASE, url.pathname)

  // Paso 1: sin sesión, a propósito.
  if (ruta.endsWith(SUFIJO_META)) {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'metodo_no_permitido' }), {
        status: 405,
        headers: JSON_CAB,
      })
    }
    return new Response(JSON.stringify(metadatosDelRecurso(recurso, BASE)), {
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
  if (token === '') return sinSesion('Conectá tu cuenta del ERP.', recurso)

  const apertura = await abrirSesion(token)
  if (!apertura.ok) {
    if (apertura.status === 401) return sinSesion(apertura.mensaje, recurso)
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

  /**
   * Qué método pidieron. UNA línea por petición.
   *
   * No es ruido: Supabase registra el método HTTP y el status, pero no el
   * cuerpo, y en MCP todo es `POST /` con 200. Sin esto, un «no se encontraron
   * herramientas» se ve en los logs exactamente igual que una conexión
   * perfecta —tres POST con 200— y no hay por dónde empezar.
   *
   * Se registran el método y la versión del protocolo, nunca los argumentos:
   * un `tools/call` lleva nombres de clientes y precios adentro.
   */
  const metodo = typeof peticion['method'] === 'string' ? peticion['method'] : '(sin método)'
  const params = (
    typeof peticion['params'] === 'object' && peticion['params'] !== null ? peticion['params'] : {}
  ) as Record<string, unknown>
  anotar({
    rpc: metodo,
    ...(metodo === 'initialize'
      ? {
          pidioVersion: String(params['protocolVersion'] ?? ''),
          cliente: String((params['clientInfo'] as { name?: unknown })?.name ?? ''),
        }
      : {}),
    ...(metodo === 'tools/call' ? { herramienta: String(params['name'] ?? '') } : {}),
  })

  const resuelto = resolver(peticion, { digestDelMd: DIGEST_SKILL })

  /*
   * Una notificación se acepta y no se contesta: 202 sin cuerpo. Mandarle una
   * respuesta JSON-RPC a algo que no trae `id` es un error de protocolo.
   */
  if (resuelto.clase === 'nada') return new Response(null, { status: 202 })

  if (resuelto.clase === 'resultado') {
    const cuerpo = JSON.stringify(sobre(resuelto.id, resuelto.resultado))
    // Cuántas herramientas salieron de verdad: es el número que hay que poder
    // comparar contra el que muestra ChatGPT cuando dice que no encontró nada.
    anotar({
      rpc: metodo,
      contesto: 'resultado',
      bytes: cuerpo.length,
      ...(metodo === 'tools/list'
        ? { herramientas: (resuelto.resultado['tools'] as unknown[] | undefined)?.length ?? 0 }
        : {}),
      ...(metodo === 'initialize'
        ? { doyVersion: String(resuelto.resultado['protocolVersion'] ?? '') }
        : {}),
    })
    return new Response(cuerpo, { status: 200, headers: JSON_CAB })
  }
  if (resuelto.clase === 'error') {
    // Un método que no conocemos sale con 200 y un error JSON-RPC adentro, así
    // que en los logs de Supabase es indistinguible de una respuesta buena.
    // Acá sí se ve: si el cliente prueba `resources/list` o `prompts/list` y se
    // va, este renglón es la explicación.
    anotar({ rpc: metodo, contesto: 'error', codigo: resuelto.codigo })
    return new Response(
      JSON.stringify(sobreError(resuelto.id, resuelto.codigo, resuelto.mensaje)),
      { status: 200, headers: JSON_CAB },
    )
  }

  /*
   * El perfil se contesta con la sesión, sin tocar la base.
   *
   * Va como texto JSON igual que el resto de las herramientas, para que el
   * modelo lo lea de la misma forma en todos los casos.
   */
  if (resuelto.clase === 'perfil') {
    const { quien, correo, membresias } = apertura.sesion
    const datos = perfil({ quien, correo, membresias })
    anotar({ herramienta: 'quien_soy', usuario: apertura.sesion.userId })
    return new Response(
      JSON.stringify(respuestaDeHerramienta(resuelto.id, JSON.stringify(datos))),
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
