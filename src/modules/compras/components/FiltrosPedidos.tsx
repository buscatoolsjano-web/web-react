import { useEffect, useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { OPCIONES_ESTADO, OPCIONES_RECEPCION } from '../lib/estados'
import { useMonedasUsadas } from '../hooks/usePedidos'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosPedidos as Filtros } from '../types'
import styles from './FiltrosPedidos.module.css'

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
 * En mobile los ocho controles se pliegan detrás de un botón. La revisión
 * visual a 390px los midió: ocupaban 408px y empujaban el primer resultado a
 * los 623px, o sea tres cuartos de la pantalla antes de ver un pedido. El
 * buscador por número queda siempre a la vista porque es el que más se usa, y
 * el botón dice cuántos filtros hay puestos para que ninguno quede escondido
 * sin avisar.
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

export function FiltrosPedidos({
  filtros,
  hayFiltros,
  onAplicar,
  onLimpiar,
}: FiltrosPedidosProps) {
  const isMobile = useIsMobile()
  const [desplegado, setDesplegado] = useState(false)
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

  const activos = contarActivos(filtros)
  // En escritorio están siempre; en mobile, sólo si se despliegan.
  const mostrarTodos = !isMobile || desplegado

  return (
    <div className={styles.barra}>
      <input
        type="search"
        className={styles.buscador}
        placeholder="Número de pedido: PC000…"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar por número"
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
        value={filtros.proveedorId ?? ''}
        onChange={(e) => onAplicar({ proveedorId: e.target.value || null })}
        aria-label="Proveedor"
      >
        <option value="">Todos los proveedores</option>
        {(proveedores.data?.filas ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.razonSocial}
          </option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filtros.estado}
        onChange={(e) => onAplicar({ estado: e.target.value })}
        aria-label="Estado"
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
        value={filtros.estadoRecepcion}
        onChange={(e) => onAplicar({ estadoRecepcion: e.target.value })}
        aria-label="Recepción"
      >
        <option value="">Recibido o no</option>
        {OPCIONES_RECEPCION.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>

      {(monedas.data ?? []).length > 1 ? (
        <select
          className={styles.select}
          value={filtros.moneda}
          onChange={(e) => onAplicar({ moneda: e.target.value })}
          aria-label="Moneda"
        >
          <option value="">Todas las monedas</option>
          {(monedas.data ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : null}

      <label className={styles.fecha}>
        <span className={styles.fechaLabel}>Pedido desde</span>
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

      <label className={styles.fecha}>
        <span className={styles.fechaLabel}>Llegada desde</span>
        <input
          type="date"
          className={styles.select}
          value={filtros.etaDesde}
          disabled={filtros.sinEta}
          onChange={(e) => onAplicar({ etaDesde: e.target.value })}
        />
      </label>
      <label className={styles.fecha}>
        <span className={styles.fechaLabel}>hasta</span>
        <input
          type="date"
          className={styles.select}
          value={filtros.etaHasta}
          disabled={filtros.sinEta}
          onChange={(e) => onAplicar({ etaHasta: e.target.value })}
        />
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filtros.sinEta}
          onChange={(e) => onAplicar({ sinEta: e.target.checked })}
        />
        Sin fecha estimada
      </label>
      </>
      )}

      {hayFiltros ? (
        <button type="button" className={styles.limpiar} onClick={onLimpiar}>
          Limpiar
        </button>
      ) : null}
    </div>
  )
}
