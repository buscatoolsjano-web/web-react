import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ConfirmBorrado } from '@/components/modals/ConfirmBorrado'
import { mensajeDeBorrado } from '@/services/borradoTextos'
import type { ElegidoParaBorrar, ResultadoBorradoMasivo } from './borradoMasivo'

export interface EliminarSeleccionadosProps {
  /** Los marcados que SE PUEDEN borrar (el listado ya filtró el resto). */
  elegidos: readonly ElegidoParaBorrar[]
  /** Cuántos marcados quedan afuera por su estado: se avisa en el diálogo. */
  noSePueden: number
  /** «pedidos», «notas de entrada»: para armar las frases. */
  plural: string
  /** Por qué los que quedan afuera no se borran. */
  motivoNoSePueden?: string | undefined
  borrar: (id: string, motivo: string) => Promise<void>
  onListo: (r: ResultadoBorradoMasivo) => void
}

/**
 * «Eliminar N» para lo marcado en un listado.
 *
 * Un motivo para todos y un borrado por documento, de a uno: cada uno queda
 * en Configuración → Borrados con su copia, y si la base rechaza alguno
 * (porque tiene documentos colgados, o porque alguien lo cambió recién) los
 * demás siguen y al final se dice cuál no y por qué.
 */
export function EliminarSeleccionados({
  elegidos,
  noSePueden,
  plural,
  motivoNoSePueden,
  borrar,
  onListo,
}: EliminarSeleccionadosProps) {
  const [abierto, setAbierto] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  if (elegidos.length === 0 && noSePueden === 0) return null

  const ejecutar = async (motivo: string) => {
    setTrabajando(true)
    const r: ResultadoBorradoMasivo = { borrados: [], fallas: [] }
    for (const e of elegidos) {
      try {
        await borrar(e.id, motivo)
        r.borrados.push(e.id)
      } catch (err) {
        r.fallas.push({ numero: e.numero, mensaje: mensajeDeBorrado(err) })
      }
    }
    setTrabajando(false)
    setAbierto(false)
    onListo(r)
  }

  const cuantos = elegidos.length
  const afuera =
    noSePueden > 0
      ? ` ${noSePueden === 1 ? 'Uno de los marcados queda' : `${noSePueden} de los marcados quedan`} afuera${motivoNoSePueden ? `: ${motivoNoSePueden}` : '.'}`
      : ''

  return (
    <>
      <Button
        variant="secondary"
        icon={<Icon name="trash" size={16} />}
        disabled={cuantos === 0}
        title={cuantos === 0 ? motivoNoSePueden : undefined}
        onClick={() => setAbierto(true)}
      >
        {`Eliminar ${cuantos}`}
      </Button>
      <ConfirmBorrado
        open={abierto}
        que={cuantos === 1 ? elegidos[0]!.numero : `${cuantos} ${plural}`}
        description={`${cuantos === 1 ? 'Se borra con sus líneas' : 'Se borran con sus líneas'}. No se puede deshacer, pero el motivo y una copia quedan en Configuración → Borrados.${afuera}`}
        confirmLabel={trabajando ? 'Eliminando…' : `Eliminar ${cuantos}`}
        busy={trabajando}
        onCancel={() => setAbierto(false)}
        onConfirm={(motivo) => void ejecutar(motivo)}
      />
    </>
  )
}
