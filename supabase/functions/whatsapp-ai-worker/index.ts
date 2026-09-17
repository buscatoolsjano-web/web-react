/**
 * whatsapp-ai-worker — análisis automático de la cola (Fase 16 · E3).
 *
 *   POST {}   header x-worker-token
 *
 * Lo llama pg_cron (vía pg_net) cada 2 minutos, y SÓLO si hay trabajos listos.
 * No lo llama el navegador ni el webhook.
 *
 * Sin verify_jwt: pg_cron no tiene un JWT. Lo protege el token interno que vive
 * en Vault; se valida preguntándole a la base (comparación de hashes), así el
 * token no existe en ningún secret de Edge Function ni en el repo.
 *
 * Responde 202 enseguida y procesa el lote en segundo plano (waitUntil): pg_net
 * corta a los 5 segundos y un análisis tarda más.
 *
 * Lo que se registra: conteos por resultado. Ni texto de mensajes, ni ids de
 * conversación, ni el token, ni la clave del proveedor.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { proveedorConfigurado } from '../whatsapp-ai-analyze/proveedor.ts'
import { procesarLote } from './lote.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(URL_BASE, CLAVE_SERVICIO, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const proveedor = proveedorConfigurado()

// Un lote a la vez por instancia: si el cron dispara mientras el anterior
// sigue, este no reclama más (la base igual impediría tomar lo mismo).
let ocupado = false

const responder = (status: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

Deno.serve(async (req) => {
  if (req.method !== 'POST') return responder(405, { error: 'metodo_no_permitido' })

  const token = req.headers.get('x-worker-token')
  if (!token || token.length > 200) return responder(401, { error: 'no_autorizado' })
  const { data: valido, error } = await admin.rpc('validar_token_worker_ia_whatsapp', { p_token: token })
  if (error || valido !== true) return responder(401, { error: 'no_autorizado' })

  if (ocupado) return responder(202, { aceptado: false, motivo: 'lote_en_curso' })
  ocupado = true

  const trabajo = procesarLote({ admin, proveedor, worker: `edge:${crypto.randomUUID().slice(0, 8)}` })
    .then((r) => {
      console.log(JSON.stringify({
        fn: 'whatsapp-ai-worker', proveedor: proveedor.nombre, reclamados: r.reclamados,
        llamadas: r.llamadasProveedor, lock_perdido: r.lockPerdido, resultados: r.resultados,
      }))
    })
    .catch(() => {
      console.log(JSON.stringify({ fn: 'whatsapp-ai-worker', evento: 'lote_fallido' }))
    })
    .finally(() => { ocupado = false })

  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(trabajo)
  else await trabajo

  return responder(202, { aceptado: true })
})
