import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Dialog } from '@/components/modals/Dialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useDebounce } from '@/hooks/useDebounce'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { fichaCompartida, listarCompartido, type FiltrosCompartido } from '../services/compartido'
import { formatearPrecio } from '../lib/formato'
import styles from './CatalogoCompartido.module.css'

const POR_PAGINA = 48
const PRODUCTO = { singular: 'producto', plural: 'productos' } as const

/**
 * El catálogo de un distribuidor (2026-11-27) — Fase 2.
 *
 * Es el catálogo que le comparte su proveedor (Buscatools), en vivo y sin
 * copiarlo: lo que se saca del lado del proveedor deja de verse acá al
 * instante. Muestra SU precio (el de distribuidor), nunca costos. Todo pasa
 * por `catalogo_compartido_listar` / `_producto`: una consulta por pantalla.
 */
export function CatalogoCompartido() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const q = useDebounce(texto.trim(), 250)
  const [filtros, setFiltros] = useState<Omit<FiltrosCompartido, 'q' | 'porPagina'>>({ categoria: null, marca: null, pagina: 1 })
  const [abierto, setAbierto] = useState<string | null>(null)

  // Una búsqueda nueva vuelve a la página 1: se guarda con qué texto se paginó.
  const [qPaginada, setQPaginada] = useState(q)
  if (qPaginada !== q) {
    setQPaginada(q)
    if (filtros.pagina !== 1) setFiltros({ ...filtros, pagina: 1 })
  }

  const consulta = useQuery({
    queryKey: ['catalogo-compartido', companyId, q, filtros],
    queryFn: () => listarCompartido(companyId!, { q, ...filtros, porPagina: POR_PAGINA }),
    enabled: companyId !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const data = consulta.data

  if (consulta.isPending) return <SkeletonRows rows={8} columns={4} label="Cargando el catálogo…" />
  if (consulta.error) {
    return (
      <ErrorState
        title="No se pudo cargar el catálogo."
        description={consulta.error.message}
        onRetry={() => void consulta.refetch()}
        retrying={consulta.isFetching}
      />
    )
  }
  if (!data?.proveedor) {
    return (
      <>
        <PageHeader title="Catálogo" />
        <EmptyState
          icon="package"
          title="Todavía no tenés un catálogo"
          description="Cuando tu proveedor te comparta su catálogo, lo vas a ver acá con tus precios."
        />
      </>
    )
  }

  const moneda = data.moneda

  return (
    <div className={styles.pagina}>
      <PageHeader
        title="Catálogo"
        subtitle={`${data.total.toLocaleString('es-AR')} productos de ${data.proveedor} · precios de distribuidor${moneda ? ` en ${moneda}` : ''}`}
      />

      <div className={styles.filtros}>
        <Field label="Buscar" hideLabel className={styles.buscar}>
          <Input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por SKU, nombre o marca…"
          />
        </Field>
        <Field label="Rubro" hideLabel>
          <Select
            value={filtros.categoria ?? ''}
            onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value || null, pagina: 1 })}
          >
            <option value="">Todos los rubros</option>
            {data.categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.cantidad.toLocaleString('es-AR')})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marca" hideLabel>
          <Select
            value={filtros.marca ?? ''}
            onChange={(e) => setFiltros({ ...filtros, marca: e.target.value || null, pagina: 1 })}
          >
            <option value="">Todas las marcas</option>
            {data.marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre} ({m.cantidad.toLocaleString('es-AR')})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {data.productos.length === 0 ? (
        <EmptyState icon="search" title="Ningún producto coincide" description="Probá con otra búsqueda o sacá algún filtro." />
      ) : (
        <ul className={styles.grilla} aria-busy={consulta.isFetching}>
          {data.productos.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.tarjeta} onClick={() => setAbierto(p.id)}>
                <span className={styles.foto}>
                  {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : null}
                </span>
                <span className={styles.sku}>{p.sku}</span>
                <span className={styles.nombre}>{p.nombre}</span>
                {p.marca ? <span className={styles.marca}>{p.marca.nombre}</span> : null}
                <span className={styles.precio}>{p.precio === null ? 'Consultar' : formatearPrecio(p.precio, moneda)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {data.total > POR_PAGINA ? (
        <Pagination
          label="Paginación del catálogo"
          offset={(filtros.pagina - 1) * POR_PAGINA}
          pageSize={POR_PAGINA}
          total={data.total}
          noun={PRODUCTO}
          loading={consulta.isFetching}
          onChange={(offset) => setFiltros({ ...filtros, pagina: Math.floor(offset / POR_PAGINA) + 1 })}
        />
      ) : null}

      {abierto && companyId ? (
        <FichaCompartida companyId={companyId} productId={abierto} onCerrar={() => setAbierto(null)} />
      ) : null}
    </div>
  )
}

function FichaCompartida({ companyId, productId, onCerrar }: { companyId: string; productId: string; onCerrar: () => void }) {
  const q = useQuery({
    queryKey: ['catalogo-compartido', companyId, 'ficha', productId],
    queryFn: () => fichaCompartida(companyId, productId),
    staleTime: 5 * 60_000,
  })
  const f = q.data
  return (
    <Dialog open onClose={onCerrar} size="lg" title={f ? f.nombre : 'Producto'} description={f ? `${f.sku}${f.marca ? ` · ${f.marca.nombre}` : ''}` : undefined}>
      {q.isPending ? (
        <SkeletonRows rows={4} columns={2} label="Cargando el producto…" />
      ) : !f ? (
        <EmptyState icon="package" title="Este producto ya no está disponible" compact />
      ) : (
        <div className={styles.ficha}>
          {f.imagenes.length > 0 ? (
            <div className={styles.fotos}>
              {f.imagenes.map((url) => (
                <img key={url} src={url} alt="" loading="lazy" />
              ))}
            </div>
          ) : null}
          <p className={styles.precioFicha}>{f.precio === null ? 'Precio a consultar' : formatearPrecio(f.precio, f.moneda)}</p>
          {f.descripcion ? <p>{f.descripcion}</p> : null}
          {f.atributos.length > 0 ? (
            <dl className={styles.atributos}>
              {f.atributos.map((a) => (
                <div key={a.etiqueta}>
                  <dt>{a.etiqueta}</dt>
                  <dd>
                    {a.valor}
                    {a.unidad ? ` ${a.unidad}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {f.descripcionLarga ? <p className={styles.larga}>{f.descripcionLarga}</p> : null}
        </div>
      )}
    </Dialog>
  )
}
