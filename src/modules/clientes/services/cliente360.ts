import { supabase } from '@/services/supabase/client'
import type {
  ActividadMensual,
  ClaveKpi,
  Cliente360,
  DocumentoReciente,
  ProductoReciente,
  TipoDeDocumento,
  ValorKpi,
} from '../types'

/**
 * La ficha rápida del cliente, en UNA llamada.
 *
 * Reemplaza a las cinco que hacían falta antes (`resumen_cliente`,
 * `totales_por_moneda_cliente`, `actividad_mensual_cliente`,
 * `documentos_del_cliente`, `productos_del_cliente`). No es una optimización
 * de lujo: el panel se abre al hacer click en una fila de una lista, y cambiar
 * de cliente cinco veces seguidas con el modelo viejo dejaba veinticinco
 * consultas en vuelo compitiendo por llegar.
 *
 * `resumen_cliente_360` es `security invoker`: hereda `customers_select`. Un
 * cliente que el actor no puede ver devuelve **null**, no una estructura
 * vacía, y por eso la pantalla puede distinguir «este cliente no tiene
 * movimientos» de «no podés ver este cliente».
 */

function aNumero(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function aNumeroONulo(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function aTexto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function aLista(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const CLAVES: ReadonlySet<string> = new Set<ClaveKpi>([
  'vendido_mes',
  'vendido_mes_anterior',
  'cotizado_mes',
  'cotizado_mes_anterior',
  'cotizaciones_abiertas',
  'pedidos_por_entregar',
])

const TIPOS: ReadonlySet<string> = new Set<TipoDeDocumento>(['cotizacion', 'pedido', 'entrega'])

/**
 * Los motivos de revisión llegan como texto —`review_reason` es una columna de
 * texto, no un array— y el resto del módulo los trata como lista.
 */
function aMotivos(v: unknown): string[] {
  if (Array.isArray(v)) return aLista(v)
  if (typeof v !== 'string' || v.trim() === '') return []
  return v.split('|').map((m) => m.trim()).filter(Boolean)
}

export function mapearCliente360(json: unknown): Cliente360 | null {
  if (json === null || typeof json !== 'object') return null
  const raiz = json as Record<string, unknown>
  const c = (raiz['cliente'] ?? {}) as Record<string, unknown>
  const com = (raiz['comercial'] ?? {}) as Record<string, unknown>
  const kpis = (raiz['kpis'] ?? {}) as Record<string, unknown>
  const tot = (raiz['totales'] ?? {}) as Record<string, unknown>
  const contacto = com['contacto'] as Record<string, unknown> | null | undefined

  const valores: ValorKpi[] = (Array.isArray(kpis['valores']) ? kpis['valores'] : [])
    .map((f) => f as Record<string, unknown>)
    // Una clave que la pantalla no conoce se descarta acá y no llega a la UI.
    .filter((f) => CLAVES.has(String(f['clave'])))
    .map((f) => ({
      clave: String(f['clave']) as ClaveKpi,
      moneda: aTexto(f['moneda']),
      documentos: aNumero(f['documentos']),
      importe: aNumero(f['importe']),
    }))

  const meses: ActividadMensual[] = (Array.isArray(raiz['meses']) ? raiz['meses'] : [])
    .map((f) => f as Record<string, unknown>)
    .filter((f) => TIPOS.has(String(f['tipo'])))
    .map((f) => ({
      mes: String(f['mes']),
      tipo: String(f['tipo']) as TipoDeDocumento,
      moneda: aTexto(f['moneda']),
      documentos: aNumero(f['documentos']),
      importe: aNumero(f['importe']),
    }))

  const recientes: DocumentoReciente[] = (Array.isArray(raiz['recientes']) ? raiz['recientes'] : [])
    .map((f) => f as Record<string, unknown>)
    .filter((f) => TIPOS.has(String(f['tipo'])))
    .map((f) => ({
      tipo: String(f['tipo']) as TipoDeDocumento,
      id: String(f['id']),
      numero: aTexto(f['numero']),
      fecha: aTexto(f['fecha']),
      estado: aTexto(f['estado']),
      entrega: aTexto(f['entrega']),
      moneda: aTexto(f['moneda']),
      total: aNumeroONulo(f['total']),
    }))

  const productos: ProductoReciente[] = (Array.isArray(raiz['productos']) ? raiz['productos'] : [])
    .map((f) => f as Record<string, unknown>)
    .map((f) => ({
      productId: aTexto(f['product_id']),
      sku: aTexto(f['sku']),
      nombre: aTexto(f['nombre']),
      origen: f['origen'] === 'pedido' ? 'pedido' : 'cotizacion',
      fecha: aTexto(f['fecha']),
      cantidad: aNumeroONulo(f['cantidad']),
      precio: aNumeroONulo(f['precio']),
      moneda: aTexto(f['moneda']),
    }))

  return {
    cliente: {
      id: String(c['id']),
      referencia: aTexto(c['referencia']),
      razonSocial: typeof c['razon_social'] === 'string' ? c['razon_social'] : '',
      nombreComercial: aTexto(c['nombre_comercial']),
      cuit: aTexto(c['cuit']),
      rubro: aTexto(c['rubro']),
      tipo: aTexto(c['tipo']),
      estado: aTexto(c['estado']),
      dadoDeBaja: c['dado_de_baja'] === true,
      necesitaRevision: c['necesita_revision'] === true,
      motivosRevision: aMotivos(c['motivos_revision']),
      emails: aLista(c['emails']),
      telefono: aTexto(c['telefono']),
      esHistorico: c['importado'] === true,
    },
    comercial: {
      vendedorId: aTexto(com['vendedor_id']),
      vendedor: aTexto(com['vendedor']),
      moneda: aTexto(com['moneda']),
      condicionDePago: aTexto(com['condicion_pago']),
      tarifaId: aTexto(com['tarifa_id']),
      tarifa: aTexto(com['tarifa']),
      contacto: contacto
        ? {
            id: String(contacto['id']),
            nombre: typeof contacto['full_name'] === 'string' ? contacto['full_name'] : '',
            rol: aTexto(contacto['role']),
            email: aTexto(contacto['email']),
            telefono: aTexto(contacto['phone']),
          }
        : null,
    },
    kpis: {
      mes: aTexto(kpis['mes']) ?? '',
      mesAnterior: aTexto(kpis['mes_anterior']) ?? '',
      valores,
    },
    meses,
    recientes,
    productos,
    totales: {
      cotizaciones: aNumero(tot['cotizaciones']),
      pedidos: aNumero(tot['pedidos']),
      entregas: aNumero(tot['entregas']),
      ultimaActividad: aTexto(tot['ultima_actividad']),
      documentos12m: aNumero(tot['documentos_12m']),
      productosDistintos: aNumero(tot['productos_distintos']),
    },
  }
}

export async function cliente360(clienteId: string, meses = 12): Promise<Cliente360 | null> {
  const { data, error } = await supabase.rpc('resumen_cliente_360', {
    p_customer: clienteId,
    p_meses: meses,
  })
  if (error) throw new Error(`No se pudo leer la ficha: ${error.message}`)
  return mapearCliente360(data)
}
