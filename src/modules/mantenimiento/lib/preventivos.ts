/**
 * Qué equipos tienen el preventivo vencido o por vencer (2026-11). PURO.
 *
 * Pedido: un aviso en el panel de inicio. La fecha es la que se carga al
 * cerrar una orden («Próximo preventivo»): ninguna se inventa. Los equipos
 * importados del sitio viejo no traen fecha y no avisan —decisión explícita:
 * «sólo fechas cargadas»—; se van sumando a medida que se cierran órdenes.
 *
 * Manda la ÚLTIMA orden de cada equipo:
 *   · abierta ........ el equipo ya está en el taller: no se avisa.
 *   · cerrada con fecha  vence esa fecha.
 *   · cerrada sin fecha  quien la cerró no pidió preventivo: no se avisa.
 * Una orden vieja con fecha no revive porque la nueva no la tenga.
 */

export interface OrdenParaPreventivo {
  assetId: string
  creada: string
  cerrada: boolean
  proximoPreventivo: string | null
}

export interface PreventivoAAvisar {
  assetId: string
  fecha: string
  /** Negativo = vencido hace tantos días; 0 = vence hoy. */
  dias: number
  vencido: boolean
}

export const DIAS_DE_ANTICIPACION = 30

const DIA_MS = 86_400_000

/** Días entre dos fechas `YYYY-MM-DD`, sin horas ni zonas horarias. */
function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS)
}

export function preventivosAAvisar(
  ordenes: readonly OrdenParaPreventivo[],
  hoy: string,
  anticipacion = DIAS_DE_ANTICIPACION,
): PreventivoAAvisar[] {
  const ultima = new Map<string, OrdenParaPreventivo>()
  for (const o of ordenes) {
    const previa = ultima.get(o.assetId)
    if (!previa || o.creada > previa.creada) ultima.set(o.assetId, o)
  }

  const avisos: PreventivoAAvisar[] = []
  for (const o of ultima.values()) {
    if (!o.cerrada || !o.proximoPreventivo) continue
    const fecha = o.proximoPreventivo.slice(0, 10)
    const dias = diasEntre(hoy, fecha)
    if (dias > anticipacion) continue
    avisos.push({ assetId: o.assetId, fecha, dias, vencido: dias < 0 })
  }
  // Lo más urgente primero: el que más tiempo lleva vencido arriba.
  return avisos.sort((a, b) => a.dias - b.dias)
}
