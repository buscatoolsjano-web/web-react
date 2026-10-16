import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { FORMATOS, type FormatoImpresion } from '../lib/impresion'
import styles from './PanelHoja.module.css'

export interface ControlesDeHojaProps {
  formato: FormatoImpresion
  onFormato: (f: FormatoImpresion) => void
}

/**
 * Los controles de la hoja, adentro de la barra de acciones del alta.
 *
 * Son los MISMOS que ofrece el diálogo de imprimir, con los mismos nombres y
 * los mismos valores iniciales: la hoja que se arma y la que sale impresa
 * tienen que medir igual, y para eso no alcanza con que se parezcan —tienen
 * que estar configuradas igual— (Fase 80).
 *
 * Quedó uno solo. Los otros dos se fueron por el mismo motivo —nadie los
 * tocaba y le comían ancho al que sí—: «precios con impuestos» en la Fase 81 y
 * «con foto del producto» en la 83, esta última porque la foto ya no es una
 * opción: el renglón impreso la lleva siempre. Las dos siguen existiendo en el
 * diálogo de imprimir, que es de donde sale el papel.
 */
export function ControlesDeHoja({ formato, onFormato }: ControlesDeHojaProps) {
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
    </div>
  )
}
