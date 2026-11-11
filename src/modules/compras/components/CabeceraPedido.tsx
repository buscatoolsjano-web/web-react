import { useId } from 'react'
import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { BuscadorProveedor } from './BuscadorProveedor'
import { useAgregarFormaDePago, useFormasDePago } from '../hooks/useProveedores'
import { SelectorFormaDePago } from '@/features/formasDePago/SelectorFormaDePago'
import { MONEDAS, type DatosPedidoCompra, type ErrorDePedido } from '../lib/validacion'
import type { ProveedorBuscado } from '../services/catalogo'
import cab from '@/modules/ventas/components/CabeceraCotizacion.module.css'
import propio from './CabeceraPedido.module.css'

export interface CabeceraPedidoProps {
  datos: DatosPedidoCompra
  errores: readonly ErrorDePedido[]
  proveedor: ProveedorBuscado | null
  /** Proveedor, moneda, tipo de cambio y fecha: sólo en borrador. */
  editaIdentidad: boolean
  /** ETA, condición de pago y notas: hasta que se cancele. */
  editaLogistica: boolean
  onCambiar: (cambios: Partial<DatosPedidoCompra>) => void
  onProveedor: (p: ProveedorBuscado | null) => void
  /** Las ventas para las que es el pedido (Fase 242): «COT…», «PDV…». */
  ventas?: readonly string[] | undefined
}

/**
 * La cabecera del pedido de compra, con el formato de Ventas (Fase 235).
 *
 * «Mirá el formato de compra, MUY MALO, necesito que repliques el formato de
 * venta.» Antes eran controles propios con rótulos en mayúsculas, un párrafo
 * de ayuda debajo de cada campo y una grilla suelta. Ahora son los MISMOS dos
 * paneles de color que la cotización y el pedido de venta, con los campos de
 * la casa (`Field`, `Input`, `Select`):
 *   · «Pedido» (color del módulo): fecha, llegada estimada, moneda, tipo de
 *     cambio.
 *   · «Proveedor» (azul): a quién, en qué condición de pago, y las notas.
 *
 * Las reglas de edición no cambian, porque son del servidor:
 *   · **Identidad** —proveedor, moneda, tipo de cambio, fecha— sólo en borrador.
 *   · **Logística** —llegada estimada, condición de pago, notas— también
 *     después de confirmar, auditado.
 * Deshabilitar es una cortesía; lo que lo impide de verdad es
 * `app.proteger_estado_pedido_compra()`.
 */
export function CabeceraPedido({
  datos,
  errores,
  proveedor,
  editaIdentidad,
  editaLogistica,
  onCambiar,
  onProveedor,
  ventas = [],
}: CabeceraPedidoProps) {
  const idPedido = useId()
  const idProveedor = useId()
  const formasDePago = useFormasDePago()
  const agregarFormaDePago = useAgregarFormaDePago()

  const errorDe = (campo: ErrorDePedido['campo']) =>
    errores.find((e) => e.campo === campo)?.mensaje ?? undefined

  return (
    <div className={cab.paneles}>
      <div role="group" className={`${cab.panel} ${cab.panelDocumento}`} aria-labelledby={idPedido}>
        <p className={cab.panelTitulo} id={idPedido}>
          Pedido
        </p>
        <div className={cab.campos}>
          {/* Para qué venta es (Fase 242): un dato, no un cartel. */}
          {ventas.length > 0 ? (
            <div className={propio.paraVenta}>
              <span className={propio.etiqueta}>Para venta</span>
              <span className={propio.chips}>
                {ventas.map((v) => (
                  <span key={v} className={propio.chipVenta}>
                    {v}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          <Field label="Fecha" required error={errorDe('fecha')}>
            <Input
              type="date"
              value={datos.fecha}
              disabled={!editaIdentidad}
              onChange={(e) => onCambiar({ fecha: e.target.value })}
            />
          </Field>

          {/* Vacía es un dato: «todavía no se sabe» es mejor que una fecha
              inventada. */}
          <Field label="Llegada estimada" optional error={errorDe('fechaEstimada')}>
            <Input
              type="date"
              value={datos.fechaEstimada}
              disabled={!editaLogistica}
              onChange={(e) => onCambiar({ fechaEstimada: e.target.value })}
            />
          </Field>

          {/* Un pedido tiene una sola moneda: todas sus líneas van en ésta. */}
          <Field label="Moneda" required error={errorDe('moneda')}>
            <Select
              value={datos.moneda}
              disabled={!editaIdentidad}
              onChange={(e) => onCambiar({ moneda: e.target.value })}
            >
              <option value="">Elegí una moneda</option>
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Tipo de cambio"
            optional
            error={errorDe('tipoCambio')}
            help={errorDe('tipoCambio') ? undefined : 'Referencia del día: no convierte nada.'}
          >
            <Input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              value={datos.tipoCambio}
              disabled={!editaIdentidad}
              onChange={(e) => onCambiar({ tipoCambio: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div
        role="group"
        className={`${cab.panel} ${cab.panelProveedor}`}
        aria-labelledby={idProveedor}
      >
        <p className={cab.panelTitulo} id={idProveedor}>
          Proveedor
        </p>
        <div className={cab.campos}>
          <BuscadorProveedor
            className={cab.ancho}
            elegido={proveedor}
            deshabilitado={!editaIdentidad}
            error={errorDe('proveedorId') ?? null}
            onElegir={(p) => onProveedor(p)}
            onLimpiar={() => onProveedor(null)}
          />

          {/*
            Fase 68: lista cerrada que se amplía a propósito («TRANSFERENCIA
            BANCARIA» y «Transferencia bancaria» eran dos condiciones). Se
            copia del proveedor al elegirlo y queda guardada en el pedido.
          */}
          <Field label="Condición de pago" optional className={cab.ancho}>
            <SelectorFormaDePago
              valor={datos.formaPago}
              opciones={formasDePago.data ?? []}
              cargando={formasDePago.isPending || !editaLogistica}
              onCambiar={(v) => onCambiar({ formaPago: v })}
              {...(editaLogistica ? { onAgregar: agregarFormaDePago } : {})}
            />
          </Field>

          <Field label="Notas" optional className={cab.ancho}>
            <Textarea
              rows={2}
              value={datos.notas}
              disabled={!editaLogistica}
              onChange={(e) => onCambiar({ notas: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}
