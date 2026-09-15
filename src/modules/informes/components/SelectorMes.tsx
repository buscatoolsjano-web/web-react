import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { useMesInformes } from '../hooks/useMesInformes'
import styles from './Informes.module.css'

/** El mes del informe, en la URL (`?mes=`). Misma lógica; Field + Input del sistema. */
export function SelectorMes({ etiqueta = 'Mes' }: { etiqueta?: string }) {
  const { mes, tope, cambiarMes } = useMesInformes()
  return (
    <>
      <Field label={etiqueta} className={styles.campoMes}>
        <Input type="month" value={mes ?? tope} max={tope} onChange={(e) => cambiarMes(e.target.value)} />
      </Field>
      {mes ? (
        <Button variant="ghost" onClick={() => cambiarMes(tope)}>
          Mes en curso
        </Button>
      ) : null}
    </>
  )
}
