import { useEffect, useState } from 'react'
import { estadosDisponibles } from '../lib/estados'
import { useClientes, useMonedas } from '../hooks/useDocumentos'
import type { FiltrosVentas, TipoDocumento } from '../types'
import styles from './FiltrosDocumentos.module.css'

export interface FiltrosDocumentosProps {
  tipo: TipoDocumento
  filtros: FiltrosVentas
  hayFiltros: boolean
  onAplicar: (cambios: Partial<FiltrosVentas>) => void
  onLimpiar: () => void
}

/**
 * Los cinco filtros mínimos: fecha, cliente, estado, moneda y número.
 *
 * Todos van al servidor. El legacy filtraba en memoria sobre la lista
 * completa, lo que obligaba a traerla entera.
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
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Buscar por número…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar por número de documento"
      />

      <select
        className={styles.select}
        value={filtros.clienteId ?? ''}
        onChange={(e) => onAplicar({ clienteId: e.target.value || null })}
        aria-label="Cliente"
      >
        <option value="">Todos los clientes</option>
        {(clientes.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
            {/* Un cliente dado de baja sigue en el filtro: sus documentos
                históricos existen y hay que poder buscarlos por él. */}
            {c.dadoDeBaja ? ' (dado de baja)' : ''}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filtros.estado ?? ''}
        onChange={(e) => onAplicar({ estado: e.target.value || null })}
        aria-label="Estado"
      >
        <option value="">Todos los estados</option>
        {estadosDisponibles(tipo).map((e) => (
          <option key={e.valor} value={e.valor}>
            {e.etiqueta}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filtros.moneda ?? ''}
        onChange={(e) => onAplicar({ moneda: e.target.value || null })}
        aria-label="Moneda"
      >
        <option value="">Todas las monedas</option>
        {(monedas.data ?? []).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <label className={styles.fecha}>
        <span className={styles.fechaLabel}>Desde</span>
        <input
          type="date"
          className={styles.select}
          value={filtros.desde ?? ''}
          onChange={(e) => onAplicar({ desde: e.target.value || null })}
        />
      </label>

      <label className={styles.fecha}>
        <span className={styles.fechaLabel}>Hasta</span>
        <input
          type="date"
          className={styles.select}
          value={filtros.hasta ?? ''}
          onChange={(e) => onAplicar({ hasta: e.target.value || null })}
        />
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.soloRevision}
          onChange={(e) => onAplicar({ soloRevision: e.target.checked })}
        />
        Sólo con observaciones
      </label>

      {hayFiltros ? (
        <button type="button" className={styles.limpiar} onClick={onLimpiar}>
          Limpiar
        </button>
      ) : null}
    </div>
  )
}
