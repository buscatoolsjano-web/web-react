import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Pagination } from '@/components/tables/Pagination'
import { contar } from '@/components/tables/rango'
import doc from '@/components/document/Document.module.css'
import { useDebounce } from '@/hooks/useDebounce'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { GuiaFiltros } from '@/modules/publico/components/GuiaFiltros'
import { ListadoProductos } from '../components/ListadoProductos'
import { BarraCarrito } from '../components/BarraCarrito'
import { ModalComparar } from '../components/ModalComparar'
import { ModalEdicionMasiva } from '../components/ModalEdicionMasiva'
import { ModalImportar } from '../components/ModalImportar'
import { ModalNuevoProducto } from '../components/ModalNuevoProducto'
import { ModalProducto } from '../components/ModalProducto'
import {
  useCategorias,
  useDefinicionesDeAtributos,
  useFacetas,
  useListasDePrecios,
  usePortadasPublicas,
} from '../hooks/useCatalogoFacetas'
import { atributosParaGuia, categoriasParaGuia, facetasParaGuia, slugGuia } from '../lib/adaptarGuia'
import { useDisponibilidad, useProductos } from '../hooks/useProductos'
import { columnaYdireccion, proximoOrden, useFiltrosCatalogo } from '../hooks/useFiltrosCatalogo'
import { useExportarCatalogo } from '../hooks/useExportarCatalogo'
import { columnasPara } from '../lib/exportar'
import { MAXIMO_COMPARAR, MINIMO_COMPARAR, useSeleccionComparar } from '../hooks/useSeleccionComparar'
import { useProductoSeleccionado } from '../hooks/useProductoSeleccionado'
import { contarFiltrosActivos } from '../lib/planDeConsulta'
import { columnasDinamicas } from '../lib/columnasDinamicas'
import { debePropagarBusqueda } from '../lib/busquedaDiferida'
import { puedeCrearProductos } from '../lib/nuevoProducto'
import { OPCIONES_POR_PAGINA } from '../types'
import styles from './CatalogoPage.module.css'

const PRODUCTO = { singular: 'producto', plural: 'productos' } as const

export function CatalogoPage() {
  const { activa } = useEmpresa()
  const { filtros, actualizar, limpiar } = useFiltrosCatalogo()

  const companyId = activa?.companyId ?? null
  const esInterno = activa?.esInterno ?? false

  // El input es local y se vuelca a la URL con retraso: así no se dispara
  // una consulta por cada tecla.
  const [textoInput, setTextoInput] = useState(filtros.q)
  const textoDiferido = useDebounce(textoInput, 300)

  // La URL es la fuente de verdad, así que el input tiene que seguirla
  // cuando cambia POR FUERA: al abrir un link con ?q=, o al usar los
  // botones atrás/adelante del navegador. Sin esto el input se quedaba con
  // su valor inicial y el efecto de abajo pisaba la URL con ese valor
  // viejo, borrando la búsqueda.
  //
  // Se ajusta durante el render (patrón oficial de React para estado
  // derivado) y no en un useEffect, que provocaría un render en cascada.
  const [qUrlPrevia, setQUrlPrevia] = useState(filtros.q)
  if (qUrlPrevia !== filtros.q) {
    setQUrlPrevia(filtros.q)
    // Se compara contra el texto recortado: si el cambio lo originó este
    // mismo input, no hay que pisar lo que la persona está tipeando.
    if (filtros.q !== textoInput.trim()) setTextoInput(filtros.q)
  }

  // La condición está en una función pura y testeada: sincronizar sólo el
  // input no alcanzaba. Cuando la URL cambia por fuera, el valor diferido
  // se queda 300 ms con el anterior, y propagarlo en esa ventana pisaba la
  // URL con el valor viejo y borraba la búsqueda. Ver busquedaDiferida.ts.
  useEffect(() => {
    if (debePropagarBusqueda(textoInput, textoDiferido, filtros.q)) {
      actualizar({ q: textoDiferido })
    }
  }, [textoInput, textoDiferido, filtros.q, actualizar])

  const { listas, porDefecto, puedeElegir, cargando: listasCargando } = useListasDePrecios(companyId)
  const [listaElegida, setListaElegida] = useState<string | null>(null)

  // La lista efectiva sale de lo que RLS dejó ver. Un externo recibe una
  // sola, así que no hay nada que elegir; un interno puede cambiarla, pero
  // sólo entre las que ya le llegaron.
  const listaEfectiva = useMemo(
    () => listas.find((l) => l.id === listaElegida) ?? porDefecto,
    [listas, listaElegida, porDefecto],
  )

  // Las opciones de cada filtro salen del servidor y dependen de los filtros
  // activos: sin categoría elegida se ven las 25 marcas, con Balanceadores
  // sólo las 3 que tienen balanceadores.
  const { data: facetas, isFetching: facetasCargando } = useFacetas(companyId, filtros)

  // Un valor suelto como "1" en una card no dice nada; "1 kg" sí. Las
  // unidades salen de las facetas, que ya vienen con label y unidad.
  const unidades = useMemo(
    () => new Map((facetas?.atributos ?? []).map((a) => [a.key, a.unidad] as const)),
    [facetas],
  )

  const { data, isPending, isFetching, error, refetch } = useProductos(filtros, listaEfectiva?.id ?? null, !listasCargando)
  const productos = useMemo(() => data?.productos ?? [], [data])
  const total = data?.total ?? 0

  const idsPagina = useMemo(() => productos.map((p) => p.id), [productos])
  const { data: disponibilidad } = useDisponibilidad(idsPagina)

  // Las etiquetas y unidades de los atributos: las usan el modal y la ficha
  // al vuelo para no mostrar nunca el jsonb crudo.
  const { data: definiciones = [] } = useDefinicionesDeAtributos(companyId)

  // Qué producto está abierto vive en la URL, al lado de la búsqueda y los
  // filtros: cerrar no toca nada de lo demás.
  const { seleccionado, abrir, cerrar } = useProductoSeleccionado()

  // Fase 22 · paridad: elegir a mano qué comparar (#42) y exportar (#49).
  const seleccion = useSeleccionComparar()
  const [comparando, setComparando] = useState(false)
  /**
   * Fase 26 · E3: el alta de producto, encima del catálogo.
   *
   * Quién ve el botón sale del rol; quién puede escribir de verdad lo
   * decide la policy `products_write` (admin y employee). La pantalla sólo
   * evita ofrecer una acción que va a fallar.
   */
  const puedeCrear = puedeCrearProductos(activa?.rol)
  // Importar actualiza en masa, así que es sólo para administradores (lo vuelve
  // a validar la RLS de products en cada update).
  const esAdmin = activa?.rol === 'admin'
  const [creando, setCreando] = useState(false)
  const [importando, setImportando] = useState(false)
  // Edición masiva de lo elegido (Fase 137): sólo admin, lo revalida la RLS.
  const [editandoMasa, setEditandoMasa] = useState(false)
  const [cambiadosMasa, setCambiadosMasa] = useState<number | null>(null)
  const exportacion = useExportarCatalogo(
    companyId,
    esInterno,
    listaEfectiva?.id ?? null,
    listaEfectiva?.moneda ?? null,
  )

  /**
   * Exportar DIRECTO, sin preguntar (pedido del usuario): se baja el Excel de lo
   * que se está viendo —o de los marcados, si hay— con TODAS las columnas. Los
   * atributos los decide cada categoría en su hoja (ver `libroExcel.ts`), así que
   * no hay nada que elegir: «exporta todo de una, según las categorías».
   */
  const exportarDirecto = () => {
    if (exportacion.exportando) return
    const todas = new Set(columnasPara(esInterno).map((c) => c.clave))
    const alcance = seleccion.elegidos.length > 0 ? 'seleccionados' : 'filtrado'
    void exportacion.exportar(filtros, todas, alcance, seleccion.elegidos)
  }

  // El precio de la página, para el total de referencia de la barra del
  // carrito. Es una estimación: el precio definitivo lo pone la cotización
  // con SU tarifa.
  const preciosVisibles = useMemo(
    () => new Map(productos.map((p) => [p.id, p.precio])),
    [productos],
  )

  // Fase 22 · paridad #19: al elegir una categoría, sus atributos pasan a ser
  // columnas, como en el legacy.
  const dinamicas = useMemo(
    () => columnasDinamicas(filtros.categoria, facetas?.atributos ?? [], total),
    [filtros.categoria, facetas, total],
  )

  const activos = contarFiltrosActivos(filtros)
  const hayFiltros = activos > 0 || filtros.q !== ''
  const limpiarTodo = () => {
    limpiar()
    setTextoInput('')
  }

  // ── La GUÍA con fotos, igual que la web (Fase 133) ──────────────────────────
  // Se reusa `GuiaFiltros` del sitio público, dándole los datos del ERP con la
  // forma que espera. La categoría del ERP se filtra por id, pero la guía habla
  // en slug: se traduce en los dos sentidos.
  const todasLasCategorias = useCategorias(companyId)
  // Las portadas del catálogo público, para que la guía muestre las mismas
  // fotos que la web (Fase 174). Se mapean por slug público.
  const portadasPublicas = usePortadasPublicas()
  const portadasPorSlug = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of portadasPublicas.data ?? []) if (c.portadaUrl) m.set(c.slug, c.portadaUrl)
    return m
  }, [portadasPublicas.data])
  const facetasGuia = useMemo(() => facetasParaGuia(facetas), [facetas])
  const categoriasGuia = useMemo(
    () => categoriasParaGuia(todasLasCategorias.data ?? [], facetas, portadasPorSlug),
    [todasLasCategorias.data, facetas, portadasPorSlug],
  )
  // La guía habla en slug público (plural: «puntas-y-tubos»), que es con el que
  // matchean las fotos; el ERP filtra por id. Se traduce en los dos sentidos.
  const categoriaActual = (todasLasCategorias.data ?? []).find((c) => c.id === filtros.categoria)
  const slugCategoriaActual = categoriaActual ? slugGuia(categoriaActual) : undefined
  const atributosGuia = useMemo(() => atributosParaGuia(filtros.atributos), [filtros.atributos])

  /** Elegir una categoría desde la guía: el ERP filtra por id, y se limpian los subfiltros. */
  const guiaElegirCategoria = (slug: string) => {
    const cat = (todasLasCategorias.data ?? []).find((c) => slugGuia(c) === slug)
    actualizar({ categoria: cat?.id ?? null, subtipos: [], atributos: {} })
  }
  /** Un filtro de la guía (tipo o atributo) → el estado multi-valor del ERP. */
  const guiaFiltrar = (clave: string, valor: string) => {
    if (clave === 'tipo') {
      actualizar({ subtipos: valor === '' ? [] : [valor] })
    } else if (clave.startsWith('a.')) {
      const key = clave.slice(2)
      actualizar({ atributos: { ...filtros.atributos, [key]: valor === '' ? [] : [valor] } })
    }
  }

  if (!activa) {
    return (
      <div className={styles.cargando}>
        <Spinner label="Cargando empresa…" />
      </div>
    )
  }

  const vacio = !isPending && !error && productos.length === 0
  const moneda = listaEfectiva?.moneda ?? null
  /** El buscador y la lista de precios, que van en el encabezado. */
  const buscador = (
    <div className={styles.busqueda}>
      <Field label="Buscar productos" hideLabel className={styles.buscador}>
        <Input
          type="search"
          value={textoInput}
          onChange={(e) => setTextoInput(e.target.value)}
          placeholder="Buscar por SKU o nombre…"
        />
      </Field>
      <span className={styles.lupa} aria-hidden="true">
        {isFetching && !isPending ? <Spinner size={16} /> : <Icon name="search" size={16} />}
      </span>
      {puedeElegir && (
        <Field label="Lista de precios" hideLabel className={styles.lista}>
          <Select value={listaEfectiva?.id ?? ''} onChange={(e) => setListaElegida(e.target.value)}>
            {listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  )

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Catálogo"
        subtitle={
          <>
            {isPending ? 'Cargando…' : contar(total, PRODUCTO)}
            {listaEfectiva ? ` · ${listaEfectiva.nombre}` : ''}
          </>
        }
        /*
          El encabezado se queda con el buscador y la lista de precios, nada
          más. Exportar, Nuevo y Comparar bajaron a la barra del listado, que
          es donde los tiene la web vieja: en la misma fila que «mostrando
          1-50 de 21.752» y los botones de página.
        */
        actions={buscador}
      />

      {/* El panel de filtros de arriba (FilterBar + PanelFacetas) se sacó
          (Fase 144, pedido del usuario): «que quede sólo el de las fotos». La
          guía con fotos de abajo es ahora la única entrada de filtro de la
          cabecera; los filtros finos siguen en las columnas de la tabla, y
          «Limpiar filtros» pasó a la barra de acciones del listado. */}

      {/* La guía con fotos, como en la web (Fase 133): entrada rápida y visual
          que convive con los filtros de columna de la tabla. Escribe el mismo
          estado de filtros que todo lo demás. */}
      <GuiaFiltros
        categoria={slugCategoriaActual}
        categorias={categoriasGuia}
        facetas={facetasGuia}
        tipo={filtros.subtipos[0] ?? ''}
        atributos={atributosGuia}
        total={total}
        cargando={facetasCargando}
        onFiltrar={guiaFiltrar}
        onCategoria={guiaElegirCategoria}
      />

      {/*
        La fila de «filtros activos» se fue (Fase 38).

        Repetía lo que ya está a la vista un centímetro más arriba: la
        categoría elegida ya es un chip resaltado y cada desplegable muestra su
        valor. Costaba una fila entera —y arriba de ella el buscador, los chips
        de categoría, los de subcategoría y los atributos—, así que la tabla
        arrancaba a 600 px y no entraba ni una fila de productos en pantalla.

        Quitar un filtro de a uno sigue estando: se vuelve a tocar su chip o se
        pone el desplegable en «Todos». Y «Limpiar filtros» ahora vive dentro
        de la barra, como en la web vieja.
      */}

      {error ? (
        <ErrorState
          title="No se pudo cargar el catálogo."
          description={error instanceof Error ? error.message : String(error)}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : vacio ? (
        hayFiltros ? (
          <EmptyState
            icon="search"
            title="Ningún producto coincide"
            description="Probá con otra búsqueda o quitá algún filtro."
            action={
              <Button variant="secondary" onClick={limpiarTodo}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="package"
            title="Todavía no hay productos"
            description="Esta empresa no tiene productos cargados en el catálogo."
            /* Una empresa nueva arranca vacía: desde acá se carga el primero o
               se importa en masa. Antes estos botones vivían sólo en la barra
               del listado, que no se dibuja sin productos, y no había forma de
               empezar. */
            action={
              puedeCrear || esAdmin ? (
                <>
                  {puedeCrear ? (
                    <Button icon={<Icon name="plus" size={16} />} onClick={() => setCreando(true)}>
                      Nuevo producto
                    </Button>
                  ) : null}
                  {esAdmin ? (
                    <Button variant="secondary" icon={<Icon name="upload" size={16} />} onClick={() => setImportando(true)}>
                      Importar
                    </Button>
                  ) : null}
                </>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          {/*
            La barra del listado, calcada de la web vieja: a la izquierda
            cuántos se están viendo y cuántos por página; a la derecha las
            acciones y los botones de página. Todo en una fila de 28 px.
          */}
          <Pagination
            soloFlechas
            label="Paginación del catálogo (arriba)"
            compacta
            offset={(filtros.pagina - 1) * filtros.porPagina}
            pageSize={filtros.porPagina}
            total={total}
            noun={PRODUCTO}
            loading={isFetching}
            onChange={(offset) => actualizar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
            pageSizeOptions={OPCIONES_POR_PAGINA}
            onPageSizeChange={(porPagina) => actualizar({ porPagina, pagina: 1 })}
            acciones={
              <>
                {/* «Limpiar filtros» vivía en el panel de arriba, que se sacó
                    (Fase 144); ahora está acá, y sólo cuando hay algo que limpiar. */}
                {hayFiltros ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={limpiarTodo}
                    aria-label="Limpiar filtros"
                    icon={<Icon name="x" size={16} />}
                  >
                    Limpiar filtros
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exportarDirecto}
                  disabled={(total === 0 && seleccion.elegidos.length === 0) || exportacion.exportando}
                >
                  {exportacion.exportando ? <Spinner size={16} /> : <Icon name="download" size={16} />}
                  {exportacion.exportando
                    ? exportacion.avance
                      ? ` Exportando… ${exportacion.avance.traidos}`
                      : ' Exportando…'
                    : ` Exportar${seleccion.elegidos.length > 0 ? ` (${seleccion.elegidos.length})` : ''}`}
                </Button>
                {esAdmin ? (
                  <Button variant="secondary" size="sm" onClick={() => setImportando(true)}>
                    <Icon name="upload" size={16} /> Importar
                  </Button>
                ) : null}
                {puedeCrear ? (
                  <Button size="sm" icon={<Icon name="plus" size={16} />} onClick={() => setCreando(true)}>
                    Nuevo
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setComparando(true)}
                  disabled={!seleccion.puedeComparar}
                  title={
                    seleccion.puedeComparar
                      ? undefined
                      : seleccion.demasiadosParaComparar
                        ? `Comparás hasta ${MAXIMO_COMPARAR} a la vez: destildá algunos (o exportá los que marcaste)`
                        : `Tildá al menos ${MINIMO_COMPARAR} productos para compararlos`
                  }
                >
                  Comparar{seleccion.elegidos.length > 0 ? ` (${seleccion.elegidos.length})` : ''}
                </Button>
                {/* Editar en masa: un campo, un valor, para todos los elegidos.
                    Sólo admin —lo vuelve a decidir la RLS `products_write`—. */}
                {esAdmin && seleccion.elegidos.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="edit" size={16} />}
                    onClick={() => {
                      setCambiadosMasa(null)
                      setEditandoMasa(true)
                    }}
                  >
                    Editar ({seleccion.elegidos.length})
                  </Button>
                ) : null}
                {seleccion.elegidos.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={seleccion.limpiar}>
                    Limpiar selección
                  </Button>
                ) : null}
              </>
            }
          />
          {exportacion.error ? (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Alert tone="danger" title="No se pudo exportar">{exportacion.error}</Alert>
            </div>
          ) : null}
          {cambiadosMasa !== null ? (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Alert tone="success" role="status" title={`Se cambiaron ${cambiadosMasa} ${cambiadosMasa === 1 ? 'producto' : 'productos'}.`} />
            </div>
          ) : null}
          <ListadoProductos
            productos={productos}
            esInterno={esInterno}
            moneda={moneda}
            disponibilidad={disponibilidad}
            unidades={unidades}
            cargando={isPending}
            onAbrirProducto={abrir}
            abierto={seleccionado}
            definiciones={definiciones}
            priceListId={listaEfectiva?.id ?? null}
            conCarrito={esInterno}
            seleccion={{
              elegidos: seleccion.ids,
              alternar: seleccion.alternar,
              alternarTodos: seleccion.alternarTodos,
              lleno: seleccion.lleno,
            }}
            columnasDinamicas={dinamicas}
            categoriaFija={filtros.categoria !== null}
            filtroColumnas={{
              filtros,
              facetas,
              onCambiar: actualizar,
              texto: textoInput,
              onTexto: setTextoInput,
            }}
            orden={{
              ...columnaYdireccion(filtros.orden),
              ordenar: (campo) => actualizar({ orden: proximoOrden(filtros.orden, campo) }),
            }}
          />
          {total > 0 ? (
            <Pagination
              soloFlechas
              label="Paginación del catálogo"
              offset={(filtros.pagina - 1) * filtros.porPagina}
              pageSize={filtros.porPagina}
              total={total}
              noun={PRODUCTO}
              loading={isFetching}
              onChange={(offset) => actualizar({ pagina: Math.floor(offset / filtros.porPagina) + 1 })}
              /* Sin selector de tamaño: ese vive en la barra de arriba. Dos
                 «Por página» en la misma pantalla son dos sitios donde mirar
                 para entender por qué se ven 50 filas y no 200. */
            />
          ) : null}
        </>
      )}

      {/* El producto va encima del catálogo, no en otra pantalla: la
          búsqueda, los filtros, la página y el scroll quedan atrás intactos
          porque nadie los tocó. */}
      {seleccionado ? (
        <ModalProducto
          productoId={seleccionado}
          priceListId={listaEfectiva?.id ?? null}
          listaResuelta={!listasCargando}
          moneda={moneda}
          definiciones={definiciones}
          onCerrar={cerrar}
          onAbrirOtro={abrir}
        />
      ) : null}

      {/* El alta, encima del catálogo. Al crear se abre el producto: es la
          forma de ver que quedó como se quería sin ir a buscarlo. */}
      {creando ? (
        <ModalNuevoProducto
          onCerrar={() => setCreando(false)}
          onCreado={(p) => {
            setCreando(false)
            abrir(p.id)
          }}
        />
      ) : null}

      {comparando && seleccion.puedeComparar ? (
        <ModalComparar
          productos={seleccion.elegidos}
          moneda={moneda}
          esInterno={esInterno}
          onQuitar={(p) => {
            seleccion.quitar(p)
            // Con uno solo no hay comparación: el legacy tampoco deja abrirla.
            if (seleccion.elegidos.length - 1 < MINIMO_COMPARAR) setComparando(false)
          }}
          onAbrirProducto={(id) => {
            setComparando(false)
            abrir(id)
          }}
          onCerrar={() => setComparando(false)}
        />
      ) : null}

      {importando && companyId ? (
        <ModalImportar
          companyId={companyId}
          definiciones={definiciones}
          onImportado={() => void refetch()}
          onCerrar={() => setImportando(false)}
        />
      ) : null}

      {editandoMasa && seleccion.elegidos.length > 0 ? (
        <ModalEdicionMasiva
          ids={seleccion.elegidos.map((p) => p.id)}
          /* La categoría que comparten los elegidos, si es una sola: con eso el
             modal ofrece el Tipo y los atributos de ESA categoría con opciones,
             no texto libre. Si están repartidos en varias, no se puede, y cae a
             texto. */
          categoriaComun={
            new Set(seleccion.elegidos.map((p) => p.categoria?.id ?? '')).size === 1
              ? (seleccion.elegidos[0]?.categoria?.id ?? null)
              : null
          }
          definiciones={definiciones}
          onCerrar={() => setEditandoMasa(false)}
          onAplicado={(n) => {
            setEditandoMasa(false)
            setCambiadosMasa(n)
            // La selección se limpia: ya se les aplicó el cambio, y dejarlos
            // marcados invita a aplicarles otro sin querer. El catálogo ya se
            // invalidó dentro del modal, así que al cerrar se ve lo nuevo.
            seleccion.limpiar()
          }}
        />
      ) : null}

      {/* La barra del carrito va última: es fija y tiene que quedar encima
          del listado, no de los modales. */}
      {esInterno && !seleccionado && !comparando ? (
        <BarraCarrito moneda={moneda} precios={preciosVisibles} />
      ) : null}
    </div>
  )
}
