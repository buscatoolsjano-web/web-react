import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { useRubros } from '../hooks/useClientes'
import type { FiltrosClientes as Filtros } from '../types'

export interface FiltrosClientesProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado.
 *
 * El legacy tenía un filtro por columna en las seis primeras. Acá la búsqueda
 * libre cubre nombre, nombre comercial, referencia, CUIT, email y dominio en
 * un solo campo —es lo que la gente usa— y quedan aparte los dos que no son
 * texto: el rubro y la cola de revisión.
 *
 * Todos van al servidor. Fase 13 · E4: sobre el `FilterBar` común; en mobile
 * la búsqueda queda a la vista y el resto se pliega.
 */
export function FiltrosClientes({ filtros, hayFiltros, onAplicar, onLimpiar }: FiltrosClientesProps) {
  const rubros = useRubros()

  // Se escribe letra por letra: se espera a que la persona pare de tipear
  // antes de pedirle nada al servidor.
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo en el input. Se ajusta DURANTE el render (patrón
  // oficial de React para estado derivado) y no en un useEffect: llamar a
  // setState dentro de un efecto provoca un render en cascada.
  const [qPrevia, setQPrevia] = useState(filtros.q)
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q)
    setTexto(filtros.q)
  }

  useEffect(() => {
    if (texto === filtros.q) return
    const id = setTimeout(() => onAplicar({ q: texto }), 300)
    return () => clearTimeout(id)
  }, [texto, filtros.q, onAplicar])

  const activos = (filtros.rubro ? 1 : 0) + (filtros.soloRevision ? 1 : 0) + (filtros.incluirBajas ? 1 : 0)

  return (
    <FilterBar
      label="Buscar y filtrar clientes"
      activeCount={activos}
      hasFilters={hayFiltros}
      onClear={onLimpiar}
      search={
        <Field label="Buscar cliente" hideLabel>
          <Input
            type="search"
            placeholder="Nombre, referencia, CUIT, email o dominio…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </Field>
      }
    >
      {(rubros.data ?? []).length > 0 ? (
        <Field label="Rubro" hideLabel>
          <Select value={filtros.rubro ?? ''} onChange={(e) => onAplicar({ rubro: e.target.value || null })}>
            <option value="">Todos los rubros</option>
            {(rubros.data ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Checkbox
        label="Sólo los marcados para revisión"
        checked={filtros.soloRevision}
        onChange={(e) => onAplicar({ soloRevision: e.target.checked })}
      />

      <Checkbox
        label="Incluir dados de baja"
        checked={filtros.incluirBajas}
        onChange={(e) => onAplicar({ incluirBajas: e.target.checked })}
      />
    </FilterBar>
  )
}
