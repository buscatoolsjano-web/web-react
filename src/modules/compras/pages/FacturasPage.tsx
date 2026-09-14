import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import tabla from '@/components/tables/Tabla.module.css'
import doc from '@/components/document/Document.module.css'
import { ChipFactura } from '../components/ChipEstado'
import { Paginador } from '../components/Paginador'
import { formatearFecha, formatearImporte } from '../lib/formato'
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

const COLUMNAS: { clave: OrdenFacturas; etiqueta: string; num?: boolean }[] = [
  { clave: 'numeroProveedor', etiqueta: 'Nº del proveedor' },
  { clave: 'numero', etiqueta: 'Referencia' },
  { clave: 'fecha', etiqueta: 'Fecha' },
  { clave: 'proveedor', etiqueta: 'Proveedor' },
  { clave: 'total', etiqueta: 'Total', num: true },
]

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
  const isMobile = useIsMobile()
  const monedas = useMonedasDeFacturas()
  const proveedores = useProveedores({
    ...FILTROS_INICIALES,
    porPagina: 100,
    orden: 'nombre',
    direccion: 'asc',
  })

  const [texto, setTexto] = useState(filtros.q)

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
    mutationFn: () => exportarFacturas(activa!.companyId, filtros),
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
              {exportar.isPending ? 'Exportando…' : 'Exportar a CSV'}
            </Button>
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
      ) : isPending && filas.length === 0 ? (
        <div className={tabla.contenedor}>
          <SkeletonRows rows={5} columns={isMobile ? 2 : 6} label="Cargando facturas…" />
        </div>
      ) : filas.length === 0 ? (
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
      ) : isMobile ? (
        <ul className={tabla.tarjetas}>
          {filas.map((f) => (
            <li key={f.id}>
              <Link to={`/compras/facturas/${f.id}`} className={tabla.tarjeta}>
                <span className={tabla.tarjetaTitulo}>{f.numeroProveedor ?? f.numero}</span>
                <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaMeta}`}>{formatearFecha(f.fecha)}</span>
                <span className={tabla.tarjetaTexto}>{f.proveedor}</span>
                <span className={tabla.tarjetaMeta}>
                  {f.numeroProveedor ? `Ref. ${f.numero} · ` : 'sin número del proveedor · '}
                  {f.lineas} {f.lineas === 1 ? 'línea' : 'líneas'}
                  {f.recepciones > 0 ? ` · ${f.recepciones} ${f.recepciones === 1 ? 'recepción' : 'recepciones'}` : ''}
                </span>
                <span className={`${tabla.tarjetaDerecha} ${tabla.tarjetaImporte}`}>{formatearImporte(f.total, f.moneda)}</span>
                <span className={tabla.tarjetaTexto}>
                  <ChipFactura estado={f.estado} />
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
                {COLUMNAS.map((c) => {
                  const activaCol = filtros.orden === c.clave
                  return (
                    <th
                      key={c.clave}
                      scope="col"
                      className={c.num ? tabla.num : undefined}
                      aria-sort={activaCol ? (filtros.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={tabla.orden} onClick={() => ordenar(c.clave)}>
                        {c.etiqueta}
                        {activaCol ? <Icon name={filtros.direccion === 'asc' ? 'arrow-up' : 'arrow-down'} size={16} className={tabla.ordenIcono} /> : null}
                      </button>
                    </th>
                  )
                })}
                <th scope="col">Moneda</th>
                <th scope="col">Estado</th>
                <th scope="col" className={tabla.num}>
                  Líneas
                </th>
                <th scope="col" className={tabla.num}>
                  Recepciones
                </th>
                <th scope="col">Creada por</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className={tabla.nowrap}>
                    <Link to={`/compras/facturas/${f.id}`} className={tabla.enlace}>
                      {f.numeroProveedor ?? <span className={tabla.secundario}>sin número</span>}
                    </Link>
                  </td>
                  <td className={tabla.nowrap}>{f.numero}</td>
                  <td className={tabla.nowrap}>{formatearFecha(f.fecha)}</td>
                  <td className={tabla.texto} title={f.proveedor}>
                    <Link to={`/compras/proveedores/${f.proveedorId}`} className={tabla.enlaceSuave}>
                      {f.proveedor}
                    </Link>
                  </td>
                  <td className={tabla.num}>{formatearImporte(f.total, f.moneda)}</td>
                  <td className={tabla.nowrap}>{f.moneda}</td>
                  <td>
                    <ChipFactura estado={f.estado} />
                  </td>
                  <td className={tabla.num}>{f.lineas}</td>
                  <td className={tabla.num}>{f.recepciones}</td>
                  <td className={tabla.secundario} title={f.autor ?? undefined}>
                    {f.autor ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
