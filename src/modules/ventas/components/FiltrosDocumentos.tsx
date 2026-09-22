import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { estadosDisponibles } from '../lib/estados'
import { useClientes, useFacetas } from '../hooks/useDocumentos'
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
  return [f.clienteId, f.estado, f.moneda, f.desde, f.hasta, f.soloRevision, f.serie, f.origen, f.pendienteDeEntrega, f.soloAbiertas].filter(Boolean).length
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
  const facetas = useFacetas(tipo)

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
          {(facetas.data?.monedas ?? []).map((m) => (
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

      {/* La serie sólo se ofrece si hay más de una: con una sola, el
          desplegable no separa nada. En cotizaciones aparece el día que la
          serie piloto COT-ERP tenga documentos, que es justo cuando hace
          falta distinguirlos de los productivos. */}
      {(facetas.data?.series ?? []).length > 1 ? (
        <Field label="Serie" hideLabel>
          <Select value={filtros.serie ?? ''} onChange={(e) => onAplicar({ serie: e.target.value || null })}>
            <option value="">Todas las series</option>
            {(facetas.data?.series ?? []).map((x) => (
              <option key={x} value={x}>
                Serie {x}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {/* El origen no existe en cotizaciones: son el principio de la cadena. */}
      {tipo !== 'cotizacion' ? (
        <Field label="Origen" hideLabel>
          <Select value={filtros.origen ?? ''} onChange={(e) => onAplicar({ origen: (e.target.value || null) as 'con' | 'sin' | null })}>
            <option value="">Con y sin origen</option>
            <option value="con">{tipo === 'pedido' ? 'Desde una cotización' : 'Desde un pedido'}</option>
            <option value="sin">Cargado a mano</option>
          </Select>
        </Field>
      ) : null}

      {tipo === 'cotizacion' ? (
        <Checkbox
          label="Sólo abiertas"
          checked={filtros.soloAbiertas}
          onChange={(e) => onAplicar({ soloAbiertas: e.target.checked })}
        />
      ) : null}

      {tipo === 'pedido' ? (
        <Checkbox
          label="Pendientes de entrega"
          checked={filtros.pendienteDeEntrega}
          onChange={(e) => onAplicar({ pendienteDeEntrega: e.target.checked })}
        />
      ) : null}

      <Checkbox label="Sólo con observaciones" checked={filtros.soloRevision} onChange={(e) => onAplicar({ soloRevision: e.target.checked })} />
    </FilterBar>
  )
}
