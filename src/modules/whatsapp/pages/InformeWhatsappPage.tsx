import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useInformeGuardado, useInformeWhatsapp } from '../hooks/useWhatsapp'
import { puedeAsignar, puedeUsarWhatsapp } from '../lib/permisos'
import {
  ATAJOS_PERIODO,
  ETIQUETA_ACTOR,
  ETIQUETA_ESTADO_CONVERSACION,
  agruparConversaciones,
  atajoPeriodo,
  compromisosVencidos,
  diaLocal,
  fechaCorta,
  momento,
  periodoDiario,
  periodoSemanal,
  presentarMotivos,
  type Agrupacion,
  type ConversacionInforme,
  type InformeWhatsapp,
  type ItemIA,
} from '../lib/ia'
import styles from './InformeWhatsapp.module.css'

type Vista = 'diario' | 'semanal'

const AGRUPACIONES: { valor: Agrupacion; etiqueta: string }[] = [
  { valor: 'contacto', etiqueta: 'Contacto' },
  { valor: 'cliente', etiqueta: 'Cliente' },
  { valor: 'asignado', etiqueta: 'Asignado' },
]

const sumarDias = (dia: string, n: number) => {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** El enlace que abre la conversación en la bandeja, y si hay, lleva al mensaje fuente. */
const enlace = (conversacion: string, mensaje?: string) =>
  `/whatsapp?conversacion=${conversacion}${mensaje ? `&mensaje=${mensaje}` : ''}`

/**
 * Informes de WhatsApp: diario y semanal.
 *
 * Se arman a demanda en la base con lo que ya existe —conversaciones,
 * mensajes, resúmenes y sugerencias—. Abrir el informe NO llama a la IA ni
 * escribe nada, y no manda nada a nadie.
 *
 * Fase 16 · E3: si el período tiene un snapshot guardado (informes
 * programados), administración ve ESE snapshot y se dice cuándo se generó. Si
 * no hay, se calcula en vivo como siempre. Un vendedor ve siempre el informe en
 * vivo de lo suyo: los snapshots son de toda la empresa.
 *
 * Cada persona ve el informe de lo que puede ver: un vendedor, el de sus
 * conversaciones asignadas. No se mezclan empresas.
 *
 * Sólo hechos: cuántas conversaciones, cuáles esperan respuesta, qué quedó
 * pendiente. Ningún puntaje ni ranking de personas.
 */
export function InformeWhatsappPage() {
  const { activa } = useEmpresa()
  const tabsId = useId()
  const [vista, setVista] = useState<Vista>('diario')
  const [dia, setDia] = useState(() => diaLocal(new Date()))
  const [agrupar, setAgrupar] = useState<Agrupacion>('contacto')

  const periodo = useMemo(() => (vista === 'diario' ? periodoDiario(dia) : periodoSemanal(dia)), [vista, dia])
  const administracion = puedeAsignar(activa?.rol)
  const guardado = useInformeGuardado(vista === 'diario' ? 'daily' : 'weekly', periodo.desde, periodo.hasta, administracion)
  // En vivo sólo si no hay snapshot (o si el rol no los ve): no se piden los dos.
  const usarVivo = !administracion || (guardado.isSuccess && guardado.data === null) || guardado.isError
  const vivo = useInformeWhatsapp(periodo.desde, periodo.hasta, usarVivo)
  const snapshot = administracion ? (guardado.data ?? null) : null
  const informe = snapshot
    ? { data: snapshot.informe, isPending: false as const, error: null, refetch: guardado.refetch }
    : administracion && guardado.isPending
      ? { data: undefined, isPending: true as const, error: null, refetch: guardado.refetch }
      : vivo
  const hoy = diaLocal(new Date())

  if (!puedeUsarWhatsapp(activa?.rol)) {
    return (
      <EmptyState
        headingLevel={1}
        icon="bar-chart"
        title="Los informes de WhatsApp no están disponibles para tu rol"
        description="Son para administración, empleados y vendedores con conversaciones asignadas."
      />
    )
  }

  const paso = vista === 'diario' ? 1 : 7

  return (
    <div className={styles.pagina}>
      <PageHeader
        back={{ to: '/whatsapp', label: 'WhatsApp' }}
        title="Informes de WhatsApp"
        subtitle="Lo que pasó en las conversaciones que podés ver. Se arma con los mensajes y las sugerencias ya guardadas."
      />

      <Tabs
        id={tabsId}
        label="Período del informe"
        value={vista}
        onChange={setVista}
        items={[
          { key: 'diario', label: 'Diario' },
          { key: 'semanal', label: 'Semanal' },
        ]}
      />

      <TabPanel tabsId={tabsId} tabKey={vista} className={styles.panel}>
        <div className={styles.atajos} role="group" aria-label="Períodos rápidos">
          {ATAJOS_PERIODO.map((a) => {
            const destino = atajoPeriodo(a.clave, hoy)
            const activo = destino.vista === vista && (vista === 'diario' ? destino.dia === dia : periodoSemanal(destino.dia).desde === periodo.desde)
            return (
              <Button
                key={a.clave}
                variant={activo ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={activo}
                onClick={() => {
                  setVista(destino.vista)
                  setDia(destino.dia)
                }}
              >
                {a.etiqueta}
              </Button>
            )
          })}
        </div>

        <div className={styles.controles}>
          <div className={styles.navegacion}>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="chevron-left" size={16} />}
              onClick={() => setDia((d) => sumarDias(d, -paso))}
            >
              {vista === 'diario' ? 'Día anterior' : 'Semana anterior'}
            </Button>
            <Field label={vista === 'diario' ? 'Día' : 'Un día de la semana'} className={styles.campoFecha}>
              <Input type="date" value={dia} max={diaLocal(new Date())} onChange={(e) => e.target.value && setDia(e.target.value)} />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon name="chevron-right" size={16} />}
              disabled={sumarDias(dia, paso) > diaLocal(new Date())}
              onClick={() => setDia((d) => sumarDias(d, paso))}
            >
              {vista === 'diario' ? 'Día siguiente' : 'Semana siguiente'}
            </Button>
          </div>
          <p className={styles.periodo}>{periodo.etiqueta}</p>
        </div>
        {!informe.isPending && !informe.error ? (
          <p className={styles.origen} role="status">
            {snapshot ? (
              <>
                <Badge tone="neutral" outline>Informe guardado</Badge> Generado {momento(snapshot.generadoEn)}, con los datos hasta
                ese momento.
              </>
            ) : (
              <>
                <Badge tone="neutral" outline>En vivo</Badge> Calculado ahora con los datos actuales.
              </>
            )}
          </p>
        ) : null}

        {informe.isPending ? (
          <SkeletonRows rows={4} columns={3} label="Armando el informe…" />
        ) : informe.error ? (
          <ErrorState title="No se pudo armar el informe." description={informe.error.message} onRetry={() => void informe.refetch()} />
        ) : informe.data.totales.conversacionesActivas === 0 && informe.data.items.length === 0 ? (
          <EmptyState
            icon="message-circle"
            title="Sin actividad en el período"
            description="No hubo mensajes en las conversaciones que podés ver."
          />
        ) : (
          <Contenido informe={informe.data} vista={vista} agrupar={agrupar} onAgrupar={setAgrupar} />
        )}
      </TabPanel>
    </div>
  )
}

function Contenido({
  informe,
  vista,
  agrupar,
  onAgrupar,
}: {
  informe: InformeWhatsapp
  vista: Vista
  agrupar: Agrupacion
  onAgrupar: (a: Agrupacion) => void
}) {
  const t = informe.totales
  const porConversacion = new Map(informe.conversaciones.map((c) => [c.id, c]))
  const abiertos = informe.items.filter((i) => i.estado === 'open')
  const vencidos = compromisosVencidos(informe.items, diaLocal(new Date()))

  const tiles =
    vista === 'diario'
      ? [
          { etiqueta: 'Conversaciones activas', valor: t.conversacionesActivas },
          { etiqueta: 'Conversaciones nuevas', valor: t.conversacionesNuevas },
          { etiqueta: 'Sin respuesta', valor: t.sinRespuesta, alerta: t.sinRespuesta > 0 },
          { etiqueta: 'Sin asignar', valor: t.sinAsignar },
          { etiqueta: 'Errores de envío', valor: t.erroresEnvio, alerta: t.erroresEnvio > 0 },
          { etiqueta: 'Pendientes abiertos', valor: t.pendientesAbiertos },
          { etiqueta: 'Compromisos detectados', valor: t.compromisos },
          { etiqueta: 'Decisiones detectadas', valor: t.decisiones },
        ]
      : [
          { etiqueta: 'Conversaciones activas', valor: t.conversacionesActivas },
          { etiqueta: 'Mensajes recibidos', valor: t.mensajesEntrantes },
          { etiqueta: 'Mensajes enviados', valor: t.mensajesSalientes },
          { etiqueta: 'Pendientes abiertos', valor: t.pendientesAbiertos },
          { etiqueta: 'Pendientes resueltos', valor: t.pendientesResueltos },
          { etiqueta: 'Compromisos vencidos', valor: t.compromisosVencidos, alerta: t.compromisosVencidos > 0 },
          { etiqueta: 'Decisiones detectadas', valor: t.decisiones },
          { etiqueta: 'Errores de envío', valor: t.erroresEnvio, alerta: t.erroresEnvio > 0 },
        ]

  const relevantes = informe.conversaciones.filter((c) => c.motivos.length > 0 || c.nueva || vista === 'semanal')
  const grupos = agruparConversaciones(relevantes, agrupar)

  return (
    <>
      <ul className={styles.tiles} aria-label="Totales del período">
        {tiles.map((x) => (
          <li key={x.etiqueta} className={styles.tile}>
            <span className={styles.tileEtiqueta}>{x.etiqueta}</span>
            <span className={styles.tileValor}>{x.valor}</span>
            {/* Un número a revisar se marca con ícono y texto, no sólo con color. */}
            {x.alerta ? (
              <span className={styles.tileAlerta}>
                <Icon name="alert-triangle" size={16} /> Revisar
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className={styles.nota}>
        Pendientes, compromisos y decisiones son <strong>sugerencias</strong> del análisis de IA sobre las conversaciones
        que alguien pidió analizar. Cada una enlaza al mensaje de donde salió.
      </p>

      <section className={styles.seccion} aria-labelledby="inf-conversaciones">
        <div className={styles.seccionCabecera}>
          <h2 id="inf-conversaciones" className={styles.seccionTitulo}>
            {vista === 'diario' ? 'Conversaciones relevantes' : 'Conversaciones activas'}
          </h2>
          <div className={styles.agrupar} role="group" aria-label="Agrupar por">
            <span className={styles.agruparEtiqueta}>Agrupar por</span>
            {AGRUPACIONES.map((a) => (
              <Button
                key={a.valor}
                size="sm"
                variant={agrupar === a.valor ? 'secondary' : 'ghost'}
                aria-pressed={agrupar === a.valor}
                onClick={() => onAgrupar(a.valor)}
              >
                {a.etiqueta}
              </Button>
            ))}
          </div>
        </div>
        {grupos.length === 0 ? (
          <p className={styles.vacio}>Ninguna conversación espera respuesta ni es nueva en el período.</p>
        ) : (
          <div className={styles.grupos}>
            {grupos.map((g) => (
              <section key={g.clave} className={styles.grupo} aria-label={g.titulo}>
                {agrupar !== 'contacto' ? <h3 className={styles.grupoTitulo}>{g.titulo}</h3> : null}
                <ul className={styles.lista}>
                  {g.conversaciones.map((c) => (
                    <FilaConversacion key={c.id} c={c} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      <ListaItems
        id="inf-pendientes"
        titulo="Pendientes y seguimientos"
        items={abiertos.filter((i) => i.tipo === 'pending' || i.tipo === 'follow_up' || i.tipo === 'next_step')}
        conversaciones={porConversacion}
        vacio="No hay pendientes abiertos."
      />
      <ListaItems
        id="inf-compromisos"
        titulo="Compromisos abiertos"
        items={informe.items.filter((i) => i.tipo === 'commitment' && i.estado === 'open')}
        conversaciones={porConversacion}
        vencidos={new Set(vencidos.map((v) => v.id))}
        vacio="No se detectaron compromisos abiertos."
      />
      <ListaItems
        id="inf-decisiones"
        titulo="Decisiones"
        // Una decisión descartada por una persona no es una decisión.
        items={informe.items.filter((i) => i.tipo === 'decision' && i.estado !== 'dismissed')}
        conversaciones={porConversacion}
        vacio="No se detectaron decisiones."
      />
      <ListaItems
        id="inf-importantes"
        titulo="Mensajes importantes"
        items={abiertos.filter((i) => i.tipo === 'important')}
        conversaciones={porConversacion}
        vacio="Nada marcado como importante."
      />

      {vista === 'semanal' ? (
        <div className={styles.columnas}>
          <section className={styles.seccion} aria-labelledby="inf-temas">
            <h2 id="inf-temas" className={styles.seccionTitulo}>Temas frecuentes</h2>
            {informe.temas.length === 0 ? (
              <p className={styles.vacio}>Todavía no hay temas: hacen falta conversaciones analizadas.</p>
            ) : (
              <ul className={styles.conteos}>
                {informe.temas.map((x) => (
                  <li key={x.tema}>
                    <span>{x.tema}</span>
                    <span className={styles.conteo}>{x.veces} conv.</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={styles.seccion} aria-labelledby="inf-asignados">
            <h2 id="inf-asignados" className={styles.seccionTitulo}>Conversaciones por asignado</h2>
            <p className={styles.nota}>Cantidad de conversaciones con actividad. No mide desempeño.</p>
            <ul className={styles.conteos}>
              {informe.porAsignado.map((p) => (
                <li key={p.asignadoId ?? 'sin'}>
                  <span>{p.asignadoId ? (p.asignado ?? 'Sin nombre') : 'Sin asignar'}</span>
                  <span className={styles.conteo}>{p.conversaciones}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </>
  )
}

function FilaConversacion({ c }: { c: ConversacionInforme }) {
  const motivos = presentarMotivos(c.motivos)
  return (
    <li className={styles.fila}>
      <div className={styles.filaCabecera}>
        <Link to={enlace(c.id)} className={styles.filaNombre}>
          {c.contacto ?? 'Sin nombre'}
        </Link>
        <span className={styles.filaHora}>{momento(c.ultimoMensajeEn)}</span>
      </div>
      <div className={styles.etiquetas}>
        {c.nueva ? <Badge tone="info">Nueva</Badge> : null}
        {c.cliente ? <Badge tone="neutral" outline>{c.cliente}</Badge> : <Badge tone="neutral" outline>Sin cliente</Badge>}
        {c.asignado ? <Badge tone="neutral">{c.asignado}</Badge> : <Badge tone="neutral">Sin asignar</Badge>}
        {c.estadoIA ? <Badge tone="neutral" outline>{ETIQUETA_ESTADO_CONVERSACION[c.estadoIA]}</Badge> : null}
        {motivos.map((m) => (
          <Badge key={m} tone="warning" dot>{m}</Badge>
        ))}
      </div>
      {c.resumen ? <p className={styles.filaResumen}>{c.resumen}</p> : null}
    </li>
  )
}

function ListaItems({
  id,
  titulo,
  items,
  conversaciones,
  vencidos,
  vacio,
}: {
  id: string
  titulo: string
  items: readonly ItemIA[]
  conversaciones: Map<string, ConversacionInforme>
  vencidos?: Set<string> | undefined
  vacio: string
}) {
  return (
    <section className={styles.seccion} aria-labelledby={id}>
      <h2 id={id} className={styles.seccionTitulo}>
        {titulo} <span className={styles.cuenta}>{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className={styles.vacio}>{vacio}</p>
      ) : (
        <ul className={styles.lista}>
          {items.map((i) => {
            const c = conversaciones.get(i.conversacionId)
            const vencido = vencidos?.has(i.id) ?? false
            return (
              <li key={i.id} className={styles.fila}>
                <p className={styles.filaTexto}>{i.descripcion}</p>
                <div className={styles.etiquetas}>
                  <span className={styles.filaContacto}>{c?.contacto ?? 'Conversación'}</span>
                  {i.tipo === 'commitment' ? <Badge tone="neutral" outline>{ETIQUETA_ACTOR[i.actor]}</Badge> : null}
                  {i.venceEn ? (
                    <Badge tone={vencido ? 'danger' : 'info'}>
                      {vencido ? 'Vencido · ' : 'Vence '}
                      {fechaCorta(i.venceEn)}
                    </Badge>
                  ) : null}
                  {i.estado !== 'open' ? <Badge tone="success">{i.estado === 'resolved' ? 'Resuelto' : 'Descartado'}</Badge> : null}
                  {i.fuentes[0] ? (
                    <Link to={enlace(i.conversacionId, i.fuentes[0])} className={styles.fuente}>
                      <Icon name="message-circle" size={16} /> Ver mensaje
                    </Link>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
