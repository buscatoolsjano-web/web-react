import { useId, useState } from 'react'
import { mostrarFacetaSubtipo } from '../lib/clasificarFaceta'
import type {
  Facetas,
  FacetaAtributo,
  FiltrosCatalogo,
  OpcionFaceta,
  RangoNumerico,
} from '../types'
import styles from './PanelFacetas.module.css'

export interface PanelFacetasProps {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  cargando: boolean
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  onLimpiar: () => void
}

/**
 * Filtros del catálogo, con las opciones que realmente existen.
 *
 * Todo lo que se ve acá viene de `catalog_facets`, que calcula cada faceta
 * con todos los filtros activos MENOS el suyo. Dos consecuencias visibles:
 *
 *  - No hay opciones muertas. Antes el desplegable de marcas mostraba las 25
 *    de la empresa aunque en Balanceadores sólo 3 tuvieran productos: 22 de
 *    25 llevaban a "ningún resultado".
 *  - Se puede cambiar de una opción a otra sin limpiar primero, porque la
 *    faceta no se filtra a sí misma.
 *
 * Ninguna categoría está nombrada en el código: qué se dibuja y qué no sale
 * de los datos.
 */
export function PanelFacetas({
  filtros,
  facetas,
  cargando,
  onCambiar,
  onLimpiar,
}: PanelFacetasProps) {
  const categoriaActiva = facetas?.categorias.find((c) => c.valor === filtros.categoria)

  const hayFiltros =
    filtros.categoria !== null ||
    filtros.marca !== null ||
    filtros.subtipos.length > 0 ||
    Object.keys(filtros.atributos).length > 0 ||
    Object.keys(filtros.rangos).length > 0

  return (
    <div className={styles.panel} aria-busy={cargando}>
      <ChipsFiltrosActivos filtros={filtros} facetas={facetas} onCambiar={onCambiar} />

      <FacetaChips
        titulo="Categoría"
        opciones={facetas?.categorias ?? []}
        seleccionados={filtros.categoria ? [filtros.categoria] : []}
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

      {mostrarFacetaSubtipo(facetas?.subtipos ?? [], categoriaActiva?.etiqueta ?? null) && (
        <FacetaChips
          titulo="Subcategoría"
          opciones={facetas?.subtipos ?? []}
          seleccionados={filtros.subtipos}
          multiple
          onElegir={(valores) => onCambiar({ subtipos: valores })}
        />
      )}

      <FacetaLista
        titulo="Marca"
        opciones={facetas?.marcas ?? []}
        seleccionados={filtros.marca ? [filtros.marca] : []}
        multiple={false}
        onElegir={(valores) => onCambiar({ marca: valores[0] ?? null })}
      />

      {(facetas?.atributos.length ?? 0) > 0 && (
        <>
          <p className={styles.subtitulo}>Características</p>
          {facetas?.atributos.map((a) =>
            a.clase === 'range' ? (
              <FacetaRango
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
              <FacetaLista
                key={a.key}
                titulo={a.unidad ? `${a.label} (${a.unidad})` : a.label}
                opciones={a.opciones}
                seleccionados={filtros.atributos[a.key] ?? []}
                multiple
                onElegir={(valores) => {
                  const atributos = { ...filtros.atributos }
                  if (valores.length === 0) delete atributos[a.key]
                  else atributos[a.key] = valores
                  onCambiar({ atributos })
                }}
              />
            ),
          )}
        </>
      )}

      {hayFiltros && (
        <button type="button" className={styles.limpiar} onClick={onLimpiar}>
          Limpiar filtros
        </button>
      )}
    </div>
  )
}

/** Fila de chips. Para conjuntos cortos donde ver todo de una ayuda. */
function FacetaChips({
  titulo,
  opciones,
  seleccionados,
  multiple,
  onElegir,
}: {
  titulo: string
  opciones: readonly OpcionFaceta[]
  seleccionados: readonly string[]
  multiple: boolean
  onElegir: (valores: string[]) => void
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
    <fieldset className={styles.grupo}>
      <legend className={styles.etiqueta}>{titulo}</legend>
      <div className={styles.chips}>
        <button
          type="button"
          className={seleccionados.length === 0 ? styles.chipActivo : styles.chip}
          onClick={() => onElegir([])}
          aria-pressed={seleccionados.length === 0}
        >
          Todas
        </button>
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            className={seleccionados.includes(o.valor) ? styles.chipActivo : styles.chip}
            onClick={() => alternar(o.valor)}
            aria-pressed={seleccionados.includes(o.valor)}
          >
            {o.etiqueta}
            <span className={styles.cuenta}>{o.cantidad.toLocaleString('es-AR')}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Lista seleccionable con conteos.
 *
 * Con pocas opciones se dibujan todas; a partir de cierto número aparece un
 * buscador, porque `medida` tiene 258 valores y `encastre` 35.
 */
const UMBRAL_BUSCADOR = 10
const VISIBLES_INICIALES = 8

function FacetaLista({
  titulo,
  opciones,
  seleccionados,
  multiple,
  onElegir,
}: {
  titulo: string
  opciones: readonly OpcionFaceta[]
  seleccionados: readonly string[]
  multiple: boolean
  onElegir: (valores: string[]) => void
}) {
  const id = useId()
  const [texto, setTexto] = useState('')
  const [expandido, setExpandido] = useState(false)

  if (opciones.length === 0) return null

  const filtradas = texto.trim()
    ? opciones.filter((o) => o.etiqueta.toLowerCase().includes(texto.trim().toLowerCase()))
    : opciones
  const visibles = expandido ? filtradas : filtradas.slice(0, VISIBLES_INICIALES)
  const ocultas = filtradas.length - visibles.length

  const alternar = (valor: string) => {
    if (!multiple) return onElegir(seleccionados.includes(valor) ? [] : [valor])
    onElegir(
      seleccionados.includes(valor)
        ? seleccionados.filter((v) => v !== valor)
        : [...seleccionados, valor],
    )
  }

  return (
    <fieldset className={styles.grupo}>
      <legend className={styles.etiqueta}>{titulo}</legend>

      {opciones.length > UMBRAL_BUSCADOR && (
        <input
          className={styles.buscadorFaceta}
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={`Buscar en ${opciones.length} opciones…`}
          aria-label={`Buscar en ${titulo}`}
        />
      )}

      <ul className={styles.lista}>
        {visibles.map((o) => (
          <li key={o.valor}>
            <label className={styles.opcion}>
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={multiple ? undefined : id}
                checked={seleccionados.includes(o.valor)}
                onChange={() => alternar(o.valor)}
              />
              <span className={styles.opcionTexto}>{o.etiqueta}</span>
              <span className={styles.cuenta}>{o.cantidad.toLocaleString('es-AR')}</span>
            </label>
          </li>
        ))}
      </ul>

      {ocultas > 0 && (
        <button type="button" className={styles.verMas} onClick={() => setExpandido(true)}>
          Ver {ocultas} más
        </button>
      )}
      {expandido && filtradas.length > VISIBLES_INICIALES && (
        <button type="button" className={styles.verMas} onClick={() => setExpandido(false)}>
          Ver menos
        </button>
      )}
    </fieldset>
  )
}

/**
 * Rango numérico.
 *
 * Sólo aparece cuando TODOS los valores del atributo son numéricos. `rpm`
 * queda fuera a propósito: 22 de sus 24 valores son intervalos de texto
 * (`0-2600`), y un rango daría resultados falsos. Ver clasificarFaceta.ts.
 */
function FacetaRango({
  faceta,
  valor,
  onCambiar,
}: {
  faceta: FacetaAtributo
  valor: RangoNumerico
  onCambiar: (r: RangoNumerico) => void
}) {
  const leer = (v: string): number | null => {
    if (v.trim() === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  return (
    <fieldset className={styles.grupo}>
      <legend className={styles.etiqueta}>
        {faceta.label}
        {faceta.unidad && <span className={styles.unidad}> ({faceta.unidad})</span>}
      </legend>
      <div className={styles.rango}>
        <input
          className={styles.numero}
          type="number"
          inputMode="decimal"
          value={valor.min ?? ''}
          placeholder={faceta.min !== null ? String(faceta.min) : 'mín.'}
          aria-label={`${faceta.label} mínimo`}
          onChange={(e) => onCambiar({ ...valor, min: leer(e.target.value) })}
        />
        <span className={styles.guion}>–</span>
        <input
          className={styles.numero}
          type="number"
          inputMode="decimal"
          value={valor.max ?? ''}
          placeholder={faceta.max !== null ? String(faceta.max) : 'máx.'}
          aria-label={`${faceta.label} máximo`}
          onChange={(e) => onCambiar({ ...valor, max: leer(e.target.value) })}
        />
      </div>
    </fieldset>
  )
}

/** Los filtros aplicados, cada uno con su ✕. */
function ChipsFiltrosActivos({
  filtros,
  facetas,
  onCambiar,
}: {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
}) {
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
    activos.push({ clave: 'marca', texto: m?.etiqueta ?? 'Marca', quitar: () => onCambiar({ marca: null }) })
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
    const desde = r.min === null ? '' : r.min
    const hasta = r.max === null ? '' : r.max
    activos.push({
      clave: `rango:${key}`,
      texto: `${def?.label ?? key}: ${desde}–${hasta}${def?.unidad ? ' ' + def.unidad : ''}`,
      quitar: () => {
        const rangos = { ...filtros.rangos }
        delete rangos[key]
        onCambiar({ rangos })
      },
    })
  }

  if (activos.length === 0) return null

  return (
    <div className={styles.activos}>
      {activos.map((a) => (
        <button key={a.clave} type="button" className={styles.chipActivoQuitar} onClick={a.quitar}>
          {a.texto}
          <span aria-hidden="true"> ✕</span>
          <span className="sr-only">Quitar filtro</span>
        </button>
      ))}
    </div>
  )
}
