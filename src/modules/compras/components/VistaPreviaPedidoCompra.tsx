import { useState } from 'react'
import { PanelHoja } from '@/modules/ventas/components/PanelHoja'
import type { OpcionesImpresion as OpcionesVentas } from '@/modules/ventas/lib/impresion'
import { VistaImpresion, type EdicionEnHoja } from '@/modules/ventas/components/VistaImpresion'
import hoja from '@/modules/ventas/components/VistaImpresion.module.css'
import { imprimiblePedidoBorrador } from '../lib/impresion'
import {
  lineaCapitulo,
  lineaDeProducto,
  netoDeLinea,
  renumerar,
  totalesPrevios,
} from '../lib/lineas'
import { etiquetaDeTratamiento } from '../lib/tratamientos'
import type { DatosPedidoCompra } from '../lib/validacion'
import type { ProveedorBuscado } from '../services/catalogo'
import type { LineaPedidoCompra } from '../types'
import { aHojaDeVentas, opcionesDeHoja } from '../lib/hojaVentas'
import { useFormasDePago } from '../hooks/useProveedores'
import { BuscadorProveedor } from './BuscadorProveedor'
import { SelectorProducto } from './SelectorProducto'

/**
 * La vista previa del pedido de compra al costado del formulario (Fase 236).
 *
 * «Quiero que también tenga vista previa del documento como las ventas.» Es
 * el MISMO marco que usa Ventas (`PanelHoja`: escala la hoja al ancho de la
 * columna y la deja pegada mientras se scrollea) con la hoja de Compras
 * adentro, armada con lo que hay en el formulario en cada tecla.
 *
 * Fase 241: «quiero que también se puedan completar los datos de la compra
 * desde la vista previa». Con `edicion`, la hoja edita EL MISMO estado que el
 * formulario —no hay dos documentos que sincronizar—, igual que en Ventas:
 * proveedor, fecha, entrega estimada y condición de pago arriba; referencia,
 * nombre, descripción, cantidad, precio y descuento en cada línea; agregar
 * productos y notas, y quitar líneas.
 */
const OPCIONES_HOJA: OpcionesVentas = {
  formato: 'valorado',
  preciosConImpuestos: false,
  papel: 'A4',
  conFotos: false,
}

export interface EdicionCompraEnHoja {
  /** Proveedor, moneda, tipo de cambio y fecha (sólo en borrador). */
  identidad: boolean
  /** Entrega estimada y condición de pago. */
  logistica: boolean
  lineas: boolean
  onCabecera: (cambios: Partial<DatosPedidoCompra>) => void
  onProveedor: (p: ProveedorBuscado | null) => void
  onLineas: (lineas: LineaPedidoCompra[]) => void
}

export function VistaPreviaPedidoCompra({
  datos,
  proveedor,
  lineas,
  numero = null,
  edicion = null,
}: {
  /** El número del pedido ya guardado; en el alta no hay. */
  numero?: string | null
  datos: DatosPedidoCompra
  proveedor: ProveedorBuscado | null
  lineas: readonly LineaPedidoCompra[]
  /** Si viene, la hoja se puede completar (Fase 241). */
  edicion?: EdicionCompraEnHoja | null
}) {
  const t = totalesPrevios(lineas)
  const [eligiendo, setEligiendo] = useState(false)
  const formas = useFormasDePago()
  const enHoja = edicionEnHoja(
    edicion,
    lineas,
    proveedor,
    datos,
    () => setEligiendo(true),
    formas.data,
  )

  return (
    <>
      <PanelHoja
        etiqueta={enHoja ? 'Pedido' : 'Vista previa del pedido'}
        aclaracion={
          numero ? null : 'El número y el total definitivo los pone el servidor al crear el pedido.'
        }
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
          const base = aHojaDeVentas(doc)
          // La entrega estimada editable reemplaza a la de sólo lectura.
          const deHoja =
            enHoja?.camposContraparte && base.datosExtra
              ? {
                  ...base,
                  datosExtra: base.datosExtra.filter((d) => d.etiqueta !== 'Entrega estimada'),
                }
              : base
          return (
            <VistaImpresion
              doc={deHoja}
              empresa={empresa}
              opciones={opcionesDeHoja(doc, opciones.papel === 'carta' ? 'carta' : 'A4')}
              edicion={enHoja}
            />
          )
        }}
      </PanelHoja>

      {eligiendo && edicion ? (
        <SelectorProducto
          onElegir={(p) => {
            edicion.onLineas([...lineas, lineaDeProducto(p, lineas.length + 1)])
            setEligiendo(false)
          }}
          onCerrar={() => setEligiendo(false)}
        />
      ) : null}
    </>
  )
}

/** Lo que la hoja de Ventas necesita para editar, armado con el estado de Compras. */
function edicionEnHoja(
  edicion: EdicionCompraEnHoja | null,
  lineas: readonly LineaPedidoCompra[],
  proveedor: ProveedorBuscado | null,
  datos: DatosPedidoCompra,
  abrirCatalogo: () => void,
  formas: readonly { nombre: string; activa: boolean }[] | undefined,
): EdicionEnHoja | null {
  if (!edicion) return null
  const cambiarLinea = (id: string, cambios: Partial<LineaPedidoCompra>) =>
    edicion.onLineas(lineas.map((l) => (l.id === id ? { ...l, ...cambios } : l)))
  const texto = (v: string) => (v.trim() === '' ? null : v)
  // Sin permiso para las líneas, los callbacks no hacen nada: la hoja de
  // Ventas los pide obligatorios.
  const nada = () => {}
  const l = edicion.lineas

  return {
    ...(edicion.identidad ? { onFecha: (v: string) => edicion.onCabecera({ fecha: v }) } : {}),
    ...(edicion.logistica
      ? {
          onFormaPago: (v: string) => edicion.onCabecera({ formaPago: v }),
          formasDePago: (formas ?? []).filter((f) => f.activa).map((f) => f.nombre),
          // En el bloque del proveedor: es cuándo entrega ÉL (como «Entregar
          // en» va en el del cliente en una venta).
          camposContraparte: (
            <>
              <dt>Entrega estimada:</dt>
              <dd>
                <input
                  type="date"
                  className={hoja.fechaEditable}
                  aria-label="Entrega estimada"
                  value={datos.fechaEstimada}
                  onChange={(e) => edicion.onCabecera({ fechaEstimada: e.target.value })}
                />
              </dd>
            </>
          ),
        }
      : {}),
    ...(edicion.identidad
      ? {
          selectorCliente: (
            <BuscadorProveedor
              apariencia="hoja"
              elegido={proveedor}
              onElegir={edicion.onProveedor}
              onLimpiar={() => edicion.onProveedor(null)}
            />
          ),
        }
      : {}),
    onCantidad: l ? (id, v) => cambiarLinea(id, { cantidad: v }) : nada,
    onPrecio: l ? (id, v) => cambiarLinea(id, { precioUnitario: v }) : nada,
    onDescuento: l ? (id, v) => cambiarLinea(id, { descuentoPct: v }) : nada,
    onEliminar: l ? (id) => edicion.onLineas(renumerar(lineas.filter((x) => x.id !== id))) : nada,
    onAgregar: l ? abrirCatalogo : nada,
    ...(l
      ? {
          onNombre: (id: string, v: string) => cambiarLinea(id, { nombre: texto(v) }),
          onDescripcion: (id: string, v: string) => cambiarLinea(id, { descripcion: texto(v) }),
          onReferencia: (id: string, v: string) => cambiarLinea(id, { sku: texto(v) }),
          onTextoCapitulo: (id: string, v: string) => cambiarLinea(id, { nombre: v }),
          onNuevoCapitulo: () => edicion.onLineas([...lineas, lineaCapitulo(lineas.length + 1)]),
        }
      : {}),
  }
}
