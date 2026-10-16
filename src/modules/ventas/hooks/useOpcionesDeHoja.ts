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
 * Hasta acá las fotos estaban FORZADAS en `true` (Fase 28 · E9: «la hoja lleva
 * foto siempre»), mientras que la impresión arranca sin ellas. Como la foto
 * reserva un cuadro de 20 mm en cada renglón, la misma cotización se veía con
 * renglones de 28 mm mientras se armaba y salía con renglones de 12 en el
 * papel.
 *
 * Dicho por quien lo usa: «cuando estoy armando la cotización se nota que hay
 * mucho más espacio que cuando imprimo; me gusta el tamaño de cuando imprimo,
 * ese mismo tiene que estar en el preview».
 *
 * Así que las fotos pasan a ser un interruptor, con el MISMO valor inicial que
 * la impresión. Las dos superficies arrancan iguales y se mueven juntas, que
 * es lo que hace que la vista previa sea una vista previa.
 *
 * No alcanzaba con achicar el cuadro de la foto: eso las dejaría PARECIDAS, y
 * lo que se pidió es que midan lo mismo.
 */
export function useOpcionesDeHoja(): {
  opciones: OpcionesImpresion
  controles: {
    formato: FormatoImpresion
    conFotos: boolean
    onFormato: (f: FormatoImpresion) => void
    onFotos: (v: boolean) => void
  }
} {
  const [formato, setFormato] = useState<FormatoImpresion>(OPCIONES_INICIALES.formato)
  const [conFotos, setConFotos] = useState(OPCIONES_INICIALES.conFotos)

  return {
    opciones: {
      formato,
      /* Sin control propio desde la Fase 81: el que había no se usaba. El
         valor es el mismo con el que arranca la impresión, así que las dos
         superficies siguen mostrando lo mismo. */
      preciosConImpuestos: OPCIONES_INICIALES.preciosConImpuestos,
      papel: OPCIONES_INICIALES.papel,
      conFotos,
    },
    controles: { formato, conFotos, onFormato: setFormato, onFotos: setConFotos },
  }
}
