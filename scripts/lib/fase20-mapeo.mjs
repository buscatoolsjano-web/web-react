/**
 * Las decisiones de la importación de activos, puras y probables.
 *
 * Están acá y no adentro del importador para que se puedan probar con
 * fixtures, sin STEL y sin base: son las reglas que deciden **a qué cliente
 * va un equipo** y **qué se guarda de cada campo**, que es donde una
 * importación se arruina en silencio.
 */

export const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null
export const normSerie = (s) => (s ?? '').toString().toUpperCase().replace(/[\s-]/g, '') || null
export const limpio = (s) => {
  const t = (s ?? '').toString().trim()
  return t === '' ? null : t
}
export const fecha = (s) => (s ? s.toString().slice(0, 10) : null)

export const claseDe = (p) =>
  (p ?? '').includes('/potentialClients/') ? 'potentialClients'
  : (p ?? '').includes('/clients/') ? 'clients'
  : null

/**
 * A qué cliente va un equipo.
 *
 * **CUIT primero, referencia legacy después, y nada más.** El nombre no
 * decide: dos razones sociales parecidas no son el mismo cliente, y un activo
 * asignado al cliente equivocado es peor que un activo sin cliente —porque no
 * se nota.
 *
 * Devuelve `{ cliente, via, ambiguo }`. Si un CUIT o una referencia resuelven
 * a dos clientes, no elige: marca ambiguo y deja el equipo sin dueño.
 */
export function elegirCliente(clienteStel, indices) {
  if (!clienteStel) return { cliente: null, via: null, ambiguo: false }

  const cuit = normCuit(clienteStel['tax-identification-number'])
  const porCuit = cuit ? (indices.porCuit.get(cuit) ?? []) : []
  if (porCuit.length === 1) return { cliente: porCuit[0], via: 'cuit', ambiguo: false }
  if (porCuit.length > 1) return { cliente: null, via: 'cuit-ambiguo', ambiguo: true }

  const ref = (clienteStel['full-reference'] ?? '').trim().toUpperCase()
  const porRef = ref ? (indices.porRef.get(ref) ?? []) : []
  if (porRef.length === 1) return { cliente: porRef[0], via: 'legacy_ref', ambiguo: false }
  if (porRef.length > 1) return { cliente: null, via: 'ref-ambigua', ambiguo: true }

  return { cliente: null, via: null, ambiguo: false }
}

/**
 * Un activo de STEL, como fila de `maintenance_assets`.
 *
 * Tres reglas que se ven en el código y conviene decir en palabras:
 *
 *   · **la marca y el modelo entran tal cual vienen.** No se normalizan ni se
 *     fusionan variantes de escritura; el `brand_id` se enlaza sólo si el
 *     nombre coincide exacto con una marca que ya existe, y nunca se crea una;
 *   · **lo que no tiene columna propia se conserva en las notas, etiquetado**
 *     —el nombre de STEL cuando no es la etiqueta, la descripción y los
 *     comentarios privados—;
 *   · **una garantía que termina antes de empezar no se guarda ni se
 *     corrige**: la tabla tiene un CHECK que lo prohíbe, y darla vuelta sería
 *     inventar. Se anota textual y el equipo entra sin garantía.
 */
export function aFilaDeActivo(a, { companyId, cliente, direccion, marcaPorNombre, ahora }) {
  const nombre = limpio(a.name)
  const identificador = limpio(a.identifier) ?? nombre

  const desde = fecha(a['warranty-start-date'])
  const hasta = fecha(a['warranty-end-date'])
  const garantiaTorcida = Boolean(desde && hasta && hasta < desde)

  const notas = [
    nombre && nombre !== identificador ? `Nombre en STEL: ${nombre}` : null,
    limpio(a.description),
    limpio(a['private-comments']),
    garantiaTorcida ? `Garantía en STEL, sin cargar por incoherente: ${desde} → ${hasta}` : null,
  ].filter(Boolean).join('\n') || null

  const marcaTexto = limpio(a.brand)
  return {
    company_id: companyId,
    reference: limpio(a['full-reference']) ?? `ACT-STEL-${a.id}`,
    owner_customer_id: cliente?.id ?? null,
    serial_number: limpio(a['serial-number']),
    brand_id: marcaTexto ? (marcaPorNombre.get(marcaTexto.toUpperCase()) ?? null) : null,
    brand_text: marcaTexto,
    model_text: limpio(a.model),
    identifier: identificador,
    city: limpio(direccion?.['city-town']),
    state: limpio(direccion?.province),
    warranty_start: garantiaTorcida ? null : desde,
    warranty_end: garantiaTorcida ? null : hasta,
    under_contract: a['subject-to-maintenance'] === true,
    notes: notas,
    external_source: 'stel',
    external_id: String(a.id),
    imported_at: ahora,
    last_synced_at: ahora,
  }
}

/** La clave de idempotencia. La referencia NO entra acá a propósito. */
export const claveDeIdentidad = (fila) =>
  `${fila.company_id}:${fila.external_source}:${fila.external_id}`
