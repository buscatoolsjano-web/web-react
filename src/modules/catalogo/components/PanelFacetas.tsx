import { useEffect, useId, useRef, useState } from 'react'
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
 * Barra de filtros del catálogo.
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
 * Las opciones vienen de `catalog_facets`, que calcula cada faceta con todos
 * los filtros activos MENOS el suyo. Dos consecuencias visibles: no hay
 * opciones muertas —en Balanceadores se ofrecen 3 marcas y no las 25 de la
 * empresa— y se puede cambiar de una opción a otra sin limpiar primero.
 *
 * Ninguna categoría está nombrada en el código: qué se dibuja sale de los datos.
 */
export function PanelFacetas({
  filtros,
  facetas,
  cargando,
  onCambiar,
  onLimpiar,
}: PanelFacetasProps) {
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
    <div className={styles.barra} aria-busy={cargando}>
      {/* ── Fila 1 · categorías ─────────────────────────────────────────── */}
      <FilaChips
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

      {/* ── Fila 2 · subcategorías de la categoría elegida ──────────────── */}
      {verSubtipos && (
        <FilaChips
          etiqueta="Subcategoría"
          opciones={facetas?.subtipos ?? []}
          seleccionados={filtros.subtipos}
          totalTodas={null}
          multiple
          onElegir={(valores) => onCambiar({ subtipos: valores })}
        />
      )}

      {/* ── Fila 3 · marca y atributos, como desplegables ───────────────── */}
      {verDesplegables && (marcas.length > 0 || atributos.length > 0) && (
        <div className={styles.filaDesplegables}>
          <span className={styles.rotulo}>Filtrar por</span>

          {marcas.length > 0 && (
            <DesplegableLista
              titulo="Marca"
              opciones={marcas}
              seleccionados={filtros.marca ? [filtros.marca] : []}
              multiple={false}
              onElegir={(valores) => onCambiar({ marca: valores[0] ?? null })}
            />
          )}

          {atributos.map((a) =>
            a.clase === 'range' ? (
              <DesplegableRango
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
              <DesplegableLista
                key={a.key}
                titulo={a.unidad ? `${a.label} (${a.unidad})` : a.label}
                opciones={a.opciones}
                seleccionados={filtros.atributos[a.key] ?? []}
                multiple
                onElegir={(valores) => {
                  const atrs = { ...filtros.atributos }
                  if (valores.length === 0) delete atrs[a.key]
                  else atrs[a.key] = valores
                  onCambiar({ atributos: atrs })
                }}
              />
            ),
          )}
        </div>
      )}

      {/* ── Filtros aplicados ──────────────────────────────────────────── */}
      <ChipsFiltrosActivos
        filtros={filtros}
        facetas={facetas}
        onCambiar={onCambiar}
        onLimpiar={onLimpiar}
      />
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
}: {
  etiqueta?: string
  opciones: readonly OpcionFaceta[]
  seleccionados: readonly string[]
  totalTodas: number | null
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
    <div className={styles.fila}>
      {etiqueta && <span className={styles.rotulo}>{etiqueta}</span>}
      <div className={styles.chips} role="group" aria-label={etiqueta ?? 'Categoría'}>
        <button
          type="button"
          className={seleccionados.length === 0 ? styles.chipActivo : styles.chip}
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
            className={seleccionados.includes(o.valor) ? styles.chipActivo : styles.chip}
            onClick={() => alternar(o.valor)}
            aria-pressed={seleccionados.includes(o.valor)}
          >
            {o.etiqueta}
            <span className={styles.cuenta}>{o.cantidad.toLocaleString('es-AR')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Envoltorio de desplegable: botón + panel flotante.
 *
 * Cierra con Escape y con un click afuera. El foco vuelve al botón, que es
 * lo mínimo para que se pueda usar sin mouse.
 */
function Desplegable({
  titulo,
  resumen,
  activo,
  children,
}: {
  titulo: string
  resumen: string | null
  activo: boolean
  children: (cerrar: () => void) => React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!abierto) return
    const afuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false)
        boton.current?.focus()
      }
    }
    document.addEventListener('mousedown', afuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', afuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <div className={styles.desplegable} ref={contenedor}>
      <button
        ref={boton}
        type="button"
        className={activo ? styles.botonDesplegableActivo : styles.botonDesplegable}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls={id}
      >
        <span className={styles.botonTitulo}>{titulo}</span>
        <span className={styles.botonValor}>{resumen ?? 'Todos'}</span>
        <span aria-hidden="true" className={styles.flecha}>
          ▾
        </span>
      </button>

      {abierto && (
        <div className={styles.panelFlotante} id={id}>
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  )
}

const UMBRAL_BUSCADOR = 10

function DesplegableLista({
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
  const [texto, setTexto] = useState('')
  const grupo = useId()

  if (opciones.length === 0) return null

  const elegidas = opciones.filter((o) => seleccionados.includes(o.valor))
  const resumen =
    elegidas.length === 0
      ? null
      : elegidas.length === 1
        ? (elegidas[0]?.etiqueta ?? null)
        : `${elegidas.length} elegidos`

  const filtradas = texto.trim()
    ? opciones.filter((o) => o.etiqueta.toLowerCase().includes(texto.trim().toLowerCase()))
    : opciones

  const alternar = (valor: string, cerrar: () => void) => {
    if (!multiple) {
      onElegir(seleccionados.includes(valor) ? [] : [valor])
      // Con una sola opción posible el panel ya cumplió su función.
      cerrar()
      return
    }
    onElegir(
      seleccionados.includes(valor)
        ? seleccionados.filter((v) => v !== valor)
        : [...seleccionados, valor],
    )
  }

  return (
    <Desplegable titulo={titulo} resumen={resumen} activo={elegidas.length > 0}>
      {(cerrar) => (
        <>
          {opciones.length > UMBRAL_BUSCADOR && (
            <input
              className={styles.buscadorFaceta}
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={`Buscar en ${opciones.length}…`}
              aria-label={`Buscar en ${titulo}`}
              autoFocus
            />
          )}

          {seleccionados.length > 0 && (
            <button type="button" className={styles.quitarTodo} onClick={() => onElegir([])}>
              Quitar selección
            </button>
          )}

          <ul className={styles.lista}>
            {filtradas.map((o) => (
              <li key={o.valor}>
                <label className={styles.opcion}>
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={multiple ? undefined : grupo}
                    checked={seleccionados.includes(o.valor)}
                    onChange={() => alternar(o.valor, cerrar)}
                  />
                  <span className={styles.opcionTexto}>{o.etiqueta}</span>
                  <span className={styles.cuenta}>{o.cantidad.toLocaleString('es-AR')}</span>
                </label>
              </li>
            ))}
            {filtradas.length === 0 && <li className={styles.vacio}>Sin coincidencias</li>}
          </ul>
        </>
      )}
    </Desplegable>
  )
}

/**
 * Rango numérico.
 *
 * Sólo aparece cuando TODOS los valores del atributo son numéricos. `rpm`
 * queda fuera a propósito: 22 de sus 24 valores son intervalos de texto
 * (`0-2600`), y un rango daría resultados falsos. Ver clasificarFaceta.ts.
 */
function DesplegableRango({
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

  const activo = valor.min !== null || valor.max !== null
  const resumen = activo
    ? `${valor.min ?? faceta.min ?? ''} – ${valor.max ?? faceta.max ?? ''}`
    : null

  return (
    <Desplegable
      titulo={faceta.unidad ? `${faceta.label} (${faceta.unidad})` : faceta.label}
      resumen={resumen}
      activo={activo}
    >
      {() => (
        <>
          <div className={styles.rango}>
            <input
              className={styles.numero}
              type="number"
              inputMode="decimal"
              value={valor.min ?? ''}
              placeholder={faceta.min !== null ? String(faceta.min) : 'mín.'}
              aria-label={`${faceta.label} mínimo`}
              onChange={(e) => onCambiar({ ...valor, min: leer(e.target.value) })}
              autoFocus
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
          {faceta.min !== null && faceta.max !== null && (
            <p className={styles.ayuda}>
              Entre {faceta.min} y {faceta.max}
              {faceta.unidad ? ` ${faceta.unidad}` : ''} en estos resultados
            </p>
          )}
          {activo && (
            <button
              type="button"
              className={styles.quitarTodo}
              onClick={() => onCambiar({ min: null, max: null })}
            >
              Quitar rango
            </button>
          )}
        </>
      )}
    </Desplegable>
  )
}

/** Los filtros aplicados, cada uno con su ✕, más el botón de limpiar todo. */
function ChipsFiltrosActivos({
  filtros,
  facetas,
  onCambiar,
  onLimpiar,
}: {
  filtros: FiltrosCatalogo
  facetas: Facetas | undefined
  onCambiar: (cambios: Partial<FiltrosCatalogo>) => void
  onLimpiar: () => void
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
    <div className={styles.activos}>
      {activos.map((a) => (
        <button
          key={a.clave}
          type="button"
          className={styles.chipActivoQuitar}
          onClick={a.quitar}
        >
          {a.texto}
          <span aria-hidden="true"> ✕</span>
          <span className="sr-only">Quitar filtro</span>
        </button>
      ))}
      <button type="button" className={styles.limpiar} onClick={onLimpiar}>
        Limpiar
      </button>
    </div>
  )
}
