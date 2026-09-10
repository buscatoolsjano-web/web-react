import { useEffect, useId, useState } from 'react'
import { useAlias, useAliasEdicion, useBuscarProductos } from '../hooks/useMemoriaYPrecios'
import { formatearFecha } from '../lib/formato'
import type { DatosAlias } from '../lib/alias'
import type { AliasDeProducto, ProductoBuscado } from '../types'
import styles from './PanelMemoria.module.css'

export interface PanelMemoriaProps {
  clienteId: string
  /** Lo decide el rol; lo IMPIDE la policy `aliases_write`. */
  puedeEditar: boolean
}

const VACIO: DatosAlias = { codigoCliente: '', descripcionCliente: '', productId: null }

const ETIQUETA_ESTADO: Record<string, string> = {
  suggested: 'Sugerida',
  confirmed: 'Confirmada',
  rejected: 'Descartada',
}

const ETIQUETA_ORIGEN: Record<string, string> = {
  manual: 'cargada a mano',
  import: 'de una importación',
  ai: 'propuesta por IA',
  legacy: 'del sistema anterior',
}

function aDatos(a: AliasDeProducto): DatosAlias {
  return {
    codigoCliente: a.codigoCliente ?? '',
    descripcionCliente: a.descripcionCliente ?? '',
    productId: a.productId,
  }
}

/**
 * Memoria de productos: cómo llama este cliente a cada SKU.
 *
 * En el legacy la clave era el **nombre normalizado del cliente**, así que
 * renombrarlo le borraba la memoria y dos clientes homónimos la compartían.
 * Acá cuelga de `customer_id`, y la unicidad es por cliente: **el mismo código
 * puede significar productos distintos en clientes distintos**.
 */
export function PanelMemoria({ clienteId, puedeEditar }: PanelMemoriaProps) {
  const id = useId()
  const { data: alias, isPending, error } = useAlias(clienteId)
  const { crear, actualizar, confirmar, descartar, borrar } = useAliasEdicion(clienteId)

  const [editando, setEditando] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosAlias>(VACIO)
  const [producto, setProducto] = useState<ProductoBuscado | null>(null)
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const [confirmandoBorrado, setConfirmandoBorrado] = useState<string | null>(null)
  const [verDescartadas, setVerDescartadas] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

  const busqueda = useBuscarProductos(consulta, editando !== null)

  const abrir = (a: AliasDeProducto | null) => {
    setDatos(a ? aDatos(a) : VACIO)
    setProducto(
      a ? { id: a.productId, sku: a.sku ?? '', nombre: a.nombreProducto ?? '', marca: a.marca } : null,
    )
    setTexto('')
    setConsulta('')
    setEditando(a ? a.id : 'nueva')
  }

  const guardar = (e: React.FormEvent) => {
    e.preventDefault()
    const limpio: DatosAlias = { ...datos, productId: producto?.id ?? null }
    if (!listoParaGuardar) return
    const alTerminar = { onSuccess: () => setEditando(null) }
    if (editando === 'nueva') crear.mutate(limpio, alTerminar)
    else if (editando) actualizar.mutate({ id: editando, datos: limpio }, alTerminar)
  }

  const guardando = crear.isPending || actualizar.isPending
  const errorAlGuardar = crear.error?.message ?? actualizar.error?.message ?? null
  // Hace falta el producto —la columna es NOT NULL— y algún texto del
  // cliente, que es lo que se va a reconocer en su orden de compra.
  const listoParaGuardar =
    producto !== null &&
    (datos.codigoCliente.trim() !== '' || datos.descripcionCliente.trim() !== '')

  const visibles = (alias ?? []).filter((a) => verDescartadas || a.estado !== 'rejected')
  const descartadas = (alias ?? []).filter((a) => a.estado === 'rejected').length

  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={guardar} noValidate>
      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-codigo`}>
          Código del cliente
        </label>
        <input
          id={`${id}-codigo`}
          className={styles.control}
          value={datos.codigoCliente}
          placeholder="El que usa en su orden de compra"
          onChange={(e) => setDatos({ ...datos, codigoCliente: e.target.value })}
        />
      </div>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-desc`}>
          Descripción del cliente
        </label>
        <input
          id={`${id}-desc`}
          className={styles.control}
          value={datos.descripcionCliente}
          placeholder="Cómo lo nombra, tal cual"
          onChange={(e) => setDatos({ ...datos, descripcionCliente: e.target.value })}
        />
      </div>

      <div className={`${styles.campo} ${styles.ancho}`}>
        <span className={styles.etiqueta}>Producto Buscatools</span>
        {producto ? (
          <div className={styles.elegido}>
            <span className={styles.sku}>{producto.sku}</span>
            <span className={styles.nombreProducto}>{producto.nombre}</span>
            <button type="button" className={styles.secundario} onClick={() => setProducto(null)}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              className={styles.control}
              value={texto}
              placeholder="Buscar por SKU, nombre o marca…"
              aria-label="Buscar producto"
              onChange={(e) => setTexto(e.target.value)}
            />
            <ul className={styles.resultados}>
              {(busqueda.data ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.opcion}
                    onClick={() => {
                      setProducto(p)
                      setTexto('')
                    }}
                  >
                    <span className={styles.sku}>{p.sku}</span> {p.nombre}
                    {p.marca ? <span className={styles.marca}> · {p.marca}</span> : null}
                  </button>
                </li>
              ))}
              {busqueda.isFetching ? <li className={styles.nota}>Buscando…</li> : null}
            </ul>
            <p className={styles.ayuda}>
              Hace falta elegir el producto: una equivalencia sin producto no equivale a
              nada.
            </p>
          </>
        )}
      </div>

      {errorAlGuardar ? (
        <p className={styles.error} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}

      <div className={styles.acciones}>
        <button type="submit" className={styles.primario} disabled={guardando || !listoParaGuardar}>
          {guardando ? 'Guardando…' : etiquetaBoton}
        </button>
        <button
          type="button"
          className={styles.secundario}
          onClick={() => setEditando(null)}
          disabled={guardando}
        >
          Cancelar
        </button>
      </div>
    </form>
  )

  if (isPending) return <p className={styles.nota}>Cargando la memoria de productos…</p>
  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error.message}
      </p>
    )
  }

  return (
    <div className={styles.wrap}>
      {visibles.length === 0 && editando === null ? (
        <p className={styles.nota}>
          Este cliente no tiene equivalencias cargadas. Sirven para reconocer sus productos
          cuando manda una orden de compra con sus propios códigos.
        </p>
      ) : null}

      {editando === 'nueva' ? <div className={styles.caja}>{formulario('Agregar')}</div> : null}

      {visibles.length > 0 ? (
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Código del cliente</th>
                <th scope="col">Descripción del cliente</th>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col">Estado</th>
                <th scope="col">Alta</th>
                {puedeEditar ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) =>
                editando === a.id ? (
                  <tr key={a.id}>
                    <td colSpan={puedeEditar ? 7 : 6}>{formulario('Guardar')}</td>
                  </tr>
                ) : (
                  <tr key={a.id} className={a.estado === 'rejected' ? styles.filaBaja : undefined}>
                    <td className={styles.mono}>{a.codigoCliente ?? '—'}</td>
                    <td className={styles.descripcion} title={a.descripcionCliente ?? ''}>
                      {a.descripcionCliente ?? '—'}
                    </td>
                    <td className={styles.mono}>{a.sku ?? '—'}</td>
                    <td className={styles.descripcion} title={a.nombreProducto ?? ''}>
                      {a.nombreProducto ?? '—'}
                    </td>
                    <td className={styles.nowrap}>
                      {ETIQUETA_ESTADO[a.estado] ?? a.estado}
                      {a.estado === 'confirmed' && !a.confirmadoPorPersona ? (
                        <span
                          className={styles.aviso}
                          title="La dio por buena la migración, no una persona"
                        >
                          {' '}
                          ⚠
                        </span>
                      ) : null}
                      <span className={styles.origen}>
                        {' '}
                        {ETIQUETA_ORIGEN[a.origen ?? ''] ?? a.origen ?? ''}
                      </span>
                    </td>
                    <td className={styles.nowrap}>{formatearFecha(a.creadoEn)}</td>
                    {puedeEditar ? (
                      <td className={styles.acciones}>
                        <button
                          type="button"
                          className={styles.secundario}
                          onClick={() => abrir(a)}
                        >
                          Editar
                        </button>
                        {a.estado === 'confirmed' && !a.confirmadoPorPersona ? (
                          <button
                            type="button"
                            className={styles.secundario}
                            disabled={confirmar.isPending}
                            onClick={() => confirmar.mutate(a.id)}
                          >
                            Confirmar
                          </button>
                        ) : null}
                        {a.estado !== 'rejected' ? (
                          <button
                            type="button"
                            className={styles.secundario}
                            disabled={descartar.isPending}
                            onClick={() => descartar.mutate(a.id)}
                          >
                            Descartar
                          </button>
                        ) : null}
                        {confirmandoBorrado === a.id ? (
                          <>
                            <button
                              type="button"
                              className={styles.peligro}
                              disabled={borrar.isPending}
                              onClick={() =>
                                borrar.mutate(a.id, {
                                  onSuccess: () => setConfirmandoBorrado(null),
                                })
                              }
                            >
                              Confirmar borrado
                            </button>
                            <button
                              type="button"
                              className={styles.secundario}
                              onClick={() => setConfirmandoBorrado(null)}
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={styles.secundario}
                            onClick={() => setConfirmandoBorrado(a.id)}
                          >
                            Borrar
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className={styles.pie}>
        {puedeEditar && editando === null ? (
          <button type="button" className={styles.primario} onClick={() => abrir(null)}>
            + Agregar equivalencia
          </button>
        ) : null}
        {descartadas > 0 ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={verDescartadas}
              onChange={(e) => setVerDescartadas(e.target.checked)}
            />
            Ver las {descartadas} descartada{descartadas === 1 ? '' : 's'}
          </label>
        ) : null}
      </div>

      {borrar.error || descartar.error || confirmar.error ? (
        <p className={styles.error} role="alert">
          {borrar.error?.message ?? descartar.error?.message ?? confirmar.error?.message}
        </p>
      ) : null}
    </div>
  )
}
