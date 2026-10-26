import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Dialog } from '@/components/modals/Dialog'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { escribeVentas } from '../lib/permisos'
import { CONFIG_POR_DEFECTO, type ConfigPlantilla } from '../lib/plantillas'
import {
  actualizarPlantilla,
  borrarPlantilla,
  crearPlantilla,
  listarPlantillas,
  type PlantillaImpresion,
} from '../services/plantillas'
import { EditorPlantilla } from '../components/EditorPlantilla'
import styles from './PlantillasImpresionPage.module.css'

/**
 * Configuración → Plantillas de impresión (Fase 154).
 *
 * Donde los admins arman y editan las plantillas que después eligen al imprimir
 * un documento. Es el otro lugar donde viven (el primero es la propia vista de
 * impresión): acá se las ve todas juntas, se renombran, se ajustan y se borran.
 */
export function PlantillasImpresionPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const escribe = escribeVentas(activa?.rol)
  const qc = useQueryClient()

  const q = useQuery({
    queryKey: ['ventas', companyId, 'plantillas'],
    queryFn: () => listarPlantillas(companyId!),
    enabled: companyId !== null,
  })

  // Lo que se está editando: `null` nada, un objeto con id=null para una nueva.
  const [edicion, setEdicion] = useState<{ id: string | null; nombre: string; config: ConfigPlantilla } | null>(null)
  const [aBorrar, setABorrar] = useState<PlantillaImpresion | null>(null)

  const refrescar = () => qc.invalidateQueries({ queryKey: ['ventas', companyId, 'plantillas'] })

  const guardar = useMutation({
    mutationFn: () =>
      edicion!.id === null
        ? crearPlantilla(companyId!, edicion!.nombre, edicion!.config).then(() => undefined)
        : actualizarPlantilla(edicion!.id, edicion!.nombre, edicion!.config),
    onSuccess: () => {
      setEdicion(null)
      void refrescar()
    },
  })

  const borrar = useMutation({
    mutationFn: () => borrarPlantilla(aBorrar!.id),
    onSuccess: () => {
      setABorrar(null)
      void refrescar()
    },
  })

  return (
    <div>
      <PageHeader
        title="Plantillas de impresión"
        subtitle="Las que los admins arman para imprimir documentos: elegís qué columnas y bloques salen y qué textos lleva."
        actions={
          escribe ? (
            <Button
              icon={<Icon name="plus" size={16} />}
              onClick={() => setEdicion({ id: null, nombre: '', config: CONFIG_POR_DEFECTO })}
            >
              Nueva plantilla
            </Button>
          ) : undefined
        }
      />

      {q.isPending ? (
        <div className={styles.cargando}><Spinner /> Cargando…</div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          icon="printer"
          title="Todavía no hay plantillas propias"
          description="Las dos fijas (Packing List y detalle) ya están en la vista de impresión. Acá armás las tuyas."
        />
      ) : (
        <ul className={styles.lista}>
          {q.data!.map((p) => (
            <li key={p.id} className={styles.fila}>
              <span className={styles.nombre}>{p.nombre}</span>
              {escribe ? (
                <span className={styles.acciones}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="edit" size={16} />}
                    onClick={() => setEdicion({ id: p.id, nombre: p.nombre, config: p.config })}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="trash" size={16} />}
                    onClick={() => setABorrar(p)}
                  >
                    Borrar
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {edicion !== null ? (
        <Dialog
          open
          onClose={() => setEdicion(null)}
          title={edicion.id === null ? 'Nueva plantilla' : 'Editar plantilla'}
          size="lg"
          busy={guardar.isPending}
          closeOnOverlay={false}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdicion(null)} disabled={guardar.isPending}>
                Cancelar
              </Button>
              <Button
                icon={<Icon name="check" size={16} />}
                loading={guardar.isPending}
                disabled={edicion.nombre.trim() === ''}
                onClick={() => guardar.mutate()}
              >
                Guardar
              </Button>
            </>
          }
        >
          {guardar.isError ? (
            <Alert tone="danger" role="alert" title="No se pudo guardar">
              <p>{guardar.error instanceof Error ? guardar.error.message : 'Probá de nuevo.'}</p>
            </Alert>
          ) : null}
          <EditorPlantilla
            nombre={edicion.nombre}
            config={edicion.config}
            onNombre={(nombre) => setEdicion((e) => (e ? { ...e, nombre } : e))}
            onConfig={(config) => setEdicion((e) => (e ? { ...e, config } : e))}
          />
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={aBorrar !== null}
        tone="danger"
        title={`¿Borrar «${aBorrar?.nombre ?? ''}»?`}
        description="La plantilla se borra y deja de aparecer al imprimir. No afecta a los documentos ya emitidos."
        confirmLabel="Borrar plantilla"
        cancelLabel="Volver"
        busy={borrar.isPending}
        onCancel={() => setABorrar(null)}
        onConfirm={() => borrar.mutate()}
      />
    </div>
  )
}
