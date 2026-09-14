import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { OPCIONES_ESTADO, OPCIONES_RECEPCION } from '../lib/estados'
import { useMonedasUsadas } from '../hooks/usePedidos'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosPedidos as Filtros } from '../types'

export interface FiltrosPedidosProps {
  filtros: Filtros
  hayFiltros: boolean
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Filtros del listado de pedidos.
 *
 * Los siete que pediste, todos contra el servidor y todos en la URL. El de
 * proveedor es un `<select>` y no un buscador porque son 142 opciones y acá
 * es un filtro, no una elección que quede guardada en un documento.
 *
 * El filtro de moneda ofrece **las monedas que realmente se usaron**, no las
 * tres de la tabla: un filtro que no devuelve nada no ayuda a nadie.
 *
 * En mobile los controles se pliegan detrás de un botón (lo hace `FilterBar`):
 * la revisión visual a 390px los midió ocupando tres cuartos de la pantalla. El
 * buscador por número queda siempre a la vista y el botón dice cuántos filtros
 * hay puestos. Fase 13: mismo estado y mismos valores, layout común.
 */

/** Cuántos filtros hay activos, sin contar el buscador que está a la vista. */
function contarActivos(f: Filtros): number {
  return [
    f.proveedorId !== null,
    f.estado !== '',
    f.estadoRecepcion !== '',
    f.moneda !== '',
    f.desde !== '',
    f.hasta !== '',
    f.etaDesde !== '',
    f.etaHasta !== '',
    f.sinEta,
  ].filter(Boolean).length
}

export function FiltrosPedidos({ filtros, hayFiltros, onAplicar, onLimpiar }: FiltrosPedidosProps) {
  const monedas = useMonedasUsadas()
  // Los proveedores para el desplegable: activos, ordenados, sin paginar.
  const proveedores = useProveedores({
    ...FILTROS_INICIALES,
    porPagina: 100,
    orden: 'nombre',
    direccion: 'asc',
  })

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
        <Field label="Buscar por número" hideLabel>
          <Input type="search" placeholder="Número de pedido: PC000…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      }
    >
      <Field label="Proveedor" hideLabel>
        <Select value={filtros.proveedorId ?? ''} onChange={(e) => onAplicar({ proveedorId: e.target.value || null })}>
          <option value="">Todos los proveedores</option>
          {(proveedores.data?.filas ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.razonSocial}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Estado" hideLabel>
        <Select value={filtros.estado} onChange={(e) => onAplicar({ estado: e.target.value })}>
          <option value="">Todos los estados</option>
          {OPCIONES_ESTADO.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Recepción" hideLabel>
        <Select value={filtros.estadoRecepcion} onChange={(e) => onAplicar({ estadoRecepcion: e.target.value })}>
          <option value="">Recibido o no</option>
          {OPCIONES_RECEPCION.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </Select>
      </Field>

      {(monedas.data ?? []).length > 1 ? (
        <Field label="Moneda" hideLabel>
          <Select value={filtros.moneda} onChange={(e) => onAplicar({ moneda: e.target.value })}>
            <option value="">Todas las monedas</option>
            {(monedas.data ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Pedido desde">
        <Input type="date" value={filtros.desde} onChange={(e) => onAplicar({ desde: e.target.value })} />
      </Field>
      <Field label="Pedido hasta">
        <Input type="date" value={filtros.hasta} onChange={(e) => onAplicar({ hasta: e.target.value })} />
      </Field>

      <Field label="Llegada desde">
        <Input type="date" value={filtros.etaDesde} disabled={filtros.sinEta} onChange={(e) => onAplicar({ etaDesde: e.target.value })} />
      </Field>
      <Field label="Llegada hasta">
        <Input type="date" value={filtros.etaHasta} disabled={filtros.sinEta} onChange={(e) => onAplicar({ etaHasta: e.target.value })} />
      </Field>

      <Checkbox label="Sin fecha estimada" checked={filtros.sinEta} onChange={(e) => onAplicar({ sinEta: e.target.checked })} />
    </FilterBar>
  )
}
