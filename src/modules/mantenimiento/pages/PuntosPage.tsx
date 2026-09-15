import { useState } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { permisosDe } from '../lib/permisos'
import { useEdicionDePuntos, usePuntos } from '../hooks/useCheckPoints'
import type { PuntoDeRevision } from '../types'
import styles from './Pagina.module.css'

/**
 * Configuración de los puntos de revisión.
 *
 * Los ocho que vienen sembrados —carcasa, tornillos, conectores, reversa,
 * software, embrague, cabezal, rotor— salen de las partes que revisa el
 * sistema anterior y aparecen con datos en sus fichas reales: no son
 * placeholders. Pero **son de un atornillador FEIN**, y el esquema es
 * multiempresa desde el primer día. Por eso están en una tabla y no en un
 * CHECK: si otra empresa revisa otra cosa, se configura acá y no hace falta
 * una migración.
 *
 * Borrar un punto que ya se usó en una orden lo impide la FK, y está bien:
 * dejaría revisiones apuntando a la nada. Para sacarlo de circulación está
 * «activo».
 *
 * Fase 13 · E5: PageHeader, tabla común, Field/Input y Badge para el estado.
 * Las mismas mutaciones; borrar sigue siendo directo (la FK es la que frena).
 */
export function PuntosPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data, isPending, error } = usePuntos(false)
  const edicion = useEdicionDePuntos()

  const [nuevo, setNuevo] = useState({ clave: '', etiqueta: '' })
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState({ clave: '', etiqueta: '', posicion: 0 })

  if (!permisos.configurar) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Puntos de revisión" back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }} />
        <Alert tone="neutral">
          <p>Tu rol no puede configurar Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  const puntos = data ?? []
  const siguientePosicion =
    puntos.reduce((max, p) => Math.max(max, p.posicion), 0) + 10

  const empezarEdicion = (p: PuntoDeRevision) => {
    setEditandoId(p.id)
    setBorrador({ clave: p.clave, etiqueta: p.etiqueta, posicion: p.posicion })
  }

  const errorDeEdicion =
    edicion.crear.error?.message ??
    edicion.actualizar.error?.message ??
    edicion.borrar.error?.message ??
    null

  const cantidad = `${puntos.length} ${puntos.length === 1 ? 'configurado' : 'configurados'}`

  return (
    <div className={doc.listado}>
      <PageHeader
        back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }}
        title="Puntos de revisión"
        subtitle={isPending ? 'Cargando…' : `${cantidad} en ${activa?.companyName ?? ''}`}
      />

      <p className={styles.nota}>
        Cada punto se marca OK, NOK o N/A en la ficha de la orden, en dos momentos: al
        diagnosticar y al reparar. Cada marca es una fila propia, no un campo JSON dentro de la
        orden, así que se puede preguntar cuántas veces falló cada parte.
      </p>

      {errorDeEdicion ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar el cambio">
          <p>{errorDeEdicion}</p>
        </Alert>
      ) : null}

      {error ? (
        <ErrorState compact title="No se pudieron leer los puntos de revisión." description={error.message} />
      ) : isPending ? (
        <div className={tabla.contenedor}>
          <SkeletonRows rows={4} columns={4} label="Cargando puntos…" />
        </div>
      ) : puntos.length === 0 ? (
        <EmptyState compact icon="inbox" title="Todavía no hay puntos de revisión" description="Agregá el primero con el formulario de abajo." />
      ) : (
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col" className={tabla.num}>
                  Orden
                </th>
                <th scope="col">Clave</th>
                <th scope="col">Etiqueta</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {puntos.map((p) =>
                editandoId === p.id ? (
                  <tr key={p.id}>
                    <td>
                      <Field label="Orden" hideLabel>
                        <Input
                          type="number"
                          className={styles.inputPosicion}
                          value={borrador.posicion}
                          onChange={(e) => setBorrador({ ...borrador, posicion: Number(e.target.value) })}
                        />
                      </Field>
                    </td>
                    <td>
                      <Field label="Clave" hideLabel>
                        <Input type="text" value={borrador.clave} onChange={(e) => setBorrador({ ...borrador, clave: e.target.value })} />
                      </Field>
                    </td>
                    <td>
                      <Field label="Etiqueta" hideLabel>
                        <Input type="text" value={borrador.etiqueta} onChange={(e) => setBorrador({ ...borrador, etiqueta: e.target.value })} />
                      </Field>
                    </td>
                    <td>{p.activo ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral" outline>Inactivo</Badge>}</td>
                    <td>
                      <span className={styles.accionesFila}>
                        <Button
                          size="sm"
                          loading={edicion.actualizar.isPending}
                          onClick={() =>
                            edicion.actualizar.mutate(
                              { id: p.id, datos: borrador },
                              { onSuccess: () => setEditandoId(null) },
                            )
                          }
                        >
                          Guardar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)}>
                          Cancelar
                        </Button>
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id}>
                    <td className={`${tabla.num} ${styles.mono}`}>{p.posicion}</td>
                    <td className={styles.mono}>{p.clave}</td>
                    <td>{p.etiqueta}</td>
                    <td>{p.activo ? <Badge tone="success">Activo</Badge> : <Badge tone="neutral" outline>Inactivo</Badge>}</td>
                    <td>
                      <span className={styles.accionesFila}>
                        <Button size="sm" variant="secondary" icon={<Icon name="edit" size={16} />} onClick={() => empezarEdicion(p)}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={edicion.actualizar.isPending}
                          onClick={() => edicion.actualizar.mutate({ id: p.id, datos: { activo: !p.activo } })}
                        >
                          {p.activo ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Icon name="trash" size={16} />}
                          disabled={edicion.borrar.isPending}
                          onClick={() => edicion.borrar.mutate(p.id)}
                        >
                          Borrar
                        </Button>
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <DocSection title="Agregar un punto">
        <div className={styles.formAlta}>
          <Field label="Clave" id="punto-clave" help="Identificador estable: no cambia aunque se reescriba la etiqueta. Único dentro de la empresa.">
            <Input type="text" value={nuevo.clave} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })} placeholder="rodamiento" />
          </Field>
          <Field label="Etiqueta" id="punto-etiqueta">
            <Input type="text" value={nuevo.etiqueta} onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })} placeholder="RODAMIENTO" />
          </Field>
        </div>
        <div className={styles.acciones}>
          <Button
            icon={<Icon name="plus" size={16} />}
            loading={edicion.crear.isPending}
            disabled={nuevo.clave.trim() === '' || nuevo.etiqueta.trim() === ''}
            onClick={() =>
              edicion.crear.mutate(
                {
                  clave: nuevo.clave,
                  etiqueta: nuevo.etiqueta,
                  posicion: siguientePosicion,
                  activo: true,
                },
                { onSuccess: () => setNuevo({ clave: '', etiqueta: '' }) },
              )
            }
          >
            {edicion.crear.isPending ? 'Agregando…' : 'Agregar punto'}
          </Button>
        </div>
      </DocSection>
    </div>
  )
}
