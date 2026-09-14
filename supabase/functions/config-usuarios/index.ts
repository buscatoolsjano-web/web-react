/**
 * config-usuarios — invitaciones de Configuración → Usuarios.
 *
 * Es lo único que necesita la clave de servicio: crear o invitar una cuenta de
 * Supabase Auth. Todo lo demás (listar, cambiar rol, suspender) son RPC con el
 * JWT del admin.
 *
 *   POST { accion: 'invitar',  company_id, email, nombre?, rol }
 *   POST { accion: 'reenviar', membership_id }
 *
 * Orden de cada pedido:
 *   1. JWT verificado (gateway con verify_jwt + auth.getUser acá);
 *   2. cuerpo validado, sin campos extra;
 *   3. la BASE valida que el actor sea admin activo de la empresa y el rol
 *      (config_validar_invitacion / config_preparar_reenvio);
 *   4. invitación oficial de Supabase Auth (inviteUserByEmail);
 *   5. membresía + bitácora en una sola función de la base.
 *
 * Nunca devuelve la clave, el enlace de invitación, tokens ni el texto crudo
 * de un error. La clave de servicio la inyecta la plataforma
 * (SUPABASE_SERVICE_ROLE_KEY): no está en el repositorio ni en el frontend.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  ORIGENES_PERMITIDOS,
  clasificarErrorAuth,
  codigoDeErrorBase,
  decidirInvitacion,
  destinoEnlace,
  statusDe,
  validarPedido,
  type EstadoIdentidad,
} from './logica.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CLAVE_SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(URL_BASE, CLAVE_SERVICIO, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function cors(origen: string | null): Record<string, string> {
  if (!origen || !(ORIGENES_PERMITIDOS as readonly string[]).includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function responder(origen: string | null, status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors(origen), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function errorDeBase(origen: string | null, e: { message?: string } | null): Response {
  const codigo = codigoDeErrorBase(e?.message)
  if (codigo) return responder(origen, statusDe(codigo), { error: codigo })
  console.error('config-usuarios: error de base', e?.message ?? 'desconocido')
  return responder(origen, 500, { error: 'error_interno' })
}

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 'Access-Control-Allow-Origin' in cors(origen) ? 204 : 403, headers: cors(origen) })
  }
  if (req.method !== 'POST') return responder(origen, 405, { error: 'metodo_no_permitido' })

  // 1 · Identidad
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return responder(origen, 401, { error: 'sesion_invalida' })
  const { data: quien, error: eQuien } = await admin.auth.getUser(jwt)
  if (eQuien || !quien.user) return responder(origen, 401, { error: 'sesion_invalida' })
  const actor = quien.user.id

  // 2 · Cuerpo
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return responder(origen, 400, { error: 'datos_invalidos' })
  }
  const pedido = validarPedido(cuerpo)
  if ('error' in pedido) return responder(origen, statusDe(pedido.error), pedido)

  const redirectTo = destinoEnlace(origen)

  // ── Reenviar ───────────────────────────────────────────────────────────────
  if (pedido.accion === 'reenviar') {
    const { data, error } = await admin.rpc('config_preparar_reenvio', { p_actor: actor, p_membership: pedido.membershipId })
    if (error) return errorDeBase(origen, error)
    const email = (data as { email: string }[] | null)?.[0]?.email
    if (!email) return responder(origen, 403, { error: 'sin_permiso' })

    const { error: eInv } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (eInv) {
      const c = clasificarErrorAuth(eInv)
      console.error('config-usuarios: reenvío fallido', c.error)
      return responder(origen, c.status, { error: c.error })
    }
    const { error: eAud } = await admin.rpc('config_auditar_reenvio', { p_actor: actor, p_membership: pedido.membershipId })
    if (eAud) console.error('config-usuarios: bitácora de reenvío', eAud.message)
    return responder(origen, 200, { resultado: 'reenviada', membership_id: pedido.membershipId, email_enviado: true })
  }

  // ── Invitar ────────────────────────────────────────────────────────────────
  const { data: filas, error: eVal } = await admin.rpc('config_validar_invitacion', {
    p_actor: actor,
    p_company: pedido.companyId,
    p_email: pedido.email,
    p_rol: pedido.rol,
  })
  if (eVal) return errorDeBase(origen, eVal)

  const decision = decidirInvitacion((filas ?? []) as EstadoIdentidad[])
  if (decision.tipo === 'conflicto') return responder(origen, statusDe(decision.error), { error: decision.error })

  if (decision.tipo === 'crear_e_invitar') {
    const { data: inv, error: eInv } = await admin.auth.admin.inviteUserByEmail(pedido.email, {
      redirectTo,
      data: pedido.nombre ? { full_name: pedido.nombre } : {},
    })
    if (eInv || !inv.user) {
      const c = clasificarErrorAuth(eInv)
      console.error('config-usuarios: invitación fallida', c.error)
      return responder(origen, c.status, { error: c.error })
    }
    const { data: mid, error: eReg } = await admin.rpc('config_registrar_miembro', {
      p_actor: actor,
      p_company: pedido.companyId,
      p_user: inv.user.id,
      p_rol: pedido.rol,
      p_nombre: pedido.nombre,
      p_evento: 'USER_INVITED',
    })
    // La cuenta quedó creada y el correo salió: si la membresía falla, repetir
    // la invitación la encuentra y sólo agrega la membresía.
    if (eReg) return errorDeBase(origen, eReg)
    return responder(origen, 200, { resultado: 'invitado', membership_id: mid, email_enviado: true })
  }

  // Cuenta existente: membresía primero; el correo sólo si todavía no confirmó.
  const { data: mid, error: eReg } = await admin.rpc('config_registrar_miembro', {
    p_actor: actor,
    p_company: pedido.companyId,
    p_user: decision.userId,
    p_rol: pedido.rol,
    p_nombre: null,
    p_evento: 'MEMBERSHIP_ADDED',
  })
  if (eReg) return errorDeBase(origen, eReg)

  if (!decision.enviarInvitacion) {
    return responder(origen, 200, { resultado: 'agregado_existente', membership_id: mid, email_enviado: false })
  }
  const { error: eInv } = await admin.auth.admin.inviteUserByEmail(pedido.email, { redirectTo })
  if (eInv) {
    const c = clasificarErrorAuth(eInv)
    console.error('config-usuarios: invitación a cuenta sin confirmar fallida', c.error)
    return responder(origen, 200, { resultado: 'agregado_pendiente', membership_id: mid, email_enviado: false, error_envio: c.error })
  }
  return responder(origen, 200, { resultado: 'agregado_pendiente', membership_id: mid, email_enviado: true })
})
