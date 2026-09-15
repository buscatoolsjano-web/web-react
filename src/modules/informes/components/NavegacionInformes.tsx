import { useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs } from '@/components/ui/Tabs'
import { leerMes } from '../lib/actividad'
import type { VistaInformes } from '../lib/vista'

export const ID_PESTANAS_INFORMES = 'informes'

/**
 * Pestañas de Informes. La ruta sigue siendo `/informes`: la vista va en la
 * URL para que «atrás» y los enlaces funcionen, y el `?mes=` se conserva.
 *
 * Fase 13 · E5: el patrón ARIA de pestañas compartido (`Tabs`, con ← →). La
 * URL que arma cada pestaña es la misma de antes y sigue agregando una entrada
 * al historial, como el enlace que reemplaza.
 */
export function NavegacionInformes({ vista }: { vista: VistaInformes }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const mes = leerMes(params.get('mes'))
  const href = (v: VistaInformes) => {
    const n = new URLSearchParams()
    if (mes) n.set('mes', mes)
    if (v === 'stock') n.set('vista', 'stock')
    const q = n.toString()
    return q ? `?${q}` : '?'
  }
  return (
    <Tabs
      id={ID_PESTANAS_INFORMES}
      label="Informes"
      value={vista}
      onChange={(v) => void navigate({ search: href(v) })}
      items={[
        { key: 'comercial', label: 'Comercial' },
        { key: 'stock', label: 'Stock' },
      ]}
    />
  )
}
