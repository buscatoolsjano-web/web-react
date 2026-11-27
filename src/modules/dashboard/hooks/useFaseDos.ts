import { useEffect, useState } from 'react'

/** Lo más que espera lo secundario, aunque lo principal siga en vuelo. */
export const ESPERA_MAXIMA_FASE_DOS_MS = 2_000

/**
 * El panel en dos tandas (2026-11-27).
 *
 * Al abrirse pedía unas doce consultas a la vez. La base es una instancia
 * chica que se ahoga con la concurrencia, no con la cantidad: medido en
 * producción, «documentos que requieren atención» y la actividad del mes
 * —0,1–1,5 s cada una solas— tardaron 11,7 s y terminaron en error, y el
 * catálogo que se abría después esperaba detrás de ellas.
 *
 * Primero sale lo que está arriba (el gráfico, los números del mes y los
 * documentos en atención); el resto —lo pendiente por persona, los últimos
 * documentos, los pedidos por entregar, los mails— recién cuando eso terminó,
 * o a los `ESPERA_MAXIMA_FASE_DOS_MS` como mucho: una consulta colgada no deja
 * al resto del panel sin dibujarse.
 *
 * `principalListo` es «ya no hay nada principal pendiente» (con dato o con
 * error, da igual: lo que importa es que dejó de ocupar la base).
 */
export function useFaseDos(principalListo: boolean): boolean {
  const [vencido, setVencido] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setVencido(true), ESPERA_MAXIMA_FASE_DOS_MS)
    return () => window.clearTimeout(id)
  }, [])
  return principalListo || vencido
}
