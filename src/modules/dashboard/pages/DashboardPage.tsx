import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { AccesosRapidos } from '../components/AccesosRapidos'
import { VistaOperativa } from '../components/VistaOperativa'
import { VistaVentas } from '../components/VistaVentas'
import { useInicio } from '../hooks/useInicio'
import { accesosPara, vistaPara } from '../lib/inicio'
import { WIDGETS, esElDeFabrica, type ClaveWidget } from '../lib/widgets'

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
 *
 * ── CADA UNO LO ACOMODA (Fase 76) ───────────────────────────────────────────
 *
 * «Quiero que todos los módulos del inicio sean widgets modificables por
 * usuario, para que cada uno pueda agrandar, achicar, subir y bajar lo que
 * quiera.»
 *
 * El botón «Acomodar» enciende el modo: cada bloque muestra cuatro flechas y
 * cada cambio se guarda solo, en el perfil de quien lo hizo. Lo que se guarda
 * es apenas el orden y el tamaño; los datos y las consultas son las mismas,
 * acomodar no pide nada al servidor salvo guardar la preferencia.
 *
 * POR AHORA SÓLO LA VISTA OPERATIVA. La de ventas es otra pantalla, con otros
 * bloques, y widgetizarla sin que nadie lo haya pedido sería inventar trabajo.
 * El día que se pida, es armar su lista de claves y su contenido: la rejilla y
 * el guardado ya están y no son de esta vista.
 */
export function DashboardPage() {
  const { activa } = useEmpresa()
  const rol = activa?.rol ?? ''
  const vista = vistaPara(rol)

  /*
   * Lo que esta persona puede acomodar es lo que esta persona puede VER. El
   * pendiente del resto es de admin, así que para un empleado no existe: ni en
   * la pantalla ni en la lista de widgets. Si estuviera en la lista, su inicio
   * guardaría un bloque invisible y las flechas moverían un hueco.
   */
  const disponibles = useMemo<readonly ClaveWidget[]>(
    () => (rol === 'admin' ? WIDGETS : WIDGETS.filter((w) => w !== 'equipo')),
    [rol],
  )
  const inicio = useInicio(disponibles)
  const [acomodando, setAcomodando] = useState(false)

  const puedeAcomodar = vista === 'operativa'
  const seAcomodo = !esElDeFabrica(inicio.widgets)

  return (
    <div className={doc.listado}>
      <PageHeader
        title="Dashboard"
        subtitle={activa ? `Resumen operativo y comercial de ${activa.companyName} · ${etiquetaRol(rol)}` : undefined}
        actions={
          puedeAcomodar ? (
            <>
              {acomodando && seAcomodo ? (
                <Button variant="ghost" size="sm" onClick={inicio.restaurar}>
                  Restaurar
                </Button>
              ) : null}
              <Button
                variant={acomodando ? 'primary' : 'secondary'}
                size="sm"
                icon={<Icon name={acomodando ? 'check' : 'sliders'} size={16} />}
                onClick={() => setAcomodando((x) => !x)}
              >
                {acomodando ? 'Listo' : 'Acomodar'}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Si el guardado falla hay que decirlo: lo que se ve es lo último que se
          pidió, pero la próxima recarga va a traer lo de antes. */}
      {inicio.error ? (
        <Alert tone="warning" role="status" title="No se pudo guardar cómo acomodaste el inicio">
          <p>{inicio.error}</p>
        </Alert>
      ) : null}

      {acomodando ? (
        <Alert tone="info" role="note">
          <p>
            Subí, bajá, agrandá o achicá cada bloque con sus flechas. Se guarda solo y es tuyo: nadie
            más ve tu inicio acomodado.
          </p>
        </Alert>
      ) : null}

      {vista === 'operativa' ? (
        <VistaOperativa
          accesos={<AccesosRapidos accesos={accesosPara(rol)} />}
          inicio={{
            widgets: inicio.widgets,
            acomodando,
            subir: inicio.subir,
            bajar: inicio.bajar,
            agrandar: inicio.agrandar,
            achicar: inicio.achicar,
          }}
        />
      ) : (
        <>
          {vista === 'ventas' ? <VistaVentas /> : null}
          <AccesosRapidos accesos={accesosPara(rol)} />
        </>
      )}
    </div>
  )
}
