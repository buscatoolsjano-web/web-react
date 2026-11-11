/**
 * La puerta del MCP del ERP en un dominio propio (Fase 229).
 *
 * El servidor de verdad es la Edge Function `erp-mcp` de Supabase. Anda con
 * ChatGPT, pero Grok no puede iniciar sesión: arranca el descubrimiento de
 * OAuth pidiendo los metadatos del recurso en la RAÍZ del dominio
 * (`https://<host>/.well-known/oauth-protected-resource/<path>`, RFC 9728), y
 * en `*.supabase.co` esa raíz es del gateway de Supabase, que contesta 401
 * «No API key». Ahí Grok abandona. No hay forma de servir esa ruta desde una
 * función de Supabase.
 *
 * Esto pone el MCP en un dominio donde la raíz SÍ es nuestra:
 *   · `/.well-known/oauth-protected-resource[/mcp]` → `prm.ts`.
 *   · `/mcp` → acá: se reenvía TAL CUAL a la función (cuerpo, Authorization,
 *     Accept, la respuesta SSE en streaming). Lo único que se toca es el
 *     `WWW-Authenticate` del 401, para que apunte a los metadatos de ESTE
 *     dominio: el recurso que el cliente valida tiene que ser la URL a la que
 *     se conectó.
 *
 * La autenticación no cambia: el token lo emite el Auth de Supabase y lo valida
 * la función (`abrirSesion`) contra él; la RLS filtra igual que siempre.
 */
export const config = { runtime: 'edge' }

const SUPABASE = 'https://jiudqbusyknubonpedde.supabase.co'
const FUNCION = `${SUPABASE}/functions/v1/erp-mcp`

/** Cabeceras que no se reenvían: las arma de nuevo cada salto. */
const SALTO = ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding']

export default async function handler(req: Request): Promise<Response> {
  const origen = new URL(req.url).origin
  const metadatos = `${origen}/.well-known/oauth-protected-resource/mcp`

  const cabeceras = new Headers(req.headers)
  for (const c of SALTO) cabeceras.delete(c)
  for (const c of [...cabeceras.keys()]) if (c.startsWith('x-vercel') || c.startsWith('x-forwarded')) cabeceras.delete(c)

  const conCuerpo = req.method !== 'GET' && req.method !== 'HEAD'
  const r = await fetch(FUNCION, {
    method: req.method,
    headers: cabeceras,
    body: conCuerpo ? await req.arrayBuffer() : undefined,
    redirect: 'manual',
  })

  const salida = new Headers(r.headers)
  // `fetch` ya descomprimió el cuerpo: no puede seguir declarando gzip/br.
  salida.delete('content-encoding')
  salida.delete('content-length')
  const desafio = salida.get('www-authenticate')
  if (desafio) {
    salida.set(
      'www-authenticate',
      desafio.replace(/resource_metadata="[^"]*"/, `resource_metadata="${metadatos}"`),
    )
  }
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: salida })
}
