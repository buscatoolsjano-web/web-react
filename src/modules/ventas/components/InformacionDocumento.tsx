import { Link } from 'react-router-dom'
import { MetaList, Missing, type MetaItem } from '@/components/document/DocSection'
import cabecera from './CabeceraCotizacion.module.css'
import docUi from '@/components/document/Document.module.css'
import styles from './InformacionDocumento.module.css'
import { formatearDomicilio } from '../lib/formato'
import { presentarOrigen } from '../lib/origen'
import { formatearMomento } from '../lib/trazabilidad'
import { RUTA_DE, type DocumentoDetalle } from '../types'

export interface InformacionDocumentoProps {
  doc: DocumentoDetalle
  /**
   * En las MISMAS cuatro secciones numeradas que el editor (Fase 27 · E5).
   *
   * Es lo que hace que un documento guardado se vea igual que uno que se
   * está cargando: los mismos títulos, en el mismo orden, en el mismo lugar
   * de la pantalla. Sin esto, mirar una cotización vieja y cargar una nueva
   * eran dos pantallas distintas para el mismo documento.
   */
  agrupado?: boolean | undefined
  /**
   * Abrir la ficha rápida del cliente sin salir del documento.
   *
   * Opcional a propósito: el componente lo usan los tres documentos y sólo
   * los que tienen a dónde llevar lo pasan.
   */
  onVerCliente?: () => void
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
export function InformacionDocumento({ doc, onVerCliente, agrupado = false }: InformacionDocumentoProps) {
  const esEntrega = doc.tipo === 'entrega'
  const esPedido = doc.tipo === 'pedido'
  const comercial = !esEntrega
  const origen = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  })

  /**
   * Cada dato con su sección, para poder mostrarlos agrupados igual que en
   * el editor. Sin agrupar salen todos en una lista, como hasta ahora.
   */
  const items: (Dato | null | false)[] = [
    {
      label: 'Cliente',
      seccion: 2,
      // Fase 19 · E3: con un modo de abrir la ficha rápida, el nombre deja de
      // ser texto. Sin él sigue siendo texto: el componente lo usan tres
      // documentos y no todos tienen a dónde llevar.
      value:
        onVerCliente && doc.clienteId ? (
          <button type="button" className={styles.cliente} onClick={onVerCliente}>
            {doc.clienteNombre}
          </button>
        ) : (
          doc.clienteNombre
        ),
    },
    { seccion: 2, label: 'Contacto', value: contacto(doc) },
    comercial && { seccion: 4, label: 'Agente', value: doc.vendedor ?? <Missing /> },
    comercial && { seccion: 3, label: 'Forma de pago', value: doc.formaPago ?? <Missing /> },
    { seccion: 4, label: 'Moneda', value: doc.moneda ?? <Missing>Sin moneda</Missing> },
    comercial && {
      label: 'Tarifa',
      seccion: 4,
      value: doc.listaPrecioNombre ?? <Missing>Sin tarifa registrada</Missing>,
    },
    doc.tipoCambio !== null && { seccion: 4, label: 'Tipo de cambio', value: doc.tipoCambio },
    { seccion: 1, label: 'Serie', value: doc.serie ?? '—' },
    // «Válida hasta» se fue en la Fase 28 · E11: no aplica, y de las 307
    // cotizaciones de la base ninguna la tenía cargada.
    // Fase 15 · E6: el domicilio congelado al emitir el remito. Si no quedó
    // registrado se dice; NO se muestra el domicilio de hoy del cliente, que
    // es otra información.
    esEntrega && {
      label: 'Dirección de entrega',
      seccion: 2,
      value: formatearDomicilio(doc.domicilioEntrega) ?? <Missing>Sin domicilio registrado</Missing>,
      wide: true,
    },
    // Fase 17 · E3: en el pedido es el domicilio ELEGIDO, que todavía se puede
    // cambiar. Sin elegir no se muestra el del cliente de hoy: se dice que el
    // remito va a usar el principal en el momento de emitirlo, que es lo que
    // efectivamente va a pasar.
    esPedido && {
      label: 'Entregar en',
      seccion: 2,
      value: formatearDomicilio(doc.domicilioElegido) ?? (
        <Missing>Sin elegir: el remito usará el domicilio principal del cliente</Missing>
      ),
      wide: true,
    },
    esEntrega && doc.transporte ? { seccion: 4, label: 'Transporte', value: doc.transporte } : null,
    esEntrega && doc.seguimiento ? { seccion: 4, label: 'Seguimiento', value: doc.seguimiento } : null,
    // De dónde salió el documento. La fila se muestra AUNQUE no tenga origen:
    // que un remito no venga de un pedido, o que un pedido sea manual, es un
    // dato del negocio —y en el histórico hay 37 remitos así—, no un olvido.
    doc.origen
      ? {
          label: ETIQUETA_ORIGEN[doc.origen.tipo] ?? 'Documento de origen',
          seccion: 1,
          value: (
            <Link to={`${RUTA_DE[doc.origen.tipo]}/${doc.origen.id}`} className={docUi.enlace}>
              {doc.origen.numero}
            </Link>
          ),
        }
      : esEntrega
        ? { seccion: 1, label: 'Pedido de origen', value: <Missing>Sin pedido relacionado</Missing> }
        : doc.tipo === 'pedido'
          ? { seccion: 1, label: 'Cotización de origen', value: <Missing>Sin cotización: pedido manual</Missing> }
          : null,
    {
      label: 'Origen',
      seccion: 1,
      value: (
        <>
          {origen.map((o) => o.texto).join(' · ')}
          {origen[0] ? `\n${origen[0].detalle}` : ''}
        </>
      ),
      wide: true,
    },
    doc.notas ? { seccion: 4, label: 'Observaciones', value: doc.notas, wide: true } : null,
    doc.creadoPor ? { seccion: 4, label: 'Creado por', value: doc.creadoPor } : null,
    { seccion: 4, label: 'Creado', value: formatearMomento(doc.creadoEn) },
    { seccion: 4, label: 'Última modificación', value: formatearMomento(doc.actualizadoEn) },
  ]

  if (!agrupado) return <MetaList items={items} />

  const de = (n: NumeroSeccion) => items.filter((i): i is Dato => !!i && i.seccion === n)
  return (
    <div className={cabecera.bloques}>
      {SECCIONES.map(([n, titulo]) => {
        const suyos = de(n)
        if (suyos.length === 0) return null
        return (
          <section key={n} className={cabecera.grupo}>
            <p className={cabecera.leyenda}>{`${n}. ${titulo}`}</p>
            <MetaList items={suyos} />
          </section>
        )
      })}
    </div>
  )
}

/** Las cuatro secciones, con el mismo número y nombre que en el editor. */
type NumeroSeccion = 1 | 2 | 3 | 4

const SECCIONES: readonly (readonly [NumeroSeccion, string])[] = [
  [1, 'Datos generales'],
  [2, 'Cliente'],
  [3, 'Condiciones'],
  [4, 'Otros datos'],
]

/** Un dato de la ficha, con la sección a la que pertenece. */
type Dato = MetaItem & { seccion: NumeroSeccion }
