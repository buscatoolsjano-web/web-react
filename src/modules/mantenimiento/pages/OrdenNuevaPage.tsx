import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { FormularioOrden } from '../components/FormularioOrden'
import { useCrearOrden } from '../hooks/useOrdenes'
import { obtenerActivo } from '../services/activos'
import type { DatosOrden } from '../services/ordenes'
import styles from './Pagina.module.css'

const hoy = () => new Date().toISOString().slice(0, 10)

/**
 * Alta de una orden de servicio.
 *
 * Se puede llegar con el equipo ya elegido (`?eq=<uuid>`, desde su ficha) o
 * sin nada. En los dos casos el cliente se precarga del dueño actual del
 * equipo y queda congelado al guardar.
 */
export function OrdenNuevaPage() {
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const equipoPrevio = params.get('eq')
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const crear = useCrearOrden()

  // El equipo que viene por la URL. Se lee entero para tener su dueño.
  const activo = useQuery({
    queryKey: ['mantenimiento', companyId, 'activo', equipoPrevio],
    queryFn: () => obtenerActivo(companyId!, equipoPrevio!),
    enabled: companyId !== null && !!equipoPrevio,
    staleTime: 30_000,
  })

  if (!permisos.crear) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Nueva orden</h1>
        <p className={styles.error} role="note">
          Tu rol no puede crear órdenes. Mantenimiento es de administradores y empleados.
        </p>
        <Link to="/mantenimiento/ordenes" className={styles.volver}>
          ← Volver a órdenes
        </Link>
      </div>
    )
  }

  if (equipoPrevio && activo.isPending) {
    return <p className={styles.nota}>Cargando equipo…</p>
  }

  const a = activo.data ?? null

  const valores: DatosOrden = {
    activoId: a?.id ?? '',
    clienteId: a?.duenoId ?? '',
    tipoServicio: 'corrective',
    motivoIngreso: '',
    condicionVisual: '',
    tecnicoId: null,
    fechaIngreso: hoy(),
    notasDiagnostico: '',
  }

  return (
    <div className={styles.page}>
      <Link to="/mantenimiento/ordenes" className={styles.volver}>
        ← Órdenes
      </Link>
      <h1 className={styles.titulo}>Nueva orden de servicio</h1>

      <FormularioOrden
        valores={valores}
        activoInicial={
          a
            ? {
                id: a.id,
                referencia: a.referencia,
                serie: a.serie,
                modelo: a.modelo,
                duenoId: a.duenoId,
                dueno: a.dueno,
              }
            : null
        }
        clienteInicial={
          a?.duenoId && a.dueno
            ? { id: a.duenoId, referencia: null, razonSocial: a.dueno, nombreComercial: null }
            : null
        }
        guardando={crear.isPending}
        errorAlGuardar={crear.error?.message ?? null}
        onGuardar={(datos) => {
          crear.mutate(datos, {
            onSuccess: ({ id }) => {
              void navegar(`/mantenimiento/ordenes/${id}`)
            },
          })
        }}
        onCancelar={() => {
          void navegar('/mantenimiento/ordenes')
        }}
      />
    </div>
  )
}
