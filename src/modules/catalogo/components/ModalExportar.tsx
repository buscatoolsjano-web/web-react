import { useId, useRef, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/ui/Spinner'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import {
  columnasPara,
  columnasPorDefecto,
  ETIQUETA_GRUPO,
  type GrupoColumna,
} from '../lib/exportar'
import styles from './ModalExportar.module.css'

const GRUPOS: GrupoColumna[] = ['base', 'atributos', 'stock']

/**
 * Elegir qué exportar (Fase 22 · paridad, #49).
 *
 * Réplica del modal del legacy (`app.js:16960`): alcance, columnas en tres
 * grupos, «todas» / «ninguna», y el conteo en vivo abajo a la izquierda.
 *
 * Dos diferencias, las dos a propósito:
 *
 *  · **«Todo el catálogo» sólo aparece para roles internos.** El legacy hace
 *    lo mismo (`_isClienteExport` fuerza el alcance filtrado, `:17001`), pero
 *    lo hace escondiendo el radio y filtrando otra vez al exportar. Acá el
 *    rol decide qué opciones existen.
 *  · **Stock virtual no está para un cliente**, porque `columnasPara` no se
 *    la ofrece. En el legacy la columna existe y se saca al final.
 */
export function ModalExportar({
  esInterno,
  totalFiltrado,
  totalCatalogo,
  hayFiltros,
  exportando,
  avance,
  error,
  onExportar,
  onCerrar,
}: {
  esInterno: boolean
  totalFiltrado: number
  /** `null` mientras no llegó: se muestra el radio sin número. */
  totalCatalogo: number | null
  hayFiltros: boolean
  exportando: boolean
  /** Cuántos lleva traídos, para no dejar medio minuto en blanco. */
  avance: { traidos: number; total: number } | null
  error: string | null
  onExportar: (elegidas: ReadonlySet<string>, alcance: 'filtrado' | 'todo') => void
  onCerrar: () => void
}) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  useModalAccesible(caja, { onClose: onCerrar })

  const disponibles = columnasPara(esInterno)
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(() => columnasPorDefecto(esInterno))
  const [alcance, setAlcance] = useState<'filtrado' | 'todo'>('filtrado')

  const alternar = (clave: string) =>
    setElegidas((s) => {
      const n = new Set(s)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })

  const cuantos = alcance === 'todo' ? (totalCatalogo ?? 0) : totalFiltrado

  return (
    <div className={styles.fondo}>
      <div
        ref={caja}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
      >
        <header className={styles.barra}>
          <h2 className={styles.titulo} id={idTitulo}>
            Exportar el catálogo
          </h2>
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>

        <div className={styles.cuerpo}>
          {esInterno && hayFiltros ? (
            <fieldset className={styles.alcance}>
              <legend className={styles.leyenda}>Qué exportar</legend>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="alcance"
                  checked={alcance === 'filtrado'}
                  onChange={() => setAlcance('filtrado')}
                />
                Lo que estoy viendo <span className={styles.conteo}>({totalFiltrado})</span>
              </label>
              <label className={styles.radio}>
                <input
                  type="radio"
                  name="alcance"
                  checked={alcance === 'todo'}
                  onChange={() => setAlcance('todo')}
                />
                Todo el catálogo{
                  totalCatalogo === null ? null : <span className={styles.conteo}> ({totalCatalogo})</span>
                }
              </label>
            </fieldset>
          ) : null}

          <div className={styles.acciones}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setElegidas(new Set(disponibles.map((c) => c.clave)))}
            >
              Todas
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setElegidas(new Set())}>
              Ninguna
            </Button>
          </div>

          {GRUPOS.map((g) => {
            const delGrupo = disponibles.filter((c) => c.grupo === g)
            if (delGrupo.length === 0) return null
            return (
              <fieldset key={g} className={styles.grupo}>
                <legend className={styles.leyenda}>{ETIQUETA_GRUPO[g]}</legend>
                <div className={styles.columnas}>
                  {delGrupo.map((c) => (
                    <label key={c.clave} className={styles.columna}>
                      <input
                        type="checkbox"
                        checked={elegidas.has(c.clave)}
                        onChange={() => alternar(c.clave)}
                        data-columna={c.clave}
                      />
                      {c.etiqueta}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}

          {error ? (
            <Alert tone="danger" role="alert" title="No se pudo exportar">
              <p>{error}</p>
            </Alert>
          ) : null}
        </div>

        <footer className={styles.pie}>
          <span className={styles.resumen}>
            {avance
              ? `Trayendo ${avance.traidos} de ${avance.total}…`
              : `${cuantos} ${cuantos === 1 ? 'producto' : 'productos'} · ${elegidas.size} ${elegidas.size === 1 ? 'columna' : 'columnas'}`}
          </span>
          <div className={styles.botones}>
            <Button variant="secondary" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button
              onClick={() => onExportar(elegidas, alcance)}
              disabled={elegidas.size === 0 || cuantos === 0 || exportando}
            >
              {exportando ? <Spinner size={16} /> : null}
              {exportando ? 'Preparando…' : 'Exportar'}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
