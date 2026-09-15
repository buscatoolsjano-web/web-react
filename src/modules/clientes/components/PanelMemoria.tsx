import { useEffect, useId, useState } from 'react'
import { DocSection } from '@/components/document/DocSection'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input } from '@/components/forms/controls'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
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

const TONO_ESTADO: Record<string, BadgeTone> = {
  suggested: 'info',
  confirmed: 'success',
  rejected: 'neutral',
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
 *
 * Fase 13 · E4: estados como `Badge`, el borrado con `ConfirmDialog` y los
 * botones de la fila con las primitivas. Mismas mutaciones.
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
  const [confirmandoBorrado, setConfirmandoBorrado] = useState<AliasDeProducto | null>(null)
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
      <div className={styles.grilla}>
        <Field label="Código del cliente" id={`${id}-codigo`}>
          <Input
            value={datos.codigoCliente}
            placeholder="El que usa en su orden de compra"
            onChange={(e) => setDatos({ ...datos, codigoCliente: e.target.value })}
          />
        </Field>
        <Field label="Descripción del cliente" id={`${id}-desc`}>
          <Input
            value={datos.descripcionCliente}
            placeholder="Cómo lo nombra, tal cual"
            onChange={(e) => setDatos({ ...datos, descripcionCliente: e.target.value })}
          />
        </Field>
      </div>

      <div className={styles.producto}>
        <span className={styles.etiqueta} id={`${id}-producto`}>
          Producto Buscatools
        </span>
        {producto ? (
          <div className={styles.elegido} aria-labelledby={`${id}-producto`} role="group">
            <code className={styles.sku}>{producto.sku}</code>
            <span className={styles.nombreProducto}>{producto.nombre}</span>
            <Button variant="secondary" size="sm" onClick={() => setProducto(null)}>
              Cambiar
            </Button>
          </div>
        ) : (
          <>
            <Field label="Buscar producto" hideLabel help="Hace falta elegir el producto: una equivalencia sin producto no equivale a nada.">
              <Input type="search" value={texto} placeholder="Buscar por SKU, nombre o marca…" onChange={(e) => setTexto(e.target.value)} />
            </Field>
            <ul className={styles.resultados} aria-label="Productos encontrados">
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
                    <code className={styles.sku}>{p.sku}</code> {p.nombre}
                    {p.marca ? <span className={styles.marca}> · {p.marca}</span> : null}
                  </button>
                </li>
              ))}
              {busqueda.isFetching ? (
                <li className={styles.buscando}>
                  <Spinner size={16} /> Buscando…
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>

      {errorAlGuardar ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{errorAlGuardar}</p>
        </Alert>
      ) : null}

      <div className={styles.acciones}>
        <Button type="submit" variant="primary" loading={guardando} disabled={!listoParaGuardar}>
          {guardando ? 'Guardando…' : etiquetaBoton}
        </Button>
        <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardando}>
          Cancelar
        </Button>
      </div>
    </form>
  )

  if (isPending) return <SkeletonRows rows={3} columns={4} label="Cargando la memoria de productos…" />
  if (error) {
    return (
      <Alert tone="danger" role="alert" title="No se pudo leer la memoria de productos">
        <p>{error.message}</p>
      </Alert>
    )
  }

  return (
    <div className={styles.wrap}>
      {visibles.length === 0 && editando === null ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="package"
          title="Sin equivalencias cargadas"
          description="Sirven para reconocer sus productos cuando manda una orden de compra con sus propios códigos."
        />
      ) : null}

      {editando === 'nueva' ? <DocSection title="Nueva equivalencia">{formulario('Agregar')}</DocSection> : null}

      {visibles.length > 0 ? (
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col">Código del cliente</th>
                <th scope="col">Descripción del cliente</th>
                <th scope="col">SKU</th>
                <th scope="col">Producto</th>
                <th scope="col">Estado</th>
                <th scope="col">Alta</th>
                {puedeEditar ? (
                  <th scope="col">
                    <span className="sr-only">Acciones</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) =>
                editando === a.id ? (
                  <tr key={a.id}>
                    <td colSpan={puedeEditar ? 7 : 6}>{formulario('Guardar')}</td>
                  </tr>
                ) : (
                  <tr key={a.id} className={a.estado === 'rejected' ? styles.filaDescartada : undefined}>
                    <td className={tabla.nowrap}>
                      <code className={styles.sku}>{a.codigoCliente ?? '—'}</code>
                    </td>
                    <td className={tabla.textoCorto} title={a.descripcionCliente ?? ''}>
                      {a.descripcionCliente ?? '—'}
                    </td>
                    <td className={tabla.nowrap}>
                      <code className={styles.sku}>{a.sku ?? '—'}</code>
                    </td>
                    <td className={tabla.texto} title={a.nombreProducto ?? ''}>
                      {a.nombreProducto ?? '—'}
                    </td>
                    <td>
                      <span className={styles.estado}>
                        <Badge tone={TONO_ESTADO[a.estado] ?? 'neutral'}>{ETIQUETA_ESTADO[a.estado] ?? a.estado}</Badge>
                        {a.estado === 'confirmed' && !a.confirmadoPorPersona ? (
                          <span className={styles.aviso}>
                            <Icon name="alert-triangle" size={16} />
                            La dio por buena la migración, no una persona
                          </span>
                        ) : null}
                        <span className={styles.origen}>{ETIQUETA_ORIGEN[a.origen ?? ''] ?? a.origen ?? ''}</span>
                      </span>
                    </td>
                    <td className={tabla.nowrap}>{formatearFecha(a.creadoEn)}</td>
                    {puedeEditar ? (
                      <td>
                        <div className={styles.accionesFila}>
                          <Button variant="secondary" size="sm" onClick={() => abrir(a)}>
                            Editar
                          </Button>
                          {a.estado === 'confirmed' && !a.confirmadoPorPersona ? (
                            <Button variant="secondary" size="sm" loading={confirmar.isPending} onClick={() => confirmar.mutate(a.id)}>
                              Confirmar
                            </Button>
                          ) : null}
                          {a.estado !== 'rejected' ? (
                            <Button variant="ghost" size="sm" loading={descartar.isPending} onClick={() => descartar.mutate(a.id)}>
                              Descartar
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" className={styles.peligro} onClick={() => setConfirmandoBorrado(a)}>
                            Borrar
                          </Button>
                        </div>
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
          <Button variant="secondary" icon={<Icon name="plus" size={16} />} onClick={() => abrir(null)}>
            Agregar equivalencia
          </Button>
        ) : null}
        {descartadas > 0 ? (
          <Checkbox
            label={`Ver las ${descartadas} descartada${descartadas === 1 ? '' : 's'}`}
            checked={verDescartadas}
            onChange={(e) => setVerDescartadas(e.target.checked)}
          />
        ) : null}
      </div>

      {borrar.error || descartar.error || confirmar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo actualizar la equivalencia">
          <p>{borrar.error?.message ?? descartar.error?.message ?? confirmar.error?.message}</p>
        </Alert>
      ) : null}

      <ConfirmDialog
        open={confirmandoBorrado !== null}
        tone="danger"
        title={`¿Borrar la equivalencia ${confirmandoBorrado?.codigoCliente ?? confirmandoBorrado?.descripcionCliente ?? ''}?`}
        description="Se borra la relación entre el código del cliente y el producto. Si sólo no aplica, «Descartar» la conserva en el historial. No se puede deshacer."
        confirmLabel="Borrar equivalencia"
        cancelLabel="Volver"
        busy={borrar.isPending}
        onConfirm={() => {
          if (!confirmandoBorrado) return
          borrar.mutate(confirmandoBorrado.id, {
            onSuccess: () => setConfirmandoBorrado(null),
            onError: () => setConfirmandoBorrado(null),
          })
        }}
        onCancel={() => setConfirmandoBorrado(null)}
      />
    </div>
  )
}
