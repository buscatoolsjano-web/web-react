import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import type { CategoriaPublica, FacetasPublicas } from '../services/catalogoPublico'
import { iconoDeEncastre, iconoDeForma } from '../lib/iconosDeForma'
import fotos from '../lib/fotosDeOpcion.generated.json'
import styles from './GuiaFiltros.module.css'

/**
 * El filtro guiado (Fase 90).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 *
 * «Que los filtros sean más dinámicos, visuales e intuitivos. Que al entrar a
 * una categoría te vaya preguntando y según lo que respondés aparezcan los
 * filtros, pero que ocupe poco.»
 *
 * En vez de catorce desplegables, UNA pregunta a la vez con tiles —foto real
 * cuando la hay, forma dibujada cuando no—. Lo respondido queda como una ficha
 * chica que se puede sacar, y la cuenta de arriba baja a medida que se afina.
 *
 * ── CONVIVE, NO REEMPLAZA ───────────────────────────────────────────────────
 *
 * Esto va ARRIBA de la tabla, como entrada rápida y visual. La tabla y sus
 * filtros de columna siguen abajo para quien quiere control fino. Las dos
 * escriben el mismo estado en la URL, así que coinciden siempre.
 *
 * ── DATA-DRIVEN, SIN INVENTAR ───────────────────────────────────────────────
 *
 * Las preguntas y sus opciones salen de `catalogo_publico_facetas` —los tipos
 * y el encastre reales de la categoría, con sus cantidades—. Ninguna opción
 * está escrita a mano. Sin categoría, la primera pregunta es el rubro.
 */

/** Cuántas opciones se muestran antes del «ver más». */
const TOPE_VISIBLE = 8

export interface GuiaFiltrosProps {
  categoria: string | undefined
  categorias: readonly CategoriaPublica[]
  facetas: FacetasPublicas | undefined
  /** Lo elegido hoy: `tipo` y los atributos (encastre…). */
  tipo: string
  atributos: Record<string, string>
  total: number
  cargando: boolean
  /** Escribe un filtro en la URL: `('tipo', v)` o `('a.encastre', v)`. */
  onFiltrar: (clave: string, valor: string) => void
  /** Entra a una categoría (cambia la ruta). */
  onCategoria: (slug: string) => void
}

interface Opcion {
  valor: string
  etiqueta: string
  cantidad: number
  medio: ReactNode
}

interface Paso {
  clave: string
  pregunta: string
  pista: string
  elegido: string
  opciones: Opcion[]
}

const fotoDe = (categoria: string | undefined, dimension: 'tipo', valor: string): string | undefined => {
  if (!categoria) return undefined
  const cat = (fotos as Record<string, { tipo?: Record<string, string> }>)[categoria]
  return cat?.[dimension]?.[valor]
}

function TileMedio({ foto, forma, nombre }: { foto: string | undefined; forma: ReactNode; nombre: string }) {
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

  // ── Armar los pasos desde los datos ──────────────────────────────────────
  const pasos: Paso[] = []

  if (!categoria) {
    pasos.push({
      clave: 'categoria',
      pregunta: '¿Qué estás buscando?',
      pista: 'elegí un rubro para empezar',
      elegido: '',
      opciones: categorias.map((c) => ({
        valor: c.slug,
        etiqueta: c.nombre,
        cantidad: c.productos,
        medio: <span className={styles.forma} aria-hidden="true">{iconoDeForma(c.nombre)}</span>,
      })),
    })
  } else {
    const tipos = facetas?.tipos ?? []
    if (tipos.length > 1 || tipo !== '') {
      pasos.push({
        clave: 'tipo',
        pregunta: '¿Qué tipo de pieza?',
        pista: 'la herramienta o la punta',
        elegido: tipo,
        opciones: tipos.map((t) => ({
          valor: t.nombre,
          etiqueta: t.nombre,
          cantidad: t.cuantos,
          medio: (
            <TileMedio
              foto={fotoDe(categoria, 'tipo', t.nombre)}
              forma={iconoDeForma(t.nombre)}
              nombre={t.nombre}
            />
          ),
        })),
      })
    }
    const encastre = (facetas?.atributos ?? []).find((a) => a.key === 'encastre')
    if (encastre && (encastre.opciones.length > 1 || atributos['encastre'])) {
      pasos.push({
        clave: 'a.encastre',
        pregunta: '¿Qué encastre?',
        pista: 'la conexión a la máquina',
        elegido: atributos['encastre'] ?? '',
        opciones: encastre.opciones.map((o) => ({
          valor: o.valor,
          etiqueta: o.valor,
          cantidad: o.cuantos,
          medio: <span className={styles.forma} aria-hidden="true">{iconoDeEncastre(o.valor)}</span>,
        })),
      })
    }
  }

  // El paso ACTIVO: el primero sin responder. Si están todos, no hay pregunta.
  const activo = pasos.find((p) => p.elegido === '')
  const respondidos = pasos.filter((p) => p.elegido !== '')

  if (pasos.length === 0) return null

  const visibles = activo
    ? expandido
      ? activo.opciones
      : activo.opciones.slice(0, TOPE_VISIBLE)
    : []
  const ocultas = activo ? activo.opciones.length - visibles.length : 0

  const elegir = (paso: Paso, valor: string) => {
    setExpandido(false)
    if (paso.clave === 'categoria') onCategoria(valor)
    else onFiltrar(paso.clave, valor)
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
            <button
              key={p.clave}
              type="button"
              className={styles.ficha}
              onClick={() => (p.clave === 'categoria' ? onCategoria('') : onFiltrar(p.clave, ''))}
              aria-label={`Quitar: ${p.elegido}`}
            >
              {p.elegido}
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
                className={cx(styles.tile, o.valor === activo.elegido && styles.tileActivo)}
                onClick={() => elegir(activo, o.valor)}
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
