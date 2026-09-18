import { Link } from 'react-router-dom'
import { MetaList, Missing, type MetaItem } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { formatearDomicilio, formatearFecha } from '../lib/formato'
import { presentarOrigen } from '../lib/origen'
import { formatearMomento } from '../lib/trazabilidad'
import { RUTA_DE, type DocumentoDetalle } from '../types'

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

/** Cómo se llama el documento del que salió éste. */
const ETIQUETA_ORIGEN: Record<string, string> = {
  cotizacion: 'Cotización de origen',
  pedido: 'Pedido de origen',
  entrega: 'Remito de origen',
}

/**
 * Todo lo que no es la identidad del documento ni sus líneas.
 *
 * Es **el mismo componente para los tres documentos** (Fase 15 · E6): hasta E5
 * la cotización usaba éste y el pedido y el remito tenían cada uno su lista
 * escrita a mano, con etiquetas que no coincidían («Fecha del pedido» acá,
 * «Fecha» allá) y datos que faltaban en uno y sobraban en otro.
 *
 * Qué entra y qué no:
 *
 * - Un dato que falta y que **debería estar** se muestra como faltante
 *   («Sin registrar»): contacto, vendedor y forma de pago son decisiones de
 *   negocio tomadas, y verlos vacíos es justamente la información.
 * - Un dato que **no corresponde** al tipo no se muestra: el remito no tiene
 *   forma de pago ni vendedor, y una fila vacía sugeriría que se olvidaron de
 *   cargarla.
 * - Un dato **opcional y vacío** tampoco se muestra: el tipo de cambio de un
 *   documento en pesos no es un olvido, y el transporte de un remito que se
 *   entregó en mano tampoco.
 *
 * La tarifa se muestra en la cotización (E2) y en el pedido (E4). En los
 * documentos anteriores queda vacía y se dice así —«Sin tarifa registrada»—,
 * que es distinto de inventarle la lista actual del cliente: esa es la de hoy,
 * no necesariamente con la que se vendió.
 */
export function InformacionDocumento({ doc }: InformacionDocumentoProps) {
  const esCotizacion = doc.tipo === 'cotizacion'
  const esEntrega = doc.tipo === 'entrega'
  const esPedido = doc.tipo === 'pedido'
  const comercial = !esEntrega
  const origen = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  })

  const items: (MetaItem | null | false)[] = [
    { label: 'Cliente', value: doc.clienteNombre },
    { label: 'Contacto', value: contacto(doc) },
    comercial && { label: 'Vendedor', value: doc.vendedor ?? <Missing /> },
    comercial && { label: 'Forma de pago', value: doc.formaPago ?? <Missing /> },
    { label: 'Moneda', value: doc.moneda ?? <Missing>Sin moneda</Missing> },
    comercial && {
      label: 'Tarifa',
      value: doc.listaPrecioNombre ?? <Missing>Sin tarifa registrada</Missing>,
    },
    doc.tipoCambio !== null && { label: 'Tipo de cambio', value: doc.tipoCambio },
    { label: 'Serie', value: doc.serie ?? '—' },
    esCotizacion && {
      label: 'Válida hasta',
      value: doc.validaHasta ? formatearFecha(doc.validaHasta) : <Missing />,
    },
    // Fase 15 · E6: el domicilio congelado al emitir el remito. Si no quedó
    // registrado se dice; NO se muestra el domicilio de hoy del cliente, que
    // es otra información.
    esEntrega && {
      label: 'Dirección de entrega',
      value: formatearDomicilio(doc.domicilioEntrega) ?? <Missing>Sin domicilio registrado</Missing>,
      wide: true,
    },
    // Fase 17 · E3: en el pedido es el domicilio ELEGIDO, que todavía se puede
    // cambiar. Sin elegir no se muestra el del cliente de hoy: se dice que el
    // remito va a usar el principal en el momento de emitirlo, que es lo que
    // efectivamente va a pasar.
    esPedido && {
      label: 'Entregar en',
      value: formatearDomicilio(doc.domicilioElegido) ?? (
        <Missing>Sin elegir: el remito usará el domicilio principal del cliente</Missing>
      ),
      wide: true,
    },
    esEntrega && doc.transporte ? { label: 'Transporte', value: doc.transporte } : null,
    esEntrega && doc.seguimiento ? { label: 'Seguimiento', value: doc.seguimiento } : null,
    // De dónde salió el documento. La fila se muestra AUNQUE no tenga origen:
    // que un remito no venga de un pedido, o que un pedido sea manual, es un
    // dato del negocio —y en el histórico hay 37 remitos así—, no un olvido.
    doc.origen
      ? {
          label: ETIQUETA_ORIGEN[doc.origen.tipo] ?? 'Documento de origen',
          value: (
            <Link to={`${RUTA_DE[doc.origen.tipo]}/${doc.origen.id}`} className={docUi.enlace}>
              {doc.origen.numero}
            </Link>
          ),
        }
      : esEntrega
        ? { label: 'Pedido de origen', value: <Missing>Sin pedido relacionado</Missing> }
        : doc.tipo === 'pedido'
          ? { label: 'Cotización de origen', value: <Missing>Sin cotización: pedido manual</Missing> }
          : null,
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
