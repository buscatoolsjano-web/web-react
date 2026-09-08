import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'

/**
 * ÚNICA instancia del cliente Supabase de toda la aplicación.
 *
 * Reglas (ADR-003), verificadas por ESLint:
 *  1. Nadie más llama a createClient().
 *  2. Los componentes NO importan este módulo. Solo lo hace la capa
 *     services/ (y features/auth/, que es la capa de sesión).
 *  3. Cero service_role en el frontend.
 *  4. La sesión la maneja el SDK — nunca localStorage a mano.
 *
 * FASE 3: el cliente está tipado con el schema real. Cualquier columna que
 * no exista, o cualquier tabla mal escrita, ahora falla en `npm run
 * typecheck` en vez de devolver un 400 en runtime.
 */
const env = getEnv()

export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'bt-auth',
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-client-info': 'buscatools-web-react' },
  },
})
