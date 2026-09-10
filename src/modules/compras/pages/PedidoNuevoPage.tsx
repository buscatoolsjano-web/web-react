import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioPedido } from '../components/FormularioPedido'
import { permisosDe } from '../lib/permisos'
import { problemasDeLinea } from '../lib/lineas'
import { pedidoVacio, validarPedido, type DatosPedidoCompra, type ErrorDePedido } from '../lib/validacion'
import { useCrearPedido } from '../hooks/usePedidos'
import type { ProveedorBuscado } from '../services/catalogo'
import type { LineaPedidoCompra } from '../types'
import styles from './ProveedorDetallePage.module.css'

const hoy = () => new Date().toISOString().slice(0, 10)

/**
 * Alta de pedido de compra.
 *
 * El número lo asigna el servidor al guardar con
 * `next_document_number(company, 'purchase_order')`. La serie arranca en 2:
 * el `PC00001` del legacy era un pedido de prueba y no se migró, así que ese
 * número no se reutiliza.
 *
 * El pedido nace en **borrador**. Confirmarlo es otra acción, desde la ficha.
 */
export function PedidoNuevoPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const crear = useCrearPedido()
  const navegar = useNavigate()

  const [datos, setDatos] = useState<DatosPedidoCompra>(pedidoVacio(hoy()))
  const [proveedor, setProveedor] = useState<ProveedorBuscado | null>(null)
  const [lineas, setLineas] = useState<LineaPedidoCompra[]>([])
  const [errores, setErrores] = useState<ErrorDePedido[]>([])
  const [intentado, setIntentado] = useState(false)

  const cambiar = (cambios: Partial<DatosPedidoCompra>) => {
    const siguiente = { ...datos, ...cambios }
    setDatos(siguiente)
    if (intentado) setErrores(validarPedido(siguiente))
  }

  /**
   * Al elegir el proveedor se precompletan la condición de pago y la moneda.
   *
   * Es una sugerencia inicial y sólo si el campo está vacío: lo que se guarda
   * es una copia en el pedido, no una referencia. Si mañana cambia la
   * condición del proveedor, este pedido no cambia.
   */
  const elegirProveedor = (p: ProveedorBuscado | null) => {
    setProveedor(p)
    if (!p) {
      cambiar({ proveedorId: '' })
      return
    }
    cambiar({
      proveedorId: p.id,
      formaPago: datos.formaPago.trim() === '' ? (p.formaPago ?? '') : datos.formaPago,
      moneda: datos.moneda === '' ? (p.moneda ?? '') : datos.moneda,
    })
  }

  const problemasDeLineas = lineas.flatMap((l) => problemasDeLinea(l))

  const guardar = () => {
    const encontrados = validarPedido(datos)
    setErrores(encontrados)
    setIntentado(true)
    if (encontrados.length > 0 || problemasDeLineas.length > 0) return
    crear.mutate(
      { datos, lineas },
      { onSuccess: ({ id }) => void navegar(`/compras/pedidos/${id}`) },
    )
  }

  if (!permisos.crearProveedor) {
    return (
      <div className={styles.page}>
        <Link to="/compras/pedidos" className={styles.volver}>
          ← Pedidos de compra
        </Link>
        <p className={styles.nota}>Tu rol no puede dar de alta pedidos de compra.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/compras/pedidos" className={styles.volver}>
        ← Pedidos de compra
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>Nuevo pedido de compra</h1>
          <p className={styles.subtitulo}>
            El número lo asigna el servidor al guardar. El pedido nace en borrador: confirmarlo
            es otra acción.
          </p>
        </div>
      </header>

      <section className={styles.bloque}>
        <FormularioPedido
          datos={datos}
          errores={errores}
          lineas={lineas}
          proveedor={proveedor}
          moneda={datos.moneda}
          editaIdentidad
          editaLogistica
          editaLineas
          totalesServidor={null}
          sinGuardar
          onCambiarCabecera={cambiar}
          onProveedor={elegirProveedor}
          onCambiarLineas={setLineas}
        />

        {crear.error ? (
          <p className={styles.error} role="alert">
            {crear.error.message}
          </p>
        ) : null}

        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.primario}
            disabled={crear.isPending}
            onClick={guardar}
          >
            {crear.isPending ? 'Guardando…' : 'Crear pedido'}
          </button>
          <button
            type="button"
            className={styles.secundario}
            disabled={crear.isPending}
            onClick={() => void navegar('/compras/pedidos')}
          >
            Cancelar
          </button>
        </div>
      </section>
    </div>
  )
}
