import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { ETAPAS, OPCIONES_ESTADO } from '../lib/estados'
import { useTecnicos } from '../hooks/useOrdenes'
import type { FiltrosOrdenes as Filtros } from '../types'
import styles from './Filtros.module.css'

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
  const isMobile = useIsMobile()
  const [desplegado, setDesplegado] = useState(false)
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

  const activos = contarActivos(filtros)
  const mostrarTodos = !isMobile || desplegado

  return (
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Número de orden: OS000…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar por número de orden"
      />

      {isMobile ? (
        <button
          type="button"
          className={styles.desplegar}
          aria-expanded={desplegado}
          onClick={() => setDesplegado((v) => !v)}
        >
          {desplegado ? 'Ocultar filtros' : 'Filtros'}
          {activos > 0 ? <span className={styles.contador}>{activos}</span> : null}
        </button>
      ) : null}

      {!mostrarTodos ? null : (
        <>
          <select
            className={styles.select}
            value={filtros.estado}
            onChange={(e) => onAplicar({ estado: e.target.value })}
            aria-label="Estado de la orden"
          >
            <option value="">Todos los estados</option>
            {OPCIONES_ESTADO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={filtros.etapa}
            onChange={(e) => onAplicar({ etapa: e.target.value })}
            aria-label="Etapa"
          >
            <option value="">Todas las etapas</option>
            {ETAPAS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={filtros.tecnicoId ?? ''}
            onChange={(e) => onAplicar({ tecnicoId: e.target.value || null })}
            aria-label="Técnico"
          >
            <option value="">Todos los técnicos</option>
            {(tecnicos.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={filtros.enEspera}
            onChange={(e) => onAplicar({ enEspera: e.target.value })}
            aria-label="En espera"
          >
            <option value="">En espera o no</option>
            <option value="si">Sólo en espera</option>
            <option value="no">Sólo activas</option>
          </select>

          <label className={styles.fecha}>
            <span className={styles.fechaLabel}>Ingreso desde</span>
            <input
              type="date"
              className={styles.select}
              value={filtros.desde}
              onChange={(e) => onAplicar({ desde: e.target.value })}
            />
          </label>

          <label className={styles.fecha}>
            <span className={styles.fechaLabel}>hasta</span>
            <input
              type="date"
              className={styles.select}
              value={filtros.hasta}
              onChange={(e) => onAplicar({ hasta: e.target.value })}
            />
          </label>

          {hayFiltros ? (
            <button type="button" className={styles.limpiar} onClick={onLimpiar}>
              Limpiar filtros
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
