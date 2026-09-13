import { useEffect, useState } from 'react'
import { ESTADOS_TRABAJO, type CuentaEmail, type EstadoTrabajo, type FiltrosEmails as Filtros, type UsuarioAsignable } from '../types'
import { ETIQUETA_ESTADO } from '../lib/formato'
import styles from './Emails.module.css'

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

  return (
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Asunto, remitente, extracto o cliente…"
        value={texto}
        maxLength={200}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar en la bandeja"
      />

      {/* Con una sola cuenta el selector no aporta nada: no se muestra. */}
      {cuentas.length > 1 ? (
        <select
          className={styles.select}
          value={filtros.cuenta ?? ''}
          onChange={(e) => onAplicar({ cuenta: e.target.value || null })}
          aria-label="Cuenta de correo"
        >
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.direccion}
            </option>
          ))}
        </select>
      ) : null}

      <select
        className={styles.select}
        value={filtros.estado ?? ''}
        onChange={(e) => onAplicar({ estado: (e.target.value || null) as EstadoTrabajo | null })}
        aria-label="Estado de trabajo"
      >
        <option value="">Todos los estados</option>
        {ESTADOS_TRABAJO.map((e) => (
          <option key={e} value={e}>
            {ETIQUETA_ESTADO[e]}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filtros.asignado ?? ''}
        onChange={(e) => onAplicar({ asignado: e.target.value || null })}
        aria-label="Asignado a"
      >
        <option value="">Cualquier asignación</option>
        <option value="yo">Asignados a mí</option>
        <option value="nadie">Sin asignar</option>
        {asignables.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filtros.cliente ?? ''}
        onChange={(e) => onAplicar({ cliente: (e.target.value || null) as Filtros['cliente'] })}
        aria-label="Vínculo con cliente"
      >
        <option value="">Con o sin cliente</option>
        <option value="con">Con cliente vinculado</option>
        <option value="sin">Sin cliente vinculado</option>
      </select>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.soloNoLeidos}
          onChange={(e) => onAplicar({ soloNoLeidos: e.target.checked })}
        />
        Sólo sin leer
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.soloConAdjuntos}
          onChange={(e) => onAplicar({ soloConAdjuntos: e.target.checked })}
        />
        Con adjuntos
      </label>

      {hayFiltros ? (
        <button type="button" className={styles.boton} onClick={onLimpiar}>
          Limpiar filtros
        </button>
      ) : null}
    </div>
  )
}
