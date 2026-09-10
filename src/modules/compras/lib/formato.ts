/**
 * Formato del módulo de Compras.
 *
 * Mismas reglas que en Ventas y en Clientes, y repetidas a propósito:
 * importar el formato de otra sección ataría dos módulos que no tienen por
 * qué moverse juntos.
 */

/**
 * Un importe con su moneda al lado.
 *
 * La moneda NUNCA es opcional en un listado donde conviven varias: un número
 * suelto no dice si son dólares o pesos. Por la misma razón no hay ninguna
 * función que sume importes de monedas distintas; el panel del legacy sumaba
 * ARS + USD + EUR en un solo total y ese número no significaba nada.
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

export function formatearFechaHora(iso: string | null): string {
  if (!iso) return '—'
  const fecha = formatearFecha(iso)
  const hora = iso.slice(11, 16)
  return hora === '' ? fecha : `${fecha} ${hora}`
}

/**
 * CUIT `30503284410` → `30-50328441-0`.
 *
 * Sólo si tiene once dígitos. El maestro legacy no trae ninguno, pero un
 * proveedor nuevo puede tenerlo, y lo que no encaja se muestra tal cual en
 * vez de corregirse.
 */
export function formatearCuit(cuit: string | null): string {
  if (!cuit) return '—'
  const digitos = cuit.replace(/\D/g, '')
  if (digitos.length !== 11) return cuit
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
}

export function rangoVisible(pagina: number, porPagina: number, total: number): string {
  if (total === 0) return '0 resultados'
  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)
  return `${desde}–${hasta} de ${total}`
}

export function totalDePaginas(total: number, porPagina: number): number {
  if (porPagina <= 0) return 1
  return Math.max(1, Math.ceil(total / porPagina))
}

/** El nombre con el que se muestra un proveedor: comercial si lo tiene. */
export function nombreVisible(razonSocial: string, nombreComercial: string | null): string {
  return nombreComercial?.trim() || razonSocial.trim() || 'Sin nombre'
}

/**
 * Los países que aparecen de verdad en el maestro.
 *
 * No es una tabla de países ni pretende serlo: son los cinco que trajo la
 * migración, para poder escribir el nombre al lado del código sin inventar un
 * catálogo. Un código que no esté acá se muestra tal cual.
 */
const PAISES: Record<string, string> = {
  AR: 'Argentina',
  ES: 'España',
  IT: 'Italia',
  US: 'Estados Unidos',
  UY: 'Uruguay',
  BR: 'Brasil',
  CL: 'Chile',
  CN: 'China',
  DE: 'Alemania',
  MX: 'México',
  PY: 'Paraguay',
}

export function nombreDePais(codigo: string | null): string {
  if (!codigo) return '—'
  return PAISES[codigo] ?? codigo
}

/** El estado del proveedor, en castellano. */
export function etiquetaDeEstado(estado: string, dadoDeBaja: boolean): string {
  if (dadoDeBaja) return 'Dado de baja'
  return estado === 'active' ? 'Activo' : 'Inactivo'
}

/** Las acciones de `purchases_audit`, en castellano. */
const ACCIONES: Record<string, string> = {
  create: 'Alta',
  update: 'Edición',
  status_change: 'Cambio de estado',
  confirm: 'Confirmación',
  cancel: 'Cancelación',
  receive: 'Recepción',
  stock_applied: 'Stock aplicado',
  delete: 'Baja',
}

export function etiquetaDeAccion(accion: string): string {
  return ACCIONES[accion] ?? accion
}
