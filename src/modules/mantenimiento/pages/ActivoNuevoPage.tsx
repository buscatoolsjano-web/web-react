import { useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { permisosDe } from '../lib/permisos'
import { FormularioActivo } from '../components/FormularioActivo'
import { useCrearActivo } from '../hooks/useActivos'
import type { DatosActivo } from '../services/activos'

const VACIO: DatosActivo = {
  duenoId: null,
  productoId: null,
  identificador: '',
  serie: '',
  marca: '',
  modelo: '',
  tipo: '',
  ciudad: '',
  provincia: '',
  garantiaDesde: '',
  garantiaHasta: '',
  bajoContrato: false,
  notas: '',
}

/**
 * Alta de un equipo.
 *
 * La referencia la emite `next_document_number`, nunca un `MAX+1` calculado
 * acá: dos altas simultáneas con `MAX+1` se pisan.
 */
export function ActivoNuevoPage() {
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const crear = useCrearActivo()

  if (!permisos.crear) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Nuevo equipo" back={{ to: '/mantenimiento/activos', label: 'Equipos' }} />
        <Alert
          tone="neutral"
          action={
            <LinkButton to="/mantenimiento/activos" variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              Volver a equipos
            </LinkButton>
          }
        >
          <p>Tu rol no puede dar de alta equipos. Mantenimiento es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={doc.pagina}>
      <PageHeader
        title="Nuevo equipo"
        back={{ to: '/mantenimiento/activos', label: 'Equipos' }}
      />

      <FormularioActivo
        valores={VACIO}
        clienteInicial={null}
        productoInicial={null}
        guardando={crear.isPending}
        errorAlGuardar={crear.error?.message ?? null}
        etiquetaGuardar="Crear equipo"
        onGuardar={(datos) => {
          crear.mutate(datos, {
            onSuccess: ({ id }) => {
              void navegar(`/mantenimiento/activos/${id}`)
            },
          })
        }}
        onCancelar={() => {
          void navegar('/mantenimiento/activos')
        }}
      />
    </div>
  )
}
