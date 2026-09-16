import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Alert } from '@/components/feedback/Alert'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { useAutoridadSeries, useNumeracion, useSyncStel } from '../hooks/useEmpresaConfig'
import { alertas, etiquetaTipo, filasAutoridad, formatearNumero, presentarAutoridad, presentarEmision, presentarEstado, presentarFilaAutoridad, type FilaAutoridad, type SecuenciaDiagnostico } from '../lib/numeracion'
import { desdeHace, fechaCorta, presentarEstadoSync, ETIQUETA_ENTIDAD, type SyncStel } from '../lib/sync-stel'
import styles from '../components/Configuracion.module.css'

/**
 * Configuración → Numeración: SÓLO LECTURA.
 *
 * Muestra cada secuencia contra los documentos que hay en esta base. No hay
 * botones para cambiar prefijos, próximos números, resetear ni cambiar la
 * autoridad: mientras STEL siga emitiendo, alinear la numeración es una
 * decisión de cutover.
 */
export function NumeracionPage() {
  const { activa } = useEmpresa()
  const q = useNumeracion()
  const lista = q.data ?? []

  const columnas: Column<SecuenciaDiagnostico>[] = [
    {
      key: 'tipo',
      header: 'Tipo de documento',
      mobile: 'title',
      render: (s) => (
        <span className={cx(styles.persona, styles.celdaTipo)}>
          <span className={styles.nombre}>{etiquetaTipo(s.docType)}</span>
          <span className={styles.email}>
            Prefijo {s.prefijo}
            {s.serie && s.serie !== s.prefijo ? ` · serie ${s.serie}` : ''}
            {s.esDefault ? '' : ' · no predeterminada'}
          </span>
          {/* Entre 768 y 1279px las columnas de números se ocultan: el dato va acá. */}
          <span className={cx(styles.email, styles.soloTablaCompacta)}>
            Próximo <code className={styles.codigo}>{s.proximo}</code>
            {s.maxSinAtipicos !== null ? <> · mayor <code className={styles.codigo}>{formatearNumero(s, s.maxSinAtipicos)}</code></> : null}
            {' · '}
            {s.documentos.toLocaleString('es-AR')} {s.documentos === 1 ? 'documento' : 'documentos'}
          </span>
        </span>
      ),
    },
    { key: 'proximo', header: 'Próximo (servidor)', hideBelow: 'xl', render: (s) => <code className={styles.codigo}>{s.proximo}</code> },
    {
      key: 'max',
      header: 'Mayor existente',
      hideBelow: 'xl',
      render: (s) =>
        s.maxSinAtipicos === null ? (
          '—'
        ) : (
          <span>
            <code className={styles.codigo}>{formatearNumero(s, s.maxSinAtipicos)}</code>
            {s.atipicosPorEncima > 0 && (
              <span className={styles.email}> (+{s.atipicosPorEncima} atípicos, hasta {formatearNumero(s, s.maxNumero)})</span>
            )}
          </span>
        ),
    },
    {
      key: 'docs',
      header: 'Documentos',
      hideBelow: 'xl',
      align: 'right',
      render: (s) => (
        <span>
          {s.documentos.toLocaleString('es-AR')}
          {s.fueraPatron > 0 && <span className={styles.email}> ({s.fueraPatron} fuera de patrón)</span>}
        </span>
      ),
    },
    { key: 'estado', header: 'Estado', render: (s) => <Chip p={presentarEstado(s)} /> },
    {
      key: 'autoridad',
      header: 'Autoridad',
      render: (s) => (
        <span className={cx(styles.chips, styles.chipsApilados)}>
          <Chip p={presentarAutoridad(s.autoridad)} />
          {s.autoridad === 'STEL' && <Chip p={presentarEmision(s.autoridad)} />}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Numeración" subtitle={`Secuencias de ${activa?.companyName ?? 'la empresa'} comparadas con los documentos de esta base.`} status={<Badge tone="warning" dot>Sólo lectura</Badge>} />

      <StatusMessage
        tono="pending"
        titulo="Sólo lectura"
        detalle="La autoridad define desde qué sistema se emite cada tipo o serie de documento. Las secuencias muestran el próximo número reservado para emitir desde el ERP. Nada de esto se edita acá."
      />

      <AutoridadDeEmision />

      {q.isError ? (
        <StatusMessage tono="error" titulo={q.error.message === 'sin_permiso' ? 'Tu rol no tiene acceso a la numeración.' : 'No se pudo leer la numeración.'} />
      ) : (
        <>
          {alertas(lista).map((a) => (
            <Alert key={a} tone="warning" role="note">
              <p>{a}</p>
            </Alert>
          ))}
          <ResponsiveTable
            columns={columnas}
            rows={lista}
            rowKey={(s) => `${s.docType}:${s.serie}`}
            isLoading={q.isPending}
            emptyMessage="Esta empresa no tiene secuencias configuradas."
            renderCard={(s) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  {columnas[0]!.render!(s)}
                  <Chip p={presentarEstado(s)} />
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Próximo</dt>
                  <dd>
                    <code className={styles.codigo}>{s.proximo}</code>
                  </dd>
                  <dt>Mayor existente</dt>
                  <dd>{columnas[2]!.render!(s)}</dd>
                  <dt>Documentos</dt>
                  <dd>{columnas[3]!.render!(s)}</dd>
                  <dt>Autoridad</dt>
                  <dd>
                    <Chip p={presentarAutoridad(s.autoridad)} />
                  </dd>
                  <dt>Estado de emisión</dt>
                  <dd>
                    <Chip p={presentarEmision(s.autoridad)} />
                  </dd>
                </dl>
                <p className={styles.nota}>{presentarEstado(s).detalle}</p>
              </article>
            )}
          />
          <p className={styles.nota}>
            «Autoridad» viene de la base y no se edita desde acá: donde dice STEL, la base bloquea la emisión desde el ERP y
            sólo un cutover auditado la pasa a ERP. Los tipos sin autoridad configurada los numera el ERP. «Atípicos» son
            números mal tipeados marcados en la importación; no se tienen en cuenta para el estado.
          </p>
          <SincronizacionStel />
        </>
      )}
    </>
  )
}

/**
 * Desde qué sistema se emite cada serie. Sale de la base: la autoridad del tipo
 * y, si la hay, la excepción de serie. Con RT-ML es la única forma de ver que
 * los remitos de MercadoLibre siguen siendo de STEL aunque el resto sea del ERP.
 * Si la consulta de excepciones falla, quedan las filas por tipo.
 */
function AutoridadDeEmision() {
  const secuencias = useNumeracion()
  const series = useAutoridadSeries()
  if (secuencias.isPending || secuencias.isError) return null
  const filas = filasAutoridad(secuencias.data ?? [], series.data ?? [])
  if (filas.length === 0) return null
  return (
    <section className={styles.bloqueSync} aria-labelledby="autoridad-emision">
      <h2 id="autoridad-emision" className={styles.subtituloSync}>
        Autoridad de emisión
      </h2>
      <ul className={styles.listaSimple}>
        {filas.map((f) => (
          <FilaDeAutoridad key={`${f.docType}/${f.serie}`} f={f} />
        ))}
      </ul>
      {series.isError && (
        <p className={styles.nota}>No se pudieron leer las excepciones por serie: se muestra la autoridad de cada tipo.</p>
      )}
    </section>
  )
}

function FilaDeAutoridad({ f }: { f: FilaAutoridad }) {
  const p = presentarFilaAutoridad(f)
  return (
    <li className={styles.filaSync}>
      <span className={styles.persona}>
        <span className={styles.nombre}>
          {f.etiqueta} · {f.serie}
        </span>
        <span className={styles.email}>
          {f.proximo === null ? 'Secuencia del ERP: no aplica' : <>Próximo número del ERP: <code className={styles.codigo}>{f.proximo}</code></>}
          {f.porSerie ? ' · excepción de esta serie' : ''}
        </span>
      </span>
      <Chip p={p} />
    </li>
  )
}

/**
 * Observabilidad del sync con STEL: qué se sincronizó, cuándo y si falló.
 * No hay botón para lanzarlo: lo corre el servidor. Para roles que no son admin
 * la consulta no devuelve nada y la sección no aparece.
 */
function SincronizacionStel() {
  const q = useSyncStel()
  if (q.isPending || q.isError || (q.data ?? []).length === 0) return null
  return (
    <section className={styles.bloqueSync} aria-labelledby="sync-stel">
      <h2 id="sync-stel" className={styles.subtituloSync}>
        Sincronización con STEL
      </h2>
      <ul className={styles.listaSimple}>
        {q.data.map((s) => (
          <FilaSync key={s.entidad} s={s} />
        ))}
      </ul>
      <p className={styles.nota}>
        El sync trae de STEL el catálogo y los documentos nuevos. Corre en el servidor y guarda hasta dónde llegó, así un
        reintento no repite trabajo. Si una corrida falla, el punto de control no avanza.
      </p>
    </section>
  )
}

function FilaSync({ s }: { s: SyncStel }) {
  const p = presentarEstadoSync(s)
  return (
    <li className={styles.filaSync}>
      <span className={styles.persona}>
        <span className={styles.nombre}>{ETIQUETA_ENTIDAD[s.entidad] ?? s.entidad}</span>
        <span className={styles.email}>
          Última corrida {desdeHace(s.fin ?? s.inicio)} ({fechaCorta(s.fin ?? s.inicio)}) · {s.llamadas} llamada{s.llamadas === 1 ? '' : 's'} a STEL
        </span>
        <span className={styles.email}>
          Punto de control: {s.checkpoint ? fechaCorta(s.checkpoint) : 'sin punto de control todavía'}
          {s.ultimoVisto ? ` · último visto ${s.ultimoVisto}` : ''}
        </span>
        {s.error && <span className={styles.email}>{s.error}</span>}
      </span>
      <Chip p={p} />
    </li>
  )
}

const TONO_BADGE: Record<string, BadgeTone> = { ok: 'success', alerta: 'warning', error: 'danger', neutro: 'neutral' }

/**
 * Estado, autoridad o emisión. El detalle queda en el `title` (y escrito en la card mobile).
 * Puede pasar a dos renglones: con el tamaño «Grande», «Emisión desde ERP bloqueada»
 * no entra en una card de 390px ni en una columna apretada.
 */
function Chip({ p }: { p: { etiqueta: string; tono: string; detalle: string } }) {
  const tono = TONO_BADGE[p.tono] ?? 'neutral'
  return (
    <span title={p.detalle} className={styles.chip}>
      <Badge tone={tono} dot={tono === 'warning' || tono === 'danger'}>
        {p.etiqueta}
      </Badge>
    </span>
  )
}
