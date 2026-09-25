import { useState } from 'react'
import { OPCIONES_INICIALES, type FormatoImpresion, type OpcionesImpresion } from '../lib/impresion'

/**
 * El formato de la hoja y si los precios llevan impuesto adentro.
 *
 * Vive acá arriba y no adentro de `PanelHoja` (Fase 28 · E12) para que la
 * pantalla decida DÓNDE ponerlo: en el alta va adentro de la barra de
 * acciones, que es donde está todo lo que se puede hacer, y así el renglón de
 * controles no le come 40 px a la hoja.
 */
export function useOpcionesDeHoja(): {
  opciones: OpcionesImpresion
  controles: { formato: FormatoImpresion; conImpuestos: boolean; onFormato: (f: FormatoImpresion) => void; onImpuestos: (v: boolean) => void }
} {
  const [formato, setFormato] = useState<FormatoImpresion>(OPCIONES_INICIALES.formato)
  const [conImpuestos, setConImpuestos] = useState(OPCIONES_INICIALES.preciosConImpuestos)

  return {
    opciones: {
      formato,
      preciosConImpuestos: conImpuestos,
      papel: OPCIONES_INICIALES.papel,
      // Fase 28 · E9: la hoja lleva foto siempre; el hueco existe en todas las
      // filas aunque el producto no tenga imagen.
      conFotos: true,
    },
    controles: { formato, conImpuestos, onFormato: setFormato, onImpuestos: setConImpuestos },
  }
}

