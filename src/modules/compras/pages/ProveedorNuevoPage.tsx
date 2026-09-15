import { useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { FormularioProveedor } from '../components/FormularioProveedor'
import { permisosDe } from '../lib/permisos'
import { PROVEEDOR_VACIO } from '../lib/validacion'
import { useCrearProveedor } from '../hooks/useEdicionProveedores'
import styles from './ProveedorDetallePage.module.css'

const VOLVER = { to: '/compras/proveedores', label: 'Proveedores' }

/**
 * Alta de proveedor.
 *
 * La referencia la asigna el servidor al guardar. La serie arranca en 146
 * porque el legacy llegó hasta `PROV00145`: los tres huecos que dejó —41, 93
 * y 121— **no se rellenan**. Un hueco es información: dice que ahí hubo algo
 * que se borró.
 */
export function ProveedorNuevoPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const crear = useCrearProveedor()
  const navegar = useNavigate()

  if (!permisos.crearProveedor) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Nuevo proveedor" back={VOLVER} />
        <Alert tone="neutral">
          <p>Tu rol no puede dar de alta proveedores.</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={VOLVER}
        title="Nuevo proveedor"
        subtitle="La referencia PROV la asigna el servidor al guardar. Los adjuntos se cargan después, desde la ficha."
      />

      <section className={styles.bloque}>
        <FormularioProveedor
          valores={PROVEEDOR_VACIO}
          guardando={crear.isPending}
          errorAlGuardar={crear.error?.message ?? null}
          etiquetaGuardar="Crear proveedor"
          onGuardar={(datos) =>
            crear.mutate(datos, {
              onSuccess: ({ id }) => void navegar(`/compras/proveedores/${id}`),
            })
          }
          onCancelar={() => void navegar('/compras/proveedores')}
        />
      </section>
    </div>
  )
}
