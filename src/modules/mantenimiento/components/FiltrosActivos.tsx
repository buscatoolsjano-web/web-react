import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { useResumenActivos, useTiposDeActivo } from '../hooks/useActivos'
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
 * **El cliente sí va en un `<select>`, y en Clientes no.** No es una
 * inconsistencia: el maestro tiene 1.010 clientes y ahí el desplegable sería
 * el que hubo que sacar de Ventas, pero equipos tienen **dieciséis**, y dos de
 * ellos concentran 141 y 134 de los 358. Filtrar por cliente es lo primero que
 * se hace en esta pantalla. El desplegable dice además cuántos equipos tiene
 * cada uno, que es lo que ayuda a elegir.
 *
 * En mobile los controles se pliegan detrás de un botón que dice cuántos hay
 * puestos (lo hace `FilterBar`); el buscador queda siempre a la vista porque
 * es el que más se usa.
 */

function contarActivos(f: Filtros): number {
  return [
    f.clienteId !== null,
    f.productoId !== null,
    f.tipo !== '',
    f.marca !== '',
    f.modelo !== '',
    f.serie !== '',
    f.sinCliente,
    f.estado !== '',
  ].filter(Boolean).length
}

export function FiltrosActivos({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosActivosProps) {
  const tipos = useTiposDeActivo()
  const resumen = useResumenActivos()

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
        <Field label="Buscar por serie, referencia, etiqueta, marca o modelo" hideLabel>
          <Input type="search" placeholder="Serie, referencia ACT000…, etiqueta, marca o modelo" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      }
    >
      {/* El cliente es el filtro de primer nivel: dieciséis clientes tienen
          los 358 equipos, y dos de ellos tienen 141 y 134. Acá un desplegable
          SÍ sirve —el de Clientes tiene 1.010 y por eso no lo tiene—, y dice
          cuántos equipos hay en cada uno. */}
      <Field label="Cliente" hideLabel>
        <Select
          value={filtros.clienteId ?? ''}
          onChange={(e) => onAplicar({ clienteId: e.target.value === '' ? null : e.target.value, sinCliente: false })}
        >
          <option value="">Todos los clientes</option>
          {(resumen.data?.clientes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} ({c.equipos})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Marca" hideLabel>
        <Select value={filtros.marca} onChange={(e) => onAplicar({ marca: e.target.value })}>
          <option value="">Todas las marcas</option>
          {(resumen.data?.marcas ?? []).map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.valor} ({m.equipos})
            </option>
          ))}
        </Select>
      </Field>

      {/* El modelo es el texto tal como vino: no se agrupan variantes de
          escritura todavía, así que el desplegable puede tener el mismo
          modelo dos veces. Es el dato real y se ve como es. */}
      <Field label="Modelo" hideLabel>
        <Select value={filtros.modelo} onChange={(e) => onAplicar({ modelo: e.target.value })}>
          <option value="">Todos los modelos</option>
          {(resumen.data?.modelos ?? []).map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.valor} ({m.equipos})
            </option>
          ))}
        </Select>
      </Field>

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
