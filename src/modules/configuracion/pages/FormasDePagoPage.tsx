import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/icons/Icon'
import { Button } from '@/components/ui/Button'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Dialogo } from '../components/Dialogo'
import { DialogoNombre } from '../components/DialogoNombre'

import { useAccionesMaestros, useFormasDePagoConfig } from '../hooks/useMaestros'
import { mensajeErrorMaestro } from '../lib/maestros'
import { ErrorMaestro, type FormaDePago } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

type Pendiente =
  | { tipo: 'crear' }
  | { tipo: 'renombrar' | 'desactivar' | 'reactivar' | 'eliminar'; f: FormaDePago }

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Configuración → Formas de pago (Fase 68).
 *
 * El campo de la cabecera de cotizaciones y pedidos dejó de ser texto libre, y
 * esto es el catálogo que llena el desplegable.
 *
 * ── Por qué renombrar y borrar son seguros acá ──────────────────────────────
 *
 * Los documentos guardan el TEXTO de la forma de pago, no el id de esta fila.
 * Así que renombrar no reescribe ninguna cotización vieja —siguen diciendo lo
 * que se acordó— y borrar no deja nada colgado: lo único que se pierde es la
 * opción en la lista.
 *
 * Por eso la columna «Usos» no bloquea nada: es información para decidir, no
 * una traba. Si una forma de pago está en cincuenta documentos, probablemente
 * convenga desactivarla en vez de borrarla, pero eso lo decide quien mira.
 *
 * Crear puede `admin` y `employee` —son los mismos que cotizan, y el pedido era
 * poder agregar una opción sobre la marcha—; administrar la lista es de admin.
 */
export function FormasDePagoPage() {
  const { activa } = useEmpresa()
  const q = useFormasDePagoConfig()
  const acciones = useAccionesMaestros()
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const lista = q.data ?? []
  const admin = activa?.rol === 'admin'
  const puedeCrear = admin || activa?.rol === 'employee'
  const ocupado =
    acciones.crearFormaPago.isPending ||
    acciones.renombrarFormaPago.isPending ||
    acciones.estadoFormaPago.isPending ||
    acciones.eliminarFormaPago.isPending

  const abrir = (p: Pendiente) => {
    setErrorDialogo(null)
    setAviso(null)
    setPendiente(p)
  }
  const cerrar = () => {
    if (!ocupado) setPendiente(null)
  }

  async function guardarNombre(nombre: string) {
    try {
      if (pendiente?.tipo === 'crear') {
        const r = await acciones.crearFormaPago.mutateAsync(nombre)
        setAviso({ tono: 'ok', titulo: `Forma de pago «${r.nombre}» creada.` })
      } else if (pendiente?.tipo === 'renombrar') {
        await acciones.renombrarFormaPago.mutateAsync({ id: pendiente.f.id, nombre })
        setAviso({
          tono: 'ok',
          titulo: `Ahora se llama «${nombre}».`,
          // Que nadie se asuste pensando que cambió lo que dicen los documentos.
        })
      }
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  async function confirmar() {
    if (!pendiente || pendiente.tipo === 'crear' || pendiente.tipo === 'renombrar') return
    const { f } = pendiente
    try {
      if (pendiente.tipo === 'eliminar') {
        await acciones.eliminarFormaPago.mutateAsync(f.id)
        setAviso({ tono: 'ok', titulo: `«${f.nombre}» eliminada de la lista.` })
      } else {
        const activar = pendiente.tipo === 'reactivar'
        await acciones.estadoFormaPago.mutateAsync({ id: f.id, activa: activar })
        setAviso({
          tono: 'ok',
          titulo: activar ? `«${f.nombre}» reactivada.` : `«${f.nombre}» desactivada.`,
        })
      }
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  const columnas: Column<FormaDePago>[] = [
    {
      key: 'nombre',
      header: 'Forma de pago',
      mobile: 'title',
      render: (f) => <span className={styles.nombre}>{f.nombre}</span>,
    },
    {
      key: 'usos',
      header: 'En documentos',
      align: 'right',
      width: '9rem',
      render: (f) => f.usos.toLocaleString('es-AR'),
    },
    { key: 'estado', header: 'Estado', width: '8rem', render: (f) => <ChipActiva activa={f.activa} /> },
  ]

  const accionesDeFila = (f: FormaDePago) => (
    <>
      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => abrir({ tipo: 'renombrar', f })}>
        Renombrar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={ocupado}
        onClick={() => abrir({ tipo: f.activa ? 'desactivar' : 'reactivar', f })}
      >
        {f.activa ? 'Desactivar' : 'Reactivar'}
      </Button>
      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => abrir({ tipo: 'eliminar', f })}>
        Eliminar
      </Button>
    </>
  )

  return (
    <>
      <PageHeader
        title="Formas de pago"
        subtitle={`Las opciones que ofrece el desplegable de cotizaciones y pedidos de ${activa?.companyName ?? 'la empresa'}.`}
        actions={
          puedeCrear ? (
            <Button icon={<Icon name="plus" size={16} />} onClick={() => abrir({ tipo: 'crear' })} disabled={ocupado}>
              Nueva forma de pago
            </Button>
          ) : undefined
        }
      />

      {!q.isPending && !q.isError && !admin && (
        <StatusMessage
          tono="pending"
          titulo={puedeCrear ? 'Podés agregar, no administrar' : 'Sólo lectura'}
          detalle="Renombrar, desactivar y eliminar es de un administrador."
        />
      )}

      <p className={styles.nota}>
        Los documentos guardan el texto de la forma de pago, no una referencia. Renombrar o
        eliminar una opción no cambia lo que dicen las cotizaciones ya emitidas.
      </p>

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} />}

      {q.isError ? (
        <StatusMessage
          tono="error"
          titulo={
            codigo(q.error) === 'sin_permiso'
              ? 'Tu rol no tiene acceso a las formas de pago.'
              : mensajeErrorMaestro(codigo(q.error))
          }
        />
      ) : (
        <ResponsiveTable
          columns={columnas}
          rows={lista}
          rowKey={(f) => f.id}
          isLoading={q.isPending}
          emptyMessage="Todavía no hay formas de pago cargadas."
          {...(admin ? { actions: accionesDeFila } : {})}
          renderCard={(f) => (
            <article className={styles.card}>
              <div className={styles.cardCabecera}>
                <span className={styles.nombre}>{f.nombre}</span>
                <ChipActiva activa={f.activa} />
              </div>
              <dl className={styles.cardDatos}>
                <dt>En documentos</dt>
                <dd>{f.usos.toLocaleString('es-AR')}</dd>
              </dl>
              {admin && <div className={styles.cardAcciones}>{accionesDeFila(f)}</div>}
            </article>
          )}
        />
      )}

      {(pendiente?.tipo === 'crear' || pendiente?.tipo === 'renombrar') && (
        <DialogoNombre
          titulo={pendiente.tipo === 'crear' ? 'Nueva forma de pago' : 'Renombrar forma de pago'}
          etiqueta="Nombre"
          textoBoton={pendiente.tipo === 'crear' ? 'Crear' : 'Guardar'}
          {...(pendiente.tipo === 'renombrar'
            ? { inicial: pendiente.f.nombre, excluirId: pendiente.f.id }
            : {})}
          existentes={lista}
          ayuda="Por ejemplo: 30 días, 50% por adelantado, contra entrega."
          guardando={acciones.crearFormaPago.isPending || acciones.renombrarFormaPago.isPending}
          error={errorDialogo}
          onGuardar={(n) => void guardarNombre(n)}
          onCerrar={cerrar}
        />
      )}

      {pendiente && pendiente.tipo !== 'crear' && pendiente.tipo !== 'renombrar' && (
        <Dialogo
          titulo={
            {
              desactivar: 'Desactivar forma de pago',
              reactivar: 'Reactivar forma de pago',
              eliminar: 'Eliminar forma de pago',
            }[pendiente.tipo]
          }
          onCerrar={cerrar}
          bloqueado={ocupado}
          pie={
            <>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button
                variant={pendiente.tipo === 'eliminar' ? 'danger' : 'primary'}
                onClick={() => void confirmar()}
                disabled={ocupado}
              >
                {ocupado
                  ? 'Guardando…'
                  : { desactivar: 'Desactivar', reactivar: 'Reactivar', eliminar: 'Eliminar' }[
                      pendiente.tipo
                    ]}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>
            {pendiente.tipo === 'eliminar'
              ? `«${pendiente.f.nombre}» desaparece del desplegable. Las ${pendiente.f.usos.toLocaleString('es-AR')} veces que está escrita en documentos no cambian: ahí quedó el texto, no una referencia.`
              : pendiente.tipo === 'desactivar'
                ? `«${pendiente.f.nombre}» deja de ofrecerse en cotizaciones y pedidos nuevos. Se puede reactivar después.`
                : `«${pendiente.f.nombre}» vuelve a aparecer en el desplegable.`}
          </p>
          {errorDialogo && <StatusMessage tono="error" titulo={errorDialogo} />}
        </Dialogo>
      )}
    </>
  )
}

/* Mismo chip que el resto de los maestros. */
function ChipActiva({ activa }: { activa: boolean }) {
  return activa ? (
    <Badge tone="success">Activa</Badge>
  ) : (
    <Badge tone="neutral" outline>
      Inactiva
    </Badge>
  )
}
