import { useId, type ReactNode } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import { useApariencia } from './useApariencia'
import { ACENTOS, FUENTES, PRESETS, TAMANOS, esOriginal, modoDe, type Apariencia } from './opciones'
import styles from './DialogoApariencia.module.css'

const TEMA = { claro: 'light', oscuro: 'dark' } as const

/**
 * «Personalizar apariencia» (Fase 14 · E0).
 *
 * Cada grupo es un `radiogroup` nativo (fieldset + inputs radio): flechas
 * para moverse, Espacio para elegir, el lector de pantalla anuncia la opción
 * y si está elegida. La elegida se marca con borde doble y tilde además del
 * color. Cada cambio se ve al instante y se guarda en el perfil.
 */
export function DialogoApariencia({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { apariencia, cambiar, restaurar, guardando, error } = useApariencia()
  const modo = modoDe(apariencia.preset)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Apariencia"
      description="Se guarda en tu usuario: la vas a ver igual en cualquier dispositivo. No cambia lo que ven las demás personas."
      size="lg"
      footer={
        <>
          <span className={styles.estado} role="status" aria-live="polite">
            {guardando ? 'Guardando…' : ''}
          </span>
          <Button variant="secondary" onClick={restaurar} disabled={esOriginal(apariencia)}>
            Restaurar original
          </Button>
          <Button onClick={onClose}>Listo</Button>
        </>
      }
    >
      <div className={styles.cuerpo}>
        {error && (
          <Alert tone="danger" role="alert" title="No se guardó el cambio">
            {error} Se volvió a la apariencia anterior.
          </Alert>
        )}

        <Grupo titulo="Tema" ayuda="Colores de toda la aplicación. Los temas oscuros cambian el fondo.">
          <div className={styles.presets}>
            {PRESETS.map((p) => (
              <Opcion key={p.id} nombre="preset" valor={p.id} etiqueta={`${p.nombre}, tema ${p.modo}${p.id === 'claro-naranja' ? ' (original)' : ''}`} elegido={apariencia.preset === p.id} onElegir={() => cambiar({ preset: p.id })} className={styles.preset}>
                <span className={styles.muestra} data-theme={TEMA[p.modo]} data-apariencia={p.id} aria-hidden="true">
                  <span className={styles.muestraHeader} />
                  <span className={styles.muestraCuerpo}>
                    <span className={styles.muestraLinea} />
                    <span className={styles.muestraBoton} />
                  </span>
                </span>
                <span className={styles.textoOpcion}>
                  <span className={styles.nombreOpcion}>{p.nombre}</span>
                  <span className={styles.detalleOpcion}>{p.modo === 'oscuro' ? 'Oscuro' : 'Claro'}</span>
                </span>
              </Opcion>
            ))}
          </div>
        </Grupo>

        <Grupo titulo="Color de acento" ayuda="Botones principales, enlaces y selección. Ventas, Compras y Mantenimiento conservan su color propio.">
          <div className={styles.acentos}>
            {ACENTOS.map((a) => (
              <Opcion key={a.id} nombre="acento" valor={a.id} etiqueta={a.id === 'tema' ? 'Acento del tema' : `Acento ${a.nombre.toLowerCase()}`} elegido={apariencia.acento === a.id} onElegir={() => cambiar({ acento: a.id })} className={styles.acento}>
                <span
                  className={styles.circulo}
                  data-theme={TEMA[modo]}
                  {...(a.id === 'tema' ? { 'data-apariencia': apariencia.preset } : { 'data-acento': a.id })}
                  aria-hidden="true"
                />
                <span className={styles.nombreOpcion}>{a.nombre}</span>
              </Opcion>
            ))}
          </div>
        </Grupo>

        <div className={styles.dosColumnas}>
          <Grupo titulo="Tamaño del texto">
            <div className={styles.lista}>
              {TAMANOS.map((t) => (
                <Opcion key={t.id} nombre="tamano" valor={t.id} etiqueta={`${t.nombre}: ${t.detalle.toLowerCase()}`} elegido={apariencia.tamano === t.id} onElegir={() => cambiar({ tamano: t.id })} className={styles.fila}>
                  <span className={cx(styles.aa, styles[`aa_${t.id}`])} aria-hidden="true">
                    Aa
                  </span>
                  <span className={styles.textoOpcion}>
                    <span className={styles.nombreOpcion}>{t.nombre}</span>
                    <span className={styles.detalleOpcion}>{t.detalle}</span>
                  </span>
                </Opcion>
              ))}
            </div>
          </Grupo>

          <Grupo titulo="Tipografía">
            <div className={styles.lista}>
              {FUENTES.map((f) => (
                <Opcion key={f.id} nombre="fuente" valor={f.id} etiqueta={`${f.nombre}: ${f.detalle}`} elegido={apariencia.fuente === f.id} onElegir={() => cambiar({ fuente: f.id })} className={styles.fila}>
                  <span className={cx(styles.aa, styles[`fuente_${f.id}`])} aria-hidden="true">
                    Ag
                  </span>
                  <span className={styles.textoOpcion}>
                    <span className={cx(styles.nombreOpcion, styles[`fuente_${f.id}`])}>{f.nombre}</span>
                    <span className={styles.detalleOpcion}>{f.detalle}</span>
                  </span>
                </Opcion>
              ))}
            </div>
          </Grupo>
        </div>
      </div>
    </Dialog>
  )
}

function Grupo({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  const idAyuda = useId()
  return (
    <fieldset className={styles.grupo} aria-describedby={ayuda ? idAyuda : undefined}>
      <legend className={styles.titulo}>{titulo}</legend>
      {ayuda && (
        <p id={idAyuda} className={styles.ayuda}>
          {ayuda}
        </p>
      )}
      {children}
    </fieldset>
  )
}

function Opcion({
  nombre,
  valor,
  etiqueta,
  elegido,
  onElegir,
  className,
  children,
}: {
  nombre: keyof Omit<Apariencia, 'version'>
  valor: string
  /** Nombre accesible completo: el texto visible va en spans sin separador. */
  etiqueta: string
  elegido: boolean
  onElegir: () => void
  className: string | undefined
  children: ReactNode
}) {
  return (
    <label className={cx(styles.opcion, elegido && styles.elegida, className)}>
      <input type="radio" className={styles.radio} name={`apariencia-${nombre}`} value={valor} aria-label={etiqueta} checked={elegido} onChange={onElegir} />
      {children}
      <span className={styles.tilde} aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
    </label>
  )
}
