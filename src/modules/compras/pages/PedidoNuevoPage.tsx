import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { cruzaDeLado, leerParaCopiar, leerParametroCopia } from '@/services/copiarDocumento'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import docUi from '@/components/document/Document.module.css'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import editor from '@/modules/ventas/pages/EditorCotizacion.module.css'
import { FormularioPedido } from '../components/FormularioPedido'
import { VistaPreviaPedidoCompra } from '../components/VistaPreviaPedidoCompra'
import { permisosDe } from '../lib/permisos'
import { lineasDesdeCopia, problemasDeLinea } from '../lib/lineas'
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
  // La hoja al costado (Fase 236), con la misma regla que Ventas: con 1280 px
  // o más se muestra sola; si la persona la cierra o la abre, gana lo suyo.
  const pantallaAncha = useMediaQuery('(min-width: 1280px)')
  const [previaPedida, setPreviaPedida] = useState<boolean | null>(null)
  const verPrevia = previaPedida ?? pantallaAncha
  const [errores, setErrores] = useState<ErrorDePedido[]>([])
  const [intentado, setIntentado] = useState(false)

  /**
   * «Duplicar como…» (Fase 233): `?copiar=<tipo>:<id>` trae las líneas de
   * otro documento —una cotización, un pedido de venta u otra compra—. Se
   * carga una sola vez; el proveedor lo elige la persona.
   */
  const [parametros] = useSearchParams()
  const copia = leerParametroCopia(parametros.get('copiar'))
  const companyId = activa?.companyId ?? null
  const copiaCargada = useRef(false)
  const [avisoCopia, setAvisoCopia] = useState<{ tono: 'info' | 'danger'; texto: string } | null>(null)
  useEffect(() => {
    if (!copia || !companyId || copiaCargada.current) return
    copiaCargada.current = true
    void leerParaCopiar(companyId, copia.tipo, copia.id)
      .then((d) => {
        const conPrecio = !cruzaDeLado(d.origen, 'pedido_compra')
        setLineas(lineasDesdeCopia(d.lineas, conPrecio))
        setDatos((x) => ({ ...x, moneda: x.moneda || (d.moneda ?? ''), notas: x.notas || (d.notas ?? '') }))
        setAvisoCopia({
          tono: 'info',
          texto: conPrecio
            ? `Copia de ${d.numero ?? 'otro pedido'}: elegí el proveedor y revisá antes de crear.`
            : `Copia de ${d.numero ?? 'una venta'}: elegí el proveedor y escribí los precios de compra (los de venta no se copian; al lado de cada línea ves el último precio pagado).`,
        })
      })
      .catch((e: unknown) => {
        copiaCargada.current = false
        setAvisoCopia({ tono: 'danger', texto: e instanceof Error ? e.message : String(e) })
      })
  }, [copia, companyId])

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
      <div className={docUi.pagina}>
        <PageHeader back={{ to: '/compras/pedidos', label: 'Pedidos de compra' }} title="Nuevo pedido de compra" />
        <Alert tone="neutral">
          <p>Tu rol no puede dar de alta pedidos de compra.</p>
        </Alert>
      </div>
    )
  }

  /*
   * El armado de Ventas (Fase 235): la barra de acciones arriba y pegada —con
   * «Crear pedido» siempre a la vista, no al pie de un formulario largo— y
   * debajo las tarjetas. El número lo asigna el servidor y el pedido nace en
   * borrador; eso lo dice la barra en una línea, no un subtítulo de tres.
   */
  return (
    <div className={docUi.pagina}>
      <ActionBar
        pegajosa
        volver={{ to: '/compras/pedidos', label: 'Pedidos de compra' }}
        titulo="Nuevo pedido de compra"
        label="Crear pedido de compra"
        primary={
          <Button icon={<Icon name="check" size={16} />} loading={crear.isPending} onClick={guardar}>
            {crear.isPending ? 'Creando…' : 'Crear pedido'}
          </Button>
        }
        secondary={
          <>
            {/* Mostrar u ocultar la hoja, como en Ventas (Fase 236). */}
            <Button
              variant="secondary"
              icon={<Icon name={verPrevia ? 'eye-off' : 'eye'} size={16} />}
              onClick={() => setPreviaPedida(!verPrevia)}
              aria-expanded={verPrevia}
              aria-label={verPrevia ? 'Ocultar vista previa' : 'Vista previa'}
              title={verPrevia ? 'Ocultar vista previa' : 'Vista previa'}
            />
            <Button variant="ghost" disabled={crear.isPending} onClick={() => void navegar('/compras/pedidos')}>
              Cancelar
            </Button>
          </>
        }
        note={<p>Nace en borrador; el número lo asigna el servidor al guardar.</p>}
      />

      <div className={verPrevia && pantallaAncha ? editor.conPrevia : undefined}>
      <section className={`${styles.bloque} ${editor.columnaEditor}`}>
        {avisoCopia ? (
          <Alert tone={avisoCopia.tono} role={avisoCopia.tono === 'danger' ? 'alert' : 'status'}>
            <p>{avisoCopia.texto}</p>
          </Alert>
        ) : null}
        {crear.error ? (
          <Alert tone="danger" role="alert">
            <p>{crear.error.message}</p>
          </Alert>
        ) : null}
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
      </section>

      {verPrevia ? (
        <div className={editor.columnaPrevia}>
          <VistaPreviaPedidoCompra datos={datos} proveedor={proveedor} lineas={lineas} />
        </div>
      ) : null}
      </div>
    </div>
  )
}
