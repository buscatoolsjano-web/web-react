import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { Dialogo } from '../components/Dialogo'
import { FormularioSerie } from '../components/FormularioSerie'
import { useAccionesNumeracion, useAutoridadSeries, useNumeracion, useSyncStel } from '../hooks/useEmpresaConfig'
import {
  alertas,
  etiquetaTipo,
  filasAutoridad,
  formatearNumero,
  mensajeErrorNumeracion,
  presentarAutoridad,
  presentarEmision,
  presentarEstado,
  presentarFilaAutoridad,
  type FilaAutoridad,
  type SecuenciaDiagnostico,
  type SerieValida,
} from '../lib/numeracion'
import { puedeAdministrarUsuarios } from '../lib/permisos'
import { desdeHace, fechaCorta, presentarEstadoSync, ETIQUETA_ENTIDAD, type SyncStel } from '../lib/sync-stel'
import { ErrorNumeracion } from '../services/numeracion'
import styles from '../components/Configuracion.module.css'

/**
 * Configuración → Numeración (Fase 58 · E3).
 *
 * ERA DE SÓLO LECTURA Y YA NO. Se escribió cuando STEL emitía: con
 * `authority = 'STEL'` la base bloquea la emisión desde el ERP y alinear la
 * numeración era una decisión de cutover, no un formulario. Hoy las 25
 * secuencias de las dos empresas están en ERP, así que el cartel quedó viejo.
 *
 * LA AUTORIDAD SE SIGUE RESPETANDO. Si algún tipo vuelve a STEL, las RPC
 * rechazan editarlo (`autoridad_externa`) y acá no se ofrece el botón.
 *
 * MÁS ACOTADA. Tenía seis columnas de diagnóstico —próximo, mayor existente,
 * documentos, fuera de patrón, atípicos, autoridad— más dos bloques fijos. El
 * mayor existente ya está dicho en el detalle del estado, y lo de autoridad
 * sólo aparece cuando tiene algo que decir: mientras todo sea ERP, mostrar una
 * columna con «ERP» veinticinco veces es ruido.
 */
export function NumeracionPage() {
  const { activa } = useEmpresa()
  const q = useNumeracion()
  const acciones = useAccionesNumeracion()
  const lista = q.data ?? []
  const series = useAutoridadSeries()

  /** Sólo un admin edita; para employee la pantalla sigue siendo de lectura. */
  const puedeEditar = puedeAdministrarUsuarios(activa?.rol)

  const [editando, setEditando] = useState<{ serie: SecuenciaDiagnostico | null } | null>(null)
  const [borrando, setBorrando] = useState<SecuenciaDiagnostico | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const ocupado = acciones.guardar.isPending || acciones.eliminar.isPending

  /* Lo de autoridad sólo si hay algo que no sea ERP. Es la compactación que
     importa: la pantalla deja de explicar un reparto que ya no existe. */
  const hayExterna =
    lista.some((s) => s.autoridad === 'STEL') || (series.data ?? []).some((s) => s.autoridad === 'STEL')

  const codigo = (e: unknown) => (e instanceof ErrorNumeracion ? e.codigo : 'desconocido')

  async function guardar(v: SerieValida) {
    setErrorDialogo(null)
    try {
      const r = await acciones.guardar.mutateAsync(v)
      setAviso({
        tono: 'ok',
        titulo: r === 'CREATED' ? `Serie ${v.serie} creada.` : `Serie ${v.serie} actualizada.`,
      })
      setEditando(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorNumeracion(codigo(e)))
    }
  }

  async function eliminar() {
    if (!borrando) return
    setErrorDialogo(null)
    try {
      await acciones.eliminar.mutateAsync({ docType: borrando.docType, serie: borrando.serie })
      setAviso({ tono: 'ok', titulo: `Serie ${borrando.serie} eliminada.` })
      setBorrando(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorNumeracion(codigo(e)))
    }
  }

  const columnas: Column<SecuenciaDiagnostico>[] = [
    {
      key: 'tipo',
      header: 'Tipo y serie',
      mobile: 'title',
      render: (s) => (
        <span className={cx(styles.persona, styles.celdaTipo)}>
          <span className={styles.nombre}>
            {etiquetaTipo(s.docType)}
            {s.esDefault && (
              <Badge tone="brand" className={styles.propia}>
                predeterminada
              </Badge>
            )}
          </span>
          <span className={styles.email}>
            Serie {s.serie}
            {s.prefijo !== s.serie ? ` · prefijo ${s.prefijo}` : ''}
            {' · '}
            {s.documentos.toLocaleString('es-AR')} {s.documentos === 1 ? 'documento' : 'documentos'}
          </span>
          {/* Entre 768 y 1279px la columna del próximo se oculta: el dato va acá. */}
          <span className={cx(styles.email, styles.soloTablaCompacta)}>
            Próximo <code className={styles.codigo}>{s.proximo}</code>
          </span>
        </span>
      ),
    },
    {
      key: 'proximo',
      header: 'Próximo',
      hideBelow: 'xl',
      render: (s) => <code className={styles.codigo}>{s.proximo}</code>,
    },
    { key: 'estado', header: 'Estado', render: (s) => <Chip p={presentarEstado(s)} /> },
    // Sólo cuando hay algo que no sea ERP: ver `hayExterna`.
    ...(hayExterna
      ? [
          {
            key: 'autoridad',
            header: 'Autoridad',
            render: (s: SecuenciaDiagnostico) => (
              <span className={cx(styles.chips, styles.chipsApilados)}>
                <Chip p={presentarAutoridad(s.autoridad)} />
                {s.autoridad === 'STEL' && <Chip p={presentarEmision(s.autoridad)} />}
              </span>
            ),
          } satisfies Column<SecuenciaDiagnostico>,
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Numeración"
        subtitle={`Con qué número sale cada documento de ${activa?.companyName ?? 'la empresa'}.`}
        {...(puedeEditar
          ? {
              actions: (
                <Button icon={<Icon name="plus" size={16} />} onClick={() => { setErrorDialogo(null); setEditando({ serie: null }) }} disabled={ocupado || q.isError}>
                  Nueva serie
                </Button>
              ),
            }
          : { status: <Badge tone="warning" dot>Sólo lectura</Badge> })}
      />

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} />}

      {q.isError ? (
        <StatusMessage tono="error" titulo={q.error.message === 'sin_permiso' ? 'Tu rol no tiene acceso a la numeración.' : 'No se pudo leer la numeración.'} />
      ) : (
        <>
          {alertas(lista).map((a) => (
            <Alert key={a} tone="warning" role="note">
              <p>{a}</p>
            </Alert>
          ))}

          {hayExterna && <AutoridadDeEmision />}

          <ResponsiveTable
            columns={columnas}
            rows={lista}
            rowKey={(s) => `${s.docType}:${s.serie}`}
            isLoading={q.isPending}
            emptyMessage="Esta empresa no tiene secuencias configuradas."
            {...(puedeEditar
              ? {
                  actions: (s: SecuenciaDiagnostico) => (
                    <AccionesDeSerie s={s} ocupado={ocupado} onEditar={() => { setErrorDialogo(null); setEditando({ serie: s }) }} onEliminar={() => { setErrorDialogo(null); setBorrando(s) }} />
                  ),
                }
              : {})}
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
                  <dd>{s.maxSinAtipicos === null ? '—' : <code className={styles.codigo}>{formatearNumero(s, s.maxSinAtipicos)}</code>}</dd>
                  {/* Lo que numera STEL tiene que decirlo también acá. En la
                      tabla es una columna que se oculta con la compactación;
                      en mobile no hay columna donde esconderlo, y era justo
                      el dato que no se puede perder. */}
                  {s.autoridad === 'STEL' && (
                    <>
                      <dt>Autoridad</dt>
                      <dd>
                        <Chip p={presentarAutoridad(s.autoridad)} />
                      </dd>
                      <dt>Estado de emisión</dt>
                      <dd>
                        <Chip p={presentarEmision(s.autoridad)} />
                      </dd>
                    </>
                  )}
                </dl>
                <p className={styles.nota}>{presentarEstado(s).detalle}</p>
                {puedeEditar && (
                  <div className={styles.cardAcciones}>
                    <AccionesDeSerie s={s} ocupado={ocupado} onEditar={() => { setErrorDialogo(null); setEditando({ serie: s }) }} onEliminar={() => { setErrorDialogo(null); setBorrando(s) }} />
                  </div>
                )}
              </article>
            )}
          />

          <p className={styles.nota}>
            El «próximo» es el número que va a llevar el siguiente documento que se emita. No puede quedar en o por
            debajo de uno ya emitido con el mismo prefijo: la base lo rechaza para no repetir. «Atípicos» son números
            mal tipeados marcados en la importación, y no cuentan para el estado.
          </p>

          <SincronizacionStel />
        </>
      )}

      {editando && (
        <FormularioSerie
          serie={editando.serie}
          secuencias={lista}
          guardando={acciones.guardar.isPending}
          error={errorDialogo}
          onGuardar={(v) => void guardar(v)}
          onCerrar={() => { if (!ocupado) setEditando(null) }}
        />
      )}

      {borrando && (
        <Dialogo
          titulo={`Eliminar la serie ${borrando.serie}`}
          bloqueado={ocupado}
          onCerrar={() => { if (!ocupado) setBorrando(null) }}
          pie={
            <>
              <Button variant="secondary" onClick={() => setBorrando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void eliminar()} disabled={ocupado}>
                {ocupado ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>
            La serie {borrando.serie} de {etiquetaTipo(borrando.docType).toLowerCase()} deja de existir. Sólo se puede
            si todavía no emitió ningún documento: si ya emitió, la base lo rechaza, porque su prefijo es lo que permite
            reconocer esos números.
          </p>
          {errorDialogo && <StatusMessage tono="error" titulo={errorDialogo} />}
        </Dialogo>
      )}
    </>
  )
}

function AccionesDeSerie({
  s,
  ocupado,
  onEditar,
  onEliminar,
}: {
  s: SecuenciaDiagnostico
  ocupado: boolean
  onEditar: () => void
  onEliminar: () => void
}) {
  // Lo que numera otro sistema no se edita desde acá: la RPC lo rechaza igual.
  const externa = s.autoridad === 'STEL'
  const motivo = externa ? 'Este tipo lo numera STEL: su secuencia no se edita desde el ERP.' : undefined
  return (
    <span className={styles.acciones}>
      <Button variant="secondary" onClick={onEditar} disabled={ocupado || externa} title={motivo}>
        Editar
      </Button>
      <Button
        variant="ghost"
        onClick={onEliminar}
        disabled={ocupado || externa || s.esDefault}
        title={s.esDefault ? 'Es la serie predeterminada: marcá otra antes de eliminarla.' : motivo}
      >
        Eliminar
      </Button>
    </span>
  )
}

/**
 * Desde qué sistema se emite cada serie. Se muestra SÓLO si hay algo que no sea
 * ERP (ver `hayExterna`): con todo en ERP era un bloque que repetía «ERP» y no
 * ayudaba a entender nada.
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
