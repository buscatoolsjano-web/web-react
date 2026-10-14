/**
 * Quién pregunta y con qué empresa. SÓLO servidor (Deno) — Fase 67.
 *
 * Lo usan las DOS puertas: `erp-api/index.ts` (REST, para cualquier cliente
 * HTTP) y `erp-mcp/index.ts` (MCP, para ChatGPT). Está acá y no copiado en
 * cada una porque es la decisión de identidad, y hay una trampa que no se
 * puede permitir que esté bien en un archivo y mal en el otro.
 *
 * ── LA TRAMPA ───────────────────────────────────────────────────────────────
 *
 * La policy de `company_memberships` es
 * `user_id = auth.uid() OR app.is_admin(company_id)`, o sea un administrador
 * VE las membresías de sus compañeros. Apoyarse sólo en la RLS para resolver
 * «su» empresa le devolvería a cualquier admin la fila de otra persona, y
 * entonces las respuestas saldrían con la empresa equivocada sin que nada
 * falle. Por eso las filas se filtran por `user_id` en código, con el id que
 * devolvió `getUser()`, que es el único dato de identidad verificado.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0'
import type { Membresia } from './logica.ts'

export interface Sesion {
  /** El token tal como llegó: el ejecutor lo necesita para que la RLS aplique. */
  token: string
  userId: string
  /** Cómo se llama, para que el agente pueda decir «lo tuyo». */
  quien: string
  correo: string | null
  membresias: Membresia[]
}

export type Apertura =
  | { ok: true; sesion: Sesion }
  | { ok: false; status: number; motivo: string; mensaje: string }

interface FilaMembresia {
  company_id: string
  user_id: string
  role: string
  companies: { name: string | null } | null
}

/** El token del `Authorization`, o cadena vacía si no vino uno usable. */
export function tokenDe(cabecera: string | null): string {
  const c = cabecera ?? ''
  return c.startsWith('Bearer ') ? c.slice(7).trim() : ''
}

export async function abrirSesion(token: string): Promise<Apertura> {
  if (token === '') {
    return { ok: false, status: 401, motivo: 'sin_sesion', mensaje: 'Hay que estar logueado.' }
  }

  const comoElUsuario = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )

  /*
   * Las dos consultas en paralelo: cada llamada del cliente paga esto de
   * nuevo, y en serie son 220 ms de regalo delante de cada herramienta. Se
   * puede porque la de membresías no necesita el id —lo usa después, para
   * filtrar— y porque las dos van con el token de quien pregunta.
   */
  const [{ data: usuario }, { data: filas, error }] = await Promise.all([
    comoElUsuario.auth.getUser(),
    comoElUsuario
      .from('company_memberships')
      .select('company_id, user_id, role, companies ( name )')
      .eq('status', 'active'),
  ])

  const userId = usuario?.user?.id ?? ''
  if (userId === '') {
    return { ok: false, status: 401, motivo: 'sin_sesion', mensaje: 'La sesión no es válida o venció.' }
  }

  if (error) {
    console.error(`sesion: no se pudieron leer las membresías: ${error.message}`)
    return {
      ok: false,
      status: 500,
      motivo: 'interno',
      mensaje: 'No pude leer tus empresas en este momento.',
    }
  }

  // Ver LA TRAMPA, arriba: este filtro no se puede sacar.
  const membresias: Membresia[] = ((filas ?? []) as unknown as FilaMembresia[])
    .filter((f) => f.user_id === userId)
    .map((f) => ({
      companyId: f.company_id,
      nombre: f.companies?.name ?? '(sin nombre)',
      rol: f.role,
    }))

  const meta = (usuario.user.user_metadata ?? {}) as { full_name?: unknown; nombre?: unknown }
  const quien =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.nombre === 'string' && meta.nombre) ||
    usuario.user.email ||
    'alguien de la empresa'

  return {
    ok: true,
    sesion: { token, userId, quien, correo: usuario.user.email ?? null, membresias },
  }
}
