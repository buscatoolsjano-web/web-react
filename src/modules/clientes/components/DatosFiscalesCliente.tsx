import { useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { CONDICIONES_IVA, pideCuit } from '../lib/condicionIva'
import { guardarDatosFiscales } from '../services/edicion'

export interface DatosFiscalesClienteProps {
  clienteId: string
  condicion: string | null
  cuit: string | null
  /** Rótulo del botón: «Guardar» en la ficha, «Guardar y facturar» al facturar. */
  textoBoton?: string
  onGuardado: (datos: { condicion: string; cuit: string | null }) => void
}

/**
 * Condición frente al IVA y CUIT del cliente, con su propio «Guardar».
 *
 * La usa la ficha del cliente y el modal de facturar: sin estos dos datos no
 * se sabe si la factura es A o B, y la base no deja facturar.
 */
export function DatosFiscalesCliente({ clienteId, condicion, cuit, textoBoton = 'Guardar', onGuardado }: DatosFiscalesClienteProps) {
  const [cond, setCond] = useState(condicion ?? '')
  const [numero, setNumero] = useState(cuit ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const faltaCuit = cond !== '' && pideCuit(cond) && numero.replace(/\D/g, '').length !== 11
  const puede = cond !== '' && !faltaCuit && !guardando

  const guardar = async () => {
    setGuardando(true)
    setError(null)
    try {
      const c = numero.trim() === '' ? null : numero.trim()
      await guardarDatosFiscales(clienteId, cond, c)
      onGuardado({ condicion: cond, cuit: c })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <Field label="Condición frente al IVA" required>
        <Select value={cond} onChange={(e) => setCond(e.target.value)} aria-label="Condición frente al IVA">
          <option value="">Elegí…</option>
          {CONDICIONES_IVA.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="CUIT"
        optional={!pideCuit(cond)}
        required={pideCuit(cond)}
        error={faltaCuit && numero.trim() !== '' ? 'Son 11 dígitos.' : undefined}
        help={pideCuit(cond) ? 'Obligatorio para facturar a esta condición.' : 'No hace falta para consumidor final o exterior.'}
      >
        <Input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="30-12345678-9" aria-label="CUIT" />
      </Field>
      {error ? (
        <Alert tone="danger" role="alert">
          <p>{error}</p>
        </Alert>
      ) : null}
      <Button onClick={() => void guardar()} loading={guardando} disabled={!puede}>
        {textoBoton}
      </Button>
    </div>
  )
}
