import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useDebounce } from '@/hooks/useDebounce'
import { consultarProductos } from '@/modules/catalogo/services/productos'
import { construirPlanDeConsulta } from '@/modules/catalogo/lib/planDeConsulta'
import { comoProductoListado, listarCompartido } from '@/modules/catalogo/services/compartido'
import type { ProductoListado } from '@/modules/catalogo/types'
import type { UltimoPrecio } from '@/modules/clientes/types'
import { FILTROS_MODAL } from '../hooks/useCatalogoParaDocumento'
import { formatearImporte } from '../lib/formato'
import { precioParaLineaNueva } from '../lib/ultimoPrecio'
import type { PrecioPropuesto } from './ModalCatalogoProductos'
import { filtrarAlInstante } from '../lib/filtroInstantaneo'
import styles from './BuscadorProductoLinea.module.css'

/**
 * El nombre de una línea que además BUSCA productos (Fase 163).
 *
 * «En el nombre, cuando escribo algo, que aparezcan en lista los productos que
 * coinciden —por si no me acuerdo el código— y al elegir uno se rellene esa
 * misma línea.» Es el buscador del modal de catálogo, pero inline y por fila: se
 * escribe libre, y si lo que se escribe coincide con productos aparece una lista
 * abajo; al elegir uno, la línea pasa a ser de catálogo con su precio.
 *
 * La lista va por un PORTAL al `body`: la tabla de líneas tiene `overflow` para
 * su scroll, y un desplegable dentro de una celda quedaría recortado. Con el
 * portal escapa de la tabla y se la ve entera. Se cierra al elegir, con Escape,
 * al tocar afuera y al scrollear (para no quedar desalineada).
 */
export interface BuscadorProductoLineaProps {
  valor: string | null
  /** La tarifa del documento: de ahí sale el precio propuesto. */
  listaPrecioId: string | null
  moneda: string | null
  historicos: Map<string, UltimoPrecio>
  /** La clase del input, para que se vea IGUAL que las otras celdas. */
  claseInput: string | undefined
  /** Escribir libre: actualiza el nombre de la línea. */
  onTexto: (texto: string) => void
  /** Elegir un producto de la lista: rellena la línea. */
  onElegir: (producto: ProductoListado, precio: PrecioPropuesto) => void
}

const MAXIMO = 8

export function BuscadorProductoLinea({
  valor,
  listaPrecioId,
  moneda,
  historicos,
  claseInput,
  onTexto,
  onElegir,
}: BuscadorProductoLineaProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false
  // Un distribuidor busca en el catálogo que le comparte su proveedor (2026-11-27).
  const esDistribuidor = activa?.modulos != null

  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idLista = useId()

  // La posición del desplegable se mide EN EL EVENTO (foco o tecla), no en el
  // render ni en un efecto: leer un ref en el render o tocar estado dentro de un
  // efecto están prohibidos por el lint, y medir acá es lo correcto igual —el
  // ref ya está montado y es cuando la posición puede haber cambiado—.
  const medir = () => {
    const r = inputRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom, left: r.left, width: r.width })
  }

  // 120 ms y no 250 (2026-11): el filtro al instante cubre la espera, así
  // que se puede salir antes a buscar sin pedirle de más al servidor.
  const q = useDebounce((valor ?? '').trim(), 120)
  const habilitado = companyId !== null && q.length >= 2 && abierto

  const { data } = useQuery({
    queryKey: ['ventas', companyId, 'buscar-linea', q, listaPrecioId, esInterno, esDistribuidor, moneda],
    queryFn: async () => {
      if (esDistribuidor) {
        const r = await listarCompartido(companyId!, { q, categoria: null, marca: null, pagina: 1, porPagina: MAXIMO })
        return { q, total: r.total, productos: r.productos.map((p) => comoProductoListado(p, r.moneda, moneda)) }
      }
      return {
        q,
        ...(await consultarProductos(
          construirPlanDeConsulta({ ...FILTROS_MODAL, q, porPagina: MAXIMO }, companyId!),
          listaPrecioId,
          esInterno,
        )),
      }
    },
    enabled: habilitado,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const texto = (valor ?? '').trim()
  // ¿La lista que hay es de lo que está escrito ahora, o de una búsqueda anterior?
  const desactualizada = data !== undefined && data.q !== texto
  const deLaBusqueda = (data?.productos ?? []).slice(0, MAXIMO)
  const productos =
    texto.length >= 2 && abierto
      ? desactualizada
        ? filtrarAlInstante(deLaBusqueda, texto)
        : habilitado
          ? deLaBusqueda
          : []
      : []
  const buscando = abierto && texto.length >= 2 && productos.length === 0 && (desactualizada || data === undefined)
  const hayLista = abierto && productos.length > 0
  // El índice resaltado, clamp al largo actual: si la lista se acortó, no se
  // sale. Se calcula en el render para no tocar estado dentro de un efecto.
  const activoSeguro = productos.length === 0 ? 0 : Math.min(activo, productos.length - 1)

  // Al scrollear o redimensionar se cierra —reposicionar en vivo dentro de una
  // tabla con scroll propio es más frágil que volver a abrir—.
  useEffect(() => {
    if (!hayLista) return
    const cerrar = () => setAbierto(false)
    // `capture` para enterarse del scroll de CUALQUIER contenedor, no sólo el
    // de la ventana (la tabla scrollea por dentro).
    window.addEventListener('scroll', cerrar, true)
    window.addEventListener('resize', cerrar)
    return () => {
      window.removeEventListener('scroll', cerrar, true)
      window.removeEventListener('resize', cerrar)
    }
  }, [hayLista])

  const elegir = (p: ProductoListado) => {
    onElegir(p, precioParaLineaNueva(historicos.get(p.id), p.precio))
    setAbierto(false)
  }

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hayLista) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActivo((activoSeguro + 1) % productos.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((activoSeguro - 1 + productos.length) % productos.length)
    } else if (e.key === 'Enter') {
      const p = productos[activoSeguro]
      if (p) {
        e.preventDefault()
        elegir(p)
      }
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className={claseInput}
        value={valor ?? ''}
        placeholder="Nombre o código del producto…"
        aria-label="Producto"
        role="combobox"
        aria-expanded={hayLista}
        aria-controls={hayLista ? idLista : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          onTexto(e.target.value)
          setAbierto(true)
          setActivo(0)
          medir()
        }}
        onFocus={() => {
          setAbierto(true)
          medir()
        }}
        // El blur cierra, pero con un respiro: si el blur vino de tocar un ítem,
        // el click tiene que llegar primero. El `onMouseDown` del ítem igual lo
        // previene; esto cubre salir con Tab.
        onBlur={() => window.setTimeout(() => setAbierto(false), 120)}
        onKeyDown={alTeclear}
      />
      {buscando && pos && !hayLista
        ? createPortal(
            <div className={styles.lista} style={{ top: pos.top, left: pos.left, minWidth: pos.width }} role="status">
              <span className={styles.buscando}>Buscando…</span>
            </div>,
            document.body,
          )
        : null}
      {hayLista && pos
        ? createPortal(
            <ul
              id={idLista}
              role="listbox"
              className={styles.lista}
              style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            >
              {productos.map((p, i) => {
                const precio = precioParaLineaNueva(historicos.get(p.id), p.precio)
                return (
                  <li key={p.id} role="option" aria-selected={i === activoSeguro}>
                    <button
                      type="button"
                      className={i === activoSeguro ? `${styles.item} ${styles.activo}` : styles.item}
                      // Antes del blur: así el click elige en vez de que el
                      // input se cierre por perder el foco.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        elegir(p)
                      }}
                      onMouseEnter={() => setActivo(i)}
                    >
                      <span className={styles.sku}>{p.sku}</span>
                      <span className={styles.nombre}>{p.nombre}</span>
                      <span className={styles.precio}>
                        {p.precio === null ? 'sin precio' : formatearImporte(precio.precio, moneda)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </>
  )
}
