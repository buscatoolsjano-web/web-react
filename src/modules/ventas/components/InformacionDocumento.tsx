import { MetaList, Missing, type MetaItem } from '@/components/document/DocSection'
import { formatearFecha } from '../lib/formato'
import { presentarOrigen } from '../lib/origen'
import { formatearMomento } from '../lib/trazabilidad'
import type { DocumentoDetalle } from '../types'

export interface InformacionDocumentoProps {
  doc: DocumentoDetalle
}

/** El contacto, con lo que haya cargado de él. */
function contacto(doc: DocumentoDetalle) {
  if (!doc.contactoNombre) return <Missing>Sin contacto asignado</Missing>
  const extra = [doc.contactoRol, doc.contactoEmail, doc.contactoTelefono].filter(Boolean)
  return (
    <>
      {doc.contactoNombre}
      {extra.length > 0 ? `\n${extra.join(' · ')}` : ''}
    </>
  )
}

/**
 * Todo lo que no es la identidad del documento ni sus líneas.
 *
 * Qué entra y qué no:
 *
 * - Un dato que falta y que **debería estar** se muestra como faltante
 *   («Sin registrar»): contacto, vendedor y forma de pago son decisiones de
 *   negocio tomadas, y verlos vacíos es justamente la información.
 * - Un dato que **no corresponde** al tipo no se muestra: el remito no tiene
 *   forma de pago, y una fila vacía sugeriría que se olvidaron de cargarla.
 * - Un dato **opcional y vacío** tampoco se muestra: el tipo de cambio de un
 *   documento en pesos no es un olvido.
 *
 * La tarifa ya se muestra: E2 le dio al documento su propio `price_list_id`.
 * En los documentos anteriores queda vacío y se dice así —«Sin tarifa
 * registrada»—, que es distinto de inventarle la lista actual del cliente:
 * esa es la de hoy, no necesariamente con la que se cotizó.
 */
export function InformacionDocumento({ doc }: InformacionDocumentoProps) {
  const esCotizacion = doc.tipo === 'cotizacion'
  const tienePagos = doc.tipo !== 'entrega'
  const origen = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  })

  const items: (MetaItem | null | false)[] = [
    { label: 'Cliente', value: doc.clienteNombre },
    { label: 'Contacto', value: contacto(doc) },
    { label: 'Vendedor', value: doc.vendedor ?? <Missing /> },
    tienePagos && { label: 'Forma de pago', value: doc.formaPago ?? <Missing /> },
    { label: 'Moneda', value: doc.moneda ?? <Missing>Sin moneda</Missing> },
    esCotizacion && {
      label: 'Tarifa',
      value: doc.listaPrecioNombre ?? <Missing>Sin tarifa registrada</Missing>,
    },
    doc.tipoCambio !== null && { label: 'Tipo de cambio', value: doc.tipoCambio },
    { label: 'Serie', value: doc.serie ?? '—' },
    esCotizacion && { label: 'Válida hasta', value: doc.validaHasta ? formatearFecha(doc.validaHasta) : <Missing /> },
    {
      label: 'Origen',
      value: (
        <>
          {origen.map((o) => o.texto).join(' · ')}
          {origen[0] ? `\n${origen[0].detalle}` : ''}
        </>
      ),
      wide: true,
    },
    doc.notas ? { label: 'Observaciones', value: doc.notas, wide: true } : null,
    doc.creadoPor ? { label: 'Creado por', value: doc.creadoPor } : null,
    { label: 'Creado', value: formatearMomento(doc.creadoEn) },
    { label: 'Última modificación', value: formatearMomento(doc.actualizadoEn) },
  ]

  return <MetaList items={items} />
}
