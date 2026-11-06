import { useMemo, useState } from 'react'
import { Icon } from '@/components/icons/Icon'
import { cx } from '@/utils/cx'
import { GRUPOS, grupoDe } from '@/modules/publico/lib/grupos'
import fotos from '@/modules/publico/lib/fotosDeOpcion.generated.json'
import { useFacetas, usePortadasPublicas } from '../hooks/useCatalogoFacetas'
import { guardarOpcionDeAtributo } from '../services/facetas'
import { slugGuia } from '../lib/adaptarGuia'
import { atributosDeLaCategoria } from '../lib/nuevoProducto'
import { FILTROS_INICIALES, type CategoriaResumen, type DefinicionAtributo, type MarcaResumen } from '../types'
import styles from './AltaGuiada.module.css'

/**
 * Atributos que la guía NO pregunta como atributo.
 *
 * `marca_disp` y `modelo` son la marca y el modelo, que tienen su propio paso
 * —al principio, porque son lo que identifica al producto— y su campo en el
 * formulario: preguntarlos también como atributo (al final, con 99 modelos de
 * otros productos como botones) los hacía cargar dos veces. Y `*_raw` es la
 * copia del dato tal cual vino del import («Longitud (original)»), que repite
 * al atributo bueno («Long. cable»).
 */
const NO_SE_PREGUNTAN = new Set(['marca_disp', 'modelo'])

/**
 * Los valores de un paso, de menor a mayor. La faceta los trae por cuántos
 * productos los usan, y así salían «0.2, 1.2, 10, 100, 115, 12»: para elegir
 * una medida hay que verlas en orden. Los que empiezan con un número (`2.5
 * MTS`, `1/4"`, `0,75`) van por ese número; el resto, alfabético.
 */
const numeroInicial = (v: string): number | null => {
  const m = /^\s*(\d+)\s*\/\s*(\d+)|^\s*(\d+(?:[.,]\d+)?)/.exec(v)
  if (!m) return null
  if (m[1] !== undefined && m[2] !== undefined) return Number(m[1]) / Number(m[2])
  return Number((m[3] ?? '').replace(',', '.'))
}
const enOrden = (valores: readonly string[]): string[] =>
  [...valores].sort((a, b) => {
    const na = numeroInicial(a)
    const nb = numeroInicial(b)
    if (na !== null && nb !== null && na !== nb) return na - nb
    if (na !== null && nb === null) return -1
    if (na === null && nb !== null) return 1
    return a.localeCompare(b, 'es', { numeric: true })
  })
const seAPreguntaEnLaGuia = (key: string): boolean => !NO_SE_PREGUNTAN.has(key) && !key.endsWith('_raw')

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
  /** `''` si se omitió: se elige en el formulario. */
  marcaId: string
  /** `''` si se omitió. */
  modelo: string
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
  marcas,
  definiciones,
  porCategoria,
  onListo,
  onSaltar,
}: {
  companyId: string | null
  categorias: readonly CategoriaResumen[]
  /** Todas las marcas de la empresa, para «Otra…» en el paso de marca. */
  marcas: readonly MarcaResumen[]
  definiciones: readonly DefinicionAtributo[]
  porCategoria: ReadonlyMap<string, ReadonlySet<string>> | undefined
  onListo: (r: ResultadoAltaGuiada) => void
  onSaltar: () => void
}) {
  const [categoriaId, setCategoriaId] = useState('')
  const [grupo, setGrupo] = useState('')
  const [tipo, setTipo] = useState('')
  const [marcaId, setMarcaId] = useState('')
  const [modelo, setModelo] = useState('')
  // «Decidido» = elegido u omitido: con eso el paso queda atrás.
  const [marcaDecidida, setMarcaDecidida] = useState(false)
  const [modeloDecidido, setModeloDecidido] = useState(false)
  const [atributos, setAtributos] = useState<Record<string, string>>({})
  // El paso de atributos que se está respondiendo (0 = el primero).
  const [idxAtributo, setIdxAtributo] = useState(0)
  // Cuando se toca «Otro…», se muestra el campo de texto de ESE paso.
  const [escribiendo, setEscribiendo] = useState(false)
  const [textoOtro, setTextoOtro] = useState('')

  const cat = categorias.find((c) => c.id === categoriaId) ?? null
  // La guía habla en slug público (plural), que es con el que matchean las
  // fotos —igual que el catálogo (Fase 174) y la web—. Ver `slugGuia`.
  const slug = cat ? slugGuia(cat) : undefined

  // Las portadas que un admin eligió para el catálogo público, para que los
  // rubros se vean con la MISMA foto que en el catálogo y en la web (Fase 178).
  const portadas = usePortadasPublicas()
  const portadasPorSlug = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of portadas.data ?? []) if (c.portadaUrl) m.set(c.slug, c.portadaUrl)
    return m
  }, [portadas.data])

  // Las facetas, acotadas al filtro ACTUAL —categoría, tipo y lo ya elegido—,
  // igual que el filtro guiado del catálogo. De acá salen los tipos del paso de
  // «tipo» y, para cada atributo, SÓLO los valores que ya existen dentro de esa
  // selección. El pedido que lo motivó: en «Puntas y tubos» + «Torx» tienen que
  // aparecer los 11 encastres reales, no todo el catálogo de encastres.
  const filtroFacetas = useMemo(
    () => ({
      ...FILTROS_INICIALES,
      categoria: categoriaId === '' ? null : categoriaId,
      subtipos: tipo === '' ? [] : [tipo],
      atributos: Object.fromEntries(Object.entries(atributos).map(([k, v]) => [k, [v]])),
    }),
    [categoriaId, tipo, atributos],
  )
  const { data: facetas } = useFacetas(categoriaId === '' ? null : companyId, filtroFacetas)

  const tiposDeCategoria = facetas?.subtipos ?? []
  const gruposPresentes = GRUPOS.filter((g) => tiposDeCategoria.some((t) => grupoDe(t.valor) === g.clave))
  const grupoUnico = gruposPresentes.length === 1 ? (gruposPresentes[0]?.clave ?? '') : ''
  const grupoActual = tipo !== '' ? grupoDe(tipo) : grupo !== '' ? grupo : grupoUnico

  // Los atributos a preguntar, en orden, para la categoría elegida.
  const atributosCat = useMemo(
    () => atributosDeLaCategoria(definiciones, categoriaId, porCategoria).filter((d) => seAPreguntaEnLaGuia(d.key)),
    [definiciones, categoriaId, porCategoria],
  )

  const reiniciarEntrada = () => { setEscribiendo(false); setTextoOtro('') }
  const nombreDeMarca = (id: string) => marcas.find((m) => m.id === id)?.nombre ?? ''

  // ── Qué paso toca ─────────────────────────────────────────────────────────
  // 1) categoría, 2) grupo (si hay más de uno), 3) tipo, 4) marca, 5) modelo,
  // 6..) cada atributo.
  let paso: {
    clave: string
    pregunta: string
    pista: string
    opciones: OpcionTile[]
    elegir: (v: string) => void
    omitir?: () => void
  }

  if (categoriaId === '') {
    paso = {
      clave: 'categoria',
      pregunta: '¿Qué estás cargando?',
      pista: 'elegí el rubro',
      opciones: categorias.map((c) => ({
        valor: c.id,
        etiqueta: c.nombre,
        foto: portadasPorSlug.get(slugGuia(c)) ?? fotoCategoria(slugGuia(c)),
      })),
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
  } else if (!marcaDecidida) {
    // Las marcas que ya hay en el rubro (y tipo) elegido, como los demás pasos;
    // si el rubro no tiene ninguna, todas. «Otra…» abre la lista completa.
    const enElRubro = facetas?.marcas ?? []
    const elegirMarca = (v: string) => { setMarcaId(v); setMarcaDecidida(true); reiniciarEntrada() }
    paso = {
      clave: 'marca',
      pregunta: '¿Qué marca?',
      pista: enElRubro.length > 0 ? 'las que ya hay en este rubro' : 'elegí la marca',
      opciones:
        enElRubro.length > 0
          ? enElRubro.map((m) => ({ valor: m.valor, etiqueta: m.etiqueta, foto: undefined }))
          : marcas.map((m) => ({ valor: m.id, etiqueta: m.nombre, foto: undefined })),
      elegir: elegirMarca,
      omitir: () => { setMarcaDecidida(true); reiniciarEntrada() },
    }
  } else if (!modeloDecidido) {
    // El modelo es de ESTE producto: no se elige de los de otros, se escribe.
    paso = {
      clave: 'modelo',
      pregunta: '¿Qué modelo?',
      pista: 'escribilo: la referencia sale de él',
      opciones: [],
      elegir: (v) => { setModelo(v); setModeloDecidido(true); reiniciarEntrada() },
      omitir: () => { setModeloDecidido(true); reiniciarEntrada() },
    }
  } else if (idxAtributo < atributosCat.length) {
    const def = atributosCat[idxAtributo]!
    const u = def.unidad ? ` ${def.unidad}` : ''
    // Sólo los valores que YA existen dentro del filtro actual (categoría +
    // tipo + lo ya elegido), de la faceta —como el filtro guiado del catálogo—.
    // Si el atributo no es filtrable no tiene faceta: ahí se ofrecen los
    // definidos. Y siempre queda «Otro…» para escribir uno nuevo a mano.
    const faceta = facetas?.atributos?.find((a) => a.key === def.key && a.clase === 'enum')
    const valores = enOrden(faceta?.opciones.length ? faceta.opciones.map((o) => o.valor) : def.opciones)
    paso = {
      clave: `a.${def.key}`,
      pregunta: `¿${def.label}?`,
      pista: def.unidad ? `en ${def.unidad}` : 'elegí o escribí el valor',
      opciones: valores.map((v) => ({ valor: v, etiqueta: `${v}${u}`, foto: undefined })),
      elegir: (v) => {
        setAtributos((a) => ({ ...a, [def.key]: v }))
        setIdxAtributo((i) => i + 1)
        reiniciarEntrada()
        if (companyId && def.id && !def.opciones.includes(v)) void guardarOpcionDeAtributo(companyId, def.id, v)
      },
      omitir: () => { setIdxAtributo((i) => i + 1); reiniciarEntrada() },
    }
  } else {
    // Todo respondido: se entrega. (Se hace en un efecto-less: botón «Listo».)
    paso = { clave: 'fin', pregunta: '', pista: '', opciones: [], elegir: () => {} }
  }

  const terminado = paso.clave === 'fin'

  // Las elecciones ya hechas, como fichas que se pueden deshacer.
  const fichas: { clave: string; texto: string; quitar: () => void }[] = []
  if (categoriaId !== '') fichas.push({ clave: 'cat', texto: cat?.nombre ?? '', quitar: () => { setCategoriaId(''); setGrupo(''); setTipo(''); setMarcaId(''); setMarcaDecidida(false); setModelo(''); setModeloDecidido(false); setAtributos({}); setIdxAtributo(0); reiniciarEntrada() } })
  if (grupo !== '' && tipo === '') fichas.push({ clave: 'grp', texto: GRUPOS.find((g) => g.clave === grupo)?.label ?? grupo, quitar: () => { setGrupo(''); reiniciarEntrada() } })
  if (tipo !== '') fichas.push({ clave: 'tipo', texto: tipo, quitar: () => { setTipo(''); setGrupo(''); reiniciarEntrada() } })
  if (marcaId !== '') fichas.push({ clave: 'marca', texto: `Marca: ${nombreDeMarca(marcaId)}`, quitar: () => { setMarcaId(''); setMarcaDecidida(false); reiniciarEntrada() } })
  if (modelo !== '') fichas.push({ clave: 'modelo', texto: `Modelo: ${modelo}`, quitar: () => { setModelo(''); setModeloDecidido(false); reiniciarEntrada() } })
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
          <p className={styles.finTexto}>
            {marcaId !== '' && modelo !== ''
              ? 'Listo. Revisá el resto y creá el producto.'
              : marcaId !== ''
                ? 'Listo. En el formulario falta el modelo.'
                : modelo !== ''
                  ? 'Listo. En el formulario falta la marca.'
                  : 'Listo. En el formulario faltan la marca y el modelo.'}
          </p>
          <button
            type="button"
            className={styles.continuar}
            onClick={() => onListo({ categoriaId, tipo, marcaId, modelo, atributos })}
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

          {paso.clave === 'marca' && escribiendo ? (
            // «Otra…» en la marca: la lista completa, no un texto libre (una
            // marca nueva se crea desde el formulario, con su prefijo).
            <div className={styles.otro}>
              <select
                className={styles.otroInput}
                autoFocus
                value=""
                aria-label="Elegí la marca"
                onChange={(e) => { if (e.target.value !== '') paso.elegir(e.target.value) }}
              >
                <option value="">Elegí de todas las marcas…</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}</option>
                ))}
              </select>
              <button type="button" className={styles.otroCancelar} onClick={reiniciarEntrada}>
                Volver
              </button>
            </div>
          ) : escribiendo || paso.clave === 'modelo' ? (
            <div className={styles.otro}>
              <input
                className={styles.otroInput}
                value={textoOtro}
                autoFocus
                placeholder={paso.clave === 'modelo' ? 'Por ejemplo: 30501352010' : 'Escribí el valor nuevo…'}
                aria-label={paso.clave === 'modelo' ? 'Modelo' : 'Valor nuevo'}
                onChange={(e) => setTextoOtro(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarOtro() } }}
              />
              <button type="button" className={styles.otroOk} onClick={confirmarOtro} disabled={textoOtro.trim() === ''}>
                Usar
              </button>
              {paso.clave === 'modelo' ? (
                <button type="button" className={styles.otroCancelar} onClick={paso.omitir}>
                  Omitir
                </button>
              ) : (
                <button type="button" className={styles.otroCancelar} onClick={reiniciarEntrada}>
                  Volver
                </button>
              )}
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
                  <span className={styles.tileEtiqueta}>{paso.clave === 'marca' ? 'Otra…' : 'Otro…'}</span>
                </button>
              ) : null}
              {paso.omitir ? (
                <button type="button" className={styles.omitir} onClick={paso.omitir}>
                  {paso.clave === 'marca' ? 'La elijo después' : 'Omitir este dato'}
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
