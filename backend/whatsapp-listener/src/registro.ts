/**
 * Los logs de un sistema que escucha conversaciones internas.
 *
 * La regla es una sola y no tiene excepciones: **por el log no sale contenido**.
 * Ni el texto, ni el número completo, ni el nombre del grupo, ni el QR, ni la
 * sesión, ni un pedazo de media. Lo que sale es qué pasó, con qué frecuencia y
 * cuánto tardó.
 *
 * Un log con el texto de los mensajes es una segunda copia de la conversación,
 * sin permisos, en un archivo que nadie audita.
 */

export type Nivel = 'info' | 'aviso' | 'error'

/** `120363...@g.us` → `g:120363…a1b2`. Sirve para correlacionar, no para leer. */
export function ocultarId(id: string): string {
  if (id.length <= 8) return 'id:****'
  return `id:${id.slice(0, 4)}…${id.slice(-4)}`
}

/**
 * Un error, sin su payload.
 *
 * Los errores de una librería no oficial suelen traer el mensaje crudo del
 * protocolo adentro. Se corta a 200 caracteres y se le sacan las cosas con
 * forma de identificador o de clave.
 */
export function sanearError(e: unknown): string {
  const crudo = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return crudo
    .replace(/\b\d{7,}\b/g, '<numero>')
    .replace(/[A-Za-z0-9_-]{24,}/g, '<token>')
    .slice(0, 200)
}

export interface Registro {
  evento(nivel: Nivel, tipo: string, datos?: Record<string, string | number | boolean>): void
}

function serializar(datos: Record<string, string | number | boolean>): string {
  return Object.entries(datos)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ')
}

export const registroDeConsola: Registro = {
  evento(nivel, tipo, datos = {}) {
    const linea = `[${new Date().toISOString()}] ${nivel} ${tipo} ${serializar(datos)}`.trimEnd()
    if (nivel === 'error') console.error(linea)
    else console.log(linea)
  },
}

/** Para los tests: guarda lo que se registró y no ensucia la salida. */
export class RegistroEnMemoria implements Registro {
  readonly lineas: { nivel: Nivel; tipo: string; datos: Record<string, unknown> }[] = []

  evento(nivel: Nivel, tipo: string, datos: Record<string, string | number | boolean> = {}): void {
    this.lineas.push({ nivel, tipo, datos })
  }

  /** Todo lo registrado, en un solo texto: sirve para buscar filtraciones. */
  get texto(): string {
    return this.lineas.map((l) => `${l.tipo} ${serializar(l.datos as never)}`).join('\n')
  }
}
