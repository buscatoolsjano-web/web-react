import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  actualizarFactura,
  anularFactura,
  borrarFactura,
  crearFactura,
  guardarLineasFactura,
  lineasDeFactura,
  listarFacturas,
  monedasDeFacturas,
  obtenerFactura,
  pendienteDeFacturar,
  registrarFactura,
  relacionadosDeFactura,
  type DatosFactura,
  type LineaAFacturar,
} from '../services/facturas'
import { historialDeEntidad } from '../services/auditoria'
import {
  FILTROS_FACTURAS_INICIALES,
  type EventoDeProveedor,
  type FacturaDetalle,
  type FiltrosFacturas,
  type LineaFactura,
  type OrdenFacturas,
  type PaginaDeFacturas,
  type PendienteDeFacturar,
  type RelacionadosFactura,
} from '../types'

// ── Filtros en la URL ──────────────────────────────────────────────────────

const TAMANOS = [10, 25, 50, 100] as const
const ESTADOS = ['draft', 'registered', 'cancelled']

function aEntero(v: string | null, porDefecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}

function aOrden(v: string | null): OrdenFacturas {
  return v === 'numero' || v === 'numeroProveedor' || v === 'proveedor' || v === 'total' || v === 'fecha'
    ? v
    : FILTROS_FACTURAS_INICIALES.orden
}

/** Una fecha que no tiene forma de fecha se ignora en vez de romper la consulta. */
function aFecha(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}

export function leerFiltros(params: URLSearchParams): FiltrosFacturas {
  const porPagina = aEntero(params.get('per'), FILTROS_FACTURAS_INICIALES.porPagina)
  const estado = params.get('estado')
  const moneda = (params.get('moneda') ?? '').toUpperCase()
  return {
    q: params.get('q') ?? '',
    proveedorId: params.get('prov'),
    estado: estado && ESTADOS.includes(estado) ? estado : '',
    moneda: /^[A-Z]{3}$/.test(moneda) ? moneda : '',
    desde: aFecha(params.get('desde')),
    hasta: aFecha(params.get('hasta')),
    pagina: aEntero(params.get('page'), 1),
    porPagina: (TAMANOS as readonly number[]).includes(porPagina)
      ? porPagina
      : FILTROS_FACTURAS_INICIALES.porPagina,
    orden: aOrden(params.get('orden')),
    direccion: params.get('dir') === 'asc' ? 'asc' : 'desc',
  }
}

export function escribirFiltros(f: FiltrosFacturas): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim() !== '') p.set('q', f.q.trim())
  if (f.proveedorId) p.set('prov', f.proveedorId)
  if (f.estado !== '') p.set('estado', f.estado)
  if (f.moneda !== '') p.set('moneda', f.moneda)
  if (f.desde !== '') p.set('desde', f.desde)
  if (f.hasta !== '') p.set('hasta', f.hasta)
  if (f.pagina > 1) p.set('page', String(f.pagina))
  if (f.porPagina !== FILTROS_FACTURAS_INICIALES.porPagina) p.set('per', String(f.porPagina))
  if (f.orden !== FILTROS_FACTURAS_INICIALES.orden) p.set('orden', f.orden)
  if (f.direccion !== FILTROS_FACTURAS_INICIALES.direccion) p.set('dir', f.direccion)
  return p
}

export const TAMANOS_DE_PAGINA = TAMANOS

export function useFiltrosFacturas() {
  const [params, setParams] = useSearchParams()
  const filtros = useMemo(() => leerFiltros(params), [params])

  const aplicar = useCallback(
    (cambios: Partial<FiltrosFacturas>) => {
      const siguiente = { ...leerFiltros(params), ...cambios }
      if (cambios.pagina === undefined) siguiente.pagina = 1
      setParams(escribirFiltros(siguiente), { replace: true })
    },
    [params, setParams],
  )

  const limpiar = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams])

  const hayFiltros =
    filtros.q.trim() !== '' ||
    filtros.proveedorId !== null ||
    filtros.estado !== '' ||
    filtros.moneda !== '' ||
    filtros.desde !== '' ||
    filtros.hasta !== ''

  return { filtros, aplicar, limpiar, hayFiltros }
}

// ── Lecturas ───────────────────────────────────────────────────────────────

export function useFacturas(filtros: FiltrosFacturas) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PaginaDeFacturas>({
    queryKey: ['compras', companyId, 'facturas', filtros],
    queryFn: () => listarFacturas(companyId!, filtros),
    enabled: companyId !== null,
    placeholderData: (previa, consultaPrevia) => {
      const empresaPrevia = consultaPrevia?.queryKey[1]
      return empresaPrevia === companyId ? previa : undefined
    },
    staleTime: 30_000,
  })
}

export function useFactura(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<FacturaDetalle | null>({
    queryKey: ['compras', companyId, 'factura', id],
    queryFn: () => obtenerFactura(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useLineasDeFactura(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<LineaFactura[]>({
    queryKey: ['compras', companyId, 'lineas-factura', id],
    queryFn: () => lineasDeFactura(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

export function useRelacionadosDeFactura(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<RelacionadosFactura>({
    queryKey: ['compras', companyId, 'relacionados-factura', id],
    queryFn: () => relacionadosDeFactura(companyId!, id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}

/**
 * Lo pendiente de facturar.
 *
 * `staleTime: 0`: es la cuenta que decide cuánto se puede facturar y no puede
 * servirse de una caché vieja.
 */
export function usePendienteDeFacturar(
  proveedorId: string | null,
  recepciones: readonly string[] | null = null,
  excluirFacturaId: string | null = null,
) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<PendienteDeFacturar[]>({
    queryKey: [
      'compras', companyId, 'pendiente-facturar', proveedorId,
      recepciones ? [...recepciones].sort().join(',') : null, excluirFacturaId,
    ],
    queryFn: () => pendienteDeFacturar(companyId!, proveedorId, recepciones, excluirFacturaId),
    enabled: companyId !== null && proveedorId !== null,
    staleTime: 0,
  })
}

export function useMonedasDeFacturas() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<string[]>({
    queryKey: ['compras', companyId, 'monedas-facturas'],
    queryFn: () => monedasDeFacturas(companyId!),
    enabled: companyId !== null,
    staleTime: 5 * 60_000,
  })
}

// ── Mutaciones ─────────────────────────────────────────────────────────────

function invalidar(qc: ReturnType<typeof useQueryClient>, companyId: string | null, id?: string) {
  for (const clave of [
    ['compras', companyId, 'facturas'],
    ['compras', companyId, 'pendiente-facturar'],
    ['compras', companyId, 'monedas-facturas'],
    ['compras', companyId, 'relacionados-pedido'],
    ['compras', companyId, 'documentos-proveedor'],
    ['compras', companyId, 'historial-proveedor'],
  ]) {
    void qc.invalidateQueries({ queryKey: clave })
  }
  if (id) {
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'factura', id] })
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'lineas-factura', id] })
    void qc.invalidateQueries({ queryKey: ['compras', companyId, 'relacionados-factura', id] })
  }
}

export function useCrearFactura() {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null

  return useMutation({
    mutationFn: ({ datos, lineas }: { datos: DatosFactura; lineas: LineaAFacturar[] }) =>
      crearFactura(companyId!, datos, lineas),
    onSuccess: () => invalidar(qc, companyId),
  })
}

export function useEditarFactura(id: string) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const companyId = activa?.companyId ?? null
  const listo = () => invalidar(qc, companyId, id)

  return {
    cabecera: useMutation({
      mutationFn: (datos: DatosFactura) => actualizarFactura(companyId!, id, datos),
      onSuccess: listo,
    }),
    lineas: useMutation({
      mutationFn: (lineas: LineaAFacturar[]) => guardarLineasFactura(companyId!, id, lineas),
      onSuccess: listo,
    }),
    registrar: useMutation({ mutationFn: () => registrarFactura(id), onSuccess: listo }),
    anular: useMutation({ mutationFn: () => anularFactura(companyId!, id), onSuccess: listo }),
    borrar: useMutation({ mutationFn: () => borrarFactura(companyId!, id), onSuccess: listo }),
  }
}

/**
 * El historial de la factura.
 *
 * Sólo acciones de negocio: alta, registro y anulación. Las ediciones del
 * borrador no se auditan a propósito.
 */
export function useHistorialDeFactura(id: string | undefined) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  return useQuery<EventoDeProveedor[]>({
    queryKey: ['compras', companyId, 'historial-factura', id],
    queryFn: () => historialDeEntidad(companyId!, 'supplier_invoice', id!),
    enabled: companyId !== null && !!id,
    staleTime: 30_000,
  })
}
