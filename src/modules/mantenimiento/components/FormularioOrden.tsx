import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import {
  CONDICIONES_VISUALES,
  MOTIVOS_INGRESO,
  OPCIONES_SERVICIO,
  etiquetaDeResultado,
} from '../lib/estados'
import { errorDe, validarOrden, type ErrorDeCampo } from '../lib/validacion'
import { useTecnicos } from '../hooks/useOrdenes'
import { usePuntos } from '../hooks/useCheckPoints'
import { BuscadorActivo } from './BuscadorActivo'
import { BuscadorCliente } from './BuscadorCliente'
import { CapturaFotosIngreso } from './CapturaFotosIngreso'
import type { DatosOrden } from '../services/ordenes'
import type { ActivoBuscado } from '../services/activos'
import type { ClienteBuscado } from '../services/catalogo'
import type { ResultadoCheck } from '../types'
import styles from './Formulario.module.css'

/** Lo que el diagnóstico de partes marca al ingreso: un resultado por punto. */
export type ChecksIniciales = { puntoId: string; resultado: ResultadoCheck }[]

export interface FormularioOrdenProps {
  valores: DatosOrden
  activoInicial: ActivoBuscado | null
  clienteInicial: ClienteBuscado | null
  guardando: boolean
  errorAlGuardar?: string | null
  onGuardar: (datos: DatosOrden, checks: ChecksIniciales, fotos: File[]) => void
  onCancelar: () => void
}

const RESULTADOS: ResultadoCheck[] = ['ok', 'nok', 'na']

/**
 * Alta de una orden de servicio — la «Nueva ficha» del app FEIN AccuTec.
 *
 * Es la pantalla de **Diagnóstico** entera, no un alta mínima: los datos de
 * ingreso, el estado de cada parte AL INGRESO y las observaciones se cargan
 * acá, igual que en el sistema que replica. Cuando se crea la orden, esos
 * checks se guardan en la fase `diagnosis`.
 *
 * Lo que define esta pantalla:
 *
 *   · **El cliente se precarga del dueño actual del equipo** y a partir del
 *     alta queda congelado. Un trigger impide cambiarlo después, así que la
 *     única oportunidad de elegirlo bien es ésta. Si el equipo no tiene dueño,
 *     hay que elegirlo a mano: el campo es obligatorio en la base.
 *   · **La orden nace en diagnóstico**, que es la primera etapa real del
 *     circuito. No hay desplegable de etapa inicial: un salto arbitrario al
 *     crear sería inventar historia.
 *   · **Condición visual y motivo son listas cerradas** (las del FEIN), pero
 *     la columna es texto libre: no inventan obligatoriedad que la base no
 *     tiene, y los datos viejos siguen siendo válidos.
 */
export function FormularioOrden({
  valores,
  activoInicial,
  clienteInicial,
  guardando,
  errorAlGuardar = null,
  onGuardar,
  onCancelar,
}: FormularioOrdenProps) {
  const id = useId()
  const tecnicos = useTecnicos()
  const puntos = usePuntos(true)
  const [datos, setDatos] = useState<DatosOrden>(valores)
  const [partes, setPartes] = useState<Record<string, ResultadoCheck>>({})
  const [fotos, setFotos] = useState<File[]>([])
  const [activo, setActivo] = useState<ActivoBuscado | null>(activoInicial)
  const [cliente, setCliente] = useState<ClienteBuscado | null>(clienteInicial)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [intentado, setIntentado] = useState(false)
  // Si el cliente salió del dueño del equipo, se dice en pantalla. Vale
  // también cuando el equipo vino por la URL desde su propia ficha.
  const [heredado, setHeredado] = useState(
    activoInicial?.duenoId != null && clienteInicial?.id === activoInicial.duenoId,
  )

  const cambiar = <K extends keyof DatosOrden>(campo: K, valor: DatosOrden[K]) => {
    const siguiente = { ...datos, [campo]: valor }
    setDatos(siguiente)
    if (intentado) setErrores(validarOrden(siguiente))
  }

  // Volver a tocar la opción ya elegida la desmarca: «no revisado» tiene que
  // poder volver a ser el estado, y no es lo mismo que «N/A».
  const marcarParte = (puntoId: string, resultado: ResultadoCheck) => {
    setPartes((p) => {
      const siguiente = { ...p }
      if (siguiente[puntoId] === resultado) delete siguiente[puntoId]
      else siguiente[puntoId] = resultado
      return siguiente
    })
  }

  const elegirActivo = (a: ActivoBuscado) => {
    setActivo(a)
    // El dueño actual del equipo se propone como cliente de la orden. Si el
    // equipo no tiene dueño, el campo queda vacío y hay que completarlo: no
    // se inventa un cliente.
    setCliente(
      a.duenoId && a.dueno
        ? { id: a.duenoId, referencia: null, razonSocial: a.dueno, nombreComercial: null }
        : null,
    )
    setHeredado(a.duenoId !== null)
    const siguiente = { ...datos, activoId: a.id, clienteId: a.duenoId ?? '' }
    setDatos(siguiente)
    if (intentado) setErrores(validarOrden(siguiente))
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    setIntentado(true)
    const encontrados = validarOrden(datos)
    setErrores(encontrados)
    if (encontrados.length === 0) {
      const checks = Object.entries(partes).map(([puntoId, resultado]) => ({ puntoId, resultado }))
      onGuardar(datos, checks, fotos)
    }
  }

  const listaPuntos = puntos.data ?? []

  return (
    <form className={styles.form} onSubmit={enviar} noValidate>
      {errorAlGuardar ? (
        <p className={styles.errorCaja} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Qué entra y de quién es</h2>

        <div className={styles.grilla}>
          <BuscadorActivo
            elegido={activo}
            deshabilitado={guardando}
            error={errorDe(errores, 'activoId')}
            onElegir={elegirActivo}
            onLimpiar={() => {
              setActivo(null)
              cambiar('activoId', '')
            }}
          />

          <BuscadorCliente
            elegido={cliente}
            etiqueta="Cliente de la orden"
            obligatorio
            deshabilitado={guardando}
            error={errorDe(errores, 'clienteId')}
            onElegir={(c) => {
              setCliente(c)
              setHeredado(false)
              cambiar('clienteId', c.id)
            }}
            onLimpiar={() => {
              setCliente(null)
              setHeredado(false)
              cambiar('clienteId', '')
            }}
          />
        </div>

        <p className={styles.ayuda}>
          {heredado
            ? 'Tomado del dueño actual del equipo. Se puede cambiar ahora, pero después del alta queda congelado: si el equipo cambia de manos, esta orden va a seguir diciendo que el trabajo se le hizo a este cliente.'
            : 'El cliente queda congelado en la orden. Cambiar después el dueño del equipo no modifica esta orden ni ninguna otra ya creada.'}
        </p>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Datos de ingreso</h2>

        <div className={styles.grilla}>
          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-fecha`}>
              Fecha de ingreso *
            </label>
            <input
              id={`${id}-fecha`}
              type="date"
              className={styles.control}
              value={datos.fechaIngreso}
              disabled={guardando}
              aria-invalid={errorDe(errores, 'fechaIngreso') ? true : undefined}
              onChange={(e) => cambiar('fechaIngreso', e.target.value)}
            />
            {errorDe(errores, 'fechaIngreso') ? (
              <span className={styles.error}>{errorDe(errores, 'fechaIngreso')}</span>
            ) : null}
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-tecnico`}>
              Técnico / responsable
            </label>
            <select
              id={`${id}-tecnico`}
              className={styles.control}
              value={datos.tecnicoId ?? ''}
              disabled={guardando}
              onChange={(e) => cambiar('tecnicoId', e.target.value || null)}
            >
              <option value="">Sin asignar</option>
              {(tecnicos.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-servicio`}>
              Tipo de servicio *
            </label>
            <select
              id={`${id}-servicio`}
              className={styles.control}
              value={datos.tipoServicio}
              disabled={guardando}
              aria-invalid={errorDe(errores, 'tipoServicio') ? true : undefined}
              onChange={(e) => cambiar('tipoServicio', e.target.value)}
            >
              {OPCIONES_SERVICIO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
            {errorDe(errores, 'tipoServicio') ? (
              <span className={styles.error}>{errorDe(errores, 'tipoServicio')}</span>
            ) : null}
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-aprietes`}>
              Aprietes al ingresar
            </label>
            <input
              id={`${id}-aprietes`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className={styles.control}
              value={datos.aprietesIngreso ?? ''}
              disabled={guardando}
              placeholder="Ciclos de apriete que trae la herramienta"
              onChange={(e) => {
                const t = e.target.value.trim()
                cambiar('aprietesIngreso', t === '' ? null : Math.max(0, Math.trunc(Number(t))))
              }}
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-visual`}>
              Condición visual
            </label>
            <select
              id={`${id}-visual`}
              className={styles.control}
              value={datos.condicionVisual}
              disabled={guardando}
              onChange={(e) => cambiar('condicionVisual', e.target.value)}
            >
              <option value="">— seleccionar —</option>
              {CONDICIONES_VISUALES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-motivo`}>
              Motivo de ingreso
            </label>
            <select
              id={`${id}-motivo`}
              className={styles.control}
              value={datos.motivoIngreso}
              disabled={guardando}
              onChange={(e) => cambiar('motivoIngreso', e.target.value)}
            >
              <option value="">— seleccionar —</option>
              {MOTIVOS_INGRESO.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Diagnóstico de partes — estado al ingreso</h2>
        <p className={styles.bannerDiag}>
          Marcá cómo <strong>llegó</strong> la herramienta, antes de intervenir. Opcional: se
          completa después desde la ficha.
        </p>

        {puntos.isPending ? (
          <p className={styles.ayuda}>Cargando los puntos de revisión…</p>
        ) : listaPuntos.length === 0 ? (
          <p className={styles.ayuda}>Esta empresa no tiene puntos de revisión configurados.</p>
        ) : (
          <div className={styles.partes}>
            {listaPuntos.map((p) => {
              const estado = partes[p.id]
              const claseCard =
                estado === 'ok'
                  ? styles.parteCardOk
                  : estado === 'nok'
                    ? styles.parteCardNok
                    : estado === 'na'
                      ? styles.parteCardNa
                      : ''
              return (
              <div key={p.id} className={`${styles.parte} ${claseCard}`}>
                <span className={styles.parteNombre}>{p.etiqueta}</span>
                <span className={styles.parteOpciones} role="group" aria-label={p.etiqueta}>
                  {RESULTADOS.map((r) => {
                    const elegida = partes[p.id] === r
                    const clase = !elegida
                      ? styles.parteOpcion
                      : r === 'ok'
                        ? styles.parteOk
                        : r === 'nok'
                          ? styles.parteNok
                          : styles.parteNa
                    return (
                      <button
                        key={r}
                        type="button"
                        className={clase}
                        aria-pressed={elegida}
                        disabled={guardando}
                        onClick={() => marcarParte(p.id, r)}
                      >
                        {etiquetaDeResultado(r)}
                      </button>
                    )
                  })}
                </span>
              </div>
              )
            })}
          </div>
        )}

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-diagnostico`}>
            Observaciones de diagnóstico
          </label>
          <textarea
            id={`${id}-diagnostico`}
            className={styles.area}
            value={datos.notasDiagnostico}
            disabled={guardando}
            placeholder="Fallas detectadas, piezas dañadas, faltantes, accesorios que vienen con el equipo…"
            onChange={(e) => cambiar('notasDiagnostico', e.target.value)}
          />
        </div>

        <p className={styles.ayuda}>
          La orden nace abierta y en diagnóstico, que es la primera etapa del circuito. De ahí en
          adelante se avanza de a una etapa desde la ficha.
        </p>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Fotos del ingreso</h2>
        <CapturaFotosIngreso fotos={fotos} onCambio={setFotos} deshabilitado={guardando} />
      </section>

      <div className={styles.acciones}>
        <Button type="submit" disabled={guardando}>
          {guardando ? 'Creando…' : 'Crear orden'}
        </Button>
        <Button variant="secondary" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
