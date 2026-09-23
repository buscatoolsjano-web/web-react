import { useId, useRef } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { Button } from '@/components/ui/Button'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { ComparadorProductos } from './ComparadorProductos'
import { columnasDeVarias } from '../lib/familias'
import type { ProductoListado } from '../types'
import styles from './ModalComparar.module.css'

/**
 * Comparar los productos que eligió la persona (Fase 22 · paridad, #42).
 *
 * En el legacy se tildan de 2 a 4 filas del listado y se toca «🔀 Comparar
 * (n)» (`openCatCompare`, app.js:17048). Acá es lo mismo, con el comparador
 * que ya existe: **no hay un segundo comparador.** El primer producto elegido
 * es la línea base, igual que el producto que uno está mirando en el
 * automático.
 *
 * Familias distintas: el legacy **no lo impide**. Arma filas fijas y les suma
 * las claves que tenga cualquiera de los elegidos, así que se comparan las
 * que se pueden y el resto queda en «—». `columnasDeVarias` replica eso.
 */
export function ModalComparar({
  productos,
  moneda,
  onQuitar,
  onAbrirProducto,
  onCerrar,
}: {
  productos: readonly ProductoListado[]
  moneda: string | null
  onQuitar: (producto: ProductoListado) => void
  onAbrirProducto: (id: string) => void
  onCerrar: () => void
}) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  const [principal, ...resto] = productos
  if (!principal) return null

  const columnas = columnasDeVarias(productos.map((p) => p.categoria?.slug ?? null))
  const familias = new Set(productos.map((p) => p.categoria?.nombre ?? 'Sin categoría'))

  return (
    <div className={styles.fondo}>
      <div
        ref={caja}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
      >
        <header className={styles.barra}>
          <div>
            <h2 className={styles.titulo} id={idTitulo}>
              Comparar productos
            </h2>
            <p className={styles.bajada}>
              {productos.length} elegidos · la primera columna es la referencia
              {familias.size > 1 ? (
                /* Sin esto, una tabla llena de «—» parece un error de datos y
                   es sólo que un balanceador no tiene encastre. */
                <> · <strong>familias distintas</strong>: sólo se comparan los atributos en común</>
              ) : null}
            </p>
          </div>
          <IconButton icon="x" aria-label="Cerrar la comparación" onClick={onCerrar} />
        </header>

        <div className={styles.cuerpo}>
          <ComparadorProductos
            principal={principal}
            similares={resto}
            familia={principal.categoria?.slug ?? null}
            columnas={columnas}
            sinTope
            moneda={moneda}
            onAbrirProducto={onAbrirProducto}
            variante="completa"
          />
        </div>

        <footer className={styles.pie}>
          <span className={styles.quitarRotulo}>Quitar:</span>
          {productos.map((p) => (
            <Button key={p.id} variant="ghost" size="sm" onClick={() => onQuitar(p)}>
              × {p.sku}
            </Button>
          ))}
        </footer>
      </div>
    </div>
  )
}
