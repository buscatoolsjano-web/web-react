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
 * Falta la tarifa: hoy el documento no guarda con qué lista de precios se
 * cotizó (`price_list_id` existe en el cliente, no en el documento). Mostrar
 * la lista actual del cliente sería atribuirle al documento una tarifa que
 * quizá no es la que se usó, así que no se muestra nada. Es el gap de schema
 * que E2 tiene que cerrar.
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
