import { useSearchParams } from 'react-router-dom'
import { leerMes } from '../lib/actividad'

/** Hoy en Argentina, `YYYY-MM`: sólo para el tope del selector; el servidor decide igual. */
export function mesActualAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).slice(0, 7)
}

/** El `?mes=` compartido por las dos pestañas. `null` = mes en curso. */
export function useMesInformes() {
  const [params, setParams] = useSearchParams()
  const mes = leerMes(params.get('mes'))
  const tope = mesActualAR()
  const cambiarMes = (valor: string) => {
    const limpio = leerMes(valor)
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (limpio && limpio !== tope) n.set('mes', limpio)
        else n.delete('mes')
        return n
      },
      { replace: true },
    )
  }
  return { mes, tope, cambiarMes }
}

