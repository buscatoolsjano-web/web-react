import { Link, useNavigate } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FormularioActivo } from '../components/FormularioActivo'
import { useCrearActivo } from '../hooks/useActivos'
import type { DatosActivo } from '../services/activos'
import styles from './Pagina.module.css'

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
      <div className={styles.page}>
        <h1 className={styles.titulo}>Nuevo equipo</h1>
        <p className={styles.error} role="note">
          Tu rol no puede dar de alta equipos. Mantenimiento es de administradores y empleados.
        </p>
        <Link to="/mantenimiento/activos" className={styles.volver}>
          ← Volver a equipos
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/mantenimiento/activos" className={styles.volver}>
        ← Equipos
      </Link>
      <h1 className={styles.titulo}>Nuevo equipo</h1>

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
