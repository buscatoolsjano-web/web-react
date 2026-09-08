import { z } from 'zod'

/**
 * Variables de entorno del frontend.
 *
 * AMBAS SON PÚBLICAS por diseño: viajan al navegador en el bundle. La
 * seguridad real la da Row Level Security en Supabase, no el ocultamiento
 * de estas claves (ese fue justamente el error del sistema legacy).
 *
 * Prohibido agregar acá cualquier secreto real (service_role, API keys de
 * IA, tokens administrativos). Eso va en Edge Functions. Ver ADR-004.
 */
export const EnvSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .url('VITE_SUPABASE_URL debe ser una URL válida'),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'VITE_SUPABASE_ANON_KEY parece incompleta'),
})

export type Env = z.infer<typeof EnvSchema>

/**
 * Valida el entorno y falla RUIDOSAMENTE con un mensaje accionable.
 *
 * Función pura: no lee import.meta.env por su cuenta.
 *
 * Preferimos un error claro acá antes que un 401 críptico en la primera
 * query, que es lo más caro de diagnosticar.
 */
export function parseEnv(raw: unknown): Env {
  const result = EnvSchema.safeParse(raw)

  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n')

    throw new Error(
      `Configuración de entorno inválida.\n${detalle}\n\n` +
        'Copiá .env.example a .env y completá los valores. ' +
        'En CI, verificá los secrets del repositorio.',
    )
  }

  return result.data
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
