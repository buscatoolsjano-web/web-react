import { Link, useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioProveedor } from '../components/FormularioProveedor'
import { permisosDe } from '../lib/permisos'
import { PROVEEDOR_VACIO } from '../lib/validacion'
import { useCrearProveedor } from '../hooks/useEdicionProveedores'
import styles from './ProveedorDetallePage.module.css'

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
      <div className={styles.page}>
        <Link to="/compras/proveedores" className={styles.volver}>
          ← Proveedores
        </Link>
        <p className={styles.nota}>Tu rol no puede dar de alta proveedores.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/compras/proveedores" className={styles.volver}>
        ← Proveedores
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>Nuevo proveedor</h1>
          <p className={styles.subtitulo}>
            La referencia PROV la asigna el servidor al guardar. Los adjuntos se cargan
            después, desde la ficha.
          </p>
        </div>
      </header>

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
