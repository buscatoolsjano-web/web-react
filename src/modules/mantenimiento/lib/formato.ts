/**
 * Formato del módulo de Mantenimiento.
 *
 * Mismas reglas que en Ventas, Clientes y Compras, y repetidas a propósito:
 * importar el formato de otra sección ataría dos módulos que no tienen por
 * qué moverse juntos.
 */

/**
 * Un importe con su moneda al lado.
 *
 * La moneda NUNCA es opcional en un listado donde conviven varias: un número
 * suelto no dice si son dólares o pesos. Por la misma razón no hay ninguna
 * función que sume importes de monedas distintas.
 */
export function formatearImporte(monto: number | null, moneda: string | null): string {
  if (monto === null || !Number.isFinite(monto)) return '—'
  const numero = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto)
  const codigo = (moneda ?? '').trim()
  return codigo === '' || codigo === '—' ? numero : `${codigo} ${numero}`
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

/**
 * Las acciones de `maintenance_audit`, en castellano.
 *
 * La lista es exactamente la que escriben los triggers de la entrega 1 más las
 * dos de la espera que agrega la entrega 2. Una acción que no esté acá se
 * muestra cruda en vez de desaparecer: es preferible un `foo_bar` visible a un
 * evento invisible en un historial.
 */
const ACCIONES: Record<string, string> = {
  create: 'Alta',
  owner_changed: 'Cambio de dueño',
  status_changed: 'Cambio de estado',
  stage_changed: 'Avance de etapa',
  stage_reverted: 'Vuelta atrás',
  stage_marked_not_required: 'Etapa marcada no requerida',
  order_put_on_hold: 'Puesta en espera',
  order_resumed: 'Reanudada',
  order_closed: 'Cierre',
  order_cancelled: 'Cancelación',
  quote_approved: 'Cotización aprobada',
  quote_rejected: 'Cotización rechazada',
  consumption_confirmed: 'Consumo de repuestos',
  part_added: 'Repuesto agregado',
  part_removed: 'Repuesto quitado',
}

export function etiquetaDeAccion(accion: string): string {
  return ACCIONES[accion] ?? accion
}

/**
 * Una cantidad.
 *
 * Sin decimales cuando es entera —«30», no «30,00»— y con decimales cuando los
 * tiene, hasta cuatro, que es la escala de la base.
 */
export function formatearNumero(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(n)
}

/**
 * Cómo se nombra un equipo en pantalla: **la referencia**, siempre.
 *
 * No el serial. El serial puede faltar, puede estar repetido y puede estar mal
 * cargado —el legacy nunca lo garantizó—, así que titular con él haría que dos
 * equipos distintos se vieran iguales. La referencia `EQ00001` la emite
 * `next_document_number` y es única por empresa.
 */
export function nombreDeEquipo(referencia: string, modelo: string | null): string {
  const m = (modelo ?? '').trim()
  return m === '' ? referencia : `${referencia} · ${m}`
}

/**
 * Un indicador de capacidad —Cp, Cpk, CV, promedio o desvío— tal como se
 * muestra.
 *
 * **«N/D» y no «0»**: un indicador que no existe no es un indicador que vale
 * cero. Con menos de dos mediciones, o con todas iguales, no hay desvío
 * muestral y `capacidad_torque()` devuelve null para Cp, Cpk y CV. Mostrar
 * «0» ahí diría «el proceso es pésimo» cuando lo que pasa es que todavía no
 * hay con qué opinar.
 *
 * Un cero real —que sí puede darse— se muestra como «0», no como «N/D».
 */
export function indicadorDeCapacidad(v: number | null, sufijo = ''): string {
  return v === null ? 'N/D' : `${formatearNumero(v)}${sufijo}`
}
