import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { ETAPAS, OPCIONES_ESTADO } from '../lib/estados'
import { useTecnicos } from '../hooks/useOrdenes'
import type { FiltrosOrdenes as Filtros } from '../types'

export interface FiltrosOrdenesProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado de órdenes.
 *
 * Los tres ejes de estado se filtran por separado —estado, etapa y espera—
 * porque son tres cosas distintas. «Abierta y en espera» y «abierta y
 * avanzando» son situaciones que no se parecen en nada, y con un solo
 * desplegable combinado no se podrían distinguir.
 *
 * Fase 13 · E5: mismo estado, mismos valores y el mismo debounce; el layout y
 * el plegado en mobile los pone `FilterBar`.
 */

function contarActivos(f: Filtros): number {
  return [
    f.clienteId !== null,
    f.activoId !== null,
    f.estado !== '',
    f.etapa !== '',
    f.tecnicoId !== null,
    f.enEspera !== '',
    f.desde !== '',
    f.hasta !== '',
  ].filter(Boolean).length
}

export function FiltrosOrdenes({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosOrdenesProps) {
  const tecnicos = useTecnicos()

  const [texto, setTexto] = useState(filtros.q)

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
        <Field label="Buscar por número de orden" hideLabel>
          <Input type="search" placeholder="Número de orden: OS000…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      }
    >
      <Field label="Estado de la orden" hideLabel>
        <Select value={filtros.estado} onChange={(e) => onAplicar({ estado: e.target.value })}>
          <option value="">Todos los estados</option>
          {OPCIONES_ESTADO.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Etapa" hideLabel>
        <Select value={filtros.etapa} onChange={(e) => onAplicar({ etapa: e.target.value })}>
          <option value="">Todas las etapas</option>
          {ETAPAS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Técnico" hideLabel>
        <Select value={filtros.tecnicoId ?? ''} onChange={(e) => onAplicar({ tecnicoId: e.target.value || null })}>
          <option value="">Todos los técnicos</option>
          {(tecnicos.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="En espera" hideLabel>
        <Select value={filtros.enEspera} onChange={(e) => onAplicar({ enEspera: e.target.value })}>
          <option value="">En espera o no</option>
          <option value="si">Sólo en espera</option>
          <option value="no">Sólo activas</option>
        </Select>
      </Field>

      <Field label="Ingreso desde">
        <Input type="date" value={filtros.desde} onChange={(e) => onAplicar({ desde: e.target.value })} />
      </Field>

      <Field label="Ingreso hasta">
        <Input type="date" value={filtros.hasta} onChange={(e) => onAplicar({ hasta: e.target.value })} />
      </Field>
    </FilterBar>
  )
}
