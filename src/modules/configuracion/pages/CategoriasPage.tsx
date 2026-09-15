import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import { Icon } from '@/components/icons/Icon'
import { Button } from '@/components/ui/Button'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { Dialogo } from '../components/Dialogo'
import { DialogoNombre } from '../components/DialogoNombre'
import { useAccionesMaestros, useCategorias } from '../hooks/useMaestros'
import { AUTORIDAD, filtrarCategorias, mensajeErrorMaestro, puedeEliminarCategoria, type Categoria } from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

type Pendiente = { tipo: 'crear' } | { tipo: 'renombrar' | 'eliminar'; c: Categoria }

const CATEGORIAS = { singular: 'categoría', plural: 'categorías' }

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Configuración → Categorías. Admin: crear, renombrar (el slug no cambia) y
 * eliminar las que no se usan. Employee: sólo lectura.
 */
export function CategoriasPage() {
  const { activa } = useEmpresa()
  const q = useCategorias()
  const acciones = useAccionesMaestros()
  const [busqueda, setBusqueda] = useState('')
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const lista = q.data?.filas ?? []
  // Qué se ofrece sale del rol; lo que se permite lo vuelve a decidir la base.
  const admin = activa?.rol === 'admin'
  const visibles = filtrarCategorias(lista, busqueda)
  const ocupado = acciones.crearCategoria.isPending || acciones.renombrarCategoria.isPending || acciones.eliminarCategoria.isPending

  const abrir = (p: Pendiente) => {
    setErrorDialogo(null)
    setAviso(null)
    setPendiente(p)
  }
  const cerrar = () => {
    if (!ocupado) setPendiente(null)
  }

  async function guardarNombre(nombre: string) {
    try {
      if (pendiente?.tipo === 'renombrar') {
        const r = await acciones.renombrarCategoria.mutateAsync({ id: pendiente.c.id, esperado: pendiente.c.nombre, nombre })
        setAviso({ tono: 'ok', titulo: r.cambiado ? `Categoría renombrada a «${r.nombre}».` : 'No había cambios.' })
      } else {
        const r = await acciones.crearCategoria.mutateAsync(nombre)
        setAviso({ tono: 'ok', titulo: `Categoría «${r.nombre}» creada.` })
      }
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  async function eliminar() {
    if (pendiente?.tipo !== 'eliminar') return
    try {
      await acciones.eliminarCategoria.mutateAsync(pendiente.c.id)
      setAviso({ tono: 'ok', titulo: `Categoría «${pendiente.c.nombre}» eliminada.` })
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  const columnas: Column<Categoria>[] = [
    {
      key: 'nombre',
      header: 'Categoría',
      mobile: 'title',
      render: (c) => (
        <span className={styles.persona}>
          <span className={styles.nombre}>{c.nombre}</span>
          <code className={cx(styles.codigo, styles.email)}>{c.slug}</code>
        </span>
      ),
    },
    { key: 'productos', header: 'Productos', align: 'right', width: '8rem', render: (c) => c.productos.toLocaleString('es-AR') },
    { key: 'atributos', header: 'Atributos', align: 'right', width: '7rem', render: (c) => c.atributos.toLocaleString('es-AR') },
    { key: 'revision', header: 'Revisión', width: '9rem', render: (c) => (c.enRevision ? <Badge tone="warning" dot>En revisión</Badge> : '—') },
  ]

  return (
    <>
      <PageHeader
        title="Categorías"
        subtitle={`Categorías de productos de ${activa?.companyName ?? 'la empresa'}.`}
        actions={
          admin ? (
            <Button icon={<Icon name="plus" size={16} />} onClick={() => abrir({ tipo: 'crear' })} disabled={ocupado}>
              Nueva categoría
            </Button>
          ) : undefined
        }
      />

      {!q.isPending && !q.isError && !admin && <StatusMessage tono="pending" titulo="Sólo lectura" detalle="Sólo un administrador puede crear, renombrar o eliminar categorías." />}
      <p className={styles.nota}>{AUTORIDAD.categorias}</p>

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} />}

      {q.isError ? (
        <StatusMessage tono="error" titulo={codigo(q.error) === 'sin_permiso' ? 'Tu rol no tiene acceso a las categorías.' : mensajeErrorMaestro(codigo(q.error))} />
      ) : (
        <>
          <div className={styles.barra}>
<Field label="Buscar categoría" hideLabel className={styles.buscar}>
              <Input type="search" placeholder="Buscar categoría" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </Field>
            {q.data && <span className={styles.nota}>{visibles.length === lista.length ? contar(lista.length, CATEGORIAS) : `${visibles.length} de ${lista.length}`}</span>}
          </div>
          <ResponsiveTable
            columns={columnas}
            rows={visibles}
            rowKey={(c) => c.id}
            isLoading={q.isPending}
            emptyMessage={lista.length === 0 ? 'Esta empresa todavía no tiene categorías.' : 'Ninguna categoría coincide con la búsqueda.'}
            {...(admin ? { actions: (c: Categoria) => <Acciones c={c} deshabilitado={ocupado} abrir={abrir} /> } : {})}
            renderCard={(c) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  {columnas[0]!.render!(c)}
                  {c.enRevision && (
                    <Badge tone="warning" dot>
                      En revisión
                    </Badge>
                  )}
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Productos</dt>
                  <dd>{c.productos.toLocaleString('es-AR')}</dd>
                  <dt>Atributos</dt>
                  <dd>{c.atributos.toLocaleString('es-AR')}</dd>
                </dl>
                {admin && (
                  <div className={styles.cardAcciones}>
                    <Acciones c={c} deshabilitado={ocupado} abrir={abrir} />
                  </div>
                )}
              </article>
            )}
          />
        </>
      )}

      {(pendiente?.tipo === 'crear' || pendiente?.tipo === 'renombrar') && (
        <DialogoNombre
          titulo={pendiente.tipo === 'crear' ? 'Nueva categoría' : 'Renombrar categoría'}
          etiqueta="Nombre de la categoría"
          textoBoton={pendiente.tipo === 'crear' ? 'Crear categoría' : 'Renombrar'}
          {...(pendiente.tipo === 'renombrar' ? { inicial: pendiente.c.nombre, excluirId: pendiente.c.id } : {})}
          existentes={lista}
          ayuda={
            pendiente.tipo === 'crear'
              ? 'La clave interna (slug) se genera del nombre y después no cambia.'
              : `La clave interna «${pendiente.c.slug}» no cambia${pendiente.c.productos ? ` y los ${pendiente.c.productos.toLocaleString('es-AR')} productos siguen en esta categoría` : ''}.`
          }
          guardando={acciones.crearCategoria.isPending || acciones.renombrarCategoria.isPending}
          error={errorDialogo}
          onGuardar={(n) => void guardarNombre(n)}
          onCerrar={cerrar}
        />
      )}
      {pendiente?.tipo === 'eliminar' && (
        <Dialogo
          titulo="Eliminar categoría"
          onCerrar={cerrar}
          bloqueado={ocupado}
          pie={
            <>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void eliminar()} disabled={ocupado}>
                {ocupado ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>«{pendiente.c.nombre}» no tiene productos, atributos ni subcategorías. Se elimina y queda registrado en la bitácora.</p>
          {errorDialogo && <StatusMessage tono="error" titulo={errorDialogo} />}
        </Dialogo>
      )}
    </>
  )
}

function Acciones({ c, deshabilitado, abrir }: { c: Categoria; deshabilitado: boolean; abrir: (p: Pendiente) => void }) {
  const eliminar = puedeEliminarCategoria(c)
  return (
    <span className={styles.acciones}>
      <Button variant="secondary" onClick={() => abrir({ tipo: 'renombrar', c })} disabled={deshabilitado}>
        Renombrar
      </Button>
      {eliminar.ok && (
        <Button variant="ghost" onClick={() => abrir({ tipo: 'eliminar', c })} disabled={deshabilitado}>
          Eliminar
        </Button>
      )}
    </span>
  )
}
