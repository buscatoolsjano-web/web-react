import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { AccesosRapidos } from '../components/AccesosRapidos'
import { VistaOperativa } from '../components/VistaOperativa'
import { VistaVentas } from '../components/VistaVentas'
import { accesosPara, vistaPara } from '../lib/inicio'

/**
 * Inicio (Fase 13 · E6). Reemplaza la pantalla de verificación de la Fase 1.
 *
 * Lo que necesita ver cada rol al entrar, con datos que ya existen:
 *   · admin / employee: pendientes de hoy, lo emitido en el mes y alertas;
 *   · salesperson: sus cotizaciones pendientes y borradores;
 *   · el resto: accesos rápidos (no hay datos propios que mostrar sin inventar).
 *
 * No repite Informes: 3–4 números y un enlace al informe completo. Los importes
 * van siempre por moneda, sin total general ni conversiones.
 */
export function DashboardPage() {
  const { activa } = useEmpresa()
  const rol = activa?.rol ?? ''
  const vista = vistaPara(rol)

  return (
    <div className={doc.listado}>
      <PageHeader title="Inicio" subtitle={activa ? `${activa.companyName} · ${etiquetaRol(rol)}` : undefined} />
      {vista === 'operativa' ? <VistaOperativa /> : vista === 'ventas' ? <VistaVentas /> : null}
      <AccesosRapidos accesos={accesosPara(rol)} />
    </div>
  )
}
