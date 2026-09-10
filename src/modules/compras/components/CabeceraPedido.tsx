import { useId } from 'react'
import { BuscadorProveedor } from './BuscadorProveedor'
import { useFormasDePago } from '../hooks/useProveedores'
import { MONEDAS, type DatosPedidoCompra, type ErrorDePedido } from '../lib/validacion'
import type { ProveedorBuscado } from '../services/catalogo'
import styles from './CabeceraPedido.module.css'

export interface CabeceraPedidoProps {
  datos: DatosPedidoCompra
  errores: readonly ErrorDePedido[]
  proveedor: ProveedorBuscado | null
  /** Proveedor, moneda, tipo de cambio y fecha: sólo en borrador. */
  editaIdentidad: boolean
  /** ETA, condición de pago y notas: hasta que se cancele. */
  editaLogistica: boolean
  onCambiar: (cambios: Partial<DatosPedidoCompra>) => void
  onProveedor: (p: ProveedorBuscado | null) => void
}

/**
 * La cabecera del pedido de compra.
 *
 * Dos grupos de campos con reglas distintas, porque el servidor las tiene
 * distintas:
 *
 *   · **Identidad** —proveedor, moneda, tipo de cambio, fecha— sólo se toca
 *     en borrador. Un pedido confirmado ya se le mandó al proveedor.
 *   · **Logística** —llegada estimada, condición de pago, notas— se ajusta
 *     también después de confirmar, y cada cambio queda auditado.
 *
 * Deshabilitar los controles es una cortesía. Lo que lo impide de verdad es
 * `app.proteger_estado_pedido_compra()`.
 */
export function CabeceraPedido({
  datos,
  errores,
  proveedor,
  editaIdentidad,
  editaLogistica,
  onCambiar,
  onProveedor,
}: CabeceraPedidoProps) {
  const id = useId()
  const formasDePago = useFormasDePago()

  const errorDe = (campo: ErrorDePedido['campo']) =>
    errores.find((e) => e.campo === campo)?.mensaje ?? null

  return (
    <div className={styles.grilla}>
      <BuscadorProveedor
        elegido={proveedor}
        deshabilitado={!editaIdentidad}
        error={errorDe('proveedorId')}
        onElegir={(p) => onProveedor(p)}
        onLimpiar={() => onProveedor(null)}
      />

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-moneda`}>
          Moneda *
        </label>
        <select
          id={`${id}-moneda`}
          className={styles.control}
          value={datos.moneda}
          disabled={!editaIdentidad}
          aria-invalid={errorDe('moneda') ? true : undefined}
          onChange={(e) => onCambiar({ moneda: e.target.value })}
        >
          <option value="">Elegí una moneda</option>
          {MONEDAS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {errorDe('moneda') ? (
          <span className={styles.error} role="alert">
            {errorDe('moneda')}
          </span>
        ) : (
          <span className={styles.ayuda}>
            Un pedido tiene una sola moneda: todas sus líneas van en ésta.
          </span>
        )}
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-tc`}>
          Tipo de cambio
        </label>
        <input
          id={`${id}-tc`}
          type="number"
          step="any"
          min="0"
          className={styles.control}
          value={datos.tipoCambio}
          disabled={!editaIdentidad}
          placeholder="opcional"
          aria-invalid={errorDe('tipoCambio') ? true : undefined}
          onChange={(e) => onCambiar({ tipoCambio: e.target.value })}
        />
        {errorDe('tipoCambio') ? (
          <span className={styles.error} role="alert">
            {errorDe('tipoCambio')}
          </span>
        ) : (
          <span className={styles.ayuda}>
            Se guarda como referencia del día. No convierte nada.
          </span>
        )}
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-fecha`}>
          Fecha del pedido *
        </label>
        <input
          id={`${id}-fecha`}
          type="date"
          className={styles.control}
          value={datos.fecha}
          disabled={!editaIdentidad}
          aria-invalid={errorDe('fecha') ? true : undefined}
          onChange={(e) => onCambiar({ fecha: e.target.value })}
        />
        {errorDe('fecha') ? (
          <span className={styles.error} role="alert">
            {errorDe('fecha')}
          </span>
        ) : null}
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-eta`}>
          Llegada estimada
        </label>
        <input
          id={`${id}-eta`}
          type="date"
          className={styles.control}
          value={datos.fechaEstimada}
          disabled={!editaLogistica}
          aria-invalid={errorDe('fechaEstimada') ? true : undefined}
          onChange={(e) => onCambiar({ fechaEstimada: e.target.value })}
        />
        {errorDe('fechaEstimada') ? (
          <span className={styles.error} role="alert">
            {errorDe('fechaEstimada')}
          </span>
        ) : (
          <span className={styles.ayuda}>
            Se puede dejar vacía: «todavía no se sabe» es un dato, y es mejor que una fecha
            inventada.
          </span>
        )}
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-pago`}>
          Condición de pago
        </label>
        {/* Un `input` con `datalist` y no un `select`: las 13 condiciones del
            legacy mezclan incoterms, medios de pago y plazos. Son una
            sugerencia, no una lista cerrada. */}
        <input
          id={`${id}-pago`}
          className={styles.control}
          list={`${id}-pagos`}
          value={datos.formaPago}
          disabled={!editaLogistica}
          onChange={(e) => onCambiar({ formaPago: e.target.value })}
        />
        <datalist id={`${id}-pagos`}>
          {(formasDePago.data ?? []).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <span className={styles.ayuda}>
          Se copia del proveedor al elegirlo, pero queda guardada acá: si mañana cambia la
          condición del proveedor, este pedido no cambia.
        </span>
      </div>

      <div className={styles.campoAncho}>
        <label className={styles.etiqueta} htmlFor={`${id}-notas`}>
          Notas
        </label>
        <textarea
          id={`${id}-notas`}
          className={styles.area}
          rows={3}
          value={datos.notas}
          disabled={!editaLogistica}
          onChange={(e) => onCambiar({ notas: e.target.value })}
        />
      </div>
    </div>
  )
}
