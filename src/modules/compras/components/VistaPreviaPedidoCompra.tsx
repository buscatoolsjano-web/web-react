import { PanelHoja } from '@/modules/ventas/components/PanelHoja'
import type { OpcionesImpresion as OpcionesVentas } from '@/modules/ventas/lib/impresion'
import { imprimiblePedidoBorrador } from '../lib/impresion'
import { netoDeLinea, totalesPrevios } from '../lib/lineas'
import { etiquetaDeTratamiento } from '../lib/tratamientos'
import type { DatosPedidoCompra } from '../lib/validacion'
import type { ProveedorBuscado } from '../services/catalogo'
import type { LineaPedidoCompra } from '../types'
import { VistaImpresion } from '@/modules/ventas/components/VistaImpresion'
import { aHojaDeVentas, opcionesDeHoja } from '../lib/hojaVentas'

/**
 * La vista previa del pedido de compra al costado del formulario (Fase 236).
 *
 * «Quiero que también tenga vista previa del documento como las ventas.» Es
 * el MISMO marco que usa Ventas (`PanelHoja`: escala la hoja al ancho de la
 * columna y la deja pegada mientras se scrollea) con la hoja de Compras
 * adentro, armada con lo que hay en el formulario en cada tecla.
 */
const OPCIONES_HOJA: OpcionesVentas = {
  formato: 'valorado',
  preciosConImpuestos: false,
  papel: 'A4',
  conFotos: false,
}

export function VistaPreviaPedidoCompra({
  datos,
  proveedor,
  lineas,
  numero = null,
}: {
  /** El número del pedido ya guardado; en el alta no hay. */
  numero?: string | null
  datos: DatosPedidoCompra
  proveedor: ProveedorBuscado | null
  lineas: readonly LineaPedidoCompra[]
}) {
  const t = totalesPrevios(lineas)
  return (
    <PanelHoja
      etiqueta="Vista previa del pedido"
      aclaracion={numero ? null : 'El número y el total definitivo los pone el servidor al crear el pedido.'}
      ajustarAlAncho
      opciones={OPCIONES_HOJA}
    >
      {(opciones, empresa) => {
        // La hoja de VENTAS, con el logo, y los rótulos de Compras (Fase 237).
        const doc = imprimiblePedidoBorrador(
            {
              numero,
              fecha: datos.fecha,
              proveedor: proveedor?.razonSocial ?? null,
              proveedorReferencia: proveedor?.referencia ?? null,
              moneda: datos.moneda,
              tipoCambio: datos.tipoCambio,
              fechaEstimada: datos.fechaEstimada,
              formaPago: datos.formaPago,
              notas: datos.notas,
            },
            lineas,
            etiquetaDeTratamiento,
            { subtotal: t.subtotal, impuesto: t.impuesto, total: t.total },
            netoDeLinea,
          )
        return <VistaImpresion doc={aHojaDeVentas(doc)} empresa={empresa} opciones={opcionesDeHoja(doc, opciones.papel === 'carta' ? 'carta' : 'A4')} />
      }}
    </PanelHoja>
  )
}
