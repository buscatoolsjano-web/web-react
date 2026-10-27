import { useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import {
  crearEmpresa,
  ErrorCrearEmpresa,
  ETIQUETA_MONEDA,
  MONEDAS,
  mensajeErrorEmpresa,
  validarNombreEmpresa,
  type Moneda,
} from '@/services/empresa/crearEmpresa'
import styles from './ModalNuevaEmpresa.module.css'

export interface ModalNuevaEmpresaProps {
  onClose: () => void
  /** La empresa quedó creada (el llamador refresca y salta a ella). */
  onCreada: (companyId: string, nombre: string) => void
}

/**
 * Alta de empresa desde el selector del header.
 *
 * Se monta sólo cuando se abre (el llamador lo renderiza condicionalmente), así
 * que los campos arrancan limpios en cada apertura sin resetearlos a mano.
 */
export function ModalNuevaEmpresa({ onClose, onCreada }: ModalNuevaEmpresaProps) {
  const [nombre, setNombre] = useState('')
  const [moneda, setMoneda] = useState<Moneda>('ARS')
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const inputNombre = useRef<HTMLInputElement>(null)
  const idForm = useId()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const err = validarNombreEmpresa(nombre)
    if (err) {
      setErrorNombre(err)
      inputNombre.current?.focus()
      return
    }
    setErrorNombre(null)
    setErrorGeneral(null)
    setGuardando(true)
    try {
      const r = await crearEmpresa(nombre.trim(), moneda)
      onCreada(r.companyId, r.name)
    } catch (err) {
      const codigo = err instanceof ErrorCrearEmpresa ? err.codigo : 'desconocido'
      setErrorGeneral(mensajeErrorEmpresa(codigo))
      setGuardando(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={guardando}
      closeOnOverlay={!guardando}
      title="Nueva empresa"
      description="Arranca vacía y con vos como administrador. Después sumás usuarios, productos y clientes."
      initialFocusRef={inputNombre}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form={idForm} loading={guardando}>
            Crear empresa
          </Button>
        </>
      }
    >
      <form id={idForm} onSubmit={(e) => void enviar(e)} className={styles.form} noValidate>
        {errorGeneral && (
          <Alert tone="danger" role="alert">
            {errorGeneral}
          </Alert>
        )}
        <Field label="Nombre" error={errorNombre ?? undefined}>
          <Input
            ref={inputNombre}
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value)
              if (errorNombre) setErrorNombre(null)
            }}
            maxLength={120}
            autoComplete="off"
            placeholder="Nombre de la empresa"
          />
        </Field>
        <Field label="Moneda" help="La moneda de la lista de precios por defecto y de los documentos.">
          <Select value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
            {MONEDAS.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_MONEDA[m]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  )
}
