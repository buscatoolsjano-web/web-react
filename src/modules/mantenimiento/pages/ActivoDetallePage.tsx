import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearFechaHora } from '../lib/formato'
import { FormularioActivo } from '../components/FormularioActivo'
import { ListadoOrdenes } from '../components/ListadoOrdenes'
import { PanelHistorial } from '../components/PanelHistorial'
import { PanelAdjuntos } from '../components/PanelAdjuntos'
import { ChipBaja } from '../components/ChipEstado'
import { useActivo, useGuardarActivo, useHistorialDeActivo } from '../hooks/useActivos'
import { useOrdenes } from '../hooks/useOrdenes'
import { obtenerClienteBreve, obtenerProductoBreve } from '../services/catalogo'
import { CLASES_EQUIPO } from '../services/adjuntos'
import { FILTROS_ORDENES_INICIALES } from '../types'
import type { DatosActivo } from '../services/activos'
import styles from './Pagina.module.css'

type Pestana = 'datos' | 'ordenes' | 'archivos' | 'historial'

/**
 * La ficha de un equipo.
 *
 * La identidad es el uuid de la URL. Lo que se muestra arriba es la
 * referencia, y el serial va como un dato más: puede faltar y puede repetirse.
 *
 * La procedencia —de qué entrega salió este equipo— se muestra **si existe** y
 * nunca se fuerza. La gran mayoría de los equipos que entran al taller no
 * salieron de una venta nuestra.
 */
export function ActivoDetallePage() {
  const { id = '' } = useParams()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)

  const [pestana, setPestana] = useState<Pestana>('datos')
  const [editando, setEditando] = useState(false)

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
      <div className={styles.page}>
        <h1 className={styles.titulo}>Equipo</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Mantenimiento. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  if (isPending) return <p className={styles.nota}>Cargando equipo…</p>

  if (error) {
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      </div>
    )
  }

  if (!activo) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>Este equipo no existe o no es de la empresa activa.</p>
        <Link to="/mantenimiento/activos" className={styles.volver}>
          ← Volver a equipos
        </Link>
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

  const dato = (etiqueta: string, valor: string | null, falta = 'sin dato') => (
    <div className={styles.dato} key={etiqueta}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={valor ? styles.datoValor : styles.falta}>{valor ?? falta}</dd>
    </div>
  )

  return (
    <div className={styles.page}>
      <Link to="/mantenimiento/activos" className={styles.volver}>
        ← Equipos
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{activo.referencia}</h1>
          <p className={styles.subtitulo}>
            {activo.modelo ?? activo.tipo ?? 'Sin modelo cargado'}
          </p>
          <div className={styles.chips}>
            <ChipBaja dadoDeBaja={activo.dadoDeBaja} />
          </div>
        </div>

        {permisos.editar && !editando ? (
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.secundario}
              onClick={() => {
                setPestana('datos')
                setEditando(true)
              }}
            >
              Editar
            </button>
            <Link
              to={`/mantenimiento/ordenes/nueva?eq=${activo.id}`}
              className={styles.primario}
            >
              + Nueva orden
            </Link>
            {activo.dadoDeBaja ? (
              <button
                type="button"
                className={styles.secundario}
                disabled={acciones.reactivar.isPending}
                onClick={() => acciones.reactivar.mutate()}
              >
                Reactivar
              </button>
            ) : (
              <button
                type="button"
                className={styles.peligro}
                disabled={acciones.darDeBaja.isPending}
                onClick={() => acciones.darDeBaja.mutate()}
              >
                Dar de baja
              </button>
            )}
          </div>
        ) : null}
      </header>

      {activo.dadoDeBaja ? (
        <p className={styles.avisoBaja} role="note">
          Equipo dado de baja. La baja es lógica: sus órdenes lo siguen nombrando y el historial
          queda intacto.
        </p>
      ) : null}

      <nav className={styles.pestanas}>
        {(
          [
            ['datos', 'Datos'],
            ['ordenes', `Órdenes (${ordenes.data?.total ?? 0})`],
            ['archivos', 'Archivos'],
            ['historial', 'Historial'],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            className={pestana === clave ? styles.pestanaActiva : styles.pestana}
            aria-current={pestana === clave ? 'page' : undefined}
            onClick={() => setPestana(clave)}
          >
            {etiqueta}
          </button>
        ))}
      </nav>

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
            <dl className={styles.datos}>
              {dato('Número de serie', activo.serie, 'sin número de serie')}
              {dato('Etiqueta interna', activo.identificador)}
              {dato('Marca', activo.marca)}
              {dato('Modelo', activo.modelo)}
              {dato('Tipo', activo.tipo)}
              {dato('Producto del catálogo', activo.productoSku, 'sin producto asociado')}
              {dato('Ciudad', activo.ciudad)}
              {dato('Provincia', activo.provincia)}
              {dato(
                'Garantía',
                activo.garantiaDesde || activo.garantiaHasta
                  ? `${formatearFecha(activo.garantiaDesde)} → ${formatearFecha(activo.garantiaHasta)}`
                  : null,
                'sin garantía cargada',
              )}
              {dato('Bajo contrato', activo.bajoContrato ? 'Sí' : 'No')}
              {dato('Alta', formatearFechaHora(activo.creadoEn))}
              {dato('Creado por', activo.autor)}
            </dl>

            <div className={styles.bloque}>
              <h2 className={styles.subtitulo}>Dueño actual</h2>
              {activo.duenoId ? (
                <p className={styles.datoValor}>
                  <Link to={`/clientes/${activo.duenoId}`} className={styles.enlace}>
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
            </div>

            <div className={styles.bloque}>
              <h2 className={styles.subtitulo}>Procedencia</h2>
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
            </div>

            {activo.notas ? (
              <div className={styles.bloque}>
                <h2 className={styles.subtitulo}>Notas</h2>
                <p className={styles.notas}>{activo.notas}</p>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {pestana === 'ordenes' ? (
        <>
          {ordenes.error ? (
            <p className={styles.error} role="alert">
              {ordenes.error.message}
            </p>
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

      {acciones.darDeBaja.error || acciones.reactivar.error ? (
        <p className={styles.error} role="alert">
          {acciones.darDeBaja.error?.message ?? acciones.reactivar.error?.message}
        </p>
      ) : null}

      {/* Navegar afuera no es parte de esta ficha, pero el botón de volver de
          arriba puede quedar lejos en una ficha larga. */}
      <button
        type="button"
        className={styles.volver}
        onClick={() => {
          void navegar('/mantenimiento/activos')
        }}
      >
        ← Volver a equipos
      </button>
    </div>
  )
}
