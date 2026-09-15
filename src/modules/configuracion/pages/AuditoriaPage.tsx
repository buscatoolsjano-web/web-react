import { useId, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Pagination } from '@/components/tables/Pagination'
import { Icon } from '@/components/icons/Icon'
import { Button } from '@/components/ui/Button'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useDebounce } from '@/hooks/useDebounce'
import { useActoresAuditoria, useAuditoria } from '../hooks/useAuditoria'
import {
  FILTROS_VACIOS,
  MODULOS,
  POR_PAGINA_AUDITORIA,
  detallesSeguros,
  errorFechas,
  etiquetaActor,
  etiquetaEntidad,
  etiquetaEvento,
  etiquetaModulo,
  eventosDeModulo,
  formatearFechaHora,
  hayFiltros,
  resumenEvento,
  type EventoAuditoria,
  type FiltrosAuditoria,
  type Modulo,
} from '../lib/auditoria'
import { puedeVerAuditoria } from '../lib/permisos'
import { ErrorAuditoria } from '../services/auditoria'
import styles from '../components/Configuracion.module.css'

const EVENTOS = { singular: 'evento', plural: 'eventos' }

const codigo = (e: unknown) => (e instanceof ErrorAuditoria ? e.codigo : 'desconocido')

const MENSAJES: Record<string, string> = {
  sin_permiso: 'Sólo un administrador de la empresa puede ver la auditoría.',
  datos_invalidos: 'Algún filtro no es válido. Revisá las fechas.',
  sin_red: 'No hay conexión.',
  desconocido: 'No se pudo leer la auditoría.',
}

/**
 * Configuración → Auditoría: SÓLO ADMIN, SÓLO LECTURA.
 *
 * Qué cambió en Configuración de la empresa activa: usuarios y membresías,
 * datos y logo de la empresa, marcas y categorías, y autoridad de numeración.
 * Filtros y paginación en el servidor. No hay acciones de borrar ni editar.
 */
export function AuditoriaPage() {
  const { activa } = useEmpresa()
  if (!puedeVerAuditoria(activa?.rol)) {
    return (
      <>
        <PageHeader title="Auditoría" />
        <EmptyState icon="eye" title="Sin acceso a Auditoría" description="Sólo un administrador de la empresa puede ver la auditoría." />
      </>
    )
  }
  return <AuditoriaAdmin />
}

function AuditoriaAdmin() {
  const { activa } = useEmpresa()
  const [filtros, setFiltros] = useState<FiltrosAuditoria>(FILTROS_VACIOS)
  const [pagina, setPagina] = useState(0)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const texto = useDebounce(filtros.texto, 300)
  const rangoInvalido = errorFechas(filtros)
  const consulta = { ...filtros, texto }
  const q = useAuditoria(rangoInvalido ? { ...consulta, desde: '', hasta: '' } : consulta, pagina * POR_PAGINA_AUDITORIA, POR_PAGINA_AUDITORIA)
  const actores = useActoresAuditoria()
  const filas = q.data?.filas ?? []
  const total = q.data?.total ?? 0
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA_AUDITORIA) - 1)
  const ids = { desde: useId(), hasta: useId(), modulo: useId(), evento: useId(), actor: useId(), texto: useId() }

  const cambiar = (parcial: Partial<FiltrosAuditoria>) => {
    setFiltros((f) => {
      const n = { ...f, ...parcial }
      // Un evento que no es del módulo elegido deja de tener sentido.
      if (parcial.modulo !== undefined && n.evento && !eventosDeModulo(n.modulo).some((e) => e.codigo === n.evento)) n.evento = ''
      return n
    })
    setPagina(0)
  }

  const alternar = (clave: string) =>
    setAbiertos((s) => {
      const n = new Set(s)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })

  const columnas: Column<EventoAuditoria>[] = [
    { key: 'fecha', header: 'Fecha y hora', width: '8rem', render: (e) => <span className={styles.celdaAuditoria}>{formatearFechaHora(e.fecha)}</span> },
    {
      key: 'evento',
      header: 'Evento',
      mobile: 'title',
      render: (e) => (
        <span className={styles.celdaAuditoria}>
          <span className={styles.nombre}>{etiquetaEvento(e.evento)}</span>
          <span className={styles.email}>{etiquetaModulo(e.modulo)}</span>
        </span>
      ),
    },
    { key: 'actor', header: 'Actor', render: (e) => <Actor e={e} /> },
    { key: 'entidad', header: 'Entidad', render: (e) => <span className={styles.celdaAuditoria}>{etiquetaEntidad(e)}</span> },
    { key: 'resumen', header: 'Resumen', render: (e) => <Resumen e={e} abierto={abiertos.has(e.clave)} onAlternar={() => alternar(e.clave)} /> },
  ]

  return (
    <>
      <PageHeader
        title="Auditoría"
        subtitle={`Cambios de Configuración en ${activa?.companyName ?? 'la empresa'}. Nada se borra ni se edita desde acá.`}
        status={<Badge tone="neutral" outline>Sólo lectura</Badge>}
      />

      {/* Mismo estado y mismos valores: FilterBar sólo ordena (y pliega en mobile). */}
      <FilterBar
        label="Filtros de auditoría"
        activeCount={[filtros.desde, filtros.hasta, filtros.modulo, filtros.evento, filtros.actor].filter(Boolean).length}
        hasFilters={hayFiltros(filtros)}
        onClear={() => {
          setFiltros(FILTROS_VACIOS)
          setPagina(0)
        }}
        search={
          <Field label="Buscar" id={ids.texto}>
            <Input type="search" maxLength={100} placeholder="Nombre, email, marca, categoría o motivo" value={filtros.texto} onChange={(e) => cambiar({ texto: e.target.value })} />
          </Field>
        }
      >
        <Field label="Desde" id={ids.desde}>
          <Input type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} aria-invalid={!!rangoInvalido} aria-describedby={rangoInvalido ? `${ids.hasta}-error` : undefined} />
        </Field>
        <Field label="Hasta" id={ids.hasta}>
          <Input type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} aria-invalid={!!rangoInvalido} aria-describedby={rangoInvalido ? `${ids.hasta}-error` : undefined} />
        </Field>
        <Field label="Módulo" id={ids.modulo}>
          <Select value={filtros.modulo} onChange={(e) => cambiar({ modulo: e.target.value as Modulo | '' })}>
            <option value="">Todos</option>
            {Object.entries(MODULOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Evento" id={ids.evento}>
          <Select value={filtros.evento} onChange={(e) => cambiar({ evento: e.target.value })}>
            <option value="">Todos</option>
            {eventosDeModulo(filtros.modulo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.etiqueta}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Actor" id={ids.actor}>
          <Select value={filtros.actor} onChange={(e) => cambiar({ actor: e.target.value })} disabled={actores.isError}>
            <option value="">Todos</option>
            {(actores.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.etiqueta} ({a.eventos})
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      {rangoInvalido && (
        <p id={`${ids.hasta}-error`} className={styles.errorCampo} role="alert">
          <Icon name="alert-circle" size={16} />
          {rangoInvalido} No se aplica el rango de fechas.
        </p>
      )}

      {q.isError ? (
        <ErrorState
          title={MENSAJES[codigo(q.error)] ?? MENSAJES.desconocido!}
          onRetry={codigo(q.error) !== 'sin_permiso' ? () => void q.refetch() : undefined}
          retrying={q.isFetching}
        />
      ) : (
        <>
          <ResponsiveTable
            columns={columnas}
            rows={filas}
            rowKey={(e) => e.clave}
            isLoading={q.isPending}
            emptyMessage={hayFiltros(filtros) ? 'Ningún evento coincide con los filtros.' : 'Todavía no hay cambios de Configuración registrados en esta empresa.'}
            renderCard={(e) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  {columnas[1]!.render!(e)}
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Fecha</dt>
                  <dd>{formatearFechaHora(e.fecha)}</dd>
                  <dt>Actor</dt>
                  <dd>
                    <Actor e={e} />
                  </dd>
                  <dt>Entidad</dt>
                  <dd>{etiquetaEntidad(e)}</dd>
                </dl>
                <Resumen e={e} abierto={abiertos.has(e.clave)} onAlternar={() => alternar(e.clave)} />
              </article>
            )}
          />
          {/* «1 evento» / «N eventos»: el plural lo resuelve Pagination. */}
          <Pagination
            label="Páginas de auditoría"
            offset={pagina * POR_PAGINA_AUDITORIA}
            pageSize={POR_PAGINA_AUDITORIA}
            total={total}
            noun={EVENTOS}
            loading={q.isFetching}
            onChange={(offset) => setPagina(Math.min(ultimaPagina, Math.floor(offset / POR_PAGINA_AUDITORIA)))}
          />
        </>
      )}
    </>
  )
}

function Actor({ e }: { e: EventoAuditoria }) {
  const sinActor = !e.actor
  return (
    <span className={styles.celdaAuditoria}>
      <span className={sinActor ? styles.email : styles.nombre}>{etiquetaActor(e)}</span>
      {e.actor?.email && e.actor.nombre && <span className={styles.email}>{e.actor.email}</span>}
    </span>
  )
}

function Resumen({ e, abierto, onAlternar }: { e: EventoAuditoria; abierto: boolean; onAlternar: () => void }) {
  const id = useId()
  const resumen = resumenEvento(e)
  const detalles = detallesSeguros(e)
  return (
    <div className={styles.resumenAuditoria}>
      {resumen ? <span>{resumen}</span> : <span className={styles.email}>Sin más datos</span>}
      {detalles.length > 0 && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className={styles.botonDetalle}
            icon={<Icon name={abierto ? 'chevron-up' : 'chevron-down'} size={16} />}
            aria-expanded={abierto}
            aria-controls={id}
            onClick={onAlternar}
          >
            {abierto ? 'Ocultar detalle' : 'Ver detalle'}
          </Button>
          {abierto && (
            <dl id={id} className={styles.cardDatos}>
              {detalles.map((d) => (
                <div key={d.etiqueta} className={styles.filaDetalle}>
                  <dt>{d.etiqueta}</dt>
                  <dd>{d.valor}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  )
}
