import { useId, useState } from 'react'
import { MOTIVOS_INGRESO, OPCIONES_SERVICIO } from '../lib/estados'
import { errorDe, validarOrden, type ErrorDeCampo } from '../lib/validacion'
import { useTecnicos } from '../hooks/useOrdenes'
import { BuscadorActivo } from './BuscadorActivo'
import { BuscadorCliente } from './BuscadorCliente'
import type { DatosOrden } from '../services/ordenes'
import type { ActivoBuscado } from '../services/activos'
import type { ClienteBuscado } from '../services/catalogo'
import styles from './Formulario.module.css'

export interface FormularioOrdenProps {
  valores: DatosOrden
  activoInicial: ActivoBuscado | null
  clienteInicial: ClienteBuscado | null
  guardando: boolean
  errorAlGuardar?: string | null
  onGuardar: (datos: DatosOrden) => void
  onCancelar: () => void
}

/**
 * Alta de una orden de servicio.
 *
 * Lo que define esta pantalla:
 *
 *   · **El cliente se precarga del dueño actual del equipo** y a partir del
 *     alta queda congelado. Un trigger impide cambiarlo después, así que la
 *     única oportunidad de elegirlo bien es ésta. Si el equipo no tiene dueño,
 *     hay que elegirlo a mano: el campo es obligatorio en la base.
 *   · **La orden nace en diagnóstico**, que es la primera etapa real del
 *     circuito del sistema anterior. No hay desplegable de etapa inicial: un
 *     salto arbitrario al crear sería inventar historia.
 *   · **El motivo de ingreso es un `datalist`, no un `select`.** Los ocho
 *     valores del legacy son los que se usaron, no una taxonomía cerrada, y el
 *     schema no tiene CHECK sobre ese campo.
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
  const [datos, setDatos] = useState<DatosOrden>(valores)
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
    if (encontrados.length === 0) onGuardar(datos)
  }

  return (
    <form className={styles.form} onSubmit={enviar} noValidate>
      {errorAlGuardar ? (
        <p className={styles.errorCaja} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Qué entra y de quién es</h2>

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

        <p className={styles.ayuda}>
          {heredado
            ? 'Tomado del dueño actual del equipo. Se puede cambiar ahora, pero después del alta queda congelado: si el equipo cambia de manos, esta orden va a seguir diciendo que el trabajo se le hizo a este cliente.'
            : 'El cliente queda congelado en la orden. Cambiar después el dueño del equipo no modifica esta orden ni ninguna otra ya creada.'}
        </p>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Ingreso</h2>

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
            <label className={styles.etiqueta} htmlFor={`${id}-motivo`}>
              Motivo de ingreso
            </label>
            <input
              id={`${id}-motivo`}
              type="text"
              className={styles.control}
              list={`${id}-motivos`}
              value={datos.motivoIngreso}
              disabled={guardando}
              onChange={(e) => cambiar('motivoIngreso', e.target.value)}
            />
            <datalist id={`${id}-motivos`}>
              {MOTIVOS_INGRESO.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-tecnico`}>
              Técnico asignado
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
        </div>

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-visual`}>
            Condición visual al recibir
          </label>
          <textarea
            id={`${id}-visual`}
            className={styles.area}
            value={datos.condicionVisual}
            disabled={guardando}
            onChange={(e) => cambiar('condicionVisual', e.target.value)}
            placeholder="Golpes, faltantes, accesorios que vienen con el equipo…"
          />
        </div>

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-diagnostico`}>
            Notas de diagnóstico
          </label>
          <textarea
            id={`${id}-diagnostico`}
            className={styles.area}
            value={datos.notasDiagnostico}
            disabled={guardando}
            onChange={(e) => cambiar('notasDiagnostico', e.target.value)}
          />
        </div>

        <p className={styles.ayuda}>
          La orden nace abierta y en diagnóstico, que es la primera etapa del circuito. De ahí en
          adelante se avanza de a una etapa desde la ficha.
        </p>
      </section>

      <div className={styles.acciones}>
        <button type="submit" className={styles.primario} disabled={guardando}>
          {guardando ? 'Creando…' : 'Crear orden'}
        </button>
        <button
          type="button"
          className={styles.secundario}
          disabled={guardando}
          onClick={onCancelar}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
