import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { useDebounce } from '@/hooks/useDebounce'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosActivos, PanelFacetas } from '../components/PanelFacetas'
import { ListadoProductos } from '../components/ListadoProductos'
import { useFacetas, useListasDePrecios } from '../hooks/useCatalogoFacetas'
import { useDisponibilidad, useProductos } from '../hooks/useProductos'
import { useFiltrosCatalogo } from '../hooks/useFiltrosCatalogo'
import { contarFiltrosActivos } from '../lib/planDeConsulta'
import { debePropagarBusqueda } from '../lib/busquedaDiferida'
import { OPCIONES_POR_PAGINA } from '../types'
import styles from './CatalogoPage.module.css'

const PRODUCTO = { singular: 'producto', plural: 'productos' } as const

export function CatalogoPage() {
  const { activa } = useEmpresa()
  const { filtros, actualizar, limpiar } = useFiltrosCatalogo()

  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  // El input es local y se vuelca a la URL con retraso: así no se dispara
  // una consulta por cada tecla.
  const [textoInput, setTextoInput] = useState(filtros.q)
  const textoDiferido = useDebounce(textoInput, 300)

  // La URL es la fuente de verdad, así que el input tiene que seguirla
  // cuando cambia POR FUERA: al abrir un link con ?q=, o al usar los
  // botones atrás/adelante del navegador. Sin esto el input se quedaba con
  // su valor inicial y el efecto de abajo pisaba la URL con ese valor
  // viejo, borrando la búsqueda.
  //
  // Se ajusta durante el render (patrón oficial de React para estado
  // derivado) y no en un useEffect, que provocaría un render en cascada.
  const [qUrlPrevia, setQUrlPrevia] = useState(filtros.q)
  if (qUrlPrevia !== filtros.q) {
    setQUrlPrevia(filtros.q)
    // Se compara contra el texto recortado: si el cambio lo originó este
    // mismo input, no hay que pisar lo que la persona está tipeando.
    if (filtros.q !== textoInput.trim()) setTextoInput(filtros.q)
  }

  // La condición está en una función pura y testeada: sincronizar sólo el
  // input no alcanzaba. Cuando la URL cambia por fuera, el valor diferido
  // se queda 300 ms con el anterior, y propagarlo en esa ventana pisaba la
  // URL con el valor viejo y borraba la búsqueda. Ver busquedaDiferida.ts.
  useEffect(() => {
    if (debePropagarBusqueda(textoInput, textoDiferido, filtros.q)) {
      actualizar({ q: textoDiferido })
    }
  }, [textoInput, textoDiferido, filtros.q, actualizar])

  const { listas, porDefecto, puedeElegir, cargando: listasCargando } = useListasDePrecios(companyId)
  const [listaElegida, setListaElegida] = useState<string | null>(null)

  // La lista efectiva sale de lo que RLS dejó ver. Un externo recibe una
  // sola, así que no hay nada que elegir; un interno puede cambiarla, pero
  // sólo entre las que ya le llegaron.
  const listaEfectiva = useMemo(
    () => listas.find((l) => l.id === listaElegida) ?? porDefecto,
    [listas, listaElegida, porDefecto],
  )

  // Las opciones de cada filtro salen del servidor y dependen de los filtros
  // activos: sin categoría elegida se ven las 25 marcas, con Balanceadores
  // sólo las 3 que tienen balanceadores.
  const { data: facetas, isFetching: facetasCargando } = useFacetas(companyId, filtros)

  // Un valor suelto como "1" en una card no dice nada; "1 kg" sí. Las
  // unidades salen de las facetas, que ya vienen con label y unidad.
  const unidades = useMemo(
    () => new Map((facetas?.atributos ?? []).map((a) => [a.key, a.unidad] as const)),
    [facetas],
  )

  const { data, isPending, isFetching, error, refetch } = useProductos(filtros, listaEfectiva?.id ?? null, !listasCargando)
  const productos = useMemo(() => data?.productos ?? [], [data])
  const total = data?.total ?? 0

  const idsPagina = useMemo(() => productos.map((p) => p.id), [productos])
  const { data: disponibilidad } = useDisponibilidad(idsPagina)

  const activos = contarFiltrosActivos(filtros)
  const hayFiltros = activos > 0 || filtros.q !== ''
  const limpiarTodo = () => {
    limpiar()
    setTextoInput('')
  }

  if (!activa) {
    return (
      <div className={styles.cargando}>
        <Spinner label="Cargando empresa…" />
      </div>
    )
  }

  const vacio = !isPending && !error && productos.length === 0
  const moneda = listaEfectiva?.moneda ?? null

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Catálogo"
        subtitle={
          <>
            {isPending ? 'Cargando…' : contar(total, PRODUCTO)}
            {listaEfectiva ? ` · ${listaEfectiva.nombre}` : ''}
          </>
        }
      />

      <FilterBar
        label="Buscar y filtrar productos"
        activeCount={activos}
        search={
          <div className={styles.busqueda}>
            <Field label="Buscar productos" hideLabel className={styles.buscador}>
              <Input
                type="search"
                value={textoInput}
                onChange={(e) => setTextoInput(e.target.value)}
                placeholder="Buscar por SKU o nombre…"
              />
            </Field>
            <span className={styles.lupa} aria-hidden="true">
              {isFetching && !isPending ? <Spinner size={16} /> : <Icon name="search" size={16} />}
            </span>
            {puedeElegir && (
              <Field label="Lista de precios" hideLabel className={styles.lista}>
                <Select value={listaEfectiva?.id ?? ''} onChange={(e) => setListaElegida(e.target.value)}>
                  {listas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        }
      >
        <PanelFacetas filtros={filtros} facetas={facetas} cargando={facetasCargando} onCambiar={actualizar} />
      </FilterBar>

      <FiltrosActivos filtros={filtros} facetas={facetas} onCambiar={actualizar} onLimpiar={limpiarTodo} />

      {error ? (
        <ErrorState
          title="No se pudo cargar el catálogo."
          description={error instanceof Error ? error.message : String(error)}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : vacio ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Ningún producto coincide"
            description="Probá con otra búsqueda o quitá algún filtro."
            action={
              <Button variant="secondary" onClick={limpiarTodo}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState icon="package" title="Todavía no hay productos" description="Esta empresa no tiene productos cargados en el catálogo." />
        )
      ) : (
        <>
          <ListadoProductos
            productos={productos}
            esInterno={esInterno}
            moneda={moneda}
            disponibilidad={disponibilidad}
            unidades={unidades}
            cargando={isPending}
          />
          {total > 0 ? (
            <Pagination
              label="Paginación del catálogo"
              offset={(filtros.pagina - 1) * filtros.porPagina}
              pageSize={filtros.porPagina}
              total={total}
              noun={PRODUCTO}
              loading={isFetching}
              onChange={(offset) => actualizar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
              pageSizeOptions={OPCIONES_POR_PAGINA}
              onPageSizeChange={(porPagina) => actualizar({ porPagina })}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
