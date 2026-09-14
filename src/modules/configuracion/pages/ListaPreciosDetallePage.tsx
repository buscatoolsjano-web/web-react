import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useDebounce } from '@/hooks/useDebounce'
import { cx } from '@/utils/cx'
import { useClientesDeLista, useItemsDeLista, useListasPrecios } from '../hooks/useMaestros'
import {
  AUTORIDAD,
  POR_PAGINA,
  formatearFechaCorta,
  formatearPrecio,
  mensajeErrorMaestro,
  presentarVigencia,
  rangoPagina,
  textoVigenciaLista,
  type ItemPrecio,
  type Vigencia,
} from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

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

  const volver = (
    <Link to="/configuracion/listas-precios" className={styles.enlace}>
      ← Listas de precios
    </Link>
  )

  if (listas.isError || (listas.data && !lista)) {
    const cod = listas.isError ? codigo(listas.error) : 'no_encontrado'
    return (
      <>
        {volver}
        <StatusMessage tono="error" titulo={cod === 'no_encontrado' ? 'Esta lista no existe en la empresa activa.' : mensajeErrorMaestro(cod)} />
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
      {volver}
      <div className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>{lista?.nombre ?? 'Lista de precios'}</h1>
          <p className={styles.subtitulo}>
            {lista ? `${lista.moneda} · ${lista.porDefecto ? 'predeterminada de la empresa · ' : ''}${textoVigenciaLista(lista)}` : 'Cargando…'}
          </p>
        </div>
      </div>

      <StatusMessage tono="pending" titulo={AUTORIDAD.listas.titulo} detalle={AUTORIDAD.listas.detalle} />

      <section className={styles.fieldset} aria-labelledby="clientes-lista">
        <h2 id="clientes-lista" className={styles.legend}>
          Clientes con esta lista por defecto
        </h2>
        {clientes.isPending ? (
          <p className={styles.nota}>Cargando…</p>
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
        <input
          className={cx(styles.control, styles.buscar)}
          type="search"
          placeholder="Buscar por SKU o producto"
          aria-label="Buscar precio por SKU o producto"
          maxLength={100}
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value)
            setPagina(0)
          }}
        />
        <select
          className={styles.selectFiltro}
          aria-label="Filtrar por vigencia"
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
        </select>
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
          <nav className={styles.paginador} aria-label="Páginas de precios">
            <Button variant="secondary" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || items.isFetching}>
              Anterior
            </Button>
            <span className={styles.nota} role="status" aria-live="polite">
              {items.isFetching ? 'Cargando…' : rangoPagina(pagina * POR_PAGINA, filas.length, total)}
            </span>
            <Button variant="secondary" onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina || items.isFetching}>
              Siguiente
            </Button>
          </nav>
        </>
      )}
    </>
  )
}

function ChipVigencia({ v }: { v: Vigencia }) {
  const p = presentarVigencia(v)
  return <span className={cx(styles.chip, styles[`tono_${p.tono}`])}>{p.etiqueta}</span>
}
