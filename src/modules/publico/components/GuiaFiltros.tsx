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

/**
 * Preguntas lindas para los atributos conocidos; para el resto se arma una del
 * label (Fase 204). Antes la lista estaba cableada a encastre/medida/largo y
 * cualquier otra categoría —balanceadores, por ejemplo— no ofrecía ni un filtro
 * guiado. Ahora los pasos salen de las facetas reales de la categoría.
 */
const PREGUNTAS: Record<string, { pregunta: string; pista: string }> = {
  encastre: { pregunta: '¿Qué encastre?', pista: 'la conexión a la máquina' },
  medida: { pregunta: '¿Qué medida?', pista: 'el diámetro o calibre' },
  largo: { pregunta: '¿Qué largo?', pista: 'el largo total' },
}

/**
 * Debajo de este número de productos un rubro se considera «chico» y se junta
 * detrás de «Más rubros» en el primer paso (Fase 181): así se ven pocos tiles
 * de entrada y el resto se despliega al tocarlo. No cambia la taxonomía —cada
 * producto sigue en su rubro—, sólo cuántos rubros se muestran de una.
 */
const UMBRAL_RUBRO = 150
/** El valor sentinela del tile «Más rubros»: no es un rubro, despliega el resto. */
const MAS_RUBROS = '__mas_rubros__'

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
  // Si el usuario pidió ver todos los rubros (tocó «Más rubros»).
  const [rubrosExpandidos, setRubrosExpandidos] = useState(false)
  const tipos = facetas?.tipos ?? []
  const gruposPresentes = GRUPOS.filter((g) => tipos.some((t) => grupoDe(t.nombre) === g.clave))
  // Con un solo grupo no se pregunta «¿punta o tubo?», pero igual se listan sus
  // tipos: así Atornilladores, Accesorios… también muestran el paso de tipo con
  // su foto, en vez de saltar directo al encastre.
  const grupoUnico = gruposPresentes.length === 1 ? (gruposPresentes[0]?.clave ?? '') : ''
  const grupoActual = tipo !== '' ? grupoDe(tipo) : grupoSel !== '' ? grupoSel : grupoUnico

  const pasos: Paso[] = []

  if (!categoria) {
    // Los rubros chicos se juntan detrás de «Más rubros» (Fase 181), salvo que
    // ya se haya pedido verlos todos. Con uno solo chico no vale la pena.
    const chicos = categorias.filter((c) => c.productos < UMBRAL_RUBRO)
    const colapsar = chicos.length > 1 && !rubrosExpandidos
    const visibles = colapsar ? categorias.filter((c) => c.productos >= UMBRAL_RUBRO) : categorias
    const tile = (c: CategoriaPublica): Opcion => ({
      valor: c.slug,
      etiqueta: c.nombre,
      cantidad: c.productos,
      // La portada que un admin eligió gana (Fase 142); si no hay, la foto del
      // JSON generado, y al final la forma dibujada.
      medio: <Medio foto={c.portadaUrl ?? fotoDeCategoria(c.fotoSlug ?? c.slug)} forma={iconoDeForma(c.nombre)} nombre={c.nombre} />,
    })
    const opciones: Opcion[] = visibles.map(tile)
    if (colapsar) {
      opciones.push({
        valor: MAS_RUBROS,
        etiqueta: 'Más rubros',
        cantidad: chicos.reduce((n, c) => n + c.productos, 0),
        medio: <Medio foto={undefined} forma={iconoDeForma('más rubros')} nombre="Más rubros" />,
      })
    }
    pasos.push({
      clave: 'categoria',
      pregunta: '¿Qué estás buscando?',
      pista: 'elegí un rubro para empezar',
      elegido: '',
      // «Más rubros» no navega: despliega los chicos en este mismo paso.
      elegir: (v) => (v === MAS_RUBROS ? setRubrosExpandidos(true) : onCategoria(v)),
      quitar: () => onCategoria(''),
      opciones,
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

    // ── Atributos de LISTA de la categoría, en su orden (data-driven, Fase 204) ──
    // Se recorren los atributos que las facetas traen para ESTA categoría —así
    // Puntas sigue dando encastre/medida/largo y Balanceadores da carcasa,
    // eslinga, largo de cable…—. Los de RANGO (numéricos de muchos valores, como
    // la capacidad en kg) no se eligen con tiles; se filtran aparte y acá se
    // saltean.
    for (const faceta of facetas?.atributos ?? []) {
      // Rango explícito (lo marca el ERP) o demasiados valores para tiles: no
      // va como lista. El tope cubre al sitio público, cuyas facetas no traen
      // `clase`, para que un numérico de decenas de valores no explote en tiles.
      if (faceta.clase === 'range' || faceta.opciones.length > 24) continue
      const puesto = atributos[faceta.key] ?? ''
      if (faceta.opciones.length <= 1 && puesto === '') continue
      const u = faceta.unidad ? ` ${faceta.unidad}` : ''
      const texto = PREGUNTAS[faceta.key] ?? {
        pregunta: `¿${faceta.label}?`,
        pista: '',
      }
      pasos.push({
        clave: `a.${faceta.key}`,
        pregunta: texto.pregunta,
        pista: PREGUNTAS[faceta.key] && faceta.unidad ? `${texto.pista} (${faceta.unidad})` : texto.pista,
        elegido: puesto,
        elegir: (v) => {
          onFiltrar(`a.${faceta.key}`, v)
        },
        quitar: () => onFiltrar(`a.${faceta.key}`, ''),
        opciones: faceta.opciones.map((o) => ({
          valor: o.valor,
          etiqueta: `${o.valor}${u}`,
          cantidad: o.cuantos,
          medio: faceta.key === 'encastre' ? <span className={styles.forma} aria-hidden="true">{iconoDeEncastre(o.valor)}</span> : null,
        })),
      })
    }
  }

  const activo = pasos.find((p) => p.elegido === '')
  const respondidos = pasos.filter((p) => p.elegido !== '')

  // Volver un paso (Fase 180): deshace lo último respondido; si no hay nada
  // respondido pero hay una categoría puesta, la deselecciona (vuelve a los
  // rubros). Así siempre hay una forma de retroceder DENTRO del recuadro.
  const puedeVolver = respondidos.length > 0 || categoria !== undefined
  const volver = () => {
    const ultimo = respondidos[respondidos.length - 1]
    if (ultimo) ultimo.quitar()
    else if (categoria !== undefined) onCategoria('')
  }

  // Sin pasos y sin categoría no hay nada que mostrar. Pero si hay una
  // categoría puesta aunque no tenga subfiltros, igual se muestra el recuadro
  // con «Volver» y la cuenta, para poder retroceder desde cualquier rubro.
  if (pasos.length === 0 && !puedeVolver) return null

  // Se muestran TODAS las opciones, sin «+N más» (pedido del usuario: que nunca
  // aparezca en ningún filtro). Los tiles llenan el ancho a cualquier cantidad.
  //
  // Y se ORDENAN: en los subfiltros (tipo, encastre, medida, largo) de la A a la
  // Z y de menor a mayor —orden natural, para que «2» vaya antes que «10» y no
  // detrás—. La categoría y el grupo se dejan como vienen (por cantidad): son
  // pocos y esa es una buena portada.
  // Si TODAS las opciones son números, se ordenan por su valor real. Se mira el
  // `valor` crudo («1.6»), NO la etiqueta («1.6 m»), que lleva la unidad y nunca
  // parsea. Y no alcanza el `localeCompare(numeric:true)`: con decimales parte
  // en el punto y compara la parte decimal como entero, así que ponía «1.6»
  // antes que «1.35» (6 < 35). Con valores mezclados (encastre «1/4», medidas)
  // sí sirve el natural, que mantiene «2» antes que «10».
  const esNumero = (s: string) => /^-?\d+(?:[.,]\d+)?$/.test(s.trim())
  const aNumero = (s: string) => Number(s.trim().replace(',', '.'))
  const ordenarOpciones = (ops: readonly Opcion[]): Opcion[] => {
    const todosNumericos = ops.length > 0 && ops.every((o) => esNumero(o.valor))
    return [...ops].sort((a, b) =>
      todosNumericos
        ? aNumero(a.valor) - aNumero(b.valor)
        : a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }),
    )
  }

  const ordenable = activo !== undefined && activo.clave !== 'categoria' && activo.clave !== 'grupo'
  const visibles = activo ? (ordenable ? ordenarOpciones(activo.opciones) : activo.opciones) : []

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
        {puedeVolver ? (
          <button type="button" className={styles.volver} onClick={volver}>
            <Icon name="chevron-left" size={16} aria-hidden="true" />
            Volver
          </button>
        ) : null}
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
      ) : cargando ? (
        // Cargando los filtros de la categoría recién elegida (Fase 206): antes
        // acá se veían los filtros de la categoría ANTERIOR hasta que llegaban
        // los nuevos. Ahora se dice que está cargando, y la transición se siente
        // intencional en vez de un cambio brusco de filtros equivocados.
        <p className={styles.listo} aria-live="polite">
          <Icon name="search" size={16} aria-hidden="true" />
          Buscando los filtros…
        </p>
      ) : (
        <p className={styles.listo}>
          <Icon name="check" size={16} aria-hidden="true" />
          Listo. Mirá los resultados abajo, o sacá un filtro para ampliar.
        </p>
      )}
    </section>
  )
}
