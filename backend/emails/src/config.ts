/**
 * Configuración del backend de Emails.
 *
 * Todo sale del entorno. Nada se hardcodea, y **ninguna credencial de Google
 * vive acá**: la identidad la da la service account adjunta al servicio de
 * Cloud Run, vía el metadata server.
 */

/** Falla al arrancar, no en el primer request. */
function requerida(nombre: string): string {
  const v = process.env[nombre]
  if (!v || !v.trim()) {
    throw new Error(`Falta la variable de entorno ${nombre}`)
  }
  return v.trim()
}

/**
 * Buzones que este backend puede impersonar.
 *
 * Existe como SEGUNDA barrera, y hace falta aunque `email_accounts` ya diga qué
 * buzón es cuál. La primera barrera es que el `sub` nunca viene del request: se
 * resuelve server-side desde la base. Ésta cubre el caso en que alguien logre
 * escribir una fila en `email_accounts` con otra dirección del dominio —
 * comprometer la base no debe alcanzar para leer correo ajeno.
 *
 * Por eso vive en la configuración del servicio y no en la base.
 */
export function buzonesPermitidos(): ReadonlySet<string> {
  const crudo = requerida('ALLOWED_GMAIL_MAILBOXES')
  const lista = crudo
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  if (lista.length === 0) {
    throw new Error('ALLOWED_GMAIL_MAILBOXES está vacía')
  }
  return new Set(lista)
}

export interface Config {
  readonly proyectoGoogle: string
  readonly serviceAccount: string
  readonly scopeGmail: string
  readonly topicPubsub: string
  /** La SA con la que Pub/Sub firma el OIDC del push. */
  readonly pubsubPushSa: string
  /** El `aud` que tiene que traer ese OIDC. */
  readonly pubsubAudience: string
  /** La SA con la que Cloud Scheduler invoca la renovación del watch. */
  readonly schedulerSa: string
  readonly supabaseUrl: string
  readonly supabaseServiceKey: string
  readonly buzones: ReadonlySet<string>
}

export function leerConfig(): Config {
  return {
    proyectoGoogle: requerida('GOOGLE_PROJECT_ID'),
    serviceAccount: requerida('GMAIL_SERVICE_ACCOUNT_EMAIL'),
    // Fijo a propósito. `https://mail.google.com/` no se pide nunca: lo único
    // que agrega es el borrado permanente.
    scopeGmail: 'https://www.googleapis.com/auth/gmail.modify',
    topicPubsub: requerida('GMAIL_PUBSUB_TOPIC'),
    pubsubPushSa: requerida('PUBSUB_PUSH_SA_EMAIL'),
    pubsubAudience: requerida('PUBSUB_PUSH_AUDIENCE'),
    schedulerSa: requerida('SCHEDULER_SA_EMAIL'),
    supabaseUrl: requerida('SUPABASE_URL'),
    supabaseServiceKey: requerida('SUPABASE_SERVICE_KEY'),
    buzones: buzonesPermitidos(),
  }
}

/**
 * ¿Puede este backend impersonar esta dirección?
 *
 * Se compara en minúsculas y sin espacios: una diferencia de mayúsculas no
 * debería abrir ni cerrar un buzón.
 */
export function buzonPermitido(buzones: ReadonlySet<string>, direccion: string | null | undefined): boolean {
  if (!direccion) return false
  return buzones.has(direccion.trim().toLowerCase())
}
