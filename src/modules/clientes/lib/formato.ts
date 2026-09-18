/**
 * Formato del módulo de Clientes.
 *
 * Mismas reglas que en Ventas —un importe sin moneda se muestra sin
 * suponerla, una fecha `YYYY-MM-DD` se parte a mano para no correrse un día
 * por la zona horaria— pero el módulo se mantiene independiente: importar
 * Ventas desde acá ataría dos secciones que no tienen por qué moverse juntas.
 */

export function formatearImporte(monto: number | null, moneda: string | null): string {
  if (monto === null || !Number.isFinite(monto)) return '—'
  const numero = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto)
  return moneda ? `${moneda} ${numero}` : numero
}

export function formatearFecha(iso: string | null): string {
  if (!iso) return '—'
  const partes = iso.slice(0, 10).split('-')
  if (partes.length !== 3) return iso
  const [a, m, d] = partes
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/**
 * CUIT `30503284410` → `30-50328441-0`.
 *
 * Sólo si tiene once dígitos. El maestro legacy trae CUIT con guiones, sin
 * guiones y algún texto que no es un CUIT; lo que no encaja se muestra tal
 * cual, sin corregirlo.
 */
export function formatearCuit(cuit: string | null): string {
  if (!cuit) return '—'
  const digitos = cuit.replace(/\D/g, '')
  if (digitos.length !== 11) return cuit
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
}

/** El nombre con el que se muestra un cliente: comercial si lo tiene. */
export function nombreVisible(razonSocial: string, nombreComercial: string | null): string {
  return nombreComercial?.trim() || razonSocial.trim() || 'Sin nombre'
}

/**
 * `2026-09-16T14:32:10Z` → `16/09/2026 11:32`, en la hora de quien mira.
 *
 * La trazabilidad (Fase 17 · E4) necesita la hora: dos cambios del mismo día
 * se distinguen por ella, y saber que algo pasó «el martes» no alcanza.
 */
export function formatearMomento(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
