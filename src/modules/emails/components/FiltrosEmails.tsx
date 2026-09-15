import { useEffect, useState } from 'react'
import { FilterBar } from '@/components/filters/FilterBar'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { ESTADOS_TRABAJO, type CuentaEmail, type EstadoTrabajo, type FiltrosEmails as Filtros, type UsuarioAsignable } from '../types'
import { ETIQUETA_ESTADO } from '../lib/formato'

export interface FiltrosEmailsProps {
  filtros: Filtros
  hayFiltros: boolean
  cuentas: CuentaEmail[]
  asignables: UsuarioAsignable[]
  onAplicar: (cambios: Partial<Filtros>) => void
  onLimpiar: () => void
}

/**
 * Los filtros de la bandeja. Todos van al servidor.
 *
 * La búsqueda es sobre la metadata local —asunto, extracto, participantes y
 * cliente—: no hay cuerpos guardados que indexar. Buscar dentro del contenido
 * en Gmail es backlog.
 *
 * Fase 13 · E5: sobre el `FilterBar` común; en mobile la búsqueda queda a la
 * vista y el resto se pliega.
 */
export function FiltrosEmails({ filtros, hayFiltros, cuentas, asignables, onAplicar, onLimpiar }: FiltrosEmailsProps) {
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

  const activos =
    (filtros.cuenta ? 1 : 0) +
    (filtros.estado ? 1 : 0) +
    (filtros.asignado ? 1 : 0) +
    (filtros.cliente ? 1 : 0) +
    (filtros.soloNoLeidos ? 1 : 0) +
    (filtros.soloConAdjuntos ? 1 : 0)

  return (
    <FilterBar
      label="Buscar y filtrar la bandeja"
      activeCount={activos}
      hasFilters={hayFiltros}
      onClear={onLimpiar}
      search={
        <Field label="Buscar en la bandeja" hideLabel>
          <Input
            type="search"
            placeholder="Asunto, remitente, extracto o cliente…"
            value={texto}
            maxLength={200}
            onChange={(e) => setTexto(e.target.value)}
          />
        </Field>
      }
    >
      {/* Con una sola cuenta el selector no aporta nada: no se muestra. */}
      {cuentas.length > 1 ? (
        <Field label="Cuenta de correo" hideLabel>
          <Select value={filtros.cuenta ?? ''} onChange={(e) => onAplicar({ cuenta: e.target.value || null })}>
            <option value="">Todas las cuentas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.direccion}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Estado de trabajo" hideLabel>
        <Select value={filtros.estado ?? ''} onChange={(e) => onAplicar({ estado: (e.target.value || null) as EstadoTrabajo | null })}>
          <option value="">Todos los estados</option>
          {ESTADOS_TRABAJO.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Asignado a" hideLabel>
        <Select value={filtros.asignado ?? ''} onChange={(e) => onAplicar({ asignado: e.target.value || null })}>
          <option value="">Cualquier asignación</option>
          <option value="yo">Asignados a mí</option>
          <option value="nadie">Sin asignar</option>
          {asignables.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Vínculo con cliente" hideLabel>
        <Select value={filtros.cliente ?? ''} onChange={(e) => onAplicar({ cliente: (e.target.value || null) as Filtros['cliente'] })}>
          <option value="">Con o sin cliente</option>
          <option value="con">Con cliente vinculado</option>
          <option value="sin">Sin cliente vinculado</option>
        </Select>
      </Field>

      <Checkbox label="Sólo sin leer" checked={filtros.soloNoLeidos} onChange={(e) => onAplicar({ soloNoLeidos: e.target.checked })} />
      <Checkbox label="Con adjuntos" checked={filtros.soloConAdjuntos} onChange={(e) => onAplicar({ soloConAdjuntos: e.target.checked })} />
    </FilterBar>
  )
}
