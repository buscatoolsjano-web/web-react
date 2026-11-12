import type {
  DocumentoImprimible as HojaVentas,
  OpcionesImpresion as OpcionesVentas,
} from '@/modules/ventas/lib/impresion'
import type { DocumentoImprimible } from './impresion'

/**
 * Un documento de Compras impreso con la MISMA hoja que Ventas (Fase 237).
 *
 * «Las compras es importante que estén con el mismo formato que las ventas,
 * con el logo correctamente.» La hoja propia de Compras ponía el nombre de la
 * empresa en texto donde va el logo, y otro armado. En vez de copiar el
 * formato, se usa la hoja de Ventas —logo, franjas, bloques, columnas— con los
 * rótulos de Compras: «Datos del pedido», «Datos del proveedor», «Proveedor:».
 *
 * La recepción no lleva precios: se imprime en formato «sin valorar».
 */
const BLOQUE: Record<DocumentoImprimible['tipo'], string> = {
  pedido: 'Datos del pedido',
  recepcion: 'Datos de la recepción',
  factura: 'Datos de la factura',
}

/**
 * Los datos que son DEL PROVEEDOR van en su bloque, con un rótulo corto.
 *
 * «Fijate que no queda proporcional los datos de las compras»: todo iba al
 * bloque del documento —nueve renglones— y el del proveedor quedaba con uno.
 * Y «Referencia del proveedor:» no entraba en la columna de rótulos (26 mm) y
 * partía el renglón en dos. En el bloque del proveedor, «Código» ya se
 * entiende de quién es.
 */
const DEL_PROVEEDOR: Record<string, string> = {
  'Referencia del proveedor': 'Código',
  'Entrega estimada': 'Entrega estimada',
  'Remito del proveedor': 'Su remito',
  'Número del proveedor': 'Su factura',
}

/** «IVA 21 %» → 21; «Exento» → 0. La hoja de Ventas muestra la alícuota. */
export function alicuotaDe(etiqueta: string | null): number | null {
  if (etiqueta === null) return null
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(etiqueta)
  return m?.[1] ? Number(m[1].replace(',', '.')) : 0
}

export function opcionesDeHoja(doc: DocumentoImprimible, papel: 'A4' | 'carta'): OpcionesVentas {
  return {
    formato: doc.tipo === 'recepcion' ? 'sin-valorar' : 'valorado',
    preciosConImpuestos: false,
    papel,
    conFotos: false,
  }
}

export function aHojaDeVentas(doc: DocumentoImprimible): HojaVentas {
  const dato = (etiqueta: string) => doc.datos.find((d) => d.etiqueta === etiqueta)?.valor ?? null
  // Lo que la hoja de Ventas ya muestra en su lugar no se repite como extra.
  const yaMostrados = new Set(['Proveedor', 'Moneda', 'Condición de pago', 'CUIT'])
  return {
    // El tipo de Ventas sólo decide etiquetas que acá se reemplazan; la
    // recepción va como remito porque es lo que más se le parece (sin precios).
    tipo: doc.tipo === 'recepcion' ? 'entrega' : 'pedido',
    titulo: doc.titulo,
    subtitulo: null,
    numero: doc.numero,
    fecha: doc.fecha,
    cliente: doc.proveedor,
    clienteCuit: dato('CUIT'),
    contacto: null,
    moneda: doc.moneda,
    formaPago: dato('Condición de pago'),
    vendedor: null,
    domicilioEntrega: null,
    transporte: null,
    seguimiento: null,
    notas: doc.notas,
    lineas: doc.lineas.map((l) => ({
      id: l.id,
      esCapitulo: l.esCapitulo,
      numero: l.numero,
      sku: l.sku,
      nombre: l.nombre,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio: l.precio,
      descuentoPct: l.descuentoPct,
      subtotal: l.neto,
      impuestoPct: alicuotaDe(l.impuesto),
      foto: null,
      partes: [],
    })),
    subtotal: doc.totales?.subtotal ?? null,
    impuesto: doc.totales?.impuesto ?? null,
    total: doc.totales?.total ?? null,
    origen: doc.relacionados.length > 0 ? doc.relacionados.join(' · ') : null,
    esHistorico: false,
    rotulos: {
      bloqueDatos: BLOQUE[doc.tipo],
      bloqueContraparte: 'Datos del proveedor',
      contraparte: 'Proveedor',
      identificador: dato('CUIT') ? 'CUIT' : null,
    },
    datosExtra: doc.datos
      .filter((d) => !yaMostrados.has(d.etiqueta))
      .map((d) => {
        const delProveedor = DEL_PROVEEDOR[d.etiqueta]
        return delProveedor ? { etiqueta: delProveedor, valor: d.valor, lado: 'contraparte' as const } : d
      }),
  }
}
