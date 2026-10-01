import { type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import { mostrarFacetaSubtipo } from '../lib/clasificarFaceta'
import { SelectorFaceta, SelectorRango } from './SelectorFaceta'
import type { Facetas, FiltrosCatalogo, OpcionFaceta } from '../types'
import styles from './PanelFacetas.module.css'

export interface PanelFacetasProps {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  cargando: boolean
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  /**
   * El buscador, que va DENTRO de la fila de categorías (Fase 38).
   *
   * Antes era una fila propia arriba de todo. Entre esa fila, los chips de
   * categoría, los de subcategoría y los atributos, la cabecera se comía 276 px
   * y la tabla arrancaba a la mitad de la pantalla. Compartir fila con los
   * chips —como la web vieja— devuelve una fila entera al contenido.
   */
  buscador?: ReactNode
}

/**
 * Facetas del catálogo.
 *
 * La disposición es HORIZONTAL y por capas, no una columna lateral que crece
 * hacia abajo:
 *
 *   fila 1 · categorías, siempre visibles
 *   fila 2 · subcategorías de la categoría elegida
 *   fila 3 · marca y atributos, cada uno como un desplegable
 *
 * Así el catálogo empieza justo debajo y no queda empujado fuera de la
 * pantalla: sin categoría elegida había 40 chips de subcategoría y listas de
 * hasta 234 valores apiladas una tras otra.
 *
 * Fase 13 · E4: vive dentro del `FilterBar` compartido, que en < 768 px la
 * pliega detrás de «Filtros». Los filtros aplicados van aparte
 * (`FiltrosActivos`) y quedan siempre a la vista.
 *
 * Las opciones vienen de `catalog_facets`, que calcula cada faceta con todos
 * los filtros activos MENOS el suyo. Dos consecuencias visibles: no hay
 * opciones muertas —en Balanceadores se ofrecen 3 marcas y no las 25 de la
 * empresa— y se puede cambiar de una opción a otra sin limpiar primero.
 *
 * Ninguna categoría está nombrada en el código: qué se dibuja sale de los datos.
 */
export function PanelFacetas({ filtros, facetas, cargando, onCambiar, buscador }: PanelFacetasProps) {
  const hayCategoria = filtros.categoria !== null

  const verSubtipos = mostrarFacetaSubtipo(
    facetas?.subtipos ?? [],
    facetas?.total ?? 0,
    hayCategoria,
    filtros.subtipos,
  )

  const atributos = facetas?.atributos ?? []
  const marcas = facetas?.marcas ?? []

  // Sin categoría elegida se muestran SÓLO las categorías. Los 14
  // desplegables del catálogo entero ocupaban cinco líneas y empujaban los
  // resultados hacia abajo, que es justo lo que veníamos a evitar.
  //
  // La excepción son los filtros ya activos: un link compartido puede traer
  // una marca o un atributo sin categoría, y entonces la fila tiene que
  // estar para poder editarlo.
  const hayFiltroDeAtributo =
    filtros.marca !== null ||
    Object.keys(filtros.atributos).length > 0 ||
    Object.keys(filtros.rangos).length > 0
  const verDesplegables = hayCategoria || hayFiltroDeAtributo

  return (
    <div className={styles.facetas} aria-busy={cargando}>
      {/* ── Fila 1 · categorías ─────────────────────────────────────────── */}
      <FilaChips
        etiqueta="Categoría"
        extra={buscador}
        opciones={facetas?.categorias ?? []}
        seleccionados={filtros.categoria ? [filtros.categoria] : []}
        totalTodas={facetas?.total ?? null}
        multiple={false}
        onElegir={(valores) =>
          // Al cambiar de categoría se descartan subtipos, atributos y rangos:
          // los de la categoría anterior no tienen por qué aplicar acá.
          onCambiar({
            categoria: valores[0] ?? null,
            subtipos: [],
            atributos: {},
            rangos: {},
          })
        }
      />

      {/*
        La SUBCATEGORÍA dejó de ser una fila de chips (Fase 38).

        Con «Puntas y tubos» eran 21 chips —Embocadura, Extensión, Allen,
        Adaptador, Torx…— que ocupaban una fila entera para un filtro que no se
        usa más que los otros. Pasa a ser un desplegable más de «Filtrar por»,
        al lado de Marca y de los atributos: mismo peso visual que el resto, y
        una fila menos entre la cabecera y los productos.
      */}

      {/* ── Fila 3 · marca y atributos, como desplegables ───────────────── */}
      {verDesplegables && (marcas.length > 0 || atributos.length > 0 || verSubtipos) && (
        <div className={styles.fila}>
          <span className={styles.rotulo}>Filtrar por</span>
          <div className={styles.desplegables}>
            {verSubtipos && (facetas?.subtipos.length ?? 0) > 0 && (
              <SelectorFaceta
                etiqueta="Subcategoría"
                valor={filtros.subtipos[0] ?? ''}
                opciones={facetas?.subtipos ?? []}
                onElegir={(v) => onCambiar({ subtipos: v === '' ? [] : [v] })}
              />
            )}

            {marcas.length > 0 && (
              <SelectorFaceta
                etiqueta="Marca"
                valor={filtros.marca ?? ''}
                opciones={marcas}
                onElegir={(v) => onCambiar({ marca: v === '' ? null : v })}
              />
            )}

            {atributos.map((a) =>
              a.clase === 'range' ? (
                <SelectorRango
                  key={a.key}
                  faceta={a}
                  valor={filtros.rangos[a.key] ?? { min: null, max: null }}
                  onCambiar={(r) => {
                    const rangos = { ...filtros.rangos }
                    if (r.min === null && r.max === null) delete rangos[a.key]
                    else rangos[a.key] = r
                    onCambiar({ rangos })
                  }}
                />
              ) : (
                <SelectorFaceta
                  key={a.key}
                  etiqueta={a.unidad ? `${a.label} (${a.unidad})` : a.label}
                  valor={filtros.atributos[a.key]?.[0] ?? ''}
                  opciones={a.opciones}
                  onElegir={(v) => {
                    const atrs = { ...filtros.atributos }
                    if (v === '') delete atrs[a.key]
                    else atrs[a.key] = [v]
                    onCambiar({ atributos: atrs })
                  }}
                />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Fila horizontal de chips.
 *
 * Scrollea de costado en pantallas angostas en vez de envolver en cinco
 * líneas: en 390 px las 8 categorías ocupaban media pantalla.
 */
function FilaChips({
  etiqueta,
  opciones,
  seleccionados,
  totalTodas,
  multiple,
  onElegir,
  extra,
}: {
  etiqueta: string
  opciones: readonly OpcionFaceta[]
  seleccionados: readonly string[]
  totalTodas: number | null
  multiple: boolean
  onElegir: (valores: string[]) => void
  /** Va al final de la fila, pegado a la derecha. Hoy: el buscador. */
  extra?: ReactNode
}) {
  if (opciones.length === 0) return null

  const alternar = (valor: string) => {
    if (!multiple) return onElegir(seleccionados.includes(valor) ? [] : [valor])
    onElegir(
      seleccionados.includes(valor)
        ? seleccionados.filter((v) => v !== valor)
        : [...seleccionados, valor],
    )
  }

  return (
    <div className={styles.fila}>
      <span className={styles.rotulo}>{etiqueta}</span>
      <div className={styles.chips} role="group" aria-label={etiqueta}>
        <button
          type="button"
          className={cx(styles.chip, seleccionados.length === 0 && styles.chipActivo)}
          onClick={() => onElegir([])}
          aria-pressed={seleccionados.length === 0}
        >
          Todas
          {totalTodas !== null && (
            <span className={styles.cuenta}>{totalTodas.toLocaleString('es-AR')}</span>
          )}
        </button>
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            className={cx(styles.chip, seleccionados.includes(o.valor) && styles.chipActivo)}
            onClick={() => alternar(o.valor)}
            aria-pressed={seleccionados.includes(o.valor)}
          >
            {o.etiqueta}
            <span className={styles.cuenta}>{o.cantidad.toLocaleString('es-AR')}</span>
          </button>
        ))}
      </div>
      {extra ? <div className={styles.extra}>{extra}</div> : null}
    </div>
  )
}

export interface FiltrosActivosProps {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  onLimpiar: () => void
}

/**
 * Los filtros aplicados, cada uno con su botón de quitar, más «Limpiar
 * filtros». Queda fuera del panel plegable: en mobile se sigue viendo qué está
 * filtrando la lista aunque el panel esté cerrado.
 */
export function FiltrosActivos({ filtros, facetas, onCambiar, onLimpiar }: FiltrosActivosProps) {
  const activos: { clave: string; texto: string; quitar: () => void }[] = []

  if (filtros.categoria) {
    const c = facetas?.categorias.find((x) => x.valor === filtros.categoria)
    activos.push({
      clave: 'cat',
      texto: c?.etiqueta ?? 'Categoría',
      quitar: () => onCambiar({ categoria: null, subtipos: [], atributos: {}, rangos: {} }),
    })
  }
  for (const t of filtros.subtipos) {
    activos.push({
      clave: `tipo:${t}`,
      texto: t,
      quitar: () => onCambiar({ subtipos: filtros.subtipos.filter((x) => x !== t) }),
    })
  }
  if (filtros.marca) {
    const m = facetas?.marcas.find((x) => x.valor === filtros.marca)
    activos.push({
      clave: 'marca',
      texto: m?.etiqueta ?? 'Marca',
      quitar: () => onCambiar({ marca: null }),
    })
  }
  for (const [key, valores] of Object.entries(filtros.atributos)) {
    const def = facetas?.atributos.find((a) => a.key === key)
    for (const v of valores) {
      activos.push({
        clave: `${key}:${v}`,
        texto: `${def?.label ?? key}: ${v}`,
        quitar: () => {
          const atributos = { ...filtros.atributos }
          const resto = valores.filter((x) => x !== v)
          if (resto.length === 0) delete atributos[key]
          else atributos[key] = resto
          onCambiar({ atributos })
        },
      })
    }
  }
  for (const [key, r] of Object.entries(filtros.rangos)) {
    const def = facetas?.atributos.find((a) => a.key === key)
    activos.push({
      clave: `rango:${key}`,
      texto: `${def?.label ?? key}: ${r.min ?? ''}–${r.max ?? ''}${def?.unidad ? ' ' + def.unidad : ''}`,
      quitar: () => {
        const rangos = { ...filtros.rangos }
        delete rangos[key]
        onCambiar({ rangos })
      },
    })
  }

  if (activos.length === 0) return null

  return (
    <div className={styles.activos} role="group" aria-label="Filtros aplicados">
      {activos.map((a) => (
        <button key={a.clave} type="button" className={styles.chipQuitar} onClick={a.quitar} aria-label={`Quitar filtro: ${a.texto}`}>
          {a.texto}
          <Icon name="x" size={16} />
        </button>
      ))}
      <Button variant="ghost" size="sm" onClick={onLimpiar}>
        Limpiar filtros
      </Button>
    </div>
  )
}
