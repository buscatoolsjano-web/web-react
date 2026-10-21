import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import type { CategoriaPublica, FacetasPublicas } from '../services/catalogoPublico'
import { iconoDeEncastre, iconoDeForma } from '../lib/iconosDeForma'
import { GRUPOS, grupoDe } from '../lib/grupos'
import fotos from '../lib/fotosDeOpcion.generated.json'
import styles from './GuiaFiltros.module.css'

/**
 * El filtro guiado (Fase 90 · ampliado en Fase 92).
 *
 * «Que los filtros sean más dinámicos, visuales e intuitivos. Al entrar a una
 * categoría te pregunta y según lo que respondés aparecen los filtros, pero que
 * ocupe poco.»
 *
 * UNA pregunta a la vez con tiles —foto real cuando la hay, forma dibujada
 * cuando no—. Lo respondido queda como ficha chica que se saca; la cuenta de
 * arriba baja al afinar. Va ARRIBA de la tabla y CONVIVE con sus filtros de
 * columna: las dos escriben el mismo estado en la URL.
 *
 * ── EL DESGLOSE (Fase 92) ───────────────────────────────────────────────────
 *
 * «Primero punta o tubo, y según eso se desglosa.» La secuencia es:
 *   rubro (sin categoría) → GRUPO (punta/tubo/conexión) → TIPO → encastre →
 *   medida → largo.
 * El grupo no filtra: es un desglose; junta los veinte tipos en cuatro que se
 * reconocen de una, y recién adentro aparecen sus tipos. Lo elegido más fino
 * —el tipo, el encastre…— sí va a la URL; el grupo vive en memoria porque es
 * sólo el camino.
 *
 * ── DATA-DRIVEN ─────────────────────────────────────────────────────────────
 *
 * Preguntas y opciones salen de `catalogo_publico_facetas` (tipos, encastre,
 * medida y largo reales de la categoría, con cantidades). Nada escrito a mano.
 */

const TOPE_VISIBLE = 8
const ATRIBUTOS: readonly { key: string; pregunta: string; pista: string }[] = [
  { key: 'encastre', pregunta: '¿Qué encastre?', pista: 'la conexión a la máquina' },
  { key: 'medida', pregunta: '¿Qué medida?', pista: 'el diámetro o calibre' },
  { key: 'largo', pregunta: '¿Qué largo?', pista: 'el largo total' },
]

export interface GuiaFiltrosProps {
  categoria: string | undefined
  categorias: readonly CategoriaPublica[]
  facetas: FacetasPublicas | undefined
  tipo: string
  atributos: Record<string, string>
  total: number
  cargando: boolean
  onFiltrar: (clave: string, valor: string) => void
  onCategoria: (slug: string) => void
}

interface Opcion {
  valor: string
  etiqueta: string
  cantidad: number
  medio: ReactNode | null
}
interface Paso {
  clave: string
  pregunta: string
  pista: string
  elegido: string
  opciones: Opcion[]
  elegir: (valor: string) => void
  quitar: () => void
}

const fotoDeTipo = (categoria: string | undefined, valor: string): string | undefined => {
  if (!categoria) return undefined
  const cat = (fotos as Record<string, { tipo?: Record<string, string> }>)[categoria]
  return cat?.tipo?.[valor]
}
const fotoDeCategoria = (slug: string): string | undefined =>
  (fotos as Record<string, { portada?: string }>)[slug]?.portada

function Medio({ foto, forma, nombre }: { foto: string | undefined; forma: ReactNode; nombre: string }) {
  if (foto) return <img src={foto} alt="" loading="lazy" width={48} height={48} className={styles.foto} />
  return (
    <span className={styles.forma} aria-hidden="true" title={nombre}>
      {forma}
    </span>
  )
}

export function GuiaFiltros({
  categoria,
  categorias,
  facetas,
  tipo,
  atributos,
  total,
  cargando,
  onFiltrar,
  onCategoria,
}: GuiaFiltrosProps) {
  const [expandido, setExpandido] = useState(false)
  // El grupo elegido vive en memoria (no va a la URL): es sólo el camino al
  // tipo. Si ya hay un tipo puesto, el grupo se deduce de él.
  const [grupoSel, setGrupoSel] = useState('')
  const grupoActual = tipo !== '' ? grupoDe(tipo) : grupoSel

  const pasos: Paso[] = []
  const tipos = facetas?.tipos ?? []

  if (!categoria) {
    pasos.push({
      clave: 'categoria',
      pregunta: '¿Qué estás buscando?',
      pista: 'elegí un rubro para empezar',
      elegido: '',
      elegir: (v) => onCategoria(v),
      quitar: () => onCategoria(''),
      opciones: categorias.map((c) => ({
        valor: c.slug,
        etiqueta: c.nombre,
        cantidad: c.productos,
        medio: (
          <Medio foto={fotoDeCategoria(c.slug)} forma={iconoDeForma(c.nombre)} nombre={c.nombre} />
        ),
      })),
    })
  } else {
    // ── Grupo ────────────────────────────────────────────────────────────────
    const gruposPresentes = GRUPOS.filter((g) => tipos.some((t) => grupoDe(t.nombre) === g.clave))
    if (gruposPresentes.length > 1) {
      pasos.push({
        clave: 'grupo',
        pregunta: '¿Punta o tubo?',
        pista: 'elegí el grupo y se desglosa',
        elegido: grupoActual,
        elegir: (v) => {
          setExpandido(false)
          setGrupoSel(v)
          const delGrupo = tipos.filter((t) => grupoDe(t.nombre) === v)
          // Si el grupo tiene un solo tipo, se aplica derecho; si no, se limpia
          // el tipo anterior para no mezclar grupos.
          onFiltrar('tipo', delGrupo.length === 1 ? (delGrupo[0]?.nombre ?? '') : '')
        },
        quitar: () => {
          setGrupoSel('')
          onFiltrar('tipo', '')
        },
        opciones: gruposPresentes.map((g) => {
          const delGrupo = tipos.filter((t) => grupoDe(t.nombre) === g.clave)
          const n = delGrupo.reduce((a, t) => a + t.cuantos, 0)
          return {
            valor: g.clave,
            etiqueta: g.label,
            cantidad: n,
            medio: <span className={styles.forma} aria-hidden="true">{iconoDeForma(delGrupo[0]?.nombre ?? g.label)}</span>,
          }
        }),
      })
    }

    // ── Tipo (dentro del grupo) ────────────────────────────────────────────────
    if (grupoActual !== '') {
      const delGrupo = tipos.filter((t) => grupoDe(t.nombre) === grupoActual)
      if (delGrupo.length > 1 || tipo !== '') {
        pasos.push({
          clave: 'tipo',
          pregunta: '¿Qué tipo?',
          pista: 'la pieza puntual',
          elegido: tipo,
          elegir: (v) => {
            setExpandido(false)
            setGrupoSel(grupoDe(v))
            onFiltrar('tipo', v)
          },
          quitar: () => onFiltrar('tipo', ''),
          opciones: delGrupo.map((t) => ({
            valor: t.nombre,
            etiqueta: t.nombre,
            cantidad: t.cuantos,
            medio: <Medio foto={fotoDeTipo(categoria, t.nombre)} forma={iconoDeForma(t.nombre)} nombre={t.nombre} />,
          })),
        })
      }
    }

    // ── Atributos: encastre → medida → largo ───────────────────────────────────
    for (const a of ATRIBUTOS) {
      const faceta = (facetas?.atributos ?? []).find((x) => x.key === a.key)
      if (!faceta) continue
      const puesto = atributos[a.key] ?? ''
      if (faceta.opciones.length <= 1 && puesto === '') continue
      const u = faceta.unidad ? ` ${faceta.unidad}` : ''
      pasos.push({
        clave: `a.${a.key}`,
        pregunta: a.pregunta,
        pista: faceta.unidad ? `${a.pista} (${faceta.unidad})` : a.pista,
        elegido: puesto,
        elegir: (v) => {
          setExpandido(false)
          onFiltrar(`a.${a.key}`, v)
        },
        quitar: () => onFiltrar(`a.${a.key}`, ''),
        opciones: faceta.opciones.map((o) => ({
          valor: o.valor,
          etiqueta: `${o.valor}${u}`,
          cantidad: o.cuantos,
          medio: a.key === 'encastre' ? <span className={styles.forma} aria-hidden="true">{iconoDeEncastre(o.valor)}</span> : null,
        })),
      })
    }
  }

  const activo = pasos.find((p) => p.elegido === '')
  const respondidos = pasos.filter((p) => p.elegido !== '')
  if (pasos.length === 0) return null

  const visibles = activo ? (expandido ? activo.opciones : activo.opciones.slice(0, TOPE_VISIBLE)) : []
  const ocultas = activo ? activo.opciones.length - visibles.length : 0

  const etiquetaChip = (p: Paso): string => {
    if (p.clave === 'grupo') return GRUPOS.find((g) => g.clave === p.elegido)?.label ?? p.elegido
    if (p.clave === 'categoria') return categorias.find((c) => c.slug === p.elegido)?.nombre ?? p.elegido
    return p.elegido
  }

  return (
    <section className={styles.guia} aria-label="Búsqueda guiada" aria-busy={cargando}>
      <div className={styles.cabecera}>
        <span className={styles.titulo}>
          <Icon name="search" size={16} aria-hidden="true" />
          Encontrá tu producto
        </span>
        <div className={styles.fichas}>
          {respondidos.map((p) => (
            <button key={p.clave} type="button" className={styles.ficha} onClick={p.quitar} aria-label={`Quitar: ${etiquetaChip(p)}`}>
              {etiquetaChip(p)}
              <Icon name="x" size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        <span className={styles.cuenta}>
          <strong>{total.toLocaleString('es-AR')}</strong> {total === 1 ? 'producto' : 'productos'}
        </span>
      </div>

      {activo ? (
        <div className={styles.pregunta}>
          <p className={styles.textoPregunta}>
            {activo.pregunta} <span className={styles.pista}>{activo.pista}</span>
          </p>
          <div className={styles.tiles} role="group" aria-label={activo.pregunta}>
            {visibles.map((o) => (
              <button
                key={o.valor}
                type="button"
                className={cx(styles.tile, o.medio === null && styles.tileTexto)}
                onClick={() => activo.elegir(o.valor)}
              >
                {o.medio}
                <span className={styles.etiqueta}>{o.etiqueta}</span>
                <span className={styles.cantidad}>{o.cantidad.toLocaleString('es-AR')}</span>
              </button>
            ))}
            {ocultas > 0 ? (
              <button type="button" className={styles.masOpciones} onClick={() => setExpandido(true)}>
                +{ocultas} más
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className={styles.listo}>
          <Icon name="check" size={16} aria-hidden="true" />
          Listo. Mirá los resultados abajo, o sacá un filtro para ampliar.
        </p>
      )}
    </section>
  )
}
