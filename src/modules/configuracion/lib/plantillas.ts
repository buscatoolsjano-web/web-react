/**
 * Plantillas de correo (Fase 41 · E2) — la parte que decide, sin pantalla.
 *
 * Dos clases que se combinan al enviar:
 *
 *   envoltorio · el marco de la empresa. Encabezado, pie, y DOS huecos.
 *   firma      · quién manda. Una por persona, y puede tener varias.
 *
 * El dueño sale de `usuarioId`: `null` es de la empresa, con valor es de esa
 * persona. Mismo criterio que la tabla, para no tener dos formas de decirlo.
 */

export type ClasePlantilla = 'envoltorio' | 'firma'

export interface Plantilla {
  id: string
  /** `null` = de la empresa. Con valor = de esa persona. */
  usuarioId: string | null
  clase: ClasePlantilla
  nombre: string
  contenido: string
  esDefault: boolean
  activa: boolean
}

/**
 * Los marcadores de DATO, que el servidor reemplaza por la ficha de quien manda.
 *
 * Esta lista es para la pantalla: se muestran como botones para insertar y
 * sirven para avisar de uno mal escrito. **No es el que manda** —quien resuelve
 * es `app.plantilla_resolver` en la base— así que agregar uno acá sin agregarlo
 * allá no hace nada, y es a propósito que se note: el que resuelve es uno solo.
 */
export const MARCADORES = [
  { clave: 'usuario.nombre', etiqueta: 'Nombre de quien manda' },
  { clave: 'usuario.puesto', etiqueta: 'Su puesto' },
  { clave: 'usuario.telefono', etiqueta: 'Su teléfono' },
  { clave: 'empresa.nombre', etiqueta: 'Nombre de la empresa' },
  { clave: 'empresa.legal', etiqueta: 'Razón social' },
  { clave: 'empresa.telefono', etiqueta: 'Teléfono de la empresa' },
  { clave: 'empresa.email', etiqueta: 'Email de la empresa' },
  { clave: 'empresa.web', etiqueta: 'Sitio web' },
  { clave: 'empresa.direccion', etiqueta: 'Dirección' },
  { clave: 'empresa.color', etiqueta: 'Color de marca' },
] as const

/**
 * Los HUECOS, que no son datos: son dónde entra lo que se escribe.
 *
 * Hay UNO solo, y la ausencia del otro tiene historia. Hubo un `{{firma}}`, y
 * está mal: la firma se edita en el composer y viaja DENTRO del mensaje, así
 * que un hueco de firma en el envoltorio la pondría una segunda vez. Peor: el
 * envío sólo rellena `{{cuerpo}}`, así que el `{{firma}}` se fue literal al
 * mail de un cliente antes de que alguien lo notara.
 */
export const HUECOS = [{ clave: 'cuerpo', etiqueta: 'El mensaje', obligatorio: true }] as const

const CLAVES_DATO: readonly string[] = MARCADORES.map((m) => m.clave)
const CLAVES_HUECO: readonly string[] = HUECOS.map((h) => h.clave)

/** Todo `{{...}}` que aparezca en un texto, en orden y sin repetir. */
export function marcadoresUsados(contenido: string): string[] {
  const vistos = new Set<string>()
  for (const m of contenido.matchAll(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g)) {
    const clave = m[1]
    if (clave) vistos.add(clave)
  }
  return [...vistos]
}

export interface Problema {
  /** `error` impide guardar; `aviso` se puede guardar igual. */
  gravedad: 'error' | 'aviso'
  texto: string
}

/**
 * Qué está mal en una plantilla, antes de guardarla.
 *
 * La diferencia entre error y aviso no es de tono: un error deja la plantilla
 * inservible —un envoltorio sin `{{cuerpo}}` se traga el mensaje— y un aviso es
 * algo que puede ser a propósito.
 */
export function revisar(clase: ClasePlantilla, nombre: string, contenido: string): Problema[] {
  const problemas: Problema[] = []
  if (nombre.trim() === '') problemas.push({ gravedad: 'error', texto: 'Poné un nombre para reconocerla.' })
  if (contenido.trim() === '') problemas.push({ gravedad: 'error', texto: 'La plantilla está vacía.' })

  const usados = marcadoresUsados(contenido)

  for (const clave of usados) {
    if (CLAVES_DATO.includes(clave)) continue
    if (CLAVES_HUECO.includes(clave)) {
      // Un hueco en una firma no se rellena nunca: el que rellena es el
      // envoltorio. Quedaría como texto muerto, o peor, se borraría solo.
      if (clase === 'firma') {
        problemas.push({ gravedad: 'error', texto: `{{${clave}}} sólo funciona en el envoltorio, no en una firma.` })
      }
      continue
    }
    problemas.push({ gravedad: 'error', texto: `{{${clave}}} no existe: revisá cómo se escribe.` })
  }

  if (clase === 'envoltorio' && !usados.includes('cuerpo')) {
    problemas.push({ gravedad: 'error', texto: 'Falta {{cuerpo}}: sin eso el mensaje no tiene dónde entrar.' })
  }
  return problemas
}

export const sePuedeGuardar = (problemas: Problema[]) => !problemas.some((p) => p.gravedad === 'error')

/**
 * Quién puede tocar cada plantilla.
 *
 * Espejo de las policies, y por las mismas razones de siempre: esto NO es el
 * control de acceso —la base rechaza igual— sino no ofrecer un botón que va a
 * fallar. Las de la empresa las toca un admin; la propia, su dueño.
 */
export function puedeEditar(p: Plantilla, rol: string | null | undefined, usuarioId: string | null): boolean {
  if (rol === 'admin') return true
  return p.usuarioId !== null && p.usuarioId === usuarioId
}

/** Las que le sirven a una persona: las de la empresa y las suyas. */
export function visiblesPara(todas: Plantilla[], usuarioId: string | null): Plantilla[] {
  return todas.filter((p) => p.usuarioId === null || p.usuarioId === usuarioId)
}

/**
 * Cuál se usa si nadie elige: la propia por defecto, y si no tiene, la de la
 * empresa. Mismo orden que `plantillas_para_enviar` en la base.
 */
export function firmaPorDefecto(todas: Plantilla[], usuarioId: string | null): Plantilla | null {
  const firmas = todas.filter((p) => p.clase === 'firma' && p.activa && p.esDefault)
  return firmas.find((p) => p.usuarioId === usuarioId) ?? firmas.find((p) => p.usuarioId === null) ?? null
}
