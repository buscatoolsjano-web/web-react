/**
 * Registrar una visita del sitio público (Fase 115).
 *
 * Igual que `cotizar-publico`: la tabla `web_page_views` no tiene policy de
 * insert para nadie, así que la única forma de escribir es esta función, que
 * corre con la clave de servicio. NO se le cree la empresa a quien llama —la
 * decide la base, con el interruptor `catalogo_publico`—; sólo se guardan la
 * ruta, un identificador anónimo de visitante (uuid que el navegador guarda en
 * localStorage) y el referrer. Sin datos personales.
 *
 * Responde 204 siempre que la entrada sea razonable: un beacon que falla no
 * puede ensuciar la consola del visitante ni frenar la página.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, max)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: CORS })

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = await req.json()
  } catch {
    return new Response(null, { status: 204, headers: CORS })
  }

  const path = texto(cuerpo.path, 300)
  if (!path) return new Response(null, { status: 204, headers: CORS })
  const visitorId = texto(cuerpo.visitor_id, 64)
  const referrer = texto(cuerpo.referrer, 300)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // La empresa la decide la base: la que tiene el catálogo público prendido.
  const { data: empresa } = await sb
    .from('companies')
    .select('id')
    .eq('catalogo_publico', true)
    .limit(1)
    .maybeSingle()
  if (!empresa) return new Response(null, { status: 204, headers: CORS })

  await sb.from('web_page_views').insert({
    company_id: empresa.id,
    path,
    visitor_id: visitorId,
    referrer,
  })

  return new Response(null, { status: 204, headers: CORS })
})
