import { Link } from 'react-router-dom'
import { MetaList, Missing, type MetaItem } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import styles from './InformacionDocumento.module.css'
import { formatearDomicilio, formatearFecha } from '../lib/formato'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { presentarOrigen } from '../lib/origen'
import { ChipEstado } from './ChipEstado'
import { RUTA_DE, type DocumentoDetalle } from '../types'

export interface InformacionDocumentoProps {
  doc: DocumentoDetalle
  /**
   * Qué mitad de los datos (Fase 84).
   *
   * El sistema anterior parte la ficha en dos: la tarjeta de arriba, con lo
   * que identifica al documento y se mira siempre, y una pestaña «Más
   * información» con el resto —moneda, tipo de cambio, domicilios,
   * observaciones—.
   *
   * Acá se hace igual, y por el motivo con el que lo pidieron: la tarjeta de
   * arriba muestra los MISMOS campos que el editor de arriba, así que apretar
   * «Editar» ya no agrega filas. Lo que sobraba no se escondió: se mudó a su
   * pestaña, donde también se edita.
   */
  parte?: 'principal' | 'mas' | undefined
  /**
   * Abrir la ficha rápida del cliente sin salir del documento.
   *
   * Opcional a propósito: el componente lo usan los tres documentos y sólo
   * los que tienen a dónde llevar lo pasan.
   */
  onVerCliente?: () => void
}

/*
 * Acá vivía `contacto()`, que armaba el contacto del documento con su cargo,
 * su correo, su teléfono y los acompañantes. Se fue con la fila en la
 * Fase 84: el contacto no está en la ficha del sistema anterior, y acá se
 * sigue viendo tocando el nombre del cliente —que abre la ficha rápida con
 * toda su agenda— y en la hoja impresa, que lo lleva porque es para el
 * cliente.
 */

/**
 * La referencia: la serie y el número, en dos cajas como el sistema anterior.
 *
 * El número ya arranca con la serie —`COT-BTS` + `00008`—, así que se corta
 * en vez de repetirla. Un documento viejo cuyo número no empiece con su serie
 * se muestra entero: partirlo a la fuerza sería inventar.
 */
function referencia(doc: DocumentoDetalle) {
  const serie = doc.serie ?? ''
  if (serie !== '' && doc.numero.startsWith(serie)) {
    return (
      <span className={styles.referencia}>
        <span>{serie}</span>
        <span>{doc.numero.slice(serie.length)}</span>
      </span>
    )
  }
  return doc.numero
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
export function InformacionDocumento({ doc, onVerCliente, parte = 'principal' }: InformacionDocumentoProps) {
  const esEntrega = doc.tipo === 'entrega'
  const esPedido = doc.tipo === 'pedido'
  const comercial = !esEntrega
  /* Sólo lo que NO es «emitido en el ERP», que es el caso de todos los días. */
  const origenPropio = presentarOrigen({
    externalSource: doc.externalSource,
    esHistorico: doc.esHistorico,
    serie: doc.serie,
  }).filter((o) => o.texto !== 'Emitido en el ERP')

  /**
   * Los datos, en el recorte y el orden del sistema anterior (Fase 84).
   *
   * «Sólo poné los datos que aparecen en STEL, así ganamos espacio, y en el
   * mismo orden.» La ficha tenía catorce filas y la de allá tiene ocho. Las
   * seis que sobraban estaban todas dichas en otro lado de la MISMA pantalla:
   *
   *  · «Origen» es el chip «Emitido en el ERP» que está arriba al lado del
   *    número, y encima se llevaba dos renglones de ancho completo.
   *  · «Moneda» está en cada precio de las líneas y en los totales.
   *  · «Creado» y «Última modificación» están en Trazabilidad, ahí con quién
   *    y qué cambió, que es más de lo que decía la fila.
   *  · «Tipo de cambio» sólo aparecía con el dato cargado, que es casi nunca.
   *  · «Contacto» se abre tocando el cliente, que es la ficha rápida.
   *
   * La única que NO estaba repetida es «Observaciones», que queda sólo en el
   * editor. Son notas de trabajo —las que hay dicen «generada al importar la
   * orden de compra»—, y por eso desde la Fase 84 tampoco se imprimen.
   *
   * Y se SUMAN dos que allá están y acá faltaban: la fecha del documento y su
   * título. Que el título no se viera era un hueco: es el renglón que sale
   * impreso debajo del tipo de documento y es lo único de la hoja que se
   * escribe para el cliente.
   *
   * Lo que el sistema anterior guarda en «Más información» y acá no tiene
   * dónde ir —el domicilio de un remito, el transporte, de qué documento
   * salió éste— se queda: esconderlo sería perderlo.
   *
   * Cada dato lleva su sección para agruparlos igual que el editor cuando la
   * columna es angosta. Con la columna ancha las secciones se disuelven y el
   * orden que se ve es el de esta lista.
   */
  const items: (Dato | null | false)[] = [
    /*
     * La referencia: la serie y el número, como las dos cajas de allá.
     *
     * El número YA empieza con la serie —«COT-BTS» + «00008»—, así que se
     * parte en vez de repetirla. Si algún documento viejo no cumple eso, se
     * muestra entero y listo: inventarle un corte sería peor.
     *
     * Desde la Fase 84 ésta es la única vez que el número se ve en la
     * pantalla: el encabezado que lo repetía arriba se fue, y con él los
     * 80 px que ocupaba.
     */
    { parte: 'principal', label: 'Referencia', value: referencia(doc) },
    { parte: 'principal', label: 'Fecha', value: formatearFecha(doc.fecha) },
    /*
     * El estado, que antes era el chip del encabezado (Fase 84). El pedido
     * tiene dos —el comercial y el de cumplimiento— y van los dos, que es lo
     * que mostraba la cabecera.
     */
    {
      parte: 'principal',
      label: 'Estado',
      value: (
        <span className={styles.estados}>
          <ChipEstado estado={presentarEstado(doc.tipo, doc.estado)} />
          {doc.estadoSecundario ? <ChipEstado estado={presentarCumplimiento(doc.estadoSecundario)} /> : null}
        </span>
      ),
    },
    { parte: 'principal', label: 'Título', value: doc.titulo ?? <Missing>Sin título</Missing> },
    /*
     * De dónde vino, SÓLO cuando no es lo de siempre (Fase 84).
     *
     * «Lo del emitido en el ERP no hace falta que esté»: es el caso normal y
     * no dice nada. «Migrado desde STEL» o «MercadoLibre» sí: explican por
     * qué el número no sigue la numeración de acá y qué se puede hacer con el
     * documento.
     */
    origenPropio.length > 0
      ? {
          parte: 'mas',
          label: 'Procedencia',
          value: origenPropio.map((o) => o.texto).join(' · '),
        }
      : null,
    // «Válida hasta» se fue en la Fase 28 · E11: no aplica, y de las 307
    // cotizaciones de la base ninguna la tenía cargada.
    // De dónde salió el documento. La fila se muestra AUNQUE no tenga origen:
    // que un remito no venga de un pedido, o que un pedido sea manual, es un
    // dato del negocio —y en el histórico hay 37 remitos así—, no un olvido.
    // Allá esto vive en el título de la tarjeta («generado a partir del pedido
    // de venta PDV01347»); acá no hay título donde ponerlo, así que es una
    // fila más de los datos generales.
    doc.origen
      ? {
          label: ETIQUETA_ORIGEN[doc.origen.tipo] ?? 'Documento de origen',
          parte: 'mas',
          value: (
            <Link to={`${RUTA_DE[doc.origen.tipo]}/${doc.origen.id}`} className={docUi.enlace}>
              {doc.origen.numero}
            </Link>
          ),
        }
      : esEntrega
        ? { parte: 'mas', label: 'Pedido de origen', value: <Missing>Sin pedido relacionado</Missing> }
        : doc.tipo === 'pedido'
          ? { parte: 'mas', label: 'Cotización de origen', value: <Missing>Sin cotización: pedido manual</Missing> }
          : null,
    {
      label: 'Cliente',
      parte: 'principal',
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
    comercial && { parte: 'principal', label: 'Forma de pago', value: doc.formaPago ?? <Missing /> },
    doc.creadoPor ? { parte: 'principal', label: 'Creado por', value: doc.creadoPor } : null,
    comercial && {
      parte: 'principal',
      // Fase 40: los agentes que acompañan, nombrados. Antes el segundo no
      // figuraba en ningún lado.
      label: doc.vendedoresExtra.length > 0 ? 'Agentes' : 'Agente',
      value:
        doc.vendedor === null && doc.vendedoresExtra.length === 0 ? (
          <Missing />
        ) : (
          [doc.vendedor, ...doc.vendedoresExtra.map((v) => v.nombre)]
            .filter((x): x is string => !!x)
            .join(', ')
        ),
    },
    comercial && {
      label: 'Tarifa',
      parte: 'principal',
      value: doc.listaPrecioNombre ?? <Missing>Sin tarifa registrada</Missing>,
    },
    // Fase 15 · E6: el domicilio congelado al emitir el remito. Si no quedó
    // registrado se dice; NO se muestra el domicilio de hoy del cliente, que
    // es otra información.
    esEntrega && {
      label: 'Dirección de entrega',
      parte: 'mas',
      value: formatearDomicilio(doc.domicilioEntrega) ?? <Missing>Sin domicilio registrado</Missing>,
      wide: true,
    },
    // Fase 17 · E3: en el pedido es el domicilio ELEGIDO, que todavía se puede
    // cambiar. Sin elegir no se muestra el del cliente de hoy: se dice que el
    // remito va a usar el principal en el momento de emitirlo, que es lo que
    // efectivamente va a pasar.
    esPedido && {
      label: 'Entregar en',
      parte: 'mas',
      value: formatearDomicilio(doc.domicilioElegido) ?? (
        <Missing>Sin elegir: el remito usará el domicilio principal del cliente</Missing>
      ),
      wide: true,
    },
    esEntrega && doc.transporte ? { parte: 'mas', label: 'Transporte', value: doc.transporte } : null,
    esEntrega && doc.seguimiento ? { parte: 'mas', label: 'Seguimiento', value: doc.seguimiento } : null,
  ]

  /*
   * Una sola lista, sin las cuatro secciones numeradas (Fase 84).
   *
   * Las secciones existían para que la ficha se viera igual que el editor,
   * que las tenía (Fase 27 · E5). El editor ahora está partido en dos
   * —la tarjeta y «Más información»— como el sistema anterior, así que son
   * dos grupos y no cuatro, y cada uno tiene su propio título arriba: el de
   * la sección de la pantalla. Un segundo título adentro era decirlo dos
   * veces.
   */
  return (
    <div className={styles.ficha}>
      <MetaList items={items.filter((i) => !i || i.parte === parte)} />
    </div>
  )
}

/** Un dato de la ficha, con la mitad a la que pertenece. */
type Dato = MetaItem & { parte: 'principal' | 'mas' }
