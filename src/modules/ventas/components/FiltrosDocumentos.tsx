import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { estadosDisponibles } from '../lib/estados'
import { useClientes, useMonedas } from '../hooks/useDocumentos'
import type { FiltrosVentas, TipoDocumento } from '../types'

export interface FiltrosDocumentosProps {
  tipo: TipoDocumento
  filtros: FiltrosVentas
  hayFiltros: boolean
  onAplicar: (cambios: Partial<FiltrosVentas>) => void
  onLimpiar: () => void
}

/** Filtros aplicados además de la búsqueda (para el contador en mobile). */
function contarActivos(f: FiltrosVentas): number {
  return [f.clienteId, f.estado, f.moneda, f.desde, f.hasta, f.soloRevision].filter(Boolean).length
}

/**
 * Los cinco filtros mínimos: fecha, cliente, estado, moneda y número.
 *
 * Todos van al servidor. El legacy filtraba en memoria sobre la lista
 * completa, lo que obligaba a traerla entera.
 *
 * Fase 13: sólo cambia el layout (`FilterBar`) y los controles del sistema.
 * Valores, URL y debounce son los mismos.
 */
export function FiltrosDocumentos({
  tipo,
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosDocumentosProps) {
  const clientes = useClientes()
  const monedas = useMonedas(tipo)

  // El número se escribe letra por letra: se espera a que la persona pare de
  // tipear antes de pedirle nada al servidor.
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera —el botón «Limpiar», o el «atrás» del
  // navegador— hay que reflejarlo en el input. Se ajusta DURANTE el render
  // (patrón oficial de React para estado derivado) y no en un useEffect:
  // llamar a setState dentro de un efecto provoca un render en cascada.
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
        <Field label="Buscar por número de documento" hideLabel>
          <Input type="search" placeholder="Buscar por número…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      }
    >
      <Field label="Cliente" hideLabel>
        <Select value={filtros.clienteId ?? ''} onChange={(e) => onAplicar({ clienteId: e.target.value || null })}>
          <option value="">Todos los clientes</option>
          {(clientes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {/* Un cliente dado de baja sigue en el filtro: sus documentos
                  históricos existen y hay que poder buscarlos por él. */}
              {c.dadoDeBaja ? ' (dado de baja)' : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Estado" hideLabel>
        <Select value={filtros.estado ?? ''} onChange={(e) => onAplicar({ estado: e.target.value || null })}>
          <option value="">Todos los estados</option>
          {estadosDisponibles(tipo).map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Moneda" hideLabel>
        <Select value={filtros.moneda ?? ''} onChange={(e) => onAplicar({ moneda: e.target.value || null })}>
          <option value="">Todas las monedas</option>
          {(monedas.data ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Desde">
        <Input type="date" value={filtros.desde ?? ''} onChange={(e) => onAplicar({ desde: e.target.value || null })} />
      </Field>

      <Field label="Hasta">
        <Input type="date" value={filtros.hasta ?? ''} onChange={(e) => onAplicar({ hasta: e.target.value || null })} />
      </Field>

      <Checkbox label="Sólo con observaciones" checked={filtros.soloRevision} onChange={(e) => onAplicar({ soloRevision: e.target.checked })} />
    </FilterBar>
  )
}
