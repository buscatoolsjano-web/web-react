import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { CabeceraPedido } from './CabeceraPedido'
import { EditorLineas, type CampoLinea } from './EditorLineas'
import { PanelTotales } from './PanelTotales'
import { SelectorProducto } from './SelectorProducto'
import {
  lineaCapitulo,
  lineaDeProducto,
  lineaLibre,
  mover,
  problemasDeLinea,
  renumerar,
  totalesPrevios,
} from '../lib/lineas'
import { tasaDe } from '../lib/tratamientos'
import { ultimosPreciosDeCompra } from '../services/catalogo'
import type { ProveedorBuscado } from '../services/catalogo'
import type { DatosPedidoCompra, ErrorDePedido } from '../lib/validacion'
import type { LineaPedidoCompra, UltimoPrecioCompra } from '../types'
import styles from './FormularioPedido.module.css'

export interface FormularioPedidoProps {
  datos: DatosPedidoCompra
  errores: readonly ErrorDePedido[]
  lineas: readonly LineaPedidoCompra[]
  proveedor: ProveedorBuscado | null
  moneda: string
  editaIdentidad: boolean
  editaLogistica: boolean
  editaLineas: boolean
  /** `false` en la vista de lectura: la cabecera ya se muestra como datos. */
  mostrarCabecera?: boolean
  /** Lo que devolvió el servidor; `null` en el alta, que todavía no existe. */
  totalesServidor: { subtotal: number; impuesto: number; total: number } | null
  sinGuardar: boolean
  onCambiarCabecera: (cambios: Partial<DatosPedidoCompra>) => void
  onProveedor: (p: ProveedorBuscado | null) => void
  onCambiarLineas: (lineas: LineaPedidoCompra[]) => void
}

/**
 * Cabecera + líneas + totales.
 *
 * Lo comparten el alta y la ficha para que las dos pantallas se comporten
 * igual: las mismas reglas de edición, la misma cuenta provisoria y el mismo
 * aviso de que el total que vale es el del servidor.
 */
export function FormularioPedido({
  datos,
  errores,
  lineas,
  proveedor,
  moneda,
  editaIdentidad,
  editaLogistica,
  editaLineas,
  mostrarCabecera = true,
  totalesServidor,
  sinGuardar,
  onCambiarCabecera,
  onProveedor,
  onCambiarLineas,
}: FormularioPedidoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [buscando, setBuscando] = useState(false)

  /**
   * El último precio pagado por cada producto de las líneas.
   *
   * No hay ninguna fuente de costo en la base —se auditó: las listas de
   * precios son de venta—, así que el precio de compra se escribe a mano.
   * Esto es lo único que se ofrece, y es un dato real: qué se pagó la última
   * vez, en esta misma moneda, en un pedido confirmado. Nunca autocompleta.
   */
  const productIds = lineas.map((l) => l.productId).filter((x): x is string => x !== null)
  const ultimos = useQuery<Map<string, UltimoPrecioCompra>>({
    queryKey: ['compras', companyId, 'ultimo-precio', moneda, [...productIds].sort().join(',')],
    queryFn: () => ultimosPreciosDeCompra(companyId!, productIds, moneda),
    enabled: companyId !== null && moneda !== '' && productIds.length > 0,
    staleTime: 60_000,
  })

  const cambiarLinea = (id: string, campo: CampoLinea, valor: string | number | null) => {
    onCambiarLineas(
      lineas.map((l) => {
        if (l.id !== id) return l
        const siguiente: LineaPedidoCompra = { ...l, [campo]: valor }
        // Cambiar el tratamiento recalcula la alícuota. En `other` queda en
        // null hasta que alguien la escriba: no hay un 21 % por defecto que
        // inventar, que es exactamente de dónde salió el bug del 1 % legacy.
        if (campo === 'tratamientoImpuesto') {
          siguiente.tasaImpuesto = tasaDe(String(valor))
        }
        return siguiente
      }),
    )
  }

  const agregar = (nueva: LineaPedidoCompra) => onCambiarLineas([...lineas, nueva])

  const problemas = lineas.flatMap((l) =>
    problemasDeLinea(l).map((p) => `Línea ${l.numeroLinea}: ${p}`),
  )
  const previo = totalesPrevios(lineas)

  return (
    <div className={styles.form}>
      {mostrarCabecera ? (
        <CabeceraPedido
          datos={datos}
          errores={errores}
          proveedor={proveedor}
          editaIdentidad={editaIdentidad}
          editaLogistica={editaLogistica}
          onCambiar={onCambiarCabecera}
          onProveedor={onProveedor}
        />
      ) : null}

      <section className={styles.bloqueLineas}>
        <header className={styles.encabezadoLineas}>
          <h2 className={styles.tituloLineas}>Líneas</h2>
          {editaLineas ? (
            <div className={styles.acciones}>
              <button
                type="button"
                className={styles.secundario}
                onClick={() => setBuscando((v) => !v)}
              >
                {buscando ? 'Cerrar buscador' : '+ Producto del catálogo'}
              </button>
              <button
                type="button"
                className={styles.secundario}
                onClick={() => agregar(lineaLibre(lineas.length + 1))}
              >
                + Línea libre
              </button>
              <button
                type="button"
                className={styles.secundario}
                onClick={() => agregar(lineaCapitulo(lineas.length + 1))}
              >
                + Capítulo
              </button>
            </div>
          ) : null}
        </header>

        {buscando && editaLineas ? (
          <SelectorProducto
            onElegir={(p) => agregar(lineaDeProducto(p, lineas.length + 1))}
            onCerrar={() => setBuscando(false)}
          />
        ) : null}

        <EditorLineas
          lineas={lineas}
          moneda={moneda || '—'}
          editable={editaLineas}
          ultimosPrecios={ultimos.data ?? new Map()}
          onCambiar={cambiarLinea}
          onEliminar={(id) => onCambiarLineas(renumerar(lineas.filter((l) => l.id !== id)))}
          onMover={(id, d) => onCambiarLineas(mover(lineas, id, d))}
        />

        {problemas.length > 0 ? (
          <ul className={styles.problemas} role="alert">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        <PanelTotales
          moneda={moneda || '—'}
          servidor={totalesServidor}
          previo={previo}
          sinGuardar={sinGuardar}
        />
      </section>
    </div>
  )
}
