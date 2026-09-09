import { useId } from 'react'
import { useClientes } from '../hooks/useDocumentos'
import styles from './CabeceraCotizacion.module.css'

export interface ValoresCabecera {
  customerId: string
  titulo: string
  fecha: string
  validaHasta: string
  moneda: string
  tipoCambio: string
  formaPago: string
  descuentoPct: string
  percepcionPct: string
  notas: string
}

export type CampoCabecera = keyof ValoresCabecera

export interface CabeceraCotizacionProps {
  valores: ValoresCabecera
  editable: boolean
  /** `true` en el alta: la moneda todavía se puede elegir. */
  monedaEditable: boolean
  /** El pedido no tiene fecha de validez; la cotización sí. */
  mostrarValidez?: boolean
  onCambiar: (campo: CampoCabecera, valor: string) => void
}

/** Las tres monedas que existen en `currencies`. */
const MONEDAS = ['USD', 'ARS', 'EUR'] as const

/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
export const PERCEPCION_HABITUAL = '2.5'

export function CabeceraCotizacion({
  valores,
  editable,
  monedaEditable,
  mostrarValidez = true,
  onCambiar,
}: CabeceraCotizacionProps) {
  const clientes = useClientes()
  const id = useId()

  const campo = (
    clave: CampoCabecera,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className={styles.campo}>
      <label className={styles.etiqueta} htmlFor={`${id}-${clave}`}>
        {etiqueta}
      </label>
      <input
        id={`${id}-${clave}`}
        className={styles.control}
        value={valores[clave]}
        readOnly={!editable}
        onChange={(e) => onCambiar(clave, e.target.value)}
        {...extra}
      />
    </div>
  )

  return (
    <div className={styles.grilla}>
      <div className={`${styles.campo} ${styles.ancho}`}>
        <label className={styles.etiqueta} htmlFor={`${id}-cliente`}>
          Cliente
        </label>
        <select
          id={`${id}-cliente`}
          className={styles.control}
          value={valores.customerId ?? ''}
          disabled={!editable}
          onChange={(e) => onCambiar('customerId', e.target.value)}
        >
          <option value="">Elegí un cliente…</option>
          {(clientes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className={`${styles.campo} ${styles.ancho}`}>
        <label className={styles.etiqueta} htmlFor={`${id}-titulo`}>
          Título
        </label>
        <input
          id={`${id}-titulo`}
          className={styles.control}
          value={valores.titulo}
          readOnly={!editable}
          onChange={(e) => onCambiar('titulo', e.target.value)}
        />
      </div>

      {campo('fecha', 'Fecha', { type: 'date' })}
      {mostrarValidez ? campo('validaHasta', 'Válida hasta', { type: 'date' }) : null}

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-moneda`}>
          Moneda
        </label>
        <select
          id={`${id}-moneda`}
          className={styles.control}
          value={valores.moneda}
          // Una vez que hay líneas con precios, cambiar la moneda cambiaría el
          // significado de cada importe sin tocar ningún número. Un documento
          // = una moneda, y se elige al crearlo.
          disabled={!editable || !monedaEditable}
          onChange={(e) => onCambiar('moneda', e.target.value)}
        >
          {MONEDAS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {!monedaEditable ? (
          <span className={styles.ayuda}>La moneda se define al crear el documento.</span>
        ) : null}
      </div>

      {campo('tipoCambio', 'Tipo de cambio', { type: 'number', step: 'any', min: '0' })}
      {campo('formaPago', 'Forma de pago')}
      {campo('descuentoPct', '% Dto. global', {
        type: 'number',
        step: 'any',
        min: '0',
        max: '100',
      })}

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-percepcionPct`}>
          % Percepción IIBB
        </label>
        <div className={styles.linea}>
          <input
            id={`${id}-percepcionPct`}
            className={styles.control}
            type="number"
            step="any"
            min="0"
            max="100"
            value={valores.percepcionPct}
            readOnly={!editable}
            onChange={(e) => onCambiar('percepcionPct', e.target.value)}
          />
          {editable ? (
            <button
              type="button"
              className={styles.mini}
              onClick={() =>
                onCambiar('percepcionPct', valores.percepcionPct ? '' : PERCEPCION_HABITUAL)
              }
            >
              {valores.percepcionPct ? 'Quitar' : `${PERCEPCION_HABITUAL} %`}
            </button>
          ) : null}
        </div>
      </div>

      <div className={`${styles.campo} ${styles.ancho}`}>
        <label className={styles.etiqueta} htmlFor={`${id}-notas`}>
          Información adicional
        </label>
        <textarea
          id={`${id}-notas`}
          className={styles.area}
          value={valores.notas}
          readOnly={!editable}
          rows={3}
          onChange={(e) => onCambiar('notas', e.target.value)}
        />
      </div>
    </div>
  )
}
