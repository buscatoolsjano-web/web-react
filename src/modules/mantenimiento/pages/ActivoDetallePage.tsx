import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, MetaList, Missing } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs'
import { Icon } from '@/components/icons/Icon'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearFechaHora } from '../lib/formato'
import { FormularioActivo } from '../components/FormularioActivo'
import { ListadoOrdenes } from '../components/ListadoOrdenes'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { CabeceraActivo } from '../components/CabeceraActivo'
import { GaleriaActivo } from '../components/GaleriaActivo'
import { ChipBaja } from '../components/ChipEstado'
import { useActivo, useGuardarActivo, useHistorialDeActivo } from '../hooks/useActivos'
import { useOrdenes } from '../hooks/useOrdenes'
import { obtenerClienteBreve, obtenerProductoBreve } from '../services/catalogo'
import { CLASES_EQUIPO } from '../services/adjuntos'
import { FILTROS_ORDENES_INICIALES } from '../types'
import type { DatosActivo } from '../services/activos'
import styles from './Pagina.module.css'

const ID_PESTANAS = 'ficha-equipo'

type Pestana = 'datos' | 'ordenes' | 'imagenes' | 'archivos' | 'historial'

/**
 * La ficha de un equipo.
 *
 * La identidad es el uuid de la URL. Lo que se muestra arriba es la
 * referencia, y el serial va como un dato más: puede faltar y puede repetirse.
 *
 * La procedencia —de qué entrega salió este equipo— se muestra **si existe** y
 * nunca se fuerza. La gran mayoría de los equipos que entran al taller no
 * salieron de una venta nuestra.
 *
 * Fase 13 · E5: PageHeader, ActionBar (una principal, secundarias y la baja
 * aparte), pestañas comunes y secciones. Mismas mutaciones y permisos.
 */
export function ActivoDetallePage() {
  const { id = '' } = useParams()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)

  const [pestana, setPestana] = useState<Pestana>('datos')
  const [editando, setEditando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const { data: activo, isPending, error } = useActivo(id)
  const historial = useHistorialDeActivo(id)
  const acciones = useGuardarActivo(id)

  // Las órdenes de este equipo, sin paginar de más: son pocas por equipo.
  const ordenes = useOrdenes({ ...FILTROS_ORDENES_INICIALES, activoId: id, porPagina: 100 })

  // El cliente y el producto ya elegidos, para que el formulario los muestre
  // sin obligar a buscarlos de nuevo.
  const cliente = useQuery({
    queryKey: ['mantenimiento', companyId, 'cliente-breve', activo?.duenoId],
    queryFn: () => obtenerClienteBreve(companyId!, activo!.duenoId!),
    enabled: companyId !== null && !!activo?.duenoId,
    staleTime: 5 * 60_000,
  })
  const producto = useQuery({
    queryKey: ['mantenimiento', companyId, 'producto-breve', activo?.productoId],
    queryFn: () => obtenerProductoBreve(companyId!, activo!.productoId!),
    enabled: companyId !== null && !!activo?.productoId,
    staleTime: 5 * 60_000,
  })

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Equipo" back={{ to: '/mantenimiento/activos', label: 'Equipos' }} />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.</p>
        </Alert>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className={doc.pagina}>
        <SkeletonRows rows={6} columns={3} label="Cargando equipo…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Equipo" back={{ to: '/mantenimiento/activos', label: 'Equipos' }} />
        <ErrorState title="No se pudo leer el equipo." description={error.message} />
      </div>
    )
  }

  if (!activo) {
    return (
      <div className={doc.pagina}>
        <EmptyState
          icon="search"
          title="Equipo no encontrado"
          description="Este equipo no existe o no es de la empresa activa."
          action={
            <LinkButton to="/mantenimiento/activos" variant="secondary" icon={<Icon name="arrow-left" size={16} />}>
              Volver a equipos
            </LinkButton>
          }
        />
      </div>
    )
  }

  const valores: DatosActivo = {
    duenoId: activo.duenoId,
    productoId: activo.productoId,
    identificador: activo.identificador ?? '',
    serie: activo.serie ?? '',
    marca: activo.marca ?? '',
    modelo: activo.modelo ?? '',
    tipo: activo.tipo ?? '',
    ciudad: activo.ciudad ?? '',
    provincia: activo.provincia ?? '',
    garantiaDesde: activo.garantiaDesde ?? '',
    garantiaHasta: activo.garantiaHasta ?? '',
    bajoContrato: activo.bajoContrato,
    notas: activo.notas ?? '',
  }

  const dato = (etiqueta: string, valor: string | null, falta = 'sin dato') => ({
    label: etiqueta,
    value: valor ?? <Missing>{falta}</Missing>,
  })

  const pestanas: TabItem<Pestana>[] = [
    { key: 'datos', label: 'Datos' },
    { key: 'ordenes', label: 'Órdenes', count: ordenes.data?.total ?? 0 },
    { key: 'imagenes', label: 'Imágenes', count: activo.imagenes.length },
    { key: 'archivos', label: 'Archivos' },
    { key: 'historial', label: 'Historial' },
  ]

  return (
    <div className={doc.pagina}>
      <PageHeader
        back={{ to: '/mantenimiento/activos', label: 'Equipos' }}
        title={activo.nombre ? `${activo.referencia} · ${activo.nombre}` : activo.referencia}
        subtitle={
          <>
            {activo.modelo ?? activo.tipo ?? 'Sin modelo cargado'}
            {activo.serie ? ` · serie ${activo.serie}` : ' · sin número de serie'}
            {' · '}
            {activo.duenoId ? (
              <Link to={`/clientes/${activo.duenoId}`} className={`${doc.enlace} ${styles.enlaceTactil}`}>
                {activo.dueno ?? 'Ver cliente'}
              </Link>
            ) : (
              'sin dueño asignado'
            )}
          </>
        }
        status={activo.dadoDeBaja ? <ChipBaja dadoDeBaja={activo.dadoDeBaja} /> : undefined}
      />

      {permisos.editar && !editando ? (
        <ActionBar
          label="Acciones del equipo"
          primary={
            <LinkButton to={`/mantenimiento/ordenes/nueva?eq=${activo.id}`} variant="primary" icon={<Icon name="plus" size={16} />}>
              Nueva orden
            </LinkButton>
          }
          secondary={
            <>
              <Button
                variant="secondary"
                icon={<Icon name="edit" size={16} />}
                onClick={() => {
                  setPestana('datos')
                  setEditando(true)
                }}
              >
                Editar
              </Button>
              {activo.dadoDeBaja ? (
                <Button
                  variant="secondary"
                  icon={<Icon name="refresh" size={16} />}
                  loading={acciones.reactivar.isPending}
                  onClick={() => acciones.reactivar.mutate()}
                >
                  Reactivar
                </Button>
              ) : null}
            </>
          }
          danger={
            activo.dadoDeBaja ? undefined : (
              <Button variant="danger" loading={acciones.darDeBaja.isPending} onClick={() => setConfirmandoBaja(true)}>
                Dar de baja
              </Button>
            )
          }
        />
      ) : null}

      {acciones.darDeBaja.error || acciones.reactivar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo cambiar el estado del equipo">
          <p>{acciones.darDeBaja.error?.message ?? acciones.reactivar.error?.message}</p>
        </Alert>
      ) : null}

      {activo.dadoDeBaja ? (
        <Alert tone="warning" role="note" title="Equipo dado de baja">
          <p>La baja es lógica: sus órdenes lo siguen nombrando y el historial queda intacto.</p>
        </Alert>
      ) : null}

      <CabeceraActivo activo={activo} />

      <div>
        <Tabs id={ID_PESTANAS} label="Secciones del equipo" items={pestanas} value={pestana} onChange={setPestana} />
        <TabPanel tabsId={ID_PESTANAS} tabKey={pestana} className={styles.panelPestana}>
          {pestana === 'datos' ? (
            editando ? (
              <FormularioActivo
                valores={valores}
                clienteInicial={cliente.data ?? null}
                productoInicial={producto.data ?? null}
                excluirId={activo.id}
                referencia={activo.referencia}
                guardando={acciones.guardar.isPending}
                errorAlGuardar={acciones.guardar.error?.message ?? null}
                etiquetaGuardar="Guardar cambios"
                onGuardar={(datos) =>
                  acciones.guardar.mutate(datos, { onSuccess: () => setEditando(false) })
                }
                onCancelar={() => setEditando(false)}
              />
            ) : (
              <>
                <DocSection title="Datos del equipo">
                  <MetaList
                    items={[
                      dato('Número de serie', activo.serie, 'sin número de serie'),
                      dato('Etiqueta interna', activo.identificador),
                      dato('Marca', activo.marca),
                      dato('Modelo', activo.modelo),
                      dato('Tipo', activo.tipo),
                      dato('Producto del catálogo', activo.productoSku, 'sin producto asociado'),
                      dato('Ciudad', activo.ciudad),
                      dato('Provincia', activo.provincia),
                      dato(
                        'Garantía',
                        activo.garantiaDesde || activo.garantiaHasta
                          ? `${formatearFecha(activo.garantiaDesde)} al ${formatearFecha(activo.garantiaHasta)}`
                          : null,
                        'sin garantía cargada',
                      ),
                      dato('Bajo contrato', activo.bajoContrato ? 'Sí' : 'No'),
                      dato('Alta', formatearFechaHora(activo.creadoEn)),
                      dato('Creado por', activo.autor),
                    ]}
                  />
                </DocSection>

                <DocSection title="Dueño actual">
                  {activo.duenoId ? (
                    <p className={styles.datoValor}>
                      <Link to={`/clientes/${activo.duenoId}`} className={`${doc.enlace} ${styles.enlaceTactil}`}>
                        {activo.dueno ?? 'Ver cliente'}
                      </Link>
                    </p>
                  ) : (
                    <p className={styles.falta}>
                      Sin dueño asignado. Es válido: un equipo puede entrar al taller antes de saber
                      de quién es.
                    </p>
                  )}
                  <p className={styles.nota}>
                    Cambiar el dueño <strong>no modifica ninguna orden ya creada</strong>. Cada orden
                    guarda su propio cliente, congelado en el momento del ingreso.
                  </p>
                </DocSection>

                <DocSection title="Procedencia">
                  {activo.procedencia ? (
                    <p className={styles.datoValor}>
                      Salió de la entrega{' '}
                      {activo.procedencia.entregaNumero ?? '(sin número visible)'} · serie{' '}
                      {activo.procedencia.serial} · {formatearFecha(activo.procedencia.fecha)}
                    </p>
                  ) : (
                    <p className={styles.nota}>
                      Sin entrega de origen registrada. La mayoría de los equipos que entran al taller
                      no salieron de una venta nuestra, así que el vínculo se muestra sólo cuando
                      existe de verdad.
                    </p>
                  )}
                </DocSection>

                {activo.descripcion ? (
                  <DocSection title="Descripción">
                    <p className={styles.notas}>{activo.descripcion}</p>
                  </DocSection>
                ) : null}

                {activo.notas ? (
                  <DocSection title="Notas">
                    <p className={styles.notas}>{activo.notas}</p>
                  </DocSection>
                ) : null}
              </>
            )
          ) : null}

          {pestana === 'ordenes' ? (
            <>
              {ordenes.error ? (
                <ErrorState compact title="No se pudieron leer las órdenes." description={ordenes.error.message} />
              ) : !ordenes.isPending && (ordenes.data?.filas ?? []).length === 0 ? (
                <EmptyState compact icon="inbox" title="Este equipo todavía no tiene órdenes de servicio" />
              ) : (
                <ListadoOrdenes
                  filas={ordenes.data?.filas ?? []}
                  orden="fecha"
                  direccion="desc"
                  cargando={ordenes.isPending}
                />
              )}
              <p className={styles.nota}>
                El cliente de cada orden es el que tenía el equipo cuando entró, no necesariamente el
                dueño de hoy.
              </p>
            </>
          ) : null}

          {/* La pestaña monta el panel sólo cuando se abre: listar los adjuntos
              es una consulta más, y la mayoría de las visitas a un equipo son
              para mirar sus órdenes. */}
          {pestana === 'imagenes' ? <GaleriaActivo imagenes={activo.imagenes} /> : null}

          {pestana === 'archivos' ? (
            <PanelAdjuntos
              entidad="maintenance_asset"
              entidadId={id}
              clases={CLASES_EQUIPO}
              puedeEditar={permisos.editar}
            />
          ) : null}

          {pestana === 'historial' ? (
            <PanelHistorial eventos={historial.data ?? []} cargando={historial.isPending} />
          ) : null}
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmandoBaja}
        tone="danger"
        title={`¿Dar de baja ${activo.referencia}?`}
        description="La baja es lógica: sus órdenes lo siguen nombrando y el historial queda intacto. Se puede reactivar."
        confirmLabel={acciones.darDeBaja.isPending ? 'Dando de baja…' : 'Dar de baja'}
        busy={acciones.darDeBaja.isPending}
        onCancel={() => setConfirmandoBaja(false)}
        onConfirm={() => acciones.darDeBaja.mutate(undefined, { onSettled: () => setConfirmandoBaja(false) })}
      />
    </div>
  )
}
