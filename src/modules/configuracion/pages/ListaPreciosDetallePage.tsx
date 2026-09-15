import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Pagination } from '@/components/tables/Pagination'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useClientesDeLista, useItemsDeLista, useListasPrecios } from '../hooks/useMaestros'
import {
  AUTORIDAD,
  POR_PAGINA,
  formatearFechaCorta,
  formatearPrecio,
  mensajeErrorMaestro,
  presentarVigencia,
  textoVigenciaLista,
  type ItemPrecio,
  type Vigencia,
} from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

const PRECIOS = { singular: 'precio', plural: 'precios' }
const VOLVER = { to: '/configuracion/listas-precios', label: 'Listas de precios' }

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Detalle de una lista de precios: SÓLO LECTURA. Los precios se piden de a
 * página al servidor (50 por vez), con búsqueda y filtro de vigencia en la base:
 * la lista base tiene más de 12.000 precios y no se bajan enteros.
 */
export function ListaPreciosDetallePage() {
  const { id = '' } = useParams<{ id: string }>()
  const listas = useListasPrecios()
  const lista = listas.data?.find((l) => l.id === id) ?? null
  const clientes = useClientesDeLista(id)

  const [busqueda, setBusqueda] = useState('')
  const [vigencia, setVigencia] = useState<'todas' | Vigencia>('todas')
  const [pagina, setPagina] = useState(0)
  const busquedaDiferida = useDebounce(busqueda, 300)
  const consulta = { busqueda: busquedaDiferida, vigencia, desplazamiento: pagina * POR_PAGINA, limite: POR_PAGINA }
  const items = useItemsDeLista(id, consulta)
  const filas = items.data?.filas ?? []
  const total = items.data?.total ?? 0
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1)
  const moneda = lista?.moneda ?? ''

  if (listas.isError || (listas.data && !lista)) {
    const cod = listas.isError ? codigo(listas.error) : 'no_encontrado'
    return (
      <>
        <PageHeader title="Lista de precios" back={VOLVER} />
        {cod === 'no_encontrado' ? (
          <EmptyState icon="search" title="Esta lista no existe en la empresa activa." />
        ) : (
          <ErrorState title={mensajeErrorMaestro(cod)} />
        )}
      </>
    )
  }

  const columnas: Column<ItemPrecio>[] = [
    {
      key: 'producto',
      header: 'Producto',
      mobile: 'title',
      render: (i) => (
        <span className={styles.persona}>
          <span className={styles.nombre}>{i.nombre}</span>
          <span className={styles.email}>
            <code className={styles.codigo}>{i.sku}</code>
            {i.marca ? ` · ${i.marca}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'precio', header: 'Precio', align: 'right', width: '10rem', render: (i) => <span className={styles.importe}>{formatearPrecio(i.importe, moneda)}</span> },
    {
      key: 'vigencia',
      header: 'Vigencia',
      width: '12rem',
      render: (i) => (
        <span className={styles.chips}>
          <ChipVigencia v={i.vigencia} />
          <span className={styles.email}>
            {formatearFechaCorta(i.desde)}
            {i.hasta ? ` – ${formatearFechaCorta(i.hasta)}` : ''}
          </span>
        </span>
      ),
    },
    { key: 'estado', header: 'Producto', width: '8rem', render: (i) => (i.estadoProducto === 'active' ? 'Activo' : i.estadoProducto === 'baja' ? 'Dado de baja' : i.estadoProducto) },
  ]

  return (
    <>
      <PageHeader
        back={VOLVER}
        title={lista?.nombre ?? 'Lista de precios'}
        subtitle={lista ? `${lista.moneda} · ${lista.porDefecto ? 'predeterminada de la empresa · ' : ''}${textoVigenciaLista(lista)}` : 'Cargando…'}
        status={<Badge tone="neutral" outline>Sólo lectura</Badge>}
      />

      <StatusMessage tono="pending" titulo={AUTORIDAD.listas.titulo} detalle={AUTORIDAD.listas.detalle} />

      <section className={styles.fieldset} aria-labelledby="clientes-lista">
        <h2 id="clientes-lista" className={styles.legend}>
          Clientes con esta lista por defecto
        </h2>
        {clientes.isPending ? (
          <SkeletonRows rows={2} columns={1} label="Cargando clientes…" />
        ) : clientes.isError ? (
          <StatusMessage tono="error" titulo={mensajeErrorMaestro(codigo(clientes.error))} />
        ) : clientes.data.total === 0 ? (
          <p className={styles.nota}>Ningún cliente la tiene como lista por defecto.</p>
        ) : (
          <>
            <ul className={styles.listaSimple}>
              {clientes.data.filas.map((c) => (
                <li key={c.id}>{c.nombre}</li>
              ))}
            </ul>
            {clientes.data.total > clientes.data.filas.length && (
              <p className={styles.nota}>
                Se muestran {clientes.data.filas.length} de {clientes.data.total.toLocaleString('es-AR')}.
              </p>
            )}
          </>
        )}
      </section>

      <h2 className={styles.legend}>Precios</h2>
      <div className={styles.barra}>
        <Field label="Buscar precio por SKU o producto" hideLabel className={styles.buscar}>
          <Input
            type="search"
            placeholder="Buscar por SKU o producto"
            maxLength={100}
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value)
              setPagina(0)
            }}
          />
        </Field>
        <Field label="Filtrar por vigencia" hideLabel className={styles.selectFiltro}>
          <Select
            value={vigencia}
            onChange={(e) => {
              setVigencia(e.target.value as 'todas' | Vigencia)
              setPagina(0)
            }}
          >
            <option value="todas">Todas las vigencias</option>
            <option value="vigente">Vigentes</option>
            <option value="futura">Futuras</option>
            <option value="vencida">Vencidas</option>
          </Select>
        </Field>
      </div>

      {items.isError ? (
        <StatusMessage tono="error" titulo={mensajeErrorMaestro(codigo(items.error))} />
      ) : (
        <>
          <ResponsiveTable
            columns={columnas}
            rows={filas}
            rowKey={(i) => i.id}
            isLoading={items.isPending}
            emptyMessage={busquedaDiferida || vigencia !== 'todas' ? 'Ningún precio coincide con la búsqueda.' : 'Esta lista no tiene precios.'}
          />
          <Pagination
            label="Páginas de precios"
            offset={pagina * POR_PAGINA}
            pageSize={POR_PAGINA}
            total={total}
            noun={PRECIOS}
            loading={items.isFetching}
            onChange={(offset) => setPagina(Math.min(ultimaPagina, Math.floor(offset / POR_PAGINA)))}
          />
        </>
      )}
    </>
  )
}

function ChipVigencia({ v }: { v: Vigencia }) {
  const p = presentarVigencia(v)
  if (p.tono === 'ok') return <Badge tone="success">{p.etiqueta}</Badge>
  if (p.tono === 'alerta') return <Badge tone="warning" dot>{p.etiqueta}</Badge>
  return <Badge tone="neutral" outline>{p.etiqueta}</Badge>
}
