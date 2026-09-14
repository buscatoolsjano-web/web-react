import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useDebounce } from '@/hooks/useDebounce'
import { cx } from '@/utils/cx'
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
import { rangoPagina } from '../lib/maestros'
import { puedeVerAuditoria } from '../lib/permisos'
import { ErrorAuditoria } from '../services/auditoria'
import styles from '../components/Configuracion.module.css'

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
        <h1 className={styles.titulo}>Auditoría</h1>
        <p className={styles.vacio}>Sólo un administrador de la empresa puede ver la auditoría.</p>
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
      <div className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Auditoría</h1>
          <p className={styles.subtitulo}>Cambios de Configuración en {activa?.companyName ?? 'la empresa'}. Sólo lectura: nada se borra ni se edita desde acá.</p>
        </div>
      </div>

      <form className={styles.filtrosAuditoria} onSubmit={(ev) => ev.preventDefault()} aria-label="Filtros de auditoría">
        <label className={styles.campo} htmlFor={ids.desde}>
          <span className={styles.etiqueta}>Desde</span>
          <input id={ids.desde} className={styles.control} type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => cambiar({ desde: e.target.value })} aria-invalid={!!rangoInvalido} aria-describedby={rangoInvalido ? `${ids.hasta}-error` : undefined} />
        </label>
        <label className={styles.campo} htmlFor={ids.hasta}>
          <span className={styles.etiqueta}>Hasta</span>
          <input id={ids.hasta} className={styles.control} type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => cambiar({ hasta: e.target.value })} aria-invalid={!!rangoInvalido} aria-describedby={rangoInvalido ? `${ids.hasta}-error` : undefined} />
        </label>
        <label className={styles.campo} htmlFor={ids.modulo}>
          <span className={styles.etiqueta}>Módulo</span>
          <select id={ids.modulo} className={styles.control} value={filtros.modulo} onChange={(e) => cambiar({ modulo: e.target.value as Modulo | '' })}>
            <option value="">Todos</option>
            {Object.entries(MODULOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.campo} htmlFor={ids.evento}>
          <span className={styles.etiqueta}>Evento</span>
          <select id={ids.evento} className={styles.control} value={filtros.evento} onChange={(e) => cambiar({ evento: e.target.value })}>
            <option value="">Todos</option>
            {eventosDeModulo(filtros.modulo).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.campo} htmlFor={ids.actor}>
          <span className={styles.etiqueta}>Actor</span>
          <select id={ids.actor} className={styles.control} value={filtros.actor} onChange={(e) => cambiar({ actor: e.target.value })} disabled={actores.isError}>
            <option value="">Todos</option>
            {(actores.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.etiqueta} ({a.eventos})
              </option>
            ))}
          </select>
        </label>
        <label className={cx(styles.campo, styles.campoAncho)} htmlFor={ids.texto}>
          <span className={styles.etiqueta}>Buscar</span>
          <input id={ids.texto} className={styles.control} type="search" maxLength={100} placeholder="Nombre, email, marca, categoría o motivo" value={filtros.texto} onChange={(e) => cambiar({ texto: e.target.value })} />
        </label>
        {rangoInvalido && (
          <p id={`${ids.hasta}-error`} className={cx(styles.errorCampo, styles.campoAncho)} role="alert">
            {rangoInvalido} No se aplica el rango de fechas.
          </p>
        )}
        {hayFiltros(filtros) && (
          <div className={styles.campoAncho}>
            <Button
              variant="secondary"
              onClick={() => {
                setFiltros(FILTROS_VACIOS)
                setPagina(0)
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </form>

      {q.isError ? (
        <div className={styles.page}>
          <StatusMessage tono="error" titulo={MENSAJES[codigo(q.error)] ?? MENSAJES.desconocido!} />
          {codigo(q.error) !== 'sin_permiso' && (
            <div>
              <Button variant="secondary" onClick={() => void q.refetch()} disabled={q.isFetching}>
                {q.isFetching ? 'Reintentando…' : 'Reintentar'}
              </Button>
            </div>
          )}
        </div>
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
          <nav className={styles.paginador} aria-label="Páginas de auditoría">
            <Button variant="secondary" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0 || q.isFetching}>
              Anterior
            </Button>
            <span className={styles.nota} role="status" aria-live="polite">
              {q.isFetching ? 'Cargando…' : total === 0 ? '0 eventos' : `${rangoPagina(pagina * POR_PAGINA_AUDITORIA, filas.length, total)} eventos`}
            </span>
            <Button variant="secondary" onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina || q.isFetching}>
              Siguiente
            </Button>
          </nav>
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
          <button type="button" className={styles.botonDetalle} aria-expanded={abierto} aria-controls={id} onClick={onAlternar}>
            {abierto ? 'Ocultar detalle' : 'Ver detalle'}
          </button>
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
