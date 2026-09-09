import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarProductos, precioSugerido, type ProductoParaLinea } from '../services/productosParaLinea'
import { formatearImporte } from '../lib/formato'
import styles from './SelectorProducto.module.css'

export interface SelectorProductoProps {
  moneda: string
  onElegir: (p: ProductoParaLinea, precio: number | null) => void
  onCerrar: () => void
}

/**
 * Buscador de productos del catálogo, contra el servidor.
 *
 * El legacy tenía `PRODUCTOS`, un array global con los 21.775 productos, y
 * filtraba en memoria. Acá cada tecla —debounceada— pide como mucho 20 filas.
 */
export function SelectorProducto({ moneda, onElegir, onCerrar }: SelectorProductoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const idBusqueda = useId()

  // Se espera a que la persona pare de tipear: sin esto, "balanceador" son
  // once requests.
  useEffect(() => {
    const id = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(id)
  }, [texto])

  const { data, isFetching, error } = useQuery({
    queryKey: ['ventas', companyId, 'buscar-producto', consulta],
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
          {(data ?? []).map((p) => {
            const precio = precioSugerido(p, moneda)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.fila}
                  onClick={() => onElegir(p, precio)}
                >
                  <span className={styles.sku}>{p.sku}</span>
                  <span className={styles.nombre}>{p.nombre}</span>
                  <span className={styles.marca}>{p.marca ?? ''}</span>
                  <span className={styles.precio}>
                    {precio !== null ? (
                      formatearImporte(precio, moneda)
                    ) : p.precio !== null ? (
                      // Hay precio, pero en otra moneda: no se convierte sin
                      // un tipo de cambio confirmado.
                      <span className={styles.otraMoneda}>
                        {formatearImporte(p.precio, p.monedaPrecio)}
                      </span>
                    ) : (
                      <span className={styles.sinPrecio}>Sin precio</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
