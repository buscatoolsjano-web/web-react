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
const fotoDeGrupo = (categoria: string | undefined, grupo: string): string | undefined =>
  categoria ? (fotos as Record<string, { grupo?: Record<string, string> }>)[categoria]?.grupo?.[grupo] : undefined

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
  // El grupo elegido vive en memoria (no va a la URL): es sólo el camino al
  // tipo. Si ya hay un tipo puesto, el grupo se deduce de él.
  const [grupoSel, setGrupoSel] = useState('')
  const tipos = facetas?.tipos ?? []
  const gruposPresentes = GRUPOS.filter((g) => tipos.some((t) => grupoDe(t.nombre) === g.clave))
  // Con un solo grupo no se pregunta «¿punta o tubo?», pero igual se listan sus
  // tipos: así Atornilladores, Accesorios… también muestran el paso de tipo con
  // su foto, en vez de saltar directo al encastre.
  const grupoUnico = gruposPresentes.length === 1 ? (gruposPresentes[0]?.clave ?? '') : ''
  const grupoActual = tipo !== '' ? grupoDe(tipo) : grupoSel !== '' ? grupoSel : grupoUnico

  const pasos: Paso[] = []

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
          // La portada que un admin eligió gana (Fase 142); si no hay, la foto
          // del JSON generado, y al final la forma dibujada.
          <Medio foto={c.portadaUrl ?? fotoDeCategoria(c.slug)} forma={iconoDeForma(c.nombre)} nombre={c.nombre} />
        ),
      })),
    })
  } else {
    // ── Grupo ────────────────────────────────────────────────────────────────
    if (gruposPresentes.length > 1) {
      pasos.push({
        clave: 'grupo',
        pregunta: '¿Punta o tubo?',
        pista: 'elegí el grupo y se desglosa',
        elegido: grupoActual,
        elegir: (v) => {
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
            medio: <Medio foto={fotoDeGrupo(categoria, g.clave)} forma={iconoDeForma(delGrupo[0]?.nombre ?? g.label)} nombre={g.label} />,
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

  // Se muestran TODAS las opciones, sin «+N más» (pedido del usuario: que nunca
  // aparezca en ningún filtro). Los tiles llenan el ancho a cualquier cantidad.
  //
  // Y se ORDENAN: en los subfiltros (tipo, encastre, medida, largo) de la A a la
  // Z y de menor a mayor —orden natural, para que «2» vaya antes que «10» y no
  // detrás—. La categoría y el grupo se dejan como vienen (por cantidad): son
  // pocos y esa es una buena portada.
  const ordenable = activo !== undefined && activo.clave !== 'categoria' && activo.clave !== 'grupo'
  const visibles = activo
    ? ordenable
      ? [...activo.opciones].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))
      : activo.opciones
    : []

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
