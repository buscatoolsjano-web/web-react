import { Field } from '@/components/forms/Field'
import { Checkbox, Select } from '@/components/forms/controls'
import { FORMATOS, type FormatoImpresion } from '../lib/impresion'
import styles from './PanelHoja.module.css'

export interface ControlesDeHojaProps {
  formato: FormatoImpresion
  conImpuestos: boolean
  onFormato: (f: FormatoImpresion) => void
  onImpuestos: (v: boolean) => void
}

export function ControlesDeHoja({ formato, conImpuestos, onFormato, onImpuestos }: ControlesDeHojaProps) {
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
    </div>
  )
}
