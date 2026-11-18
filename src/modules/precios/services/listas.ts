import { supabase } from '@/services/supabase/client'
import type { ImagenProducto } from '@/modules/catalogo/types'
import type { CambioDePrecio, Movimiento } from '../lib/comparativa'

/**
 * Las listas de precios de las marcas (Fase 49).
 *
 * Son el REGISTRO de lo que manda cada marca, no los precios de venta: esos
 * los llena STEL y `product_prices` es de sólo lectura para el ERP. Acá no se
 * decide ningún precio; se guarda lo que llegó y se compara con lo anterior.
 *
 * Todo lo de abajo es sólo lectura. La carga la hace un script, porque leer un
 * Excel del Drive y mapear sus columnas es trabajo de una corrida puntual y no
 * de una pantalla.
 */

export interface FuenteDeLista {
  id: string
  nombre: string
  marcaId: string | null
  clase: 'marca' | 'proveedor'
  /** Cuántas listas hay cargadas de esta fuente. */
  versiones: number
  /** La fecha de la más reciente. */
  ultima: string | null
}

export interface VersionDeLista {
  id: string
  fecha: string
  moneda: string
  columnaAncla: string
  origen: string
  archivo: string | null
  enlace: string | null
  nota: string | null
  renglones: number
  /** Cuántos de esos renglones encontraron su producto en el catálogo. */
  cruzan: number
}

/** Las fuentes con su resumen. Pocas filas: una por marca. */
export async function listarFuentes(companyId: string): Promise<FuenteDeLista[]> {
  const { data, error } = await supabase
    .from('price_list_sources')
    .select('id, name, brand_id, kind, price_list_versions ( id, issued_on )')
    .eq('company_id', companyId)
    .order('name')

  if (error) throw new Error(`No se pudieron leer las listas de precios: ${error.message}`)

  type Fila = {
    id: string
    name: string
    brand_id: string | null
    kind: string
    price_list_versions?: { id: string; issued_on: string }[]
  }

  return ((data ?? []) as unknown as Fila[]).map((f) => {
    const vs = f.price_list_versions ?? []
    // El orden de un embebido no lo garantiza PostgREST: se ordena acá.
    const fechas = vs.map((v) => v.issued_on).sort()
    return {
      id: f.id,
      nombre: f.name,
      marcaId: f.brand_id,
      clase: f.kind === 'proveedor' ? 'proveedor' : 'marca',
      versiones: vs.length,
      ultima: fechas.at(-1) ?? null,
    }
  })
}

/**
 * Las versiones de una fuente, de la más nueva a la más vieja.
 *
 * El conteo de renglones viene de la base con `count`, no trayéndose los
 * 3.630 renglones para contarlos acá: una lista entera son ~400 KB y lo único
 * que se quiere mostrar es un número.
 */
export async function listarVersiones(
  companyId: string,
  sourceId: string,
): Promise<VersionDeLista[]> {
  const { data, error } = await supabase
    .from('price_list_versions')
    .select('id, issued_on, currency, anchor_column, origin, file_name, file_url, notes')
    .eq('company_id', companyId)
    .eq('source_id', sourceId)
    .order('issued_on', { ascending: false })

  if (error) throw new Error(`No se pudieron leer las versiones: ${error.message}`)

  /*
   * Los conteos, TODOS A LA VEZ (auditoría 2026-11). Antes iban de a uno: dos
   * viajes por versión, en fila — con diez versiones, veinte viajes uno detrás
   * del otro antes de poder mostrar el desplegable. Ahora el que manda es el
   * más lento, no la suma.
   */
  const conteos = await Promise.all(
    (data ?? []).map((v) =>
      Promise.all([
        supabase.from('price_list_items').select('id', { count: 'exact', head: true }).eq('version_id', v.id),
        supabase
          .from('price_list_items')
          .select('id', { count: 'exact', head: true })
          .eq('version_id', v.id)
          .not('product_id', 'is', null),
      ]),
    ),
  )

  const salida: VersionDeLista[] = []
  for (const [i, v] of (data ?? []).entries()) {
    const [total, conProducto] = conteos[i]!

    salida.push({
      id: v.id,
      fecha: v.issued_on,
      moneda: v.currency,
      columnaAncla: v.anchor_column,
      origen: v.origin,
      archivo: v.file_name,
      enlace: v.file_url,
      nota: v.notes,
      renglones: total.count ?? 0,
      cruzan: conProducto.count ?? 0,
    })
  }
  return salida
}

/**
 * Los cambios de una versión contra la anterior de su misma fuente.
 *
 * La cuenta del porcentaje la hace la vista `price_list_changes`, no esta
 * función: así la misma cuenta vale para la pantalla, para un informe y para
 * cualquiera que consulte la base.
 *
 * `limite` existe porque una lista son miles de renglones y la pantalla
 * muestra los que más se movieron. El resumen —cuántos subieron, la mediana—
 * se calcula sobre lo que se trae, así que el límite tiene que ser alto o el
 * resumen miente; por eso el valor por defecto no es 50.
 */
export async function cambiosDeVersion(
  companyId: string,
  versionId: string,
  limite = 5000,
): Promise<CambioDePrecio[]> {
  const { data, error } = await supabase
    .from('price_list_changes')
    .select('reference, description, product_id, precio, precio_anterior, porcentaje, movimiento')
    .eq('company_id', companyId)
    .eq('version_id', versionId)
    .limit(limite)

  if (error) throw new Error(`No se pudo armar la comparativa: ${error.message}`)

  return (data ?? []).map((c) => ({
    reference: c.reference ?? '',
    description: c.description,
    productId: c.product_id,
    precio: c.precio,
    precioAnterior: c.precio_anterior,
    porcentaje: c.porcentaje,
    movimiento: (c.movimiento ?? 'sin dato') as Movimiento,
  }))
}

// ── La planilla adentro (Fase 50) ──────────────────────────────────────────

export interface FilaDePlanilla {
  reference: string
  description: string | null
  productId: string | null
  /**
   * La foto del producto del catálogo, cuando la referencia cruzó.
   *
   * Es el mismo tipo que usa el catálogo, no uno reducido: así la pinta
   * `ImagenProducto`, con su miniatura verificada y su caída a la original
   * cuando la miniatura no existe —que es el 51 % de las de WordPress—.
   */
  imagen: ImagenProducto | null
  sku: string | null
  /** Precio por fecha. Una fecha ausente es una lista donde no estaba. */
  precios: Record<string, number | null>
  /** Lo máximo que se vendió, para tenerlo al lado del precio teórico. */
  ventaMaxima: VentaMaxima | null
  /** El costo de compra y el precio de venta de la última lista, cada uno con su moneda. */
  costo: { monto: number; moneda: string | null } | null
  venta: { monto: number; moneda: string | null } | null
  /** Unidades pedidas por clientes: ordena la planilla, los más vendidos arriba. */
  vendidos: number
}

/**
 * El precio más alto al que se vendió —u ofreció— un producto (Fase 56).
 *
 * PARA QUÉ. La fórmula dice un PVP teórico y la realidad dice otra cosa. El
 * `2005.5VPCM` es el caso: el costo por 3 da 19,32 y a Grupo Mirgor se le
 * vendió a 146,79. Sin esa referencia al lado, el número de la fórmula se lee
 * como si fuera el techo, y no lo es.
 *
 * LA MONEDA VA SIEMPRE y no se compara contra el costo. El costo de estas
 * listas está en EUR y lo vendido en USD o ARS; poner un cociente entre los dos
 * sería inventar un tipo de cambio. Es una referencia al lado, no una cuenta.
 */
export interface VentaMaxima {
  productId: string
  monto: number
  moneda: string
  /** `pedido` es una venta; `cotizacion` es una oferta que pudo no cerrarse. */
  tipo: 'pedido' | 'cotizacion'
  documentoId: string | null
  numero: string | null
  fecha: string | null
  cliente: string | null
  clienteId: string | null
  cantidad: number | null
  precioLista: number | null
  descuentoPct: number | null
  /** Cuántas veces se cotizó o vendió, y cuántas de ésas fueron venta. */
  veces: number
  vecesVendido: number
}

export interface Planilla {
  filas: FilaDePlanilla[]
  total: number
}

/** Limpia las comillas que arrastran algunas descripciones del Excel. */
const sinComillas = (s: string | null) =>
  s === null ? null : s.replace(/^"+|"+$/g, '').replace(/""/g, '"').trim()

/**
 * La planilla de una marca: una fila por referencia, los precios por fecha.
 *
 * Las columnas NO salen de acá: la pantalla las arma con la lista de versiones
 * y busca cada precio por su fecha. El orden de las claves de un jsonb lo
 * normaliza Postgres y confiar en él ya costó una vez (Fase 43).
 *
 * La foto se pide aparte y sólo para las referencias de la página: traerla en
 * el mismo join obligaría a `product_images` en una vista agrupada, y son 25
 * filas contra miles.
 */
export async function planillaDePrecios(
  companyId: string,
  sourceId: string,
  { texto = '', pagina = 1, porPagina = 25 }: { texto?: string; pagina?: number; porPagina?: number } = {},
): Promise<Planilla> {
  const desde = (pagina - 1) * porPagina
  // Por referencia o por descripción, que es como se busca un producto.
  //
  // `%` y `_` son comodines de `ilike`: sin escaparlos, buscar «2520/8_» o
  // pegarle a un `%` devuelve cualquier cosa y parece que el buscador anda
  // mal. Se escapan con barra invertida.
  const buscado = texto.trim().replace(/[%_]/g, (comodin) => '\\' + comodin)

  /*
   * El orden lo decide la base (`listas_planilla`): primero los que están en
   * el catálogo, entre ellos los más vendidos, después los que tienen foto, y
   * al final las referencias que no están en el catálogo. «Priorizar los que
   * más vendemos y los que tienen foto, y los que NO están en el catálogo,
   * últimos.»
   */
  const { data, error } = await supabase.rpc('listas_planilla', {
    p_company_id: companyId,
    p_source_id: sourceId,
    p_texto: buscado,
    p_desde: desde,
    p_cuantos: porPagina,
  })
  if (error) throw new Error(`No se pudo leer la lista: ${error.message}`)
  const count = data?.[0]?.total ?? (desde === 0 ? 0 : null)

  const montoDe = (m: number | null, moneda: string | null) => (m === null ? null : { monto: Number(m), moneda })
  const filas = (data ?? []).map((f) => ({
    reference: f.reference ?? '',
    description: sinComillas(f.description),
    productId: f.product_id,
    imagen: null as FilaDePlanilla['imagen'],
    sku: null as string | null,
    precios: (f.precios ?? {}) as Record<string, number | null>,
    ventaMaxima: null as VentaMaxima | null,
    costo: montoDe(f.costo, f.moneda_costo),
    venta: montoDe(f.venta, f.moneda_venta),
    vendidos: Number(f.vendidos ?? 0),
  }))

  return { filas, total: count ?? 0 }
}

/** Lo que se le agrega a una fila de la planilla después de pintarla. */
export interface ExtrasDePlanilla {
  /** Por id de producto: su SKU y su foto principal. */
  productos: Map<string, { sku: string; imagen: FilaDePlanilla['imagen'] }>
  /** Por id de producto: lo máximo que se le vendió. */
  ventaMaxima: Map<string, VentaMaxima>
}

/**
 * La foto, el SKU y la venta máxima de los productos de una página.
 *
 * SEPARADO DE LA PLANILLA a propósito (auditoría 2026-11). Antes la página era
 * una cadena de tres viajes —`listas_planilla`, después `products`, después
 * `product_venta_maxima`— y no se pintaba ni una fila hasta que llegaba el
 * último: medido en producción, la primera fila salía a los 8,6 s. Las
 * referencias, descripciones y precios ya están en el primer viaje; la foto y
 * el máximo pueden llegar un momento después sin que nadie espere por ellos.
 *
 * Y los dos que quedan van a la vez: los dos sólo necesitan los ids.
 */
export async function extrasDePlanilla(companyId: string, ids: readonly string[]): Promise<ExtrasDePlanilla> {
  const productos: ExtrasDePlanilla['productos'] = new Map()
  const mejorPorProducto = new Map<string, VentaMaxima>()
  if (ids.length === 0) return { productos, ventaMaxima: mejorPorProducto }

  const [{ data: prods }, { data: maximos }] = await Promise.all([
    supabase
      .from('products')
      .select('id, sku, product_images ( source_url, thumb_url, is_primary )')
      .in('id', [...ids])
      .eq('product_images.is_primary', true),
    /*
     * Lo máximo vendido.
     *
     * La vista devuelve UNA FILA POR MONEDA. Acá se elige la de mayor importe
     * sin convertir nada: comparar 520.000 ARS con 826 USD no tiene sentido,
     * pero mostrar «lo más alto que se cobró, y en qué moneda» sí. La moneda
     * viaja con el número para que la pantalla no pueda perderla.
     */
    supabase
      .from('product_venta_maxima')
      .select(
        'product_id, moneda, maximo, tipo, documento_id, numero, fecha, customer_id, cliente, cantidad, precio_lista, descuento_pct, veces, veces_vendido',
      )
      .eq('company_id', companyId)
      .in('product_id', [...ids]),
  ])

  type Fila = {
    id: string
    sku: string
    product_images?: { source_url: string | null; thumb_url: string | null }[] | null
  }

  for (const p of (prods ?? []) as unknown as Fila[]) {
    const img = (p.product_images ?? []).find((i) => i.source_url !== null)
    productos.set(p.id, {
      sku: p.sku,
      imagen: img
        ? {
            url: img.source_url!,
            thumbUrl: img.thumb_url,
            kind: 'product_image',
            posicion: 0,
            esPrincipal: true,
          }
        : null,
    })
  }

  for (const m of maximos ?? []) {
      if (m.product_id === null || m.maximo === null) continue
      const cand: VentaMaxima = {
        productId: m.product_id,
        monto: Number(m.maximo),
        moneda: m.moneda ?? '',
        tipo: m.tipo === 'pedido' ? 'pedido' : 'cotizacion',
        documentoId: m.documento_id,
        numero: m.numero,
        fecha: m.fecha,
        cliente: m.cliente,
        clienteId: m.customer_id,
        cantidad: m.cantidad === null ? null : Number(m.cantidad),
        precioLista: m.precio_lista === null ? null : Number(m.precio_lista),
        descuentoPct: m.descuento_pct === null ? null : Number(m.descuento_pct),
        veces: Number(m.veces ?? 0),
        vecesVendido: Number(m.veces_vendido ?? 0),
      }
      const previo = mejorPorProducto.get(m.product_id)
      // Ante dos monedas se muestra la del importe más alto y se dice cuál es.
      if (!previo || cand.monto > previo.monto) mejorPorProducto.set(m.product_id, cand)
  }

  return { productos, ventaMaxima: mejorPorProducto }
}

/** Las filas de la planilla con sus extras puestos, cuando ya llegaron. */
export function conExtras(planilla: Planilla, extras: ExtrasDePlanilla | undefined): Planilla {
  if (extras === undefined) return planilla
  return {
    ...planilla,
    filas: planilla.filas.map((f) => {
      if (f.productId === null) return f
      const p = extras.productos.get(f.productId)
      return {
        ...f,
        sku: p?.sku ?? f.sku,
        imagen: p?.imagen ?? f.imagen,
        ventaMaxima: extras.ventaMaxima.get(f.productId) ?? f.ventaMaxima,
      }
    }),
  }
}

// ── La trazabilidad de una celda (Fase 56) ─────────────────────────────────

export interface DesgloseDeCelda {
  /** De qué fuente y versión salió el número. */
  fuente: string
  fecha: string
  moneda: string
  origen: string
  columnaAncla: string
  archivo: string | null
  enlace: string | null
  nota: string | null
  /** El renglón tal como se cargó: el ancla y TODAS las columnas del archivo. */
  reference: string
  descripcion: string | null
  anchor: number | null
  columnas: Record<string, unknown>
  /** La fórmula que rige esa fuente, para poder reproducir el PVP a mano. */
  formula: {
    multiplicador: number
    claveBase: string | null
    baseEsCosto: boolean
    fijaPrecio: boolean
    nota: string | null
  } | null
}

/**
 * De dónde sale un número de la planilla (Fase 56).
 *
 * Es lo que hace falta para poder tocar un precio y que diga de dónde vino: la
 * fuente, el archivo con su enlace, la fecha, el renglón crudo con TODAS las
 * columnas del original —no sólo la que se usó— y la fórmula que rige. Sin
 * esto, un número en una celda es un número que hay que creer.
 */
export async function desgloseDeCelda(
  companyId: string,
  sourceId: string,
  reference: string,
  fecha: string,
): Promise<DesgloseDeCelda | null> {
  const { data: version, error: eV } = await supabase
    .from('price_list_versions')
    .select('id, issued_on, currency, anchor_column, origin, file_name, file_url, notes, price_list_sources ( name )')
    .eq('company_id', companyId)
    .eq('source_id', sourceId)
    .eq('issued_on', fecha)
    .maybeSingle()

  if (eV) throw new Error(`No se pudo leer la versión: ${eV.message}`)
  if (!version) return null

  const { data: item, error: eI } = await supabase
    .from('price_list_items')
    .select('reference, description, anchor, prices')
    .eq('version_id', version.id)
    .eq('reference', reference)
    .maybeSingle()

  if (eI) throw new Error(`No se pudo leer el renglón: ${eI.message}`)

  /* La fórmula de la fuente, y si no tiene, la general de la empresa. */
  const { data: formulas } = await supabase
    .from('price_formulas')
    .select('source_id, multiplier, base_key, base_is_cost, applies_to_price, notes')
    .eq('company_id', companyId)
    .or(`source_id.eq.${sourceId},source_id.is.null`)

  const dela = (formulas ?? []).find((f) => f.source_id === sourceId)
  const general = (formulas ?? []).find((f) => f.source_id === null)
  const f = dela ?? general ?? null

  type ConFuente = { price_list_sources?: { name: string } | { name: string }[] | null }
  const fuenteCruda = (version as unknown as ConFuente).price_list_sources
  const nombreFuente = Array.isArray(fuenteCruda) ? (fuenteCruda[0]?.name ?? '') : (fuenteCruda?.name ?? '')

  return {
    fuente: nombreFuente,
    fecha: version.issued_on,
    moneda: version.currency,
    origen: version.origin,
    columnaAncla: version.anchor_column,
    archivo: version.file_name,
    enlace: version.file_url,
    nota: version.notes,
    reference,
    descripcion: sinComillas(item?.description ?? null),
    anchor: item?.anchor === null || item?.anchor === undefined ? null : Number(item.anchor),
    columnas: (item?.prices ?? {}) as Record<string, unknown>,
    formula: f
      ? {
          multiplicador: Number(f.multiplier),
          claveBase: f.base_key,
          baseEsCosto: f.base_is_cost,
          fijaPrecio: f.applies_to_price,
          nota: f.notes,
        }
      : null,
  }
}
