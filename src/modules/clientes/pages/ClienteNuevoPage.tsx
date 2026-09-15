import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioCliente } from '../components/FormularioCliente'
import { permisosDe } from '../lib/permisos'
import { CLIENTE_VACIO } from '../lib/validacion'
import { useCrearCliente } from '../hooks/useEdicionClientes'
import styles from './ClienteNuevoPage.module.css'

/**
 * Alta de cliente.
 *
 * La referencia `CLI00001` la asigna el servidor al guardar, no el
 * formulario: `nextClienteRef` del legacy hacía `MAX+1` sobre la lista que
 * tenía en memoria, y dos personas dando de alta a la vez se pisaban el
 * número.
 */
export function ClienteNuevoPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const crear = useCrearCliente()
  const navegar = useNavigate()
  const volver = { to: '/clientes', label: 'Clientes' }

  if (!permisos.crearCliente) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Nuevo cliente" back={volver} />
        <EmptyState
          icon="users"
          title="Tu rol no puede dar de alta clientes"
          description="El alta es de administradores, empleados y vendedores."
          action={<LinkButton to="/clientes">Volver al listado</LinkButton>}
        />
      </div>
    )
  }

  return (
    <div className={`${doc.pagina} ${styles.pagina}`}>
      <PageHeader
        back={volver}
        title="Nuevo cliente"
        subtitle="Los contactos y las direcciones se cargan después, desde la ficha."
      />

      <DocSection>
        <FormularioCliente
          valores={CLIENTE_VACIO}
          guardando={crear.isPending}
          errorAlGuardar={crear.error?.message ?? null}
          etiquetaGuardar="Crear cliente"
          onGuardar={(datos) =>
            crear.mutate(datos, {
              onSuccess: ({ id }) => void navegar(`/clientes/${id}`),
            })
          }
          onCancelar={() => void navegar('/clientes')}
        />
      </DocSection>
    </div>
  )
}
