/**
 * config-empresa-logo — subir, reemplazar o quitar el logo de una empresa.
 *
 *   POST multipart/form-data
 *     accion=subir     company_id, version (updated_at de la empresa), archivo
 *     accion=eliminar  company_id, version
 *
 * Orden:
 *   1. JWT verificado (gateway con verify_jwt + auth.getUser);
 *   2. campos del formulario en lista blanca;
 *   3. la BASE valida admin activo y versión (config_empresa_logo_precheck);
 *   4. el archivo se valida por sus BYTES (PNG, JPEG o WEBP; SVG no), tamaño y
 *      coincidencia con el tipo declarado. El nombre del archivo se ignora;
 *   5. se sube con la clave de servicio a una ruta controlada
 *      `<company_id>/logo-<epoch ms>.<ext>` (sin upsert);
 *   6. la base registra la ruta con concurrencia optimista y deja bitácora
 *      (config_empresa_logo_registrar); si falla, se borra lo recién subido;
 *   7. se borra el logo anterior: queda un solo archivo por empresa.
 *
 * Los bytes no se procesan ni se re-codifican: se guardan tal cual y se sirven
 * como imagen con su tipo real. No devuelve URLs, tokens ni texto crudo.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  BUCKET,
  ORIGENES_PERMITIDOS,
  TAMANO_MAXIMO,
  codigoDeErrorBase,
  rutaLogo,
  statusDe,
  validarArchivo,
  validarCampos,
} from './logica.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
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
  console.error('config-empresa-logo: error de base')
  return responder(origen, 500, { error: 'error_interno' })
}

Deno.serve(async (req) => {
  const origen = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 'Access-Control-Allow-Origin' in cors(origen) ? 204 : 403, headers: cors(origen) })
  }
  if (req.method !== 'POST') return responder(origen, 405, { error: 'metodo_no_permitido' })

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return responder(origen, 401, { error: 'sesion_invalida' })
  const { data: quien, error: eQuien } = await admin.auth.getUser(jwt)
  if (eQuien || !quien.user) return responder(origen, 401, { error: 'sesion_invalida' })
  const actor = quien.user.id

  // Tope antes de leer el cuerpo: 2 MB de imagen + margen del multipart.
  const largo = Number(req.headers.get('Content-Length') ?? '0')
  if (largo > TAMANO_MAXIMO + 64 * 1024) return responder(origen, 413, { error: 'archivo_grande' })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return responder(origen, 400, { error: 'datos_invalidos' })
  }
  const claves = [...form.keys()]
  const texto = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : null
  }
  const pedido = validarCampos(
    { accion: texto('accion'), company_id: texto('company_id'), version: texto('version') },
    claves,
  )
  if ('error' in pedido) return responder(origen, statusDe(pedido.error), pedido)

  const { data: anterior, error: ePre } = await admin.rpc('config_empresa_logo_precheck', {
    p_actor: actor,
    p_company: pedido.companyId,
    p_esperado: pedido.version,
  })
  if (ePre) return errorDeBase(origen, ePre)

  let rutaNueva: string | null = null
  if (pedido.accion === 'subir') {
    const archivo = form.get('archivo')
    if (!(archivo instanceof File)) return responder(origen, 400, { error: 'datos_invalidos', campo: 'archivo' })
    if (archivo.size > TAMANO_MAXIMO) return responder(origen, 413, { error: 'archivo_grande' })
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const v = validarArchivo(bytes, archivo.type)
    if ('error' in v) return responder(origen, statusDe(v.error), { error: v.error })

    rutaNueva = rutaLogo(pedido.companyId, v.tipo, Date.now())
    const { error: eUp } = await admin.storage.from(BUCKET).upload(rutaNueva, bytes, {
      contentType: v.tipo,
      cacheControl: '3600',
      upsert: false,
    })
    if (eUp) {
      console.error('config-empresa-logo: subida fallida')
      return responder(origen, 502, { error: 'subida_fallida' })
    }
  } else if (!anterior) {
    return responder(origen, 409, { error: 'sin_logo' })
  }

  const { data: reg, error: eReg } = await admin.rpc('config_empresa_logo_registrar', {
    p_actor: actor,
    p_company: pedido.companyId,
    p_esperado: pedido.version,
    p_path: rutaNueva,
  })
  if (eReg) {
    if (rutaNueva) await admin.storage.from(BUCKET).remove([rutaNueva])
    return errorDeBase(origen, eReg)
  }
  const fila = (reg as { updated_at: string; logo_anterior: string | null; logo_path: string | null }[])[0]

  // Queda un solo archivo por empresa. Si el borrado falla, el logo nuevo ya
  // está registrado: el viejo queda huérfano pero sin referencia.
  if (fila?.logo_anterior && fila.logo_anterior !== rutaNueva) {
    const { error: eRm } = await admin.storage.from(BUCKET).remove([fila.logo_anterior])
    if (eRm) console.error('config-empresa-logo: no se pudo borrar el logo anterior')
  }

  return responder(origen, 200, {
    resultado: pedido.accion === 'subir' ? 'logo_actualizado' : 'logo_eliminado',
    logo_path: fila?.logo_path ?? null,
    version: fila?.updated_at ?? null,
  })
})
