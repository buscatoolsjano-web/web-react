import { createClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

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
 * FASE 1: sin tipos de base de datos todavía. En Fase 2, cuando exista el
 * schema, se genera src/types/database.types.ts y este cliente pasa a ser
 * createClient<Database>(...), con lo que todas las queries quedan tipadas.
 */
const env = getEnv()

export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
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
