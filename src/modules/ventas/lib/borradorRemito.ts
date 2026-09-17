import type { DocumentoDetalle, LineaDocumento } from '../types'

/**
 * El borrador del remito (Fase 15 · E5).
 *
 * Es primo del borrador de la cotización y el pedido, pero mucho más chico, y
 * a propósito: un remito NO es un documento de precios. Acá se edita lo que el
 * remito decide —la fecha, el transporte, el texto y **cuánto se entrega**— y
 * nada de lo que decidió el pedido: el precio, el descuento y el impuesto
 * viajan como snapshot y no se tocan.
 *
 * Como en E2–E4: **nada se escribe hasta «Guardar cambios»**.
 */

export interface CabeceraRemito {
  fecha: string
  titulo: string
  notas: string
  contactoId: string
  transporte: string
  seguimiento: string
}

export interface LineaRemito {
  /** Clave estable para React; las líneas nuevas todavía no tienen `id`. */
  clave: string
  id: string | null
  orderLineId: string | null
  sku: string | null
  nombre: string | null
  descripcion: string
  /** Texto: se edita como texto y se convierte al guardar. */
  cantidad: string
}

export interface BorradorRemito {
  cabecera: CabeceraRemito
  lineas: LineaRemito[]
  /** El `updated_at` que se leyó al entrar en edición. */
  esperado: string
}

export type CampoRemito = keyof CabeceraRemito

const texto = (v: number | string | null | undefined): string => (v === null || v === undefined ? '' : String(v))

/** El estado exacto del remito al entrar en edición. Es lo que restaura Descartar. */
export function crearBorradorRemito(
  doc: DocumentoDetalle,
  lineas: readonly LineaDocumento[],
  extra: { transporte?: string | null; seguimiento?: string | null } = {},
): BorradorRemito {
  return {
    cabecera: {
      fecha: doc.fecha.slice(0, 10),
      titulo: doc.titulo ?? '',
      notas: doc.notas ?? '',
      contactoId: doc.contactoId ?? '',
      transporte: extra.transporte ?? '',
      seguimiento: extra.seguimiento ?? '',
    },
    lineas: [...lineas]
      .sort((a, b) => (a.numeroLinea ?? 0) - (b.numeroLinea ?? 0))
      .map((l) => ({
        clave: l.id,
        id: l.id,
        orderLineId: l.ordenLineaId,
        sku: l.sku,
        nombre: l.nombre,
        descripcion: l.descripcion ?? '',
        cantidad: texto(l.cantidad),
      })),
    esperado: doc.actualizadoEn,
  }
}

export function hayCambiosRemito(actual: BorradorRemito, original: BorradorRemito): boolean {
  return JSON.stringify({ c: actual.cabecera, l: actual.lineas }) !==
    JSON.stringify({ c: original.cabecera, l: original.lineas })
}

export function cambiarCampoRemito(
  b: BorradorRemito,
  campo: CampoRemito,
  valor: string,
): BorradorRemito {
  return { ...b, cabecera: { ...b.cabecera, [campo]: valor } }
}

export function cambiarLineaRemito(
  b: BorradorRemito,
  clave: string,
  campo: 'cantidad' | 'descripcion',
  valor: string,
): BorradorRemito {
  return {
    ...b,
    lineas: b.lineas.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)),
  }
}

export function quitarLineaRemito(b: BorradorRemito, clave: string): BorradorRemito {
  return { ...b, lineas: b.lineas.filter((l) => l.clave !== clave) }
}

export function agregarLineaRemito(
  b: BorradorRemito,
  linea: { orderLineId: string; sku: string | null; nombre: string | null; descripcion?: string | null; cantidad: number },
): BorradorRemito {
  return {
    ...b,
    lineas: [
      ...b.lineas,
      {
        clave: `nueva-${b.lineas.length + 1}-${linea.orderLineId}`,
        id: null,
        orderLineId: linea.orderLineId,
        sku: linea.sku,
        nombre: linea.nombre,
        descripcion: linea.descripcion ?? '',
        cantidad: texto(linea.cantidad),
      },
    ],
  }
}

/** Lo que falta para poder guardar. Vacío: se puede. */
export function faltaParaGuardarRemito(b: BorradorRemito): string[] {
  const falta: string[] = []
  if (b.lineas.length === 0) falta.push('Un remito sin líneas no es un remito.')
  if (b.lineas.some((l) => !(Number(l.cantidad.replace(',', '.')) > 0))) {
    falta.push('Todas las cantidades tienen que ser mayores que cero.')
  }
  if (b.cabecera.fecha === '') falta.push('Falta la fecha del remito.')
  return falta
}

export interface PayloadRemito {
  cabecera: Record<string, string | number | null>
  lineas: { id?: string | null; order_line_id?: string | null; quantity: number; description_snapshot: string | null }[]
}

const COLUMNA: Record<CampoRemito, string> = {
  fecha: 'delivery_date',
  titulo: 'title',
  notas: 'notes',
  contactoId: 'contact_id',
  transporte: 'carrier',
  seguimiento: 'tracking',
}

/**
 * Lo que se le manda a `guardar_remito`: sólo la cabecera que cambió, con los
 * nombres de `deliveries`, y las líneas completas en su orden.
 */
export function aPayloadRemito(actual: BorradorRemito, original: BorradorRemito): PayloadRemito {
  const cabecera: Record<string, string | number | null> = {}
  for (const k of Object.keys(actual.cabecera) as CampoRemito[]) {
    if (actual.cabecera[k] !== original.cabecera[k]) {
      cabecera[COLUMNA[k]] = actual.cabecera[k] === '' ? null : actual.cabecera[k]
    }
  }
  return {
    cabecera,
    lineas: actual.lineas.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      ...(l.orderLineId ? { order_line_id: l.orderLineId } : {}),
      quantity: Number(l.cantidad.replace(',', '.')),
      description_snapshot: l.descripcion === '' ? null : l.descripcion,
    })),
  }
}

/**
 * Cuánto se puede poner en una línea sin pasarse: lo que queda pendiente en el
 * pedido MÁS lo que este mismo remito ya tenía tomado, que no compite consigo
 * mismo. Es la misma cuenta que hace la base; acá sirve para no ofrecer algo
 * que el servidor va a rechazar.
 */
export function topeDeLinea(
  linea: LineaRemito,
  pendientes: ReadonlyMap<string, { pendiente: number; enEsteRemito: number }>,
): number | null {
  if (!linea.orderLineId) return null
  const p = pendientes.get(linea.orderLineId)
  if (!p) return null
  return p.pendiente + p.enEsteRemito
}
