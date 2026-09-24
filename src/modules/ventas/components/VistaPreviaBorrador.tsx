import { imprimibleDelBorrador } from '../lib/impresion'
import { PanelHoja } from './PanelHoja'
import { VistaImpresion, type EdicionEnHoja } from './VistaImpresion'
import type { LineaDocumento, TipoDocumento } from '../types'

export interface VistaPreviaBorradorProps {
  tipo: TipoDocumento
  fecha: string
  cliente: string
  contacto: string | null
  moneda: string | null
  formaPago: string | null
  notas: string | null
  lineas: readonly LineaDocumento[]
  /** Al lado del editor la hoja A4 no entra a tamaño real: se achica. */
  ajustarAlAncho?: boolean
  /** Si viene, la hoja se puede editar (Fase 22 · A3). */
  edicion?: EdicionEnHoja | null
}

/**
 * El documento como va a salir, mientras se lo está cargando (Fase 19 · E3).
 *
 * **No guarda nada para mostrarse.** Se arma desde el borrador que está en
 * memoria, con el MISMO `VistaImpresion` que usa la impresión del documento ya
 * creado: no hay una plantilla para la pantalla y otra para el papel, que es
 * como el legacy terminaba mostrando una cosa e imprimiendo otra.
 *
 * Los controles, la escala y los datos de la empresa los pone `PanelHoja`, que
 * es el mismo panel que usa la hoja del documento guardado
 * (`VistaPreviaDocumento`). Acá sólo queda de qué datos sale la hoja.
 *
 * Lo que no puede mostrar, lo dice: el número lo asigna el servidor al crear,
 * y el total definitivo también —con el descuento global y la percepción—.
 */
export function VistaPreviaBorrador({
  tipo,
  fecha,
  cliente,
  contacto,
  moneda,
  formaPago,
  notas,
  lineas,
  ajustarAlAncho = false,
  edicion = null,
}: VistaPreviaBorradorProps) {
  return (
    <PanelHoja
      etiqueta={edicion ? 'Documento' : 'Vista previa del documento'}
      aclaracion="El número y el total definitivo los pone el servidor al crear el documento."
      ajustarAlAncho={ajustarAlAncho}
    >
      {(opciones, empresa) => (
        <VistaImpresion
          doc={imprimibleDelBorrador(
            tipo,
            { fecha, cliente, contacto, moneda, formaPago, notas, lineas },
            opciones,
          )}
          empresa={empresa}
          opciones={opciones}
          edicion={edicion}
        />
      )}
    </PanelHoja>
  )
}
