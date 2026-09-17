import { Badge } from '@/components/ui/Badge'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { momento, presentarMotivos, textoDeErrorIA, type MotivoAtencion } from '../lib/ia'
import type { CorridaIA } from '../services/ia'
import styles from './Whatsapp.module.css'

export interface PanelActividadProps {
  motivos: readonly MotivoAtencion[]
  /** `null` cuando el rol no ve las corridas (sólo admin y employee). */
  corridas: readonly CorridaIA[] | null
  cargando: boolean
}

const ESTADO: Record<CorridaIA['estado'], { etiqueta: string; tono: 'success' | 'danger' | 'neutral' }> = {
  ok: { etiqueta: 'Analizado', tono: 'success' },
  error: { etiqueta: 'Falló', tono: 'danger' },
  sin_cambios: { etiqueta: 'Sin mensajes nuevos', tono: 'neutral' },
}

/**
 * Por qué esta conversación pide atención y qué pasó con sus análisis.
 *
 * Las señales NO son sólo de la IA: la mayoría son reglas fijas (el último
 * mensaje es del contacto, hay una pregunta, falló un envío). Se muestran
 * juntas y en palabras.
 *
 * El historial de análisis muestra hechos: cuándo, cuántos mensajes, cuántas
 * sugerencias se guardaron y cuántas se descartaron por no tener fuente. Sin
 * contenido de los mensajes y sin costos en pesos.
 */
export function PanelActividad({ motivos, corridas, cargando }: PanelActividadProps) {
  const textos = presentarMotivos(motivos)

  return (
    <div className={styles.ia}>
      <section className={styles.bloque} aria-labelledby="act-senales">
        <h3 id="act-senales" className={styles.bloqueTitulo}>Atención</h3>
        {textos.length === 0 ? (
          <p className={styles.sinVinculo}>No hay señales: la conversación no está esperando nada nuestro.</p>
        ) : (
          <ul className={styles.iaMotivos}>
            {textos.map((t) => (
              <li key={t}>
                <Badge tone="warning" dot>{t}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {corridas !== null ? (
        <section className={styles.bloque} aria-labelledby="act-analisis">
          <h3 id="act-analisis" className={styles.bloqueTitulo}>Análisis</h3>
          {cargando ? (
            <SkeletonRows rows={2} columns={1} label="Cargando la actividad…" />
          ) : corridas.length === 0 ? (
            <p className={styles.sinVinculo}>Todavía no se pidió ningún análisis.</p>
          ) : (
            <ul className={styles.iaItems}>
              {corridas.map((c) => (
                <li key={c.id} className={styles.iaItem}>
                  <div className={styles.iaEtiquetas}>
                    <Badge tone={ESTADO[c.estado].tono}>{ESTADO[c.estado].etiqueta}</Badge>
                    <span className={styles.iaPie}>{momento(c.en)}</span>
                  </div>
                  <p className={styles.iaPie}>
                    {c.estado === 'error'
                      ? textoDeErrorIA(c.codigo)
                      : c.estado === 'ok'
                        ? `${c.mensajes} mensaje(s) · ${c.itemsGuardados} sugerencia(s) nueva(s)` +
                          (c.itemsDescartados > 0 ? ` · ${c.itemsDescartados} descartada(s) en la validación` : '')
                        : 'No había mensajes nuevos: no se llamó a la IA.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
