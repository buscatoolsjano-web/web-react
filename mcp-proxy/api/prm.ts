/**
 * Los metadatos del recurso protegido (RFC 9728) del MCP del ERP (Fase 229).
 *
 * Es lo primero que pide Grok: quién autoriza el acceso a `https://<host>/mcp`.
 * El `resource` es la URL pública de ESTE dominio —la que pegó la persona en el
 * conector— y quien autoriza es el Auth de Supabase, el mismo que usa ChatGPT.
 * Mismo contenido que `metadatosDelRecurso` de `erp-mcp/logica.ts`.
 */
export const config = { runtime: 'edge' }

const SUPABASE = 'https://jiudqbusyknubonpedde.supabase.co'

export default function handler(req: Request): Response {
  const origen = new URL(req.url).origin
  return new Response(
    JSON.stringify({
      resource: `${origen}/mcp`,
      authorization_servers: [`${SUPABASE}/auth/v1`],
      bearer_methods_supported: ['header'],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
