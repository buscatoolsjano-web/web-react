import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { Pagination } from '@/components/tables/Pagination'
import { filaClickeable } from '@/components/tables/filaClickeable'
import tabla from '@/components/tables/Tabla.module.css'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useFacturasVenta } from '../hooks/useFacturasVenta'
import { TAMANOS_DE_PAGINA } from '../hooks/useFiltrosVentas'
import { descargarCsv } from '../lib/csv'
import {
  ESTADOS_FACTURA_VENTA,
  FILTROS_FACTURAS_VENTA,
  estadoDeFactura,
  facturasVentaACsv,
  filtrarFacturas,
  type FiltrosFacturasVenta,
  type OrdenFacturasVenta,
} from '../lib/facturasListado'
import { formatearFecha, formatearImporte } from '../lib/formato'
import type { FacturaListada } from '../services/facturas'

const FACTURAS = { singular: 'factura', plural: 'facturas' }

/** Las columnas ordenables, en el orden de los otros listados de Ventas. */
const COLUMNAS: { clave: OrdenFacturasVenta; etiqueta: string; num?: boolean }[] = [
  { clave: 'numero', etiqueta: 'Número' },
  { clave: 'cliente', etiqueta: 'Cliente' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'total', etiqueta: 'Total', num: true },
  { clave: 'estado', etiqueta: 'Estado' },
]

function Chip({ f }: { f: FacturaListada }) {
  const e = estadoDeFactura(f.estado)
  return (
    <Badge tone={e.tono} outline={f.estado === 'cancelled'}>
      {e.texto}
    </Badge>
  )
}

/**
 * Las facturas de venta (Fase 29 · E7), con el MISMO formato que los otros
 * listados de Ventas: exportar (todo o lo marcado), filtros, columnas
 * ordenables con la flecha siempre a la vista, casillas, la fila entera abre
 * la factura, un chip de estado y el paginador.
 *
 * Todavía no se crean desde acá: nacen del pedido, con «Generar» en el
 * circuito de la venta. Esta pantalla es dónde viven después.
 */
export function FacturasVentaPage() {
  const facturas = useFacturasVenta()
  const navegar = useNavigate()
  const isMobile = useIsMobile()
  const [filtros, setFiltros] = useState<FiltrosFacturasVenta>(FILTROS_FACTURAS_VENTA)
  const [desde, setDesde] = useState(0)
  const [porPagina, setPorPagina] = useState<number>(TAMANOS_DE_PAGINA[0] ?? 25)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  const todas = useMemo(() => facturas.data ?? [], [facturas.data])
  const filtradas = useMemo(() => filtrarFacturas(todas, filtros), [todas, filtros])
  const clientes = useMemo(() => [...new Set(todas.map((f) => f.cliente))].sort((a, b) => a.localeCompare(b, 'es')), [todas])
  const pagina = filtradas.slice(desde, desde + porPagina)
  const hayFiltros =
    filtros.q !== '' || filtros.cliente !== '' || filtros.estado !== '' || filtros.desde !== '' || filtros.hasta !== ''

  // Cambiar un filtro vuelve a la primera página.
  const aplicar = (cambios: Partial<FiltrosFacturasVenta>) => {
    setFiltros((f) => ({ ...f, ...cambios }))
    setDesde(0)
  }
  const ordenar = (clave: OrdenFacturasVenta) =>
    aplicar(
      clave === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: clave, direccion: 'desc' },
    )
  const marcar = (id: string, marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      if (marcado) n.add(id)
      else n.delete(id)
      return n
    })
  const todosMarcados = pagina.length > 0 && pagina.every((f) => seleccionados.has(f.id))
  const marcarTodos = (marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      for (const f of pagina) {
        if (marcado) n.add(f.id)
        else n.delete(f.id)
      }
      return n
    })

  const exportar = () => {
    const filas = seleccionados.size > 0 ? todas.filter((f) => seleccionados.has(f.id)) : filtradas
    descargarCsv(`facturas-${new Date().toISOString().slice(0, 10)}.csv`, facturasVentaACsv(filas))
  }

  if (facturas.error) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Facturas" />
        <ErrorState
          title="No se pudieron leer las facturas."
          description={facturas.error.message}
          onRetry={() => void facturas.refetch()}
          retrying={facturas.isFetching}
        />
      </div>
    )
  }

  const abrir = (f: FacturaListada) => void navegar(`/ventas/facturas/${f.id}`)

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Facturas"
        subtitle={
          facturas.isPending
            ? 'Cargando…'
            : `${filtradas.length} ${filtradas.length === 1 ? 'factura' : 'facturas'}`
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Icon name="download" size={16} />}
              disabled={filtradas.length === 0 && seleccionados.size === 0}
              onClick={exportar}
            >
              {seleccionados.size > 0 ? `Exportar ${seleccionados.size} a CSV` : 'Exportar a CSV'}
            </Button>
            {seleccionados.size > 0 ? (
              <Button variant="ghost" onClick={() => setSeleccionados(new Set())}>
                Limpiar selección
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        activeCount={[filtros.cliente, filtros.estado, filtros.desde, filtros.hasta].filter((v) => v !== '').length}
        hasFilters={hayFiltros}
        onClear={() => aplicar(FILTROS_FACTURAS_VENTA)}
        search={
          <Field label="Buscar factura" hideLabel>
            <Input
              type="search"
              placeholder="Buscar por número, pedido o cliente…"
              value={filtros.q}
              onChange={(e) => aplicar({ q: e.target.value })}
            />
          </Field>
        }
      >
        <Field label="Cliente" hideLabel>
          <Select value={filtros.cliente} onChange={(e) => aplicar({ cliente: e.target.value })}>
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado" hideLabel>
          <Select value={filtros.estado} onChange={(e) => aplicar({ estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS_FACTURA_VENTA).map(([v, e]) => (
              <option key={v} value={v}>
                {e.texto}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde">
          <Input type="date" value={filtros.desde} onChange={(e) => aplicar({ desde: e.target.value })} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={filtros.hasta} onChange={(e) => aplicar({ hasta: e.target.value })} />
        </Field>
      </FilterBar>

      {facturas.isPending ? (
        <div className={tabla.contenedor}>
          <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando facturas…" />
        </div>
      ) : filtradas.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay facturas que coincidan. Probá con otro cliente, estado o fecha."
            action={
              <Button variant="secondary" onClick={() => aplicar(FILTROS_FACTURAS_VENTA)}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="inbox"
            title="Todavía no hay facturas"
            description="Las facturas se generan desde el pedido, en el circuito de la venta. El número fiscal lo sigue dando AFIP a través de Tango."
          />
        )
      ) : (
        <>
          {isMobile ? (
            <ul className={tabla.tarjetas}>
              {pagina.map((f) => (
                <li key={f.id}>
                  <Link to={`/ventas/facturas/${f.id}`} className={tabla.tarjeta}>
                    <span className={tabla.tarjetaTitulo}>{f.numero}</span>
                    <span className={tabla.tarjetaDerecha}>
                      <Chip f={f} />
                    </span>
                    <span className={tabla.tarjetaTexto}>{f.cliente}</span>
                    <span className={tabla.tarjetaMeta}>{formatearFecha(f.fecha)}</span>
                    <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>
                      {formatearImporte(f.total, f.moneda)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className={tabla.contenedor}>
              <table className={tabla.tabla}>
                <thead>
                  <tr>
                    <th scope="col" className={tabla.check}>
                      <input
                        type="checkbox"
                        checked={todosMarcados}
                        aria-label="Seleccionar todas las de esta página"
                        onChange={(e) => marcarTodos(e.target.checked)}
                      />
                    </th>
                    {COLUMNAS.map((c) => {
                      const activa = filtros.orden === c.clave
                      return (
                        <th
                          key={c.clave}
                          scope="col"
                          className={c.num ? tabla.num : undefined}
                          aria-sort={activa ? (filtros.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button type="button" className={tabla.orden} onClick={() => ordenar(c.clave)}>
                            {c.etiqueta}
                            <Icon
                              name={activa && filtros.direccion === 'desc' ? 'arrow-down' : 'arrow-up'}
                              size={16}
                              className={activa ? tabla.ordenIcono : tabla.ordenIconoApagado}
                            />
                          </button>
                        </th>
                      )
                    })}
                    <th scope="col" className={tabla.ocultaBajoLg}>
                      Pedido
                    </th>
                    <th scope="col" className={tabla.ocultaBajoXl}>
                      Nº en Tango
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.map((f) => (
                    <tr
                      key={f.id}
                      className={`${tabla.filaClicable} ${seleccionados.has(f.id) ? tabla.seleccionada : ''}`}
                      {...filaClickeable(() => abrir(f))}
                    >
                      <td className={tabla.check}>
                        <input
                          type="checkbox"
                          checked={seleccionados.has(f.id)}
                          aria-label={`Seleccionar ${f.numero}`}
                          onChange={(e) => marcar(f.id, e.target.checked)}
                        />
                      </td>
                      <td className={tabla.nowrap}>
                        <Link to={`/ventas/facturas/${f.id}`} className={tabla.enlace}>
                          {f.numero}
                        </Link>
                      </td>
                      <td className={tabla.texto}>{f.cliente}</td>
                      <td className={tabla.nowrap}>{formatearFecha(f.fecha)}</td>
                      <td className={tabla.num}>{formatearImporte(f.total, f.moneda)}</td>
                      <td>
                        <span className={tabla.estados}>
                          <Chip f={f} />
                        </span>
                      </td>
                      <td className={`${tabla.nowrap} ${tabla.ocultaBajoLg}`}>{f.pedidoNumero ?? '—'}</td>
                      {/* Vacío en todas mientras la API de Tango no esté
                          enchufada: es la columna que dice qué se replicó. */}
                      <td className={`${tabla.nowrap} ${tabla.secundario} ${tabla.ocultaBajoXl}`}>
                        {f.numeroExterno ?? 'Sin replicar'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            offset={desde}
            pageSize={porPagina}
            total={filtradas.length}
            noun={FACTURAS}
            onChange={setDesde}
            pageSizeOptions={TAMANOS_DE_PAGINA}
            onPageSizeChange={(n) => {
              setPorPagina(n)
              setDesde(0)
            }}
          />
        </>
      )}
    </div>
  )
}
