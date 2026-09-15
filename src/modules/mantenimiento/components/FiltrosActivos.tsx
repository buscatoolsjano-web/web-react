import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { useTiposDeActivo } from '../hooks/useActivos'
import type { FiltrosActivos as Filtros } from '../types'

export interface FiltrosActivosProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado de equipos.
 *
 * Todos contra el servidor y todos en la URL. El de tipo ofrece **los tipos
 * que realmente se cargaron**, no una lista inventada: un filtro que no
 * devuelve nada no le sirve a nadie.
 *
 * No hay filtro de cliente en un `<select>`: son 1.010 y sería el desplegable
 * gigante que hubo que sacar de Ventas. Se filtra por cliente entrando desde
 * la ficha del cliente o del equipo, que es cuando hace falta.
 *
 * En mobile los controles se pliegan detrás de un botón que dice cuántos hay
 * puestos (lo hace `FilterBar`); el buscador queda siempre a la vista porque
 * es el que más se usa.
 */

function contarActivos(f: Filtros): number {
  return [f.clienteId !== null, f.productoId !== null, f.tipo !== '', f.estado !== ''].filter(
    Boolean,
  ).length
}

export function FiltrosActivos({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosActivosProps) {
  const tipos = useTiposDeActivo()

  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —«Limpiar», o el «atrás» del navegador—
  // hay que reflejarlo en el input. Se ajusta DURANTE el render, no en un
  // useEffect: llamar a setState dentro de un efecto provoca un render en
  // cascada.
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

  return (
    <FilterBar
      activeCount={contarActivos(filtros)}
      hasFilters={hayFiltros}
      onClear={onLimpiar}
      search={
        <Field label="Buscar por serie, referencia o etiqueta" hideLabel>
          <Input type="search" placeholder="Serie, referencia EQ000… o etiqueta" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      }
    >
      <Field label="Tipo de equipo" hideLabel>
        <Select value={filtros.tipo} onChange={(e) => onAplicar({ tipo: e.target.value })}>
          <option value="">Todos los tipos</option>
          {(tipos.data ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Estado del equipo" hideLabel>
        <Select value={filtros.estado} onChange={(e) => onAplicar({ estado: e.target.value })}>
          <option value="">Activos y dados de baja</option>
          <option value="activo">Sólo activos</option>
          <option value="baja">Sólo dados de baja</option>
        </Select>
      </Field>
    </FilterBar>
  )
}
