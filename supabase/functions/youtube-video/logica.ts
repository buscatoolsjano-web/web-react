/**
 * Lo que se decide sin red: el título y la descripción del video.
 * Vive aparte para correr en vitest.
 */

export interface DatosTitulo {
  /** OS00012 para una orden, ACT00227 para un equipo. */
  referencia: string
  modelo: string | null
  serie: string | null
  cliente: string | null
  /** AAAA-MM-DD */
  fecha: string
}

/** YouTube rechaza `<` y `>` en el título, y lo corta en 100 caracteres. */
const limpiar = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()

/** «OS00012 · FEIN ASM18-8-PC serie 000460 · Whirlpool Argentina S.A. · 20/11/2026». */
export function tituloDeVideo(d: DatosTitulo): string {
  const [a, m, dia] = d.fecha.split('-')
  const equipo = [d.modelo, d.serie ? `serie ${d.serie}` : null].filter(Boolean).join(' ')
  const partes = [d.referencia, equipo, d.cliente, `${dia}/${m}/${a}`].filter((p): p is string => !!p && p.trim() !== '')
  const titulo = limpiar(partes.join(' · '))
  if (titulo.length <= 100) return titulo
  // Si no entra, se acorta el cliente, que es lo que menos identifica al video.
  const sinCliente = limpiar([d.referencia, equipo, `${dia}/${m}/${a}`].filter(Boolean).join(' · '))
  return sinCliente.slice(0, 100)
}

export function descripcionDeVideo(tipo: 'maintenance_order' | 'maintenance_asset', referencia: string): string {
  return tipo === 'maintenance_order'
    ? `Orden de servicio ${referencia}. Subido desde el ERP de Buscatools.`
    : `Equipo ${referencia}. Subido desde el ERP de Buscatools.`
}

/** El id de un video de YouTube: 11 caracteres de [A-Za-z0-9_-]. */
export const esIdDeYoutube = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{11}$/.test(s)
