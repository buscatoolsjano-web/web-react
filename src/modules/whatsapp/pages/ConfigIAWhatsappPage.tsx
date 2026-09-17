import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select, Switch } from '@/components/forms/controls'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { puedeConfigurarIA } from '../lib/permisos'
import { clavesIA, useConfigIA, useMetricasIA } from '../hooks/useWhatsapp'
import {
  DEBOUNCE_MAX,
  DEBOUNCE_MIN,
  DESCRIPCION_MODO,
  DIAS_SEMANA,
  ETIQUETA_MODO,
  MODELO_VISIBLE,
  PROVEEDOR_VISIBLE,
  ZONA_HORARIA,
  alertasIA,
  cambiosConfig,
  erroresConfig,
  formularioDesdeConfig,
  miles,
  modoDe,
  textoErrorConfig,
  textoErrorTrabajo,
  usd,
  type ConfigIA,
  type FormularioIA,
  type MetricasIA,
  type MetricasPeriodo,
  type ModoIA,
} from '../lib/configIA'
import { momento } from '../lib/ia'
import { ErrorConfigIA, guardarConfigIA, reintentarAnalisis } from '../services/configIA'
import styles from './ConfigIAWhatsapp.module.css'

const TONO_MODO: Record<ModoIA, BadgeTone> = { desactivada: 'neutral', manual: 'info', automatica: 'success' }

/**
 * Configuración → WhatsApp · IA. Sólo admin.
 *
 * Un solo lugar para: el modo (desactivada / manual / automática), el kill
 * switch, el debounce, los límites diarios, los informes programados y el uso
 * y costo. Proveedor y modelo se muestran, no se eligen: son de servidor.
 *
 * Guardado explícito con la versión leída: si otro admin guardó antes, la base
 * lo rechaza y no se pisa nada.
 */
export function ConfigIAWhatsappPage() {
  const { activa } = useEmpresa()
  const esAdmin = puedeConfigurarIA(activa?.rol)
  const config = useConfigIA(esAdmin)
  const metricas = useMetricasIA(esAdmin)
  // Acá y no en el formulario: guardar cambia la versión y remonta el formulario.
  const [aviso, setAviso] = useState<Aviso | null>(null)

  if (!esAdmin) {
    return (
      <EmptyState
        headingLevel={1}
        icon="settings"
        title="Sin acceso a la IA de WhatsApp"
        description="Sólo un administrador de la empresa puede ver y cambiar esta configuración."
      />
    )
  }

  if (config.isPending) {
    return (
      <>
        <PageHeader title="WhatsApp · IA" />
        <SkeletonRows rows={6} columns={2} label="Cargando la configuración…" />
      </>
    )
  }
  if (config.isError) {
    const codigo = config.error instanceof ErrorConfigIA ? config.error.codigo : 'desconocido'
    return (
      <>
        <PageHeader title="WhatsApp · IA" />
        <ErrorState title={textoErrorConfig(codigo)} onRetry={() => void config.refetch()} />
      </>
    )
  }

  // `key`: al cambiar la versión guardada, el formulario arranca de lo nuevo.
  return (
    <Formulario
      key={`${config.data.companyId}:${config.data.updatedAt ?? ''}`}
      config={config.data}
      metricas={metricas}
      aviso={aviso}
      setAviso={setAviso}
    />
  )
}

interface Aviso {
  tono: 'success' | 'danger'
  texto: string
}

function Formulario({
  config, metricas, aviso, setAviso,
}: {
  config: ConfigIA
  metricas: ReturnType<typeof useMetricasIA>
  aviso: Aviso | null
  setAviso: (a: Aviso | null) => void
}) {
  const qc = useQueryClient()
  const inicial = formularioDesdeConfig(config)
  const [form, setForm] = useState<FormularioIA>(inicial)

  const errores = erroresConfig(form)
  const cambios = cambiosConfig(inicial, form)
  const hayCambios = Object.keys(cambios).length > 0
  const hayErrores = Object.keys(errores).length > 0
  const modoNuevo = modoDe(form)

  const guardar = useMutation({
    mutationFn: () => guardarConfigIA(config.companyId, config.updatedAt, cambios),
    onMutate: () => setAviso(null),
    onSuccess: (r) => {
      setAviso({
        tono: 'success',
        texto: `Cambios guardados. ${ETIQUETA_MODO[r.config.modo]}.${r.cancelados > 0 ? ` Se cancelaron ${r.cancelados} análisis pendientes.` : ''}`,
      })
      qc.setQueryData(clavesIA.config(config.companyId), r.config)
      void qc.invalidateQueries({ queryKey: clavesIA.metricas(config.companyId) })
      void qc.invalidateQueries({ queryKey: clavesIA.modo(config.companyId) })
    },
    onError: (e: Error) => setAviso({ tono: 'danger', texto: textoErrorConfig(e instanceof ErrorConfigIA ? e.codigo : 'desconocido') }),
  })

  const cambiar = <K extends keyof FormularioIA>(campo: K, valor: FormularioIA[K]) => {
    setAviso(null)
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!hayCambios || hayErrores || guardar.isPending) return
    guardar.mutate()
  }

  const ocupado = guardar.isPending

  return (
    <form className={styles.pagina} onSubmit={enviar} noValidate>
      <PageHeader
        title="WhatsApp · IA"
        subtitle="Análisis con IA de las conversaciones de WhatsApp de la empresa: modo, límites de uso e informes."
        status={
          <Badge tone={TONO_MODO[config.modo]} dot>
            {ETIQUETA_MODO[config.modo]}
          </Badge>
        }
      />

      <section className={styles.tarjeta} aria-labelledby="ia-estado">
        <h2 id="ia-estado" className={styles.titulo}>Estado</h2>
        <p className={styles.nota}>{DESCRIPCION_MODO[config.modo]}</p>
        <dl className={styles.datos}>
          <dt>Proveedor</dt>
          <dd>{PROVEEDOR_VISIBLE}</dd>
          <dt>Modelo</dt>
          <dd>{MODELO_VISIBLE}</dd>
          <dt>Zona horaria</dt>
          <dd>{ZONA_HORARIA}</dd>
        </dl>
        <p className={styles.nota}>
          El proveedor y el modelo se configuran en el servidor, no desde esta pantalla. Ninguna clave se muestra acá.
        </p>
      </section>

      <fieldset className={styles.tarjeta} disabled={ocupado}>
        <legend className={styles.titulo}>Análisis</legend>
        <Switch
          label="Habilitar IA de WhatsApp"
          checked={form.enabled}
          onChange={(e) => cambiar('enabled', e.target.checked)}
        />
        {inicial.enabled && !form.enabled ? (
          <Alert tone="warning" title="Apagar la IA">
            Se dejan de hacer análisis nuevos, manuales y automáticos, y se cancelan los pendientes. Los resúmenes y
            sugerencias ya guardados siguen visibles. WhatsApp sigue funcionando igual.
          </Alert>
        ) : null}
        <Checkbox
          label="Analizar automáticamente conversaciones"
          checked={form.autoAnalyze}
          disabled={!form.enabled}
          help={
            form.enabled
              ? 'Cuando entra un mensaje nuevo, la conversación se analiza sola después del tiempo de espera. Nunca responde ni cambia nada.'
              : 'Primero hay que habilitar la IA.'
          }
          onChange={(e) => cambiar('autoAnalyze', e.target.checked)}
        />
        {modoNuevo === 'automatica' && config.modo !== 'automatica' ? (
          <Alert tone="info" title="Análisis automático">
            Cada conversación con actividad nueva cuenta como un análisis y tiene costo. Conviene fijar los límites diarios.
          </Alert>
        ) : null}

        <div className={styles.grilla}>
          <Field
            label="Espera antes de analizar (segundos)"
            help={`Desde el último mensaje. Si entran varios seguidos, se analizan juntos. Entre ${DEBOUNCE_MIN} y ${DEBOUNCE_MAX}.`}
            error={errores.debounceSeconds}
          >
            <Input
              inputMode="numeric"
              value={form.debounceSeconds}
              onChange={(e) => cambiar('debounceSeconds', e.target.value)}
            />
          </Field>
          <Field label="Límite de análisis por día" optional help="Vacío: sin límite. Aplica a manuales y automáticos." error={errores.maxDailyAnalyses}>
            <Input inputMode="numeric" value={form.maxDailyAnalyses} onChange={(e) => cambiar('maxDailyAnalyses', e.target.value)} />
          </Field>
          <Field label="Límite de USD por día" optional help="Costo estimado con los precios verificados. Vacío: sin límite." error={errores.maxDailyCostUsd}>
            <Input inputMode="decimal" value={form.maxDailyCostUsd} onChange={(e) => cambiar('maxDailyCostUsd', e.target.value)} />
          </Field>
        </div>
        <p className={styles.nota}>
          Al alcanzar un límite no se llama a la IA hasta el día siguiente. WhatsApp no se bloquea.
        </p>
      </fieldset>

      <fieldset className={styles.tarjeta} disabled={ocupado}>
        <legend className={styles.titulo}>Informes programados</legend>
        <p className={styles.nota}>
          Se generan y se guardan con los datos que ya existen, sin IA. No se envían a nadie: se ven en WhatsApp → Informes.
        </p>
        <Checkbox label="Informe diario" help="El del día anterior, a partir de la hora elegida." checked={form.dailyReportEnabled} onChange={(e) => cambiar('dailyReportEnabled', e.target.checked)} />
        <div className={styles.grilla}>
          <Field label="Hora del informe diario" error={errores.dailyReportTime}>
            <Input type="time" value={form.dailyReportTime} disabled={!form.dailyReportEnabled} onChange={(e) => cambiar('dailyReportTime', e.target.value)} />
          </Field>
        </div>
        <Checkbox label="Informe semanal" help="La última semana cerrada (lunes a domingo)." checked={form.weeklyReportEnabled} onChange={(e) => cambiar('weeklyReportEnabled', e.target.checked)} />
        <div className={styles.grilla}>
          <Field label="Día del informe semanal" error={errores.weeklyReportDay}>
            <Select value={form.weeklyReportDay} disabled={!form.weeklyReportEnabled} onChange={(e) => cambiar('weeklyReportDay', e.target.value)}>
              <option value="">Elegí un día</option>
              {DIAS_SEMANA.map((d) => (
                <option key={d.valor} value={String(d.valor)}>{d.etiqueta}</option>
              ))}
            </Select>
          </Field>
          <Field label="Hora del informe semanal" error={errores.weeklyReportTime}>
            <Input type="time" value={form.weeklyReportTime} disabled={!form.weeklyReportEnabled} onChange={(e) => cambiar('weeklyReportTime', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {aviso ? (
        <Alert tone={aviso.tono} role={aviso.tono === 'danger' ? 'alert' : 'status'}>
          {aviso.texto}
        </Alert>
      ) : null}

      <div className={styles.barra}>
        {hayCambios ? (
          <Button variant="ghost" onClick={() => { setForm(inicial); setAviso(null) }} disabled={ocupado}>
            Deshacer cambios
          </Button>
        ) : null}
        <Button type="submit" loading={ocupado} disabled={!hayCambios || hayErrores}>
          Guardar cambios
        </Button>
      </div>

      <Uso metricas={metricas} modo={config.modo} companyId={config.companyId} />
    </form>
  )
}

const PERIODOS: { clave: 'hoy' | 'ultimos7Dias' | 'mes'; titulo: string }[] = [
  { clave: 'hoy', titulo: 'Hoy' },
  { clave: 'ultimos7Dias', titulo: 'Últimos 7 días' },
  { clave: 'mes', titulo: 'Mes actual' },
]

function Uso({ metricas, modo, companyId }: { metricas: ReturnType<typeof useMetricasIA>; modo: ModoIA; companyId: string }) {
  const qc = useQueryClient()
  const [errorReintento, setErrorReintento] = useState<string | null>(null)
  const reintentar = useMutation({
    mutationFn: (conversacionId: string) => reintentarAnalisis(conversacionId),
    onSuccess: () => {
      setErrorReintento(null)
      void qc.invalidateQueries({ queryKey: clavesIA.metricas(companyId) })
    },
    onError: (e: Error) => setErrorReintento(textoErrorConfig(e instanceof ErrorConfigIA ? e.codigo : 'desconocido')),
  })

  return (
    <section className={styles.tarjeta} aria-labelledby="ia-uso">
      <div className={styles.cabecera}>
        <h2 id="ia-uso" className={styles.titulo}>Uso y costo</h2>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="refresh" size={16} />}
          loading={metricas.isFetching}
          onClick={() => void metricas.refetch()}
        >
          Actualizar
        </Button>
      </div>

      {metricas.isPending ? (
        <SkeletonRows rows={3} columns={3} label="Cargando el uso…" />
      ) : metricas.isError ? (
        <Alert tone="danger" role="alert" title="No se pudo leer el uso">
          {textoErrorConfig(metricas.error instanceof ErrorConfigIA ? metricas.error.codigo : 'desconocido')}
        </Alert>
      ) : (
        <ContenidoUso m={metricas.data} modo={modo} reintentando={reintentar.isPending ? (reintentar.variables ?? null) : null} onReintentar={(id) => reintentar.mutate(id)} errorReintento={errorReintento} />
      )}
    </section>
  )
}

function ContenidoUso({
  m, modo, reintentando, onReintentar, errorReintento,
}: {
  m: MetricasIA
  modo: ModoIA
  reintentando: string | null
  onReintentar: (conversacionId: string) => void
  errorReintento: string | null
}) {
  const alertas = alertasIA(m, modo)
  return (
    <>
      {alertas.length > 0 ? (
        <ul className={styles.alertas} aria-label="Indicadores">
          {alertas.map((a) => (
            <li key={a.clave}>
              <Alert tone={a.tono}>{a.texto}</Alert>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nota}>Sin análisis pendientes, fallidos ni límites alcanzados.</p>
      )}

      <div className={styles.periodos}>
        {PERIODOS.map((p) => (
          <Periodo key={p.clave} titulo={p.titulo} datos={m[p.clave]} />
        ))}
      </div>
      <p className={styles.nota}>
        «Análisis» cuenta las llamadas a la IA. Los omitidos (IA apagada o límite alcanzado) no llamaron a nadie. El costo es
        una estimación con los precios verificados del modelo.
      </p>

      <h3 className={styles.subtitulo}>Cola de análisis automático</h3>
      <dl className={styles.datos}>
        <dt>Pendientes</dt>
        <dd>{m.cola.pendientes}</dd>
        <dt>En curso</dt>
        <dd>{m.cola.procesando}</dd>
        <dt>Esperando por límite</dt>
        <dd>{m.cola.limiteAlcanzado}</dd>
        <dt>Fallidos</dt>
        <dd>{m.cola.fallidos}</dd>
      </dl>

      {m.fallidos.length > 0 ? (
        <>
          <h3 className={styles.subtitulo}>Análisis fallidos</h3>
          {errorReintento ? <Alert tone="danger" role="alert">{errorReintento}</Alert> : null}
          <ul className={styles.fallidos}>
            {m.fallidos.map((f) => (
              <li key={f.conversacionId} className={styles.fallido}>
                <div className={styles.fallidoTexto}>
                  <Link to={`/whatsapp?conversacion=${f.conversacionId}`} className={styles.enlace}>{f.contacto}</Link>
                  <span className={styles.nota}>
                    {textoErrorTrabajo(f.error)} · {f.intentos} intento(s) · {momento(f.actualizadoEn)}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={reintentando === f.conversacionId}
                  disabled={modo !== 'automatica' || reintentando !== null}
                  onClick={() => onReintentar(f.conversacionId)}
                  aria-label={`Reintentar el análisis de ${f.contacto}`}
                >
                  Reintentar
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}

function Periodo({ titulo, datos }: { titulo: string; datos: MetricasPeriodo }) {
  return (
    <div className={styles.periodo}>
      <h3 className={styles.subtitulo}>{titulo}</h3>
      <dl className={styles.datos}>
        <dt>Análisis</dt>
        <dd>{miles(datos.llamadas)}</dd>
        <dt>Costo estimado</dt>
        <dd>{usd(datos.costoUsd)}</dd>
        <dt>Tokens de entrada</dt>
        <dd>{miles(datos.inputTokens)}</dd>
        <dt>Tokens de salida</dt>
        <dd>{miles(datos.outputTokens)}</dd>
        <dt>Razonamiento</dt>
        <dd>{miles(datos.reasoningTokens)}</dd>
        <dt>Errores</dt>
        <dd>{miles(datos.errores)}</dd>
        <dt>Omitidos</dt>
        <dd>{miles(datos.omitidas)}</dd>
      </dl>
    </div>
  )
}
