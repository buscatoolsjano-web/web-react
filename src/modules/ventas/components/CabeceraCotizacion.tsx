import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { MONEDAS_DOCUMENTO as MONEDAS } from '../lib/moneda'
import { BuscadorCliente } from './BuscadorCliente'
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


/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
const PERCEPCION_HABITUAL = '2.5'

/**
 * Cabecera editable de cotización y pedido.
 *
 * Fase 13: los mismos campos y el mismo `onCambiar`, agrupados en tres bloques
 * (cliente, condiciones, notas) y con los controles del sistema (`Field`).
 */
export function CabeceraCotizacion({
  valores,
  editable,
  monedaEditable,
  mostrarValidez = true,
  onCambiar,
}: CabeceraCotizacionProps) {
  const numero = { type: 'number', step: 'any', min: '0' } as const

  return (
    <div className={styles.bloques}>
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Cliente y referencia</legend>
        <div className={styles.grilla}>
          <div className={`${styles.campo} ${styles.ancho}`}>
            {/* El buscador tiene su propio input con su `aria-label`, así que acá
                va un rótulo y no un `<label for>` que apuntaría a nada. */}
            <span className={styles.etiqueta}>Cliente</span>
            <BuscadorCliente
              valor={valores.customerId || null}
              editable={editable}
              onElegir={(elegido) => onCambiar('customerId', elegido ?? '')}
            />
          </div>
          <Field label="Título" optional className={styles.ancho}>
            <Input value={valores.titulo} readOnly={!editable} onChange={(e) => onCambiar('titulo', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Fechas y condiciones</legend>
        <div className={styles.grilla}>
          <Field label="Fecha">
            <Input type="date" value={valores.fecha} readOnly={!editable} onChange={(e) => onCambiar('fecha', e.target.value)} />
          </Field>
          {mostrarValidez ? (
            <Field label="Válida hasta" optional>
              <Input type="date" value={valores.validaHasta} readOnly={!editable} onChange={(e) => onCambiar('validaHasta', e.target.value)} />
            </Field>
          ) : null}
          <Field label="Moneda" help={monedaEditable ? 'Obligatoria: no hay moneda por defecto.' : 'La moneda se define al crear el documento.'}>
            <Select value={valores.moneda} required disabled={!editable || !monedaEditable} onChange={(e) => onCambiar('moneda', e.target.value)}>
              {valores.moneda === '' ? (
                <option value="" disabled>
                  Elegí la moneda
                </option>
              ) : null}
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo de cambio" optional>
            <Input {...numero} inputMode="decimal" value={valores.tipoCambio} readOnly={!editable} onChange={(e) => onCambiar('tipoCambio', e.target.value)} />
          </Field>
          <Field label="Forma de pago" optional>
            <Input value={valores.formaPago} readOnly={!editable} onChange={(e) => onCambiar('formaPago', e.target.value)} />
          </Field>
          <Field label="% Dto. global" optional>
            <Input {...numero} max="100" inputMode="decimal" value={valores.descuentoPct} readOnly={!editable} onChange={(e) => onCambiar('descuentoPct', e.target.value)} />
          </Field>
          <Field label="% Percepción IIBB" optional>
            <div className={styles.linea}>
              <Input {...numero} max="100" inputMode="decimal" value={valores.percepcionPct} readOnly={!editable} onChange={(e) => onCambiar('percepcionPct', e.target.value)} />
              {editable ? (
                <Button
                  variant="secondary"
                  onClick={() => onCambiar('percepcionPct', valores.percepcionPct ? '' : PERCEPCION_HABITUAL)}
                >
                  {valores.percepcionPct ? 'Quitar' : `${PERCEPCION_HABITUAL} %`}
                </Button>
              ) : null}
            </div>
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Notas</legend>
        <Field label="Información adicional" optional>
          <Textarea value={valores.notas} readOnly={!editable} rows={3} onChange={(e) => onCambiar('notas', e.target.value)} />
        </Field>
      </fieldset>
    </div>
  )
}
