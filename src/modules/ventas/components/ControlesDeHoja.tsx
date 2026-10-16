import { Field } from '@/components/forms/Field'
import { Checkbox, Select } from '@/components/forms/controls'
import { FORMATOS, type FormatoImpresion } from '../lib/impresion'
import styles from './PanelHoja.module.css'

export interface ControlesDeHojaProps {
  formato: FormatoImpresion
  conImpuestos: boolean
  /** La foto del producto en cada renglón (Fase 80). */
  conFotos: boolean
  onFormato: (f: FormatoImpresion) => void
  onImpuestos: (v: boolean) => void
  onFotos: (v: boolean) => void
}

/**
 * Los controles de la hoja, adentro de la barra de acciones del alta.
 *
 * Son los MISMOS que ofrece el diálogo de imprimir, con los mismos nombres y
 * los mismos valores iniciales: la hoja que se arma y la que sale impresa
 * tienen que medir igual, y para eso no alcanza con que se parezcan —tienen
 * que estar configuradas igual— (Fase 80).
 */
export function ControlesDeHoja({
  formato,
  conImpuestos,
  conFotos,
  onFormato,
  onImpuestos,
  onFotos,
}: ControlesDeHojaProps) {
  return (
    <div className={styles.controlesEnBarra}>
      <Field label="Formato" hideLabel>
        <Select value={formato} onChange={(e) => onFormato(e.target.value as FormatoImpresion)}>
          {FORMATOS.map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.etiqueta}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="Precios con impuestos" checked={conImpuestos} onChange={(e) => onImpuestos(e.target.checked)} />
      {/* El mismo nombre que en el diálogo de imprimir: es la misma opción. */}
      <Checkbox
        label="Con foto del producto"
        checked={conFotos}
        disabled={formato === 'ticket'}
        onChange={(e) => onFotos(e.target.checked)}
      />
    </div>
  )
}
