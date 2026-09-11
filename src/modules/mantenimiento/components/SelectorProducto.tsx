import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarProductos, type ProductoBuscado } from '../services/catalogo'
import styles from './SelectorProducto.module.css'

export interface SelectorProductoProps {
  onElegir: (p: ProductoBuscado) => void
  onCerrar: () => void
  /**
   * La aclaración del pie. Cambia según dónde se use: en un equipo el producto
   * es opcional, en un repuesto es obligatorio. Dejar el texto del equipo en
   * los dos lados contradecía el «Repuesto *» del formulario.
   */
  pie?: string
}

const PIE_POR_DEFECTO =
  'El producto es opcional: un equipo que no está en el catálogo se carga igual con marca y modelo escritos a mano.'

/**
 * Buscador de productos del catálogo, contra el servidor.
 *
 * El legacy tenía `PRODUCTOS`, un array global con los 21.775 productos, y
 * filtraba en memoria. Acá cada tecla —debounceada— pide como mucho 20 filas.
 *
 * **No muestra ningún precio en ningún caso.** Ni acá ni en la cotización: las
 * listas del catálogo son de VENTA, y ofrecerlas como precio de cotización o
 * como costo de un repuesto sería exactamente la confusión que este módulo
 * evita.
 */
export function SelectorProducto({
  onElegir,
  onCerrar,
  pie = PIE_POR_DEFECTO,
}: SelectorProductoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const idBusqueda = useId()

  useEffect(() => {
    const id = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(id)
  }, [texto])

  const { data, isFetching, error } = useQuery({
    queryKey: ['mantenimiento', companyId, 'buscar-producto', consulta],
    queryFn: () => buscarProductos(companyId!, consulta),
    enabled: companyId !== null && consulta.trim().length >= 2,
    staleTime: 30_000,
  })

  return (
    <div className={styles.panel} role="dialog" aria-label="Elegir producto del catálogo">
      <div className={styles.cabecera}>
        <label className={styles.etiqueta} htmlFor={idBusqueda}>
          Buscar por SKU, nombre o marca
        </label>
        <button type="button" className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar">
          ×
        </button>
      </div>

      <input
        id={idBusqueda}
        type="search"
        className={styles.input}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="PRO05229, atornillador, FEIN…"
        autoFocus
      />

      {error ? (
        <p className={styles.nota} role="alert">
          {error.message}
        </p>
      ) : consulta.trim().length < 2 ? (
        <p className={styles.nota}>Escribí al menos dos caracteres.</p>
      ) : isFetching ? (
        <p className={styles.nota}>Buscando…</p>
      ) : (data ?? []).length === 0 ? (
        <p className={styles.nota}>Sin resultados.</p>
      ) : (
        <ul className={styles.lista}>
          {(data ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.fila} onClick={() => onElegir(p)}>
                <span className={styles.sku}>{p.sku}</span>
                <span className={styles.nombre}>{p.nombre}</span>
                <span className={styles.marca}>{p.marca ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.pie}>{pie}</p>
    </div>
  )
}
