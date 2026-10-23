import { useMemo, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import { GRUPOS, grupoDe } from '@/modules/publico/lib/grupos'
import fotos from '@/modules/publico/lib/fotosDeOpcion.generated.json'
import { useFacetas } from '../hooks/useCatalogoFacetas'
import { atributosDeLaCategoria } from '../lib/nuevoProducto'
import { FILTROS_INICIALES, type CategoriaResumen, type DefinicionAtributo } from '../types'
import styles from './AltaGuiada.module.css'

/**
 * Alta de producto GUIADA (Fase 131).
 *
 * «Que sea como los filtros de la web: aparecen las categorías con fotos y vas
 * eligiendo.» Mismo recorrido que la guía del sitio público, pero en vez de
 * filtrar, cada elección CARGA un dato del producto nuevo:
 *
 *   Categoría → grupo (punta/tubo) → tipo (Phillips…) → encastre → medida →
 *   largo → …
 *
 * El grupo es sólo el camino (no es un campo); el tipo va a `product_type` y
 * cada atributo de la categoría se va completando. Al terminar, el formulario
 * de siempre queda con la categoría, el tipo y los atributos ya puestos, y sólo
 * falta marca, modelo (que arman la referencia solos) y lo opcional.
 *
 * Cada paso ofrece lo que YA existe como botones; y un «Otro…» para escribir un
 * valor nuevo, así el alta no queda limitada a lo cargado.
 */

/** Lo que el flujo guiado deja listo para el formulario. */
export interface ResultadoAltaGuiada {
  categoriaId: string
  tipo: string
  atributos: Record<string, string>
}

interface OpcionTile {
  valor: string
  etiqueta: string
  foto: string | undefined
}

const fotoCategoria = (slug: string): string | undefined =>
  (fotos as Record<string, { portada?: string }>)[slug]?.portada
const fotoTipo = (slug: string | undefined, tipo: string): string | undefined =>
  slug ? (fotos as Record<string, { tipo?: Record<string, string> }>)[slug]?.tipo?.[tipo] : undefined
const fotoGrupo = (slug: string | undefined, grupo: string): string | undefined =>
  slug ? (fotos as Record<string, { grupo?: Record<string, string> }>)[slug]?.grupo?.[grupo] : undefined

export function AltaGuiada({
  companyId,
  categorias,
  definiciones,
  porCategoria,
  onListo,
  onSaltar,
}: {
  companyId: string | null
  categorias: readonly CategoriaResumen[]
  definiciones: readonly DefinicionAtributo[]
  porCategoria: ReadonlyMap<string, ReadonlySet<string>> | undefined
  onListo: (r: ResultadoAltaGuiada) => void
  onSaltar: () => void
}) {
  const [categoriaId, setCategoriaId] = useState('')
  const [grupo, setGrupo] = useState('')
  const [tipo, setTipo] = useState('')
  const [atributos, setAtributos] = useState<Record<string, string>>({})
  // El paso de atributos que se está respondiendo (0 = el primero).
  const [idxAtributo, setIdxAtributo] = useState(0)
  // Cuando se toca «Otro…», se muestra el campo de texto de ESE paso.
  const [escribiendo, setEscribiendo] = useState(false)
  const [textoOtro, setTextoOtro] = useState('')

  const cat = categorias.find((c) => c.id === categoriaId) ?? null
  const slug = cat?.slug

  // Los tipos (product_type) que ya existen en la categoría salen de las
  // facetas, acotadas a esa categoría (su id, que es como filtra el ERP).
  const { data: facetas } = useFacetas(categoriaId === '' ? null : companyId, {
    ...FILTROS_INICIALES,
    categoria: categoriaId === '' ? null : categoriaId,
  })

  const tiposDeCategoria = facetas?.subtipos ?? []
  const gruposPresentes = GRUPOS.filter((g) => tiposDeCategoria.some((t) => grupoDe(t.valor) === g.clave))
  const grupoUnico = gruposPresentes.length === 1 ? (gruposPresentes[0]?.clave ?? '') : ''
  const grupoActual = tipo !== '' ? grupoDe(tipo) : grupo !== '' ? grupo : grupoUnico

  // Los atributos a preguntar, en orden, para la categoría elegida.
  const atributosCat = useMemo(
    () => atributosDeLaCategoria(definiciones, categoriaId, porCategoria),
    [definiciones, categoriaId, porCategoria],
  )

  const reiniciarEntrada = () => { setEscribiendo(false); setTextoOtro('') }

  // ── Qué paso toca ─────────────────────────────────────────────────────────
  // 1) categoría, 2) grupo (si hay más de uno), 3) tipo, 4..) cada atributo.
  let paso: { clave: string; pregunta: string; pista: string; opciones: OpcionTile[]; elegir: (v: string) => void }

  if (categoriaId === '') {
    paso = {
      clave: 'categoria',
      pregunta: '¿Qué estás cargando?',
      pista: 'elegí el rubro',
      opciones: categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre, foto: fotoCategoria(c.slug) })),
      elegir: (v) => { setCategoriaId(v); reiniciarEntrada() },
    }
  } else if (gruposPresentes.length > 1 && grupo === '' && tipo === '') {
    paso = {
      clave: 'grupo',
      pregunta: '¿Punta o tubo?',
      pista: 'elegí el grupo',
      opciones: gruposPresentes.map((g) => ({ valor: g.clave, etiqueta: g.label, foto: fotoGrupo(slug, g.clave) })),
      elegir: (v) => { setGrupo(v); reiniciarEntrada() },
    }
  } else if (tipo === '' && grupoActual !== '') {
    const delGrupo = tiposDeCategoria.filter((t) => grupoDe(t.valor) === grupoActual)
    paso = {
      clave: 'tipo',
      pregunta: '¿Qué tipo?',
      pista: 'la pieza puntual',
      opciones: delGrupo.map((t) => ({ valor: t.valor, etiqueta: t.valor, foto: fotoTipo(slug, t.valor) })),
      elegir: (v) => { setTipo(v); reiniciarEntrada() },
    }
  } else if (idxAtributo < atributosCat.length) {
    const def = atributosCat[idxAtributo]!
    const u = def.unidad ? ` ${def.unidad}` : ''
    paso = {
      clave: `a.${def.key}`,
      pregunta: `¿${def.label}?`,
      pista: def.unidad ? `en ${def.unidad}` : 'elegí o escribí el valor',
      opciones: def.opciones.map((v) => ({ valor: v, etiqueta: `${v}${u}`, foto: undefined })),
      elegir: (v) => { setAtributos((a) => ({ ...a, [def.key]: v })); setIdxAtributo((i) => i + 1); reiniciarEntrada() },
    }
  } else {
    // Todo respondido: se entrega. (Se hace en un efecto-less: botón «Listo».)
    paso = { clave: 'fin', pregunta: '', pista: '', opciones: [], elegir: () => {} }
  }

  const terminado = paso.clave === 'fin'

  // Las elecciones ya hechas, como fichas que se pueden deshacer.
  const fichas: { clave: string; texto: string; quitar: () => void }[] = []
  if (categoriaId !== '') fichas.push({ clave: 'cat', texto: cat?.nombre ?? '', quitar: () => { setCategoriaId(''); setGrupo(''); setTipo(''); setAtributos({}); setIdxAtributo(0); reiniciarEntrada() } })
  if (grupo !== '' && tipo === '') fichas.push({ clave: 'grp', texto: GRUPOS.find((g) => g.clave === grupo)?.label ?? grupo, quitar: () => { setGrupo(''); reiniciarEntrada() } })
  if (tipo !== '') fichas.push({ clave: 'tipo', texto: tipo, quitar: () => { setTipo(''); setGrupo(''); reiniciarEntrada() } })
  atributosCat.slice(0, idxAtributo).forEach((def) => {
    if (atributos[def.key] !== undefined) {
      fichas.push({
        clave: def.key,
        texto: `${def.label}: ${atributos[def.key]}`,
        quitar: () => {
          setAtributos((a) => { const n = { ...a }; delete n[def.key]; return n })
          setIdxAtributo(atributosCat.findIndex((d) => d.key === def.key))
          reiniciarEntrada()
        },
      })
    }
  })

  const confirmarOtro = () => {
    const v = textoOtro.trim()
    if (v === '') return
    paso.elegir(v)
  }

  return (
    <div className={styles.guia}>
      <div className={styles.cabecera}>
        <p className={styles.titulo}>Cargá el producto paso a paso</p>
        <button type="button" className={styles.saltar} onClick={onSaltar}>
          Prefiero el formulario
        </button>
      </div>

      {fichas.length > 0 ? (
        <div className={styles.fichas}>
          {fichas.map((f) => (
            <button key={f.clave} type="button" className={styles.ficha} onClick={f.quitar} aria-label={`Cambiar: ${f.texto}`}>
              {f.texto}
              <Icon name="x" size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {terminado ? (
        <div className={styles.fin}>
          <span className={styles.finIcono} aria-hidden="true"><Icon name="check" size={24} /></span>
          <p className={styles.finTexto}>Listo. Ahora poné la marca y el modelo.</p>
          <button
            type="button"
            className={styles.continuar}
            onClick={() => onListo({ categoriaId, tipo, atributos })}
          >
            Continuar
            <Icon name="arrow-right" size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className={styles.pregunta}>
          <p className={styles.textoPregunta}>
            {paso.pregunta} <span className={styles.pista}>{paso.pista}</span>
          </p>

          {escribiendo ? (
            <div className={styles.otro}>
              <input
                className={styles.otroInput}
                value={textoOtro}
                autoFocus
                placeholder="Escribí el valor nuevo…"
                onChange={(e) => setTextoOtro(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarOtro() } }}
              />
              <button type="button" className={styles.otroOk} onClick={confirmarOtro} disabled={textoOtro.trim() === ''}>
                Usar
              </button>
              <button type="button" className={styles.otroCancelar} onClick={reiniciarEntrada}>
                Volver
              </button>
            </div>
          ) : (
            <div className={styles.tiles} role="group" aria-label={paso.pregunta}>
              {paso.opciones.map((o) => (
                <button key={o.valor} type="button" className={cx(styles.tile, !o.foto && styles.tileTexto)} onClick={() => paso.elegir(o.valor)}>
                  {o.foto ? (
                    <img src={o.foto} alt="" loading="lazy" width={48} height={48} className={styles.tileFoto} />
                  ) : null}
                  <span className={styles.tileEtiqueta}>{o.etiqueta}</span>
                </button>
              ))}
              {/* Siempre se puede escribir un valor nuevo (menos en el paso de
                  categoría, que se elige de las que existen). */}
              {paso.clave !== 'categoria' ? (
                <button type="button" className={cx(styles.tile, styles.tileOtro)} onClick={() => setEscribiendo(true)}>
                  <Icon name="plus" size={20} aria-hidden="true" />
                  <span className={styles.tileEtiqueta}>Otro…</span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
