import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Input } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { buscarComponentes } from '@/modules/catalogo/services/productos'
import styles from './BuscadorProducto.module.css'

export interface ProductoElegido {
  id: string
  sku: string
  nombre: string
}

export interface BuscadorProductoProps {
  /** Con qué arranca la búsqueda: el texto del cliente, que es la mejor pista. */
  texto: string
  onElegir: (p: ProductoElegido) => void
  onCancelar: () => void
}

/**
 * Elegir un producto del catálogo para una línea (Fase 30 · E6).
 *
 * Arranca con el texto que escribió el cliente ya cargado. Es la diferencia
 * entre «buscá vos» y «mirá si es alguno de estos»: el que revisa una OC de
 * veinte líneas no puede volver a tipear cada descripción.
 *
 * Se reusa `buscarComponentes` —la misma consulta del armador de kits— porque
 * hace exactamente esto: busca por referencia o nombre y no devuelve kits.
 */
export function BuscadorProducto({ texto, onElegir, onCancelar }: BuscadorProductoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [valor, setValor] = useState(texto)
  const [consulta, setConsulta] = useState(texto)

  // Se espera a que pare de tipear: sin esto, cada tecla es una consulta.
  useEffect(() => {
    const t = setTimeout(() => setConsulta(valor), 300)
    return () => clearTimeout(t)
  }, [valor])

  const resultados = useQuery({
    queryKey: ['ventas', companyId, 'buscar-producto-oc', consulta],
    queryFn: () => buscarComponentes(companyId!, consulta),
    enabled: companyId !== null && consulta.trim().length >= 2,
    staleTime: 30_000,
  })

  const opciones = resultados.data ?? []

  return (
    <div className={styles.caja}>
      <div className={styles.fila}>
        <Input
          autoFocus
          value={valor}
          placeholder="Referencia o nombre…"
          aria-label="Buscar un producto del catálogo"
          onChange={(e) => setValor(e.target.value)}
        />
        <Button variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>

      {resultados.error ? (
        <p className={styles.nota} role="alert">
          {resultados.error.message}
        </p>
      ) : opciones.length > 0 ? (
        <ul className={styles.lista}>
          {opciones.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onElegir({ id: p.id, sku: p.sku, nombre: p.nombre })}>
                <span className={styles.sku}>{p.sku}</span>
                <span>{p.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.nota}>
          {resultados.isFetching
            ? 'Buscando…'
            : consulta.trim().length < 2
              ? 'Escribí al menos dos letras.'
              : 'Ningún producto coincide.'}
        </p>
      )}
    </div>
  )
}
