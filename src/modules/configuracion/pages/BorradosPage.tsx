import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Pagination } from '@/components/tables/Pagination'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useDebounce } from '@/hooks/useDebounce'
import {
  ENTIDADES_BORRABLES,
  etiquetaDeAccion,
  etiquetaDeEntidad,
  formatearMomento,
  resumenDeCopia,
} from '../lib/borrados'
import { puedeVerConfiguracion } from '../lib/permisos'
import {
  FILTROS_BORRADOS_VACIOS,
  listarBorrados,
  type Borrado,
  type FiltrosBorrados,
} from '../services/borrados'
import styles from '../components/Configuracion.module.css'
import propios from './BorradosPage.module.css'

const BORRADOS = { singular: 'borrado', plural: 'borrados' }

/**
 * Configuración → Borrados (Fase 40).
 *
 * Qué se borró, quién lo borró, cuándo y **por qué**. Es el único lugar donde
 * eso queda: la auditoría de cada documento cuelga del documento y se va con
 * él, así que un borrado no deja rastro en ningún otro lado.
 *
 * Guarda además una copia de la fila entera. No es para restaurar con un
 * botón —eso sería prometer más de lo que se puede cumplir, porque las líneas,
 * los adjuntos y los vínculos no están— sino para que alguien pueda rehacer a
 * mano lo que se borró por error, sabiendo exactamente qué decía.
 *
 * Sólo lectura, y no por elección de la pantalla: `deletion_log` no tiene
 * policy de insert, update ni delete. Un historial que se puede editar no es
 * un historial.
 */
export function BorradosPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [filtros, setFiltros] = useState<FiltrosBorrados>(FILTROS_BORRADOS_VACIOS)
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const q = useDebounce(filtros.q, 300)

  const consulta = useQuery({
    queryKey: ['configuracion', companyId, 'borrados', { ...filtros, q }],
    queryFn: () => listarBorrados(companyId!, { ...filtros, q }),
    enabled: companyId !== null,
    staleTime: 30_000,
  })

  if (!puedeVerConfiguracion(activa?.rol)) {
    return (
      <>
        <PageHeader title="Borrados" />
        <EmptyState icon="trash" title="Sin acceso" description="Tu rol en esta empresa no tiene acceso a Configuración." />
      </>
    )
  }

  const filas = consulta.data?.filas ?? []
  const total = consulta.data?.total ?? 0
  const hayFiltros = filtros.q.trim() !== '' || filtros.entidad !== null

  const alternar = (id: number) =>
    setAbiertos((previos) => {
      const n = new Set(previos)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const columnas: Column<Borrado>[] = [
    {
      key: 'cuando',
      header: 'Cuándo',
      width: '10rem',
      hideBelow: 'lg',
      render: (b) => <span className={styles.celdaAuditoria}>{formatearMomento(b.cuando)}</span>,
    },
    {
      key: 'que',
      header: 'Qué',
      mobile: 'title',
      render: (b) => (
        <span className={styles.celdaAuditoria}>
          <span className={styles.nombre}>{b.etiqueta ?? 'Sin nombre'}</span>
          <span className={styles.email}>{etiquetaDeEntidad(b.entidad)}</span>
        </span>
      ),
    },
    {
      key: 'accion',
      header: 'Acción',
      width: '7rem',
      render: (b) => (
        <Badge tone={b.accion === 'deactivate' ? 'warning' : 'danger'} outline>
          {etiquetaDeAccion(b.accion)}
        </Badge>
      ),
    },
    {
      key: 'quien',
      header: 'Quién',
      render: (b) => <span className={styles.celdaAuditoria}>{b.quien ?? 'Sin registrar'}</span>,
    },
    {
      key: 'motivo',
      header: 'Por qué',
      render: (b) => <Motivo b={b} abierto={abiertos.has(b.id)} onAlternar={() => alternar(b.id)} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Borrados"
        subtitle={`Lo que se borró en ${activa?.companyName ?? 'la empresa'}, con el motivo y una copia de lo que decía.`}
        status={
          <Badge tone="neutral" outline>
            Sólo lectura
          </Badge>
        }
      />

      <FilterBar
        label="Filtros de borrados"
        activeCount={filtros.entidad ? 1 : 0}
        hasFilters={hayFiltros}
        onClear={() => setFiltros(FILTROS_BORRADOS_VACIOS)}
        search={
          <Field label="Buscar por nombre o motivo" hideLabel>
            <Input
              type="search"
              placeholder="Número, nombre o motivo…"
              value={filtros.q}
              onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value, pagina: 1 }))}
            />
          </Field>
        }
      >
        <Field label="Tipo" hideLabel>
          <Select
            value={filtros.entidad ?? ''}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, entidad: e.target.value || null, pagina: 1 }))
            }
          >
            <option value="">Todo</option>
            {ENTIDADES_BORRABLES.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {consulta.isError ? (
        <ErrorState
          title="No se pudo leer el registro de borrados."
          onRetry={() => void consulta.refetch()}
          retrying={consulta.isFetching}
        />
      ) : (
        <>
          <ResponsiveTable
            columns={columnas}
            rows={filas}
            rowKey={(b) => String(b.id)}
            isLoading={consulta.isPending}
            emptyMessage={
              hayFiltros
                ? 'Ningún borrado coincide con los filtros.'
                : 'Todavía no se borró nada en esta empresa.'
            }
            renderCard={(b) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>{columnas[1]!.render!(b)}</div>
                <dl className={styles.cardDatos}>
                  <dt>Cuándo</dt>
                  <dd>{formatearMomento(b.cuando)}</dd>
                  <dt>Quién</dt>
                  <dd>{b.quien ?? 'Sin registrar'}</dd>
                  <dt>Acción</dt>
                  <dd>{etiquetaDeAccion(b.accion)}</dd>
                </dl>
                <Motivo b={b} abierto={abiertos.has(b.id)} onAlternar={() => alternar(b.id)} />
              </article>
            )}
          />
          <Pagination
            label="Páginas de borrados"
            offset={(filtros.pagina - 1) * filtros.porPagina}
            pageSize={filtros.porPagina}
            total={total}
            noun={BORRADOS}
            loading={consulta.isFetching}
            onChange={(offset) =>
              setFiltros((f) => ({ ...f, pagina: Math.floor(offset / f.porPagina) + 1 }))
            }
          />
        </>
      )}
    </>
  )
}

/**
 * El motivo, y detrás de un clic lo que la fila decía.
 *
 * La copia va plegada porque es material de consulta: el 95 % de las veces lo
 * que se busca es el motivo, y mostrar veinte campos al lado lo escondería.
 */
function Motivo({ b, abierto, onAlternar }: { b: Borrado; abierto: boolean; onAlternar: () => void }) {
  const campos = resumenDeCopia(b.copia)
  return (
    <div className={propios.motivo}>
      <p className={propios.texto}>{b.motivo}</p>
      {campos.length > 0 ? (
        <>
          <button type="button" className={propios.ver} aria-expanded={abierto} onClick={onAlternar}>
            {abierto ? 'Ocultar lo que decía' : 'Ver lo que decía'}
          </button>
          {abierto ? (
            <dl className={propios.copia}>
              {campos.map((c) => (
                <div key={c.clave} className={propios.campo}>
                  <dt>{c.clave}</dt>
                  <dd>{c.valor}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
