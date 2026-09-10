import { useId, useState } from 'react'
import { useFormasDePago } from '../hooks/useProveedores'
import {
  validarProveedor,
  type DatosProveedor,
  type ErrorDeCampo,
} from '../lib/validacion'
import styles from './FormularioProveedor.module.css'

export interface FormularioProveedorProps {
  valores: DatosProveedor
  /** El CUIT con el que se abrió el formulario. Ver `validarProveedor`. */
  cuitOriginal?: string | null
  /** La referencia PROV. En el alta la da el servidor y acá se avisa. */
  referencia?: string | null
  guardando: boolean
  errorAlGuardar?: string | null
  etiquetaGuardar: string
  onGuardar: (datos: DatosProveedor) => void
  onCancelar: () => void
}

/** Las tres monedas que existen en `currencies`. */
const MONEDAS = ['USD', 'ARS', 'EUR'] as const

/**
 * Alta y edición del proveedor.
 *
 * Los campos son los que **existen de verdad** en `suppliers` y los que el
 * legacy tenía por proveedor. Dos decisiones que se ven acá:
 *
 *   · La dirección es UN campo de texto, no cinco. En el legacy es un solo
 *     string, y los 142 se migraron enteros. Partirlo en calle / localidad /
 *     provincia / CP obligaría a adivinar dónde corta cada uno.
 *   · La forma de pago es un `input` con `datalist`, no un `select`. Los 13
 *     valores del legacy mezclan incoterms, medios de pago y plazos —y traen
 *     erratas—: son una sugerencia, no una taxonomía.
 */
export function FormularioProveedor({
  valores,
  cuitOriginal = null,
  referencia = null,
  guardando,
  errorAlGuardar = null,
  etiquetaGuardar,
  onGuardar,
  onCancelar,
}: FormularioProveedorProps) {
  const id = useId()
  const formasDePago = useFormasDePago()
  const [datos, setDatos] = useState<DatosProveedor>(valores)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [intentado, setIntentado] = useState(false)

  const cambiar = <K extends keyof DatosProveedor>(campo: K, valor: DatosProveedor[K]) => {
    const siguiente = { ...datos, [campo]: valor }
    setDatos(siguiente)
    // Después del primer intento fallido, la validación acompaña mientras se
    // escribe: si no, hay que apretar Guardar de nuevo para ver si se arregló.
    if (intentado) setErrores(validarProveedor(siguiente, cuitOriginal))
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarProveedor(datos, cuitOriginal)
    setErrores(encontrados)
    setIntentado(true)
    if (encontrados.length === 0) onGuardar(datos)
  }

  const errorDe = (campo: keyof DatosProveedor) =>
    errores.find((e) => e.campo === campo)?.mensaje ?? null

  const texto = (
    campo: keyof DatosProveedor,
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
          onChange={(e) => cambiar(campo, e.target.value)}
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
        {texto('email', 'Email', { type: 'email', placeholder: 'ventas@proveedor.com' })}
        {texto('pais', 'País', {
          placeholder: 'AR',
          maxLength: 2,
          autoCapitalize: 'characters',
          spellCheck: false,
        })}

        <div className={styles.campo}>
          <label className={styles.etiqueta} htmlFor={`${id}-formaPago`}>
            Forma de pago
          </label>
          <input
            id={`${id}-formaPago`}
            className={styles.control}
            list={`${id}-formasDePago`}
            value={datos.formaPago}
            onChange={(e) => cambiar('formaPago', e.target.value)}
          />
          <datalist id={`${id}-formasDePago`}>
            {(formasDePago.data ?? []).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

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

        {texto('actividad', 'Actividad')}
        {texto('agente', 'Agente')}

        <div className={styles.campo}>
          <span className={styles.etiqueta}>Referencia</span>
          <span className={styles.soloLectura}>
            {referencia ?? 'la asigna el servidor al guardar'}
          </span>
        </div>
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-direccion`}>
          Dirección
        </label>
        <textarea
          id={`${id}-direccion`}
          className={styles.area}
          rows={2}
          value={datos.direccion}
          onChange={(e) => cambiar('direccion', e.target.value)}
        />
        <span className={styles.ayuda}>
          En una sola línea, como en el sistema anterior. No se parte en calle, localidad y
          código postal: eso obligaría a adivinar dónde corta cada uno.
        </span>
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-notas`}>
          Notas
        </label>
        <textarea
          id={`${id}-notas`}
          className={styles.area}
          rows={5}
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
