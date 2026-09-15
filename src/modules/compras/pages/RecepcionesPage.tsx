import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { permisosDe } from '../lib/permisos'
import { descargarCsv, recepcionesACsv } from '../lib/csv'
import { exportarRecepciones } from '../services/recepciones'
import { ListadoRecepciones } from '../components/ListadoRecepciones'
import { Paginador } from '../components/Paginador'
import { useDepositos, useRecepciones } from '../hooks/useRecepciones'
import { useFiltrosRecepciones } from '../hooks/useFiltrosRecepciones'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosRecepciones, type OrdenRecepciones } from '../types'

const RECEPCIONES = { singular: 'recepción', plural: 'recepciones' }

/** Cuántos filtros hay puestos, sin contar el buscador que está a la vista. */
function contarActivos(f: FiltrosRecepciones): number {
  return [
    f.proveedorId !== null,
    f.pedidoId !== null,
    f.estado !== '',
    f.depositoId !== null,
    f.desde !== '',
    f.hasta !== '',
  ].filter(Boolean).length
}

/**
 * El listado de recepciones.
 *
 * Sin columna de importe: una recepción **no está valorizada** en el schema y
 * no se inventó una. Los filtros se pliegan en mobile, igual que en pedidos.
 */
export function RecepcionesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosRecepciones()
  const { data, isPending, isFetching, error, refetch } = useRecepciones(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const depositos = useDepositos()
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
   * Se lleva lo que muestran los filtros. **Sin importes**: la recepción no
   * está valorizada y no se le inventa un precio para llenar una columna.
   *
   * Va acá arriba, antes del `return` por permisos: un hook después de un
   * retorno temprano cambia el orden de los hooks entre renders.
   */
  const exportar = useMutation({
    mutationFn: () => exportarRecepciones(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `recepciones-${new Date().toISOString().slice(0, 10)}.csv`,
        recepcionesACsv(filas),
      ),
  })

  const ordenar = (columna: OrdenRecepciones) => {
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.verProveedores) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Notas de entrada" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const total = data?.total ?? 0
  const filas = data?.filas ?? []

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Notas de entrada"
        subtitle={isPending ? 'Cargando…' : contar(total, RECEPCIONES)}
        actions={
          <Button
            variant="secondary"
            icon={<Icon name="download" size={16} />}
            loading={exportar.isPending}
            disabled={total === 0}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending ? 'Exportando…' : 'Exportar a CSV'}
          </Button>
        }
      />

      <Alert tone="info">
        <p>Una recepción se crea desde un pedido de compra confirmado, con el botón «Recibir mercadería».</p>
      </Alert>

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
          <Field label="Buscar por número" hideLabel>
            <Input type="search" placeholder="Número de recepción: NTEP000…" value={texto} onChange={(e) => setTexto(e.target.value)} />
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
            <option value="">Borradores y confirmadas</option>
            <option value="draft">Borradores</option>
            <option value="confirmed">Confirmadas</option>
          </Select>
        </Field>

        {(depositos.data ?? []).length > 1 ? (
          <Field label="Depósito" hideLabel>
            <Select value={filtros.depositoId ?? ''} onChange={(e) => aplicar({ depositoId: e.target.value || null })}>
              <option value="">Todos los depósitos</option>
              {(depositos.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
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
      ) : !isPending && filas.length === 0 ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Sin resultados para estos filtros"
            description="No hay notas de entrada que coincidan. Probá con otro proveedor, estado o fecha."
            action={
              <Button variant="secondary" onClick={limpiar}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="package"
            title="Todavía no hay notas de entrada"
            description="Se generan desde un pedido de compra confirmado, al recibir la mercadería."
          />
        )
      ) : (
        <>
          <ListadoRecepciones filas={filas} orden={filtros.orden} direccion={filtros.direccion} onOrdenar={ordenar} cargando={isPending} />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={total}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
            sustantivo={RECEPCIONES}
          />
        </>
      )}
    </div>
  )
}
