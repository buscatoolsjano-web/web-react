import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { ListadoFacturas } from '../components/ListadoFacturas'
import { Paginador } from '../components/Paginador'
import { OPCIONES_ESTADO_FACTURA, etiquetaDeEstadoFactura } from '../lib/estados'
import { permisosDe } from '../lib/permisos'
import { descargarCsv, facturasACsv } from '../lib/csv'
import { exportarFacturas } from '../services/facturas'
import { useFacturas, useFiltrosFacturas, useMonedasDeFacturas } from '../hooks/useFacturas'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosFacturas, type OrdenFacturas } from '../types'

/** Cuántos filtros hay activos, sin contar el buscador que está a la vista. */
function contarActivos(f: FiltrosFacturas): number {
  return [
    f.proveedorId !== null,
    f.estado !== '',
    f.moneda !== '',
    f.desde !== '',
    f.hasta !== '',
  ].filter(Boolean).length
}

const FACTURAS = { singular: 'factura', plural: 'facturas' }

/**
 * El listado de facturas de proveedor.
 *
 * Mismo patrón que pedidos y recepciones: filtros, orden y página en la URL,
 * todo resuelto por el servidor, y en mobile los filtros se pliegan.
 *
 * Cada importe lleva su moneda: acá conviven USD, ARS y EUR y no hay ninguna
 * fila de total general.
 */
export function FacturasPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosFacturas()
  const { data, isPending, isFetching, error, refetch } = useFacturas(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const monedas = useMonedasDeFacturas()
  const proveedores = useProveedores({
    ...FILTROS_INICIALES,
    porPagina: 100,
    orden: 'nombre',
    direccion: 'asc',
  })

  const [texto, setTexto] = useState(filtros.q)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  // Si el filtro cambia desde afuera hay que reflejarlo en el input. Se ajusta
  // DURANTE el render, no en un useEffect.
  const [qPrevia, setQPrevia] = useState(filtros.q)
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q)
    setTexto(filtros.q)
  }

  useEffect(() => {
    if (texto === filtros.q) return
    const id = setTimeout(() => aplicar({ q: texto }), 300)
    return () => clearTimeout(id)
  }, [texto, filtros.q, aplicar])

  /**
   * Exportar.
   *
   * Se lleva lo que muestran los filtros. Cada fila lleva **su moneda** en una
   * columna: el archivo no suma nada, y quien lo abra agrupa por ahí.
   */
  const exportar = useMutation({
    // Con facturas marcadas se llevan ésas, igual que en ventas.
    mutationFn: async () =>
      seleccionados.size > 0
        ? { filas: (data?.filas ?? []).filter((f) => seleccionados.has(f.id)) }
        : exportarFacturas(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `facturas-proveedor-${new Date().toISOString().slice(0, 10)}.csv`,
        facturasACsv(filas, etiquetaDeEstadoFactura),
      ),
  })

  const ordenar = (columna: OrdenFacturas) =>
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )

  if (!permisos.verProveedores) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Facturas de proveedor" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const total = data?.total ?? 0
  const filas = data?.filas ?? []

  const marcar = (id: string, marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      if (marcado) n.add(id)
      else n.delete(id)
      return n
    })
  const marcarTodos = (marcado: boolean) =>
    setSeleccionados((s) => {
      const n = new Set(s)
      for (const f of filas) {
        if (marcado) n.add(f.id)
        else n.delete(f.id)
      }
      return n
    })

  const nueva = permisos.crearProveedor ? (
    <LinkButton to="/compras/facturas/nueva" variant="primary" icon={<Icon name="plus" size={16} />}>
      Nueva factura
    </LinkButton>
  ) : undefined

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Facturas de proveedor"
        subtitle={isPending ? 'Cargando…' : contar(total, FACTURAS)}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Icon name="download" size={16} />}
              loading={exportar.isPending}
              disabled={total === 0}
              onClick={() => exportar.mutate()}
            >
              {exportar.isPending
                ? 'Exportando…'
                : seleccionados.size > 0
                  ? `Exportar ${seleccionados.size} a CSV`
                  : 'Exportar a CSV'}
            </Button>
            {seleccionados.size > 0 ? (
              <Button variant="ghost" onClick={() => setSeleccionados(new Set())}>
                Limpiar selección
              </Button>
            ) : null}
            {nueva}
          </>
        }
      />

      {exportar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo exportar">
          <p>{exportar.error.message}</p>
        </Alert>
      ) : null}

      <FilterBar
        activeCount={contarActivos(filtros)}
        hasFilters={hayFiltros}
        onClear={limpiar}
        search={
          <Field label="Buscar factura" hideLabel>
            <Input type="search" placeholder="Número del proveedor o referencia FP…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </Field>
        }
      >
        <Field label="Proveedor" hideLabel>
          <Select value={filtros.proveedorId ?? ''} onChange={(e) => aplicar({ proveedorId: e.target.value || null })}>
            <option value="">Todos los proveedores</option>
            {(proveedores.data?.filas ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.razonSocial}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Estado" hideLabel>
          <Select value={filtros.estado} onChange={(e) => aplicar({ estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {OPCIONES_ESTADO_FACTURA.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </Select>
        </Field>

        {(monedas.data ?? []).length > 1 ? (
          <Field label="Moneda" hideLabel>
            <Select value={filtros.moneda} onChange={(e) => aplicar({ moneda: e.target.value })}>
              <option value="">Todas las monedas</option>
              {(monedas.data ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Desde">
          <Input type="date" value={filtros.desde} onChange={(e) => aplicar({ desde: e.target.value })} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={filtros.hasta} onChange={(e) => aplicar({ hasta: e.target.value })} />
        </Field>
      </FilterBar>

      {error ? (
        <ErrorState title="No se pudo leer el listado." description="Revisá la conexión y volvé a intentar." onRetry={() => void refetch()} retrying={isFetching} />
      ) : filas.length === 0 && !isPending ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay facturas que coincidan. Probá con otro proveedor, estado o fecha."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="inbox"
            title="Todavía no hay facturas de proveedor"
            description="Las facturas se registran a partir de lo recibido en las notas de entrada."
            action={nueva}
          />
        )
      ) : (
        <ListadoFacturas
          filas={filas}
          orden={filtros.orden}
          direccion={filtros.direccion}
          onOrdenar={ordenar}
          cargando={isPending}
          seleccionados={seleccionados}
          onSeleccionar={marcar}
          onSeleccionarTodos={marcarTodos}
        />
      )}

      {error || filas.length === 0 ? null : (
        <Paginador
          pagina={filtros.pagina}
          porPagina={filtros.porPagina}
          total={total}
          cargando={isFetching}
          onIr={(pagina) => aplicar({ pagina })}
          onTamano={(porPagina) => aplicar({ porPagina })}
          sustantivo={FACTURAS}
        />
      )}
    </div>
  )
}
