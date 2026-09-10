import { useId, useState } from 'react'
import { ListaDeTextos } from './ListaDeTextos'
import { opcionesDeRubro } from '../lib/rubros'
import {
  validarCliente,
  type DatosCliente,
  type ErrorDeCampo,
} from '../lib/validacion'
import styles from './FormularioCliente.module.css'

export interface FormularioClienteProps {
  valores: DatosCliente
  /** El CUIT con el que se abrió el formulario. Ver `validarCliente`. */
  cuitOriginal?: string | null
  /** La referencia CLI. En el alta la da el servidor y acá se avisa. */
  referencia?: string | null
  guardando: boolean
  errorAlGuardar?: string | null
  etiquetaGuardar: string
  onGuardar: (datos: DatosCliente) => void
  onCancelar: () => void
}

/** Las tres monedas que existen en `currencies`. */
const MONEDAS = ['USD', 'ARS', 'EUR'] as const

/**
 * Alta y edición del cliente.
 *
 * Los campos son los que **existen de verdad** en `customers`. No hay
 * «vendedor asignado» ni «lista de precios» editables acá: la columna existe
 * pero el legacy nunca la usó por cliente, y ponerle un desplegable sería
 * invitar a inventar un dato que después nadie sabe de dónde salió.
 */
export function FormularioCliente({
  valores,
  cuitOriginal = null,
  referencia = null,
  guardando,
  errorAlGuardar = null,
  etiquetaGuardar,
  onGuardar,
  onCancelar,
}: FormularioClienteProps) {
  const id = useId()
  const [datos, setDatos] = useState<DatosCliente>(valores)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [intentado, setIntentado] = useState(false)

  const cambiar = <K extends keyof DatosCliente>(campo: K, valor: DatosCliente[K]) => {
    const siguiente = { ...datos, [campo]: valor }
    setDatos(siguiente)
    // Después del primer intento fallido, la validación acompaña mientras se
    // escribe: si no, hay que apretar Guardar de nuevo para ver si se arregló.
    if (intentado) setErrores(validarCliente(siguiente, cuitOriginal))
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarCliente(datos, cuitOriginal)
    setErrores(encontrados)
    setIntentado(true)
    if (encontrados.length === 0) onGuardar(datos)
  }

  const errorDe = (campo: keyof DatosCliente) =>
    errores.find((e) => e.campo === campo)?.mensaje ?? null

  const texto = (
    campo: keyof DatosCliente,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const error = errorDe(campo)
    return (
      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-${campo}`}>
          {etiqueta}
        </label>
        <input
          id={`${id}-${campo}`}
          className={styles.control}
          value={String(datos[campo] ?? '')}
          aria-invalid={error ? true : undefined}
          onChange={(e) => cambiar(campo, e.target.value as DatosCliente[typeof campo])}
          {...extra}
        />
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <form className={styles.form} onSubmit={enviar} noValidate>
      <div className={styles.grilla}>
        {texto('razonSocial', 'Razón social *', { required: true, autoFocus: true })}
        {texto('nombreComercial', 'Nombre comercial')}
        {texto('cuit', 'CUIT', { inputMode: 'numeric', placeholder: '30-50328441-0' })}
        {texto('telefono', 'Teléfono')}

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-rubro`}>
            Rubro
          </label>
          {/* Un `input` con `datalist` y no un `select`: los cuatro rubros del
              legacy son una sugerencia, no una lista cerrada. `industry` es
              texto libre y no hay tabla de rubros. */}
          <input
            id={`${id}-rubro`}
            className={styles.control}
            list={`${id}-rubros`}
            value={datos.rubro}
            onChange={(e) => cambiar('rubro', e.target.value)}
          />
          <datalist id={`${id}-rubros`}>
            {opcionesDeRubro(valores.rubro).map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-tipo`}>
            Tipo
          </label>
          <select
            id={`${id}-tipo`}
            className={styles.control}
            value={datos.tipo}
            onChange={(e) => cambiar('tipo', e.target.value)}
          >
            <option value="business">Empresa</option>
            <option value="individual">Persona</option>
          </select>
        </div>

        {texto('condicionDePago', 'Condición de pago')}

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-moneda`}>
            Moneda por defecto
          </label>
          <select
            id={`${id}-moneda`}
            className={styles.control}
            value={datos.monedaPorDefecto}
            onChange={(e) => cambiar('monedaPorDefecto', e.target.value)}
          >
            <option value="">Sin definir</option>
            {MONEDAS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.campo}>
          <span className={styles.etiqueta}>Referencia</span>
          <span className={styles.soloLectura}>
            {referencia ?? 'la asigna el servidor al guardar'}
          </span>
        </div>
      </div>

      <div className={styles.grilla}>
        <ListaDeTextos
          etiqueta="Emails"
          valores={datos.emails}
          tipo="email"
          placeholder="compras@empresa.com"
          ayuda="Son direcciones de la empresa, no personas. Los contactos van en su pestaña."
          onCambiar={(v) => cambiar('emails', v)}
        />
        <ListaDeTextos
          etiqueta="Dominios"
          valores={datos.dominios}
          placeholder="empresa.com"
          ayuda="Sirven para reconocer al cliente por el mail desde el que escribe."
          onCambiar={(v) => cambiar('dominios', v)}
        />
      </div>
      {errorDe('emails') ? (
        <p className={styles.error} role="alert">
          {errorDe('emails')}
        </p>
      ) : null}

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-notas`}>
          Notas
        </label>
        <textarea
          id={`${id}-notas`}
          className={styles.area}
          rows={3}
          value={datos.notas}
          onChange={(e) => cambiar('notas', e.target.value)}
        />
      </div>

      {errorAlGuardar ? (
        <p className={styles.errorCaja} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}

      <div className={styles.acciones}>
        <button type="submit" className={styles.primario} disabled={guardando}>
          {guardando ? 'Guardando…' : etiquetaGuardar}
        </button>
        <button
          type="button"
          className={styles.secundario}
          onClick={onCancelar}
          disabled={guardando}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
