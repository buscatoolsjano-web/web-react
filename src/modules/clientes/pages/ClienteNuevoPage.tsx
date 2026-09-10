import { Link, useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioCliente } from '../components/FormularioCliente'
import { permisosDe } from '../lib/permisos'
import { CLIENTE_VACIO } from '../lib/validacion'
import { useCrearCliente } from '../hooks/useEdicionClientes'
import styles from './ClienteDetallePage.module.css'

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

  if (!permisos.crearCliente) {
    return (
      <div className={styles.page}>
        <Link to="/clientes" className={styles.volver}>
          ← Clientes
        </Link>
        <p className={styles.nota}>Tu rol no puede dar de alta clientes.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/clientes" className={styles.volver}>
        ← Clientes
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>Nuevo cliente</h1>
          <p className={styles.subtitulo}>
            Los contactos y las direcciones se cargan después, desde la ficha.
          </p>
        </div>
      </header>

      <section className={styles.bloque}>
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
      </section>
    </div>
  )
}
