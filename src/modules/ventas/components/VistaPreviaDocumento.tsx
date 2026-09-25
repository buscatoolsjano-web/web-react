import { useDatosDeProductos } from '../hooks/useDatosDeProductos'
import { construirImprimible } from '../lib/impresion'
import { PanelHoja } from './PanelHoja'
import { VistaImpresion, type EdicionEnHoja } from './VistaImpresion'
import type { DocumentoDetalle, LineaDocumento } from '../types'

export interface VistaPreviaDocumentoProps {
  /** El documento guardado. Sus totales son los del servidor. */
  doc: DocumentoDetalle
  /**
   * Las líneas que hay que dibujar.
   *
   * Se pasan aparte porque mientras se edita son las del borrador en memoria y
   * no las que devolvió el servidor. Son las MISMAS que ve el editor de la
   * izquierda: hay un solo juego de líneas, no dos que haya que sincronizar.
   */
  lineas: readonly LineaDocumento[]
  ajustarAlAncho?: boolean
  /** Si viene, la hoja se puede editar. Sólo cuando el documento es editable. */
  edicion?: EdicionEnHoja | null
  /** Qué aclarar. Mientras se edita, que los totales son previsualización. */
  aclaracion?: string | null
}

/**
 * La hoja de un documento ya guardado, dentro de su pantalla (Fase 26 · E2).
 *
 * El pedido: **que una cotización, un pedido o un remito viejos se vean igual
 * que una cotización nueva.** Antes no: el alta tenía la hoja al lado del
 * editor y el detalle no tenía hoja, así que para ver cómo salía el documento
 * había que abrir el modal de impresión — y en el modal no se puede editar.
 *
 * Es el mismo `PanelHoja` y el mismo `VistaImpresion` que el alta. La única
 * diferencia real es de dónde salen los datos: acá del documento guardado
 * (`construirImprimible`), allá del borrador. Por eso los totales que muestra
 * son los del servidor —no una cuenta propia— salvo mientras se edita, que es
 * cuando quien lo usa manda la aclaración correspondiente.
 */
export function VistaPreviaDocumento({
  doc,
  lineas,
  ajustarAlAncho = false,
  edicion = null,
  aclaracion = null,
}: VistaPreviaDocumentoProps) {
  // La hoja muestra lo MISMO que se imprime: foto y descripción armada con
  // los datos del producto (Fase 28 · E9).
  const { datos, definiciones } = useDatosDeProductos(lineas)

  return (
    <PanelHoja
      etiqueta="Documento"
      aclaracion={aclaracion}
      ajustarAlAncho={ajustarAlAncho}
    >
      {(opciones, empresa) => (
        <VistaImpresion
          // Las líneas visibles reemplazan a las del documento: mientras se
          // edita, la hoja tiene que mostrar lo que se está editando.
          doc={construirImprimible({ ...doc, lineas: [...lineas] }, opciones, datos, definiciones)}
          empresa={empresa}
          opciones={opciones}
          edicion={edicion}
        />
      )}
    </PanelHoja>
  )
}
