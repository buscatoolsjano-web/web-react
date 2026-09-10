import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarProductos, type ProductoBuscado } from '../services/catalogo'
import styles from './SelectorProducto.module.css'

export interface SelectorProductoProps {
  onElegir: (p: ProductoBuscado) => void
  onCerrar: () => void
}

/**
 * Buscador de productos del catálogo, contra el servidor.
 *
 * El legacy tenía `PRODUCTOS`, un array global con los 21.775 productos, y
 * filtraba en memoria. Acá cada tecla —debounceada— pide como mucho 20 filas.
 *
 * **No muestra ningún precio**, a diferencia del selector de Ventas. Las
 * listas de precios son de VENTA: en un pedido de compra el precio es lo que
 * se le paga al proveedor, y no hay ninguna fuente de costo en la base. El
 * precio se escribe a mano en la línea, con el último precio pagado al lado
 * como referencia si existe.
 */
export function SelectorProducto({ onElegir, onCerrar }: SelectorProductoProps) {
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
    queryKey: ['compras', companyId, 'buscar-producto', consulta],
    queryFn: () => buscarProductos(companyId!, consulta),
    enabled: companyId !== null && consulta.trim().length >= 2,
    staleTime: 30_000,
  })

  return (
    <div className={styles.panel} role="dialog" aria-label="Agregar producto">
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
        placeholder="PRO05229, balanceador, Gedore…"
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

      <p className={styles.pie}>
        El precio de compra se escribe en la línea: las listas de precios del catálogo son de
        venta y no sirven acá.
      </p>
    </div>
  )
}
