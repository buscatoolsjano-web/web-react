import { sanearError, type Registro } from './registro.js'

/**
 * El logger que se le pasa a Baileys.
 *
 * Existe por una sola razón, y es de privacidad: **la librería loguea el
 * contenido de los mensajes** en `debug` y `trace`, y su logger por defecto
 * (pino) escribe a stdout. Sin esto, el primer arranque contra un grupo real
 * deja la conversación entera en la consola y después en el archivo de logs
 * del servidor, sin permisos y sin que nadie lo audite.
 *
 * Así que `trace`, `debug` e `info` **se tiran**. De `warn` y `error` se
 * conserva únicamente el texto del mensaje, saneado, y **nunca el objeto**:
 * ese objeto es el que trae el nodo del protocolo con el contenido adentro.
 */
export function registroParaBaileys(registro: Registro): {
  level: string
  child(): ReturnType<typeof registroParaBaileys>
  trace(): void
  debug(): void
  info(): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
} {
  const nada = () => {}
  const contar = (nivel: 'aviso' | 'error') => (obj: unknown, msg?: string) => {
    // El primer argumento se descarta SIEMPRE. Si no hay texto, se usa el
    // error saneado, que ya viene sin números largos ni tokens.
    registro.evento(nivel, 'baileys', { detalle: sanearError(msg ?? obj) })
  }

  const propio = {
    level: 'warn',
    child: () => propio,
    trace: nada,
    debug: nada,
    info: nada,
    warn: contar('aviso'),
    error: contar('error'),
  }
  return propio
}
