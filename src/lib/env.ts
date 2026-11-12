/**
 * Variables de entorno del frontend.
 *
 * AMBAS SON PÚBLICAS por diseño: viajan al navegador en el bundle. La
 * seguridad real la da Row Level Security en Supabase, no el ocultamiento
 * de estas claves (ese fue justamente el error del sistema legacy).
 *
 * Prohibido agregar acá cualquier secreto real (service_role, API keys de
 * IA, tokens administrativos). Eso va en Edge Functions. Ver ADR-004.
 *
 * Se valida a mano, sin zod: este archivo se carga en el arranque de la app y
 * zod sumaba 74 kB (21 kB comprimidos) a la primera descarga sólo para mirar
 * tres variables. Nada más del frontend lo usaba.
 */
export interface Env {
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_ANON_KEY: string
  // El servicio público de la bandeja de Emails (Cloud Run). Es una URL, no un
  // secreto: la autorización la da el JWT de cada persona. Opcional para que un
  // entorno sin Emails siga arrancando; la bandeja lo avisa en vez de romper.
  VITE_EMAILS_API_URL?: string
}

function esUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    new URL(v)
    return true
  } catch {
    return false
  }
}

/**
 * Valida el entorno y falla RUIDOSAMENTE con un mensaje accionable.
 *
 * Función pura: no lee import.meta.env por su cuenta.
 *
 * Preferimos un error claro acá antes que un 401 críptico en la primera
 * query, que es lo más caro de diagnosticar.
 */
export function parseEnv(raw: unknown): Env {
  const r = (raw ?? {}) as Record<string, unknown>
  const errores: string[] = []

  const url = r.VITE_SUPABASE_URL
  if (!esUrl(url)) errores.push('VITE_SUPABASE_URL: VITE_SUPABASE_URL debe ser una URL válida')

  const clave = r.VITE_SUPABASE_ANON_KEY
  if (typeof clave !== 'string' || clave.length < 20) {
    errores.push('VITE_SUPABASE_ANON_KEY: VITE_SUPABASE_ANON_KEY parece incompleta')
  }

  // Vacío cuenta como ausente. Sin esto, un `VITE_EMAILS_API_URL=` en un .env
  // —o un secret de CI que quedó en blanco— rompería el arranque entero por
  // una función opcional. Degradar la bandeja es la respuesta correcta;
  // ladrillar el login no.
  const correo = r.VITE_EMAILS_API_URL === '' ? undefined : r.VITE_EMAILS_API_URL
  if (correo !== undefined && !esUrl(correo)) {
    errores.push('VITE_EMAILS_API_URL: VITE_EMAILS_API_URL debe ser una URL válida')
  }

  if (errores.length) {
    throw new Error(
      `Configuración de entorno inválida.\n${errores.map((e) => `  · ${e}`).join('\n')}\n\n` +
        'Copiá .env.example a .env y completá los valores. ' +
        'En CI, verificá los secrets del repositorio.',
    )
  }

  const env: Env = { VITE_SUPABASE_URL: url as string, VITE_SUPABASE_ANON_KEY: clave as string }
  if (correo !== undefined) env.VITE_EMAILS_API_URL = correo as string
  return env
}

let cache: Env | null = null

/**
 * Entorno validado de la aplicación.
 *
 * Se valida en la primera llamada — que ocurre al crear el cliente
 * Supabase, o sea al arrancar la app.
 *
 * Es una función y no una constante de módulo a propósito: así importar
 * este archivo no tiene efectos secundarios, y `parseEnv` se puede testear
 * sin depender de que exista un .env.
 */
export function getEnv(): Env {
  cache ??= parseEnv(import.meta.env)
  return cache
}
