import { Link } from 'react-router-dom'
import type { ComprasDelProveedor } from '../types'
import styles from './PanelCompras.module.css'

export interface PanelComprasProps {
  proveedorId: string
  datos: ComprasDelProveedor | undefined
  cargando: boolean
}

const DOCUMENTOS = [
  { clave: 'pedidos', etiqueta: 'Pedidos de compra', ruta: '/compras/pedidos' },
  { clave: 'recepciones', etiqueta: 'Notas de entrega', ruta: '/compras/recepciones' },
  { clave: 'facturas', etiqueta: 'Facturas de proveedor', ruta: '/compras/facturas' },
] as const

/**
 * Los documentos de compra del proveedor.
 *
 * Cada número es un **enlace al listado filtrado por este proveedor**, no un
 * cartel: `?prov=<id>` es el mismo filtro que usa la pantalla, así que el link
 * se comparte y el «atrás» del navegador vuelve acá.
 *
 * La relación es por `supplier_id`, nunca por el nombre: dos proveedores
 * pueden llamarse parecido y un nombre se edita.
 */
export function PanelCompras({ proveedorId, datos, cargando }: PanelComprasProps) {
  if (cargando) return <p className={styles.nota}>Cargando…</p>

  const total = (datos?.pedidos ?? 0) + (datos?.recepciones ?? 0) + (datos?.facturas ?? 0)

  return (
    <div className={styles.panel}>
      <dl className={styles.numeros}>
        {DOCUMENTOS.map((d) => {
          const cuantos = datos?.[d.clave] ?? 0
          return (
            <div key={d.clave} className={styles.numero}>
              <dt className={styles.etiqueta}>{d.etiqueta}</dt>
              <dd className={styles.valor}>
                {cuantos === 0 ? (
                  cuantos
                ) : (
                  <Link className={styles.enlace} to={`${d.ruta}?prov=${proveedorId}`}>
                    {cuantos}
                  </Link>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {total === 0 ? (
        <p className={styles.nota}>
          Este proveedor todavía no tiene documentos de compra. En cuanto tenga uno, el número
          lleva al listado filtrado por él.
        </p>
      ) : (
        <p className={styles.nota}>
          Cada número abre su listado filtrado por este proveedor.
        </p>
      )}
    </div>
  )
}
