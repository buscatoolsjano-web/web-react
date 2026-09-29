import { supabase } from '@/services/supabase/client'
import type {
  CandidataCotizacion,
  CandidatoCliente,
  LineaEmparejada,
  MetodoCliente,
  MetodoLinea,
} from '../lib/importarOc'

/**
 * Importar la OC del cliente: los cuatro pasos contra la base (Fase 30 · E6).
 *
 * Todo el emparejamiento vive en el servidor y no acá, por una razón de
 * tamaño: buscar entre 21.775 productos y 1.010 clientes desde el navegador
 * significaría bajarse el catálogo entero. Las RPC ya lo resuelven con los
 * índices de trigramas que tiene la base.
 *
 * Lo que sí es de este lado es el mapeo de nombres: la base habla
 * `snake_case` y el resto del módulo, `camelCase`.
 */

/** Una línea como sale de la IA, antes de saber qué producto nuestro es. */
export interface LineaCruda {
  n: number
  codigo: string | null
  descripcion: string | null
  cantidad: number
  precio: number | null
}

const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Texto, comprobando el tipo en vez de forzarlo con `String()`.
 *
 * `Json` incluye objetos y arreglos, así que `String(v)` puede devolver
 * literalmente «[object Object]» y meterlo en la pantalla. Lo marcó el lint y
 * tenía razón: es la clase de cosa que aparece en producción como un cartel
 * sin sentido.
 */
const cadena = (v: unknown): string => (typeof v === 'string' ? v : '')

/** A qué cliente nuestro corresponde. Puede devolver varios: la pantalla pregunta. */
export async function emparejarCliente(
  companyId: string,
  nombre: string | null,
  cuit: string | null,
): Promise<CandidatoCliente[]> {
  const { data, error } = await supabase.rpc('emparejar_cliente_de_oc', {
    p_company: companyId,
    p_nombre: nombre,
    p_cuit: cuit,
  })
  if (error) throw new Error(`No se pudo buscar el cliente: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    customerId: cadena(c['customer_id']),
    nombre: (c['nombre'] as string | null) ?? null,
    cuit: (c['cuit'] as string | null) ?? null,
    metodo: c['metodo'] as MetodoCliente,
    confianza: numero(c['confianza']),
  }))
}

/** Qué producto nuestro es cada línea. Devuelve TODAS, incluidas las que no encontró. */
export async function emparejarLineas(
  companyId: string,
  customerId: string,
  lineas: readonly LineaCruda[],
): Promise<LineaEmparejada[]> {
  const { data, error } = await supabase.rpc('emparejar_lineas_de_oc', {
    p_company: companyId,
    p_customer: customerId,
    p_lineas: lineas as unknown as never,
  })
  if (error) throw new Error(`No se pudo emparejar el catálogo: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[]).map((l) => ({
    n: numero(l['n']),
    codigo: (l['codigo'] as string | null) ?? null,
    descripcion: (l['descripcion'] as string | null) ?? null,
    cantidad: numero(l['cantidad']),
    precio: l['precio'] === null || l['precio'] === undefined ? null : numero(l['precio']),
    productId: (l['product_id'] as string | null) ?? null,
    sku: (l['sku'] as string | null) ?? null,
    nombre: (l['nombre'] as string | null) ?? null,
    metodo: l['metodo'] as MetodoLinea,
    confianza: numero(l['confianza']),
  }))
}

/**
 * Las cotizaciones a las que esta OC podría estar respondiendo.
 *
 * Se mandan sólo los productos que el emparejador SÍ resolvió: los que
 * quedaron sin match no dicen nada sobre qué cotización es.
 */
export async function cotizacionesPara(
  companyId: string,
  customerId: string,
  lineas: readonly LineaEmparejada[],
): Promise<CandidataCotizacion[]> {
  const productos = [...new Set(lineas.map((l) => l.productId).filter((p): p is string => p !== null))]
  if (productos.length === 0) return []

  const { data, error } = await supabase.rpc('cotizaciones_para_oc', {
    p_company: companyId,
    p_customer: customerId,
    p_productos: productos,
  })
  if (error) throw new Error(`No se pudieron buscar las cotizaciones: ${error.message}`)

  return ((data ?? []) as Record<string, unknown>[]).map((q) => ({
    quoteId: cadena(q['quote_id']),
    numero: cadena(q['numero']),
    fecha: cadena(q['fecha']),
    estado: cadena(q['estado']),
    total: numero(q['total']),
    moneda: (q['moneda'] as string | null) ?? null,
    lineasEnComun: numero(q['lineas_en_comun']),
    lineasOc: numero(q['lineas_oc']),
    cobertura: numero(q['cobertura']),
  }))
}

/** Lo que responde la base al importar. */
export interface ResultadoImportacion {
  poId: string
  quoteId: string
  cotizacion: string
  lineas: number
  sinMatch: number
  conDiferencia: number
  estado: string
  vinculada: boolean
}

/**
 * Los motivos que devuelve `importar_oc`, en castellano.
 *
 * Se traducen acá y no se muestra el error crudo: `OC_DUPLICADA` no le dice
 * nada a nadie, y es justamente el caso más frecuente —arrastrar dos veces el
 * mismo PDF—, así que merece una frase que explique qué pasó.
 */
const MOTIVOS: Record<string, string> = {
  SIN_PERMISO: 'Tu rol no importa órdenes de compra.',
  OC_SIN_NUMERO: 'La orden de compra no tiene número.',
  OC_SIN_LINEAS: 'La orden de compra no tiene líneas.',
  CLIENTE_INVALIDO: 'Ese cliente no existe en la empresa.',
  COTIZACION_INVALIDA: 'Esa cotización no es de este cliente.',
  OC_DUPLICADA: 'Esa orden de compra ya está importada para este cliente.',
}

export class FalloDeImportacion extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'FalloDeImportacion'
  }
}

export async function importarOc(params: {
  companyId: string
  customerId: string
  numero: string
  fecha: string | null
  moneda: string | null
  lineas: readonly LineaEmparejada[]
  quoteId: string | null
  textoCrudo: string | null
}): Promise<ResultadoImportacion> {
  const { data, error } = await supabase.rpc('importar_oc', {
    p_company: params.companyId,
    p_customer: params.customerId,
    p_numero: params.numero,
    p_fecha: params.fecha,
    p_moneda: params.moneda,
    // De vuelta a `snake_case`: la RPC lee las mismas claves que devolvió
    // `emparejar_lineas_de_oc`, así que el viaje de ida y vuelta es simétrico.
    p_lineas: params.lineas.map((l) => ({
      n: l.n,
      codigo: l.codigo,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio: l.precio,
      product_id: l.productId,
      sku: l.sku,
      nombre: l.nombre,
      metodo: l.metodo,
      confianza: l.confianza,
    })) as unknown as never,
    p_quote_id: params.quoteId,
    p_raw_text: params.textoCrudo,
  })

  if (error) {
    const codigo = Object.keys(MOTIVOS).find((c) => error.message.includes(c))
    throw new FalloDeImportacion(
      codigo ?? 'error_interno',
      codigo ? MOTIVOS[codigo]! : 'No se pudo importar la orden de compra.',
    )
  }

  const r = (data ?? {}) as Record<string, unknown>
  return {
    poId: cadena(r['po_id']),
    quoteId: cadena(r['quote_id']),
    cotizacion: cadena(r['cotizacion']),
    lineas: numero(r['lineas']),
    sinMatch: numero(r['sin_match']),
    conDiferencia: numero(r['con_diferencia']),
    estado: cadena(r['estado']),
    vinculada: r['vinculada'] === true,
  }
}

/** Lo que devuelve la Edge Function al leer el PDF. */
export interface OcLeida {
  cliente: { nombre: string | null; cuit: string | null }
  numero: string
  fecha: string | null
  moneda: string | null
  lineas: LineaCruda[]
  textoCrudo: string | null
}

/**
 * Leer la OC de un PDF (Fase 30 · E4, todavía sin desplegar).
 *
 * La lectura vive en una Edge Function y no acá por dos razones: la clave del
 * proveedor de IA no puede salir del servidor, y el PDF no tiene por qué
 * viajar dos veces.
 *
 * Mientras la función no esté desplegada, esto falla — y falla DICIENDO que
 * falta desplegarla. Un «Failed to fetch» mandaría a buscar el problema al
 * lugar equivocado.
 */
export async function leerOcDesdePdf(archivo: File): Promise<OcLeida> {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)

  // El genérico y el tipo del error no son adorno: `functions.invoke` devuelve
  // `any` en las dos puntas, y el lint lo marca. Sin esto, leerle `.message` a
  // lo que sea que vuelva compila igual y explota en producción.
  const respuesta: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
    'importar-oc',
    { body: cuerpo },
  )
  const { data, error } = respuesta

  if (error) {
    /**
     * El motivo y el mensaje vienen en el CUERPO, no en el error.
     *
     * `functions.invoke` trata cualquier respuesta no-2xx como un fallo y deja
     * el `Response` en `error.context`; su `.message` es genérico. Sin leer el
     * cuerpo, «El PDF no tiene texto: parece escaneado» se vería como «Edge
     * Function returned a non-2xx status code», que no ayuda a nadie.
     */
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      const cuerpo: unknown = await ctx.json().catch(() => null)
      const e = (cuerpo as { error?: { motivo?: unknown; mensaje?: unknown } } | null)?.error
      if (typeof e?.mensaje === 'string') {
        throw new FalloDeImportacion(typeof e.motivo === 'string' ? e.motivo : 'lectura', e.mensaje)
      }
      if (ctx.status === 404) {
        throw new FalloDeImportacion(
          'sin_desplegar',
          'La lectura automática todavía no está disponible: falta desplegar la función que lee el PDF.',
        )
      }
    }

    const msg = error.message
    if (msg.includes('404') || /not\s*found/i.test(msg)) {
      throw new FalloDeImportacion(
        'sin_desplegar',
        'La lectura automática todavía no está disponible: falta desplegar la función que lee el PDF.',
      )
    }
    throw new FalloDeImportacion('lectura', `No se pudo leer el PDF: ${msg}`)
  }

  const o = (data ?? {}) as Record<string, unknown>
  const cli = (typeof o['cliente'] === 'object' && o['cliente'] !== null ? o['cliente'] : {}) as Record<string, unknown>

  return {
    cliente: {
      nombre: typeof cli['nombre'] === 'string' ? cli['nombre'] : null,
      cuit: typeof cli['cuit'] === 'string' ? cli['cuit'] : null,
    },
    numero: cadena(o['numero']),
    fecha: typeof o['fecha'] === 'string' ? o['fecha'] : null,
    moneda: typeof o['moneda'] === 'string' ? o['moneda'] : null,
    lineas: (Array.isArray(o['lineas']) ? o['lineas'] : []).map((l, i) => {
      const x = (l ?? {}) as Record<string, unknown>
      return {
        n: i + 1,
        codigo: typeof x['codigo'] === 'string' ? x['codigo'] : null,
        descripcion: typeof x['descripcion'] === 'string' ? x['descripcion'] : null,
        cantidad: numero(x['cantidad']),
        precio: x['precio'] === null || x['precio'] === undefined ? null : numero(x['precio']),
      }
    }),
    textoCrudo: typeof o['texto'] === 'string' ? o['texto'] : null,
  }
}

/** En qué estado está la lectura con IA. */
export interface EstadoDeLectura {
  proveedor: string
  /** `false` cuando la función está desplegada pero sin proveedor real. */
  listo: boolean
}

/**
 * Preguntarle a la función si la IA está encendida (Fase 30 · E6).
 *
 * Existe para que el cartel de la pantalla diga la verdad. Uno que anuncia
 * «IA activa» cuando el proveedor está en `falso` es peor que no tener
 * cartel: manda a probar con una OC real y a no entender por qué salen
 * siempre los mismos tres ítems de demo.
 *
 * Si la función no responde, se asume que NO está lista. Ante la duda, el
 * cartel se calla.
 */
export async function estadoDeLectura(): Promise<EstadoDeLectura> {
  try {
    const r: { data: unknown; error: Error | null } = await supabase.functions.invoke<unknown>(
      'importar-oc',
      { method: 'GET' },
    )
    if (r.error) return { proveedor: 'desconocido', listo: false }
    const o = (r.data ?? {}) as Record<string, unknown>
    return { proveedor: cadena(o['proveedor']) || 'desconocido', listo: o['listo'] === true }
  } catch {
    return { proveedor: 'desconocido', listo: false }
  }
}

/** Una línea de una cotización candidata, para poder mirarla sin salir. */
export interface LineaDeCotizacion {
  id: string
  sku: string | null
  nombre: string | null
  cantidad: number
  precio: number
  productId: string | null
}

/**
 * Las líneas de una cotización candidata (Fase 30 · E6).
 *
 * «2 de 5 coinciden» no alcanza para decidir si es LA cotización: pueden ser
 * dos productos que ese cliente compra siempre y aparecen en todas. Hay que
 * poder abrirla y mirarla.
 *
 * Se piden pocas columnas y de la tabla, sin RPC: es una lectura simple que la
 * política de `sales_quote_lines` ya acota a la empresa de quien mira.
 */
export async function lineasDeCotizacion(quoteId: string): Promise<LineaDeCotizacion[]> {
  const { data, error } = await supabase
    .from('sales_quote_lines')
    .select('id, sku_snapshot, name_snapshot, quantity, unit_price, product_id, line_no, line_type')
    .eq('quote_id', quoteId)
    .order('line_no')

  if (error) throw new Error(`No se pudieron leer las líneas: ${error.message}`)

  return (data ?? [])
    // Los capítulos son texto en el medio del documento, no productos.
    .filter((l) => l.line_type !== 'chapter')
    .map((l) => ({
      id: String(l.id),
      sku: l.sku_snapshot,
      nombre: l.name_snapshot,
      cantidad: numero(l.quantity),
      precio: numero(l.unit_price),
      productId: l.product_id,
    }))
}
