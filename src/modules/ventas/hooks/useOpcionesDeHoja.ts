import { useState } from 'react'
import { OPCIONES_INICIALES, type FormatoImpresion, type OpcionesImpresion } from '../lib/impresion'

/**
 * El formato de la hoja mientras se arma el documento.
 *
 * Vive acá arriba y no adentro de `PanelHoja` (Fase 28 · E12) para que la
 * pantalla decida DÓNDE ponerlo: en el alta va adentro de la barra de
 * acciones, que es donde está todo lo que se puede hacer, y así el renglón de
 * controles no le come 40 px a la hoja.
 *
 * ── LA HOJA DEL ALTA MIDE COMO EL PAPEL (Fase 80) ───────────────────────────
 *
 * Hasta la Fase 80 las fotos estaban FORZADAS en `true` acá, mientras que la
 * impresión arrancaba sin ellas. Como la foto reserva un cuadro en cada
 * renglón, la misma cotización se veía con renglones altos mientras se armaba
 * y salía con renglones bajos en el papel.
 *
 * Dicho por quien lo usa: «cuando estoy armando la cotización se nota que hay
 * mucho más espacio que cuando imprimo; me gusta el tamaño de cuando imprimo,
 * ese mismo tiene que estar en el preview».
 *
 * Lo que arregló eso no fue el interruptor que se agregó entonces, sino que
 * las dos superficies arranquen del MISMO valor. Así que desde la Fase 83 no
 * hay interruptor: el valor inicial de la impresión —hoy con foto, que es como
 * se pidió que salga el renglón— se usa tal cual. Un control menos en la barra
 * y una forma menos de que las dos hojas se separen.
 */
export function useOpcionesDeHoja(): {
  opciones: OpcionesImpresion
  controles: {
    formato: FormatoImpresion
    onFormato: (f: FormatoImpresion) => void
  }
} {
  const [formato, setFormato] = useState<FormatoImpresion>(OPCIONES_INICIALES.formato)

  return {
    opciones: {
      formato,
      /* Sin control propio: los que había no se usaban (Fase 81 y 83). Los
         valores son los mismos con los que arranca la impresión, así que las
         dos superficies siguen mostrando lo mismo. */
      preciosConImpuestos: OPCIONES_INICIALES.preciosConImpuestos,
      papel: OPCIONES_INICIALES.papel,
      conFotos: OPCIONES_INICIALES.conFotos,
    },
    controles: { formato, onFormato: setFormato },
  }
}
