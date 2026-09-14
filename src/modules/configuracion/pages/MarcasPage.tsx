import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { Dialogo } from '../components/Dialogo'
import { DialogoNombre } from '../components/DialogoNombre'
import { useAccionesMaestros, useMarcas } from '../hooks/useMaestros'
import { AUTORIDAD, filtrarMarcas, mensajeErrorMaestro, puedeEliminarMarca, textoDesactivar, type FiltroEstado, type Marca } from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

type Pendiente = { tipo: 'crear' } | { tipo: 'desactivar' | 'reactivar' | 'eliminar'; m: Marca }

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Configuración → Marcas. Admin: crear, desactivar/reactivar y eliminar las que
 * no se usan. Employee: sólo lectura. El nombre no se edita (AUTORIDAD.marcasNombre).
 */
export function MarcasPage() {
  const { activa } = useEmpresa()
  const q = useMarcas()
  const acciones = useAccionesMaestros()
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<FiltroEstado>('todas')
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const lista = q.data?.filas ?? []
  // Qué se ofrece sale del rol; lo que se permite lo vuelve a decidir la base.
  const admin = activa?.rol === 'admin'
  const visibles = filtrarMarcas(lista, busqueda, estado)
  const ocupado = acciones.crearMarca.isPending || acciones.estadoMarca.isPending || acciones.eliminarMarca.isPending

  const abrir = (p: Pendiente) => {
    setErrorDialogo(null)
    setAviso(null)
    setPendiente(p)
  }
  const cerrar = () => {
    if (!ocupado) setPendiente(null)
  }

  async function crear(nombre: string) {
    try {
      const r = await acciones.crearMarca.mutateAsync(nombre)
      setAviso({ tono: 'ok', titulo: `Marca «${r.nombre}» creada.` })
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  async function confirmar() {
    if (!pendiente || pendiente.tipo === 'crear') return
    const { m } = pendiente
    try {
      if (pendiente.tipo === 'eliminar') {
        await acciones.eliminarMarca.mutateAsync(m.id)
        setAviso({ tono: 'ok', titulo: `Marca «${m.nombre}» eliminada.` })
      } else {
        const activa = pendiente.tipo === 'reactivar'
        await acciones.estadoMarca.mutateAsync({ id: m.id, activa })
        setAviso({ tono: 'ok', titulo: activa ? `Marca «${m.nombre}» reactivada.` : `Marca «${m.nombre}» desactivada.` })
      }
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeErrorMaestro(codigo(e)))
    }
  }

  const columnas: Column<Marca>[] = [
    {
      key: 'nombre',
      header: 'Marca',
      mobile: 'title',
      render: (m) => <span className={styles.nombre}>{m.nombre}</span>,
    },
    { key: 'productos', header: 'Productos', align: 'right', width: '8rem', render: (m) => m.productos.toLocaleString('es-AR') },
    { key: 'equipos', header: 'Equipos', align: 'right', width: '7rem', render: (m) => m.equipos.toLocaleString('es-AR') },
    { key: 'estado', header: 'Estado', width: '8rem', render: (m) => <ChipActiva activa={m.activa} /> },
  ]

  return (
    <>
      <div className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Marcas</h1>
          <p className={styles.subtitulo}>Marcas de productos de {activa?.companyName ?? 'la empresa'}.</p>
        </div>
        {admin && (
          <Button onClick={() => abrir({ tipo: 'crear' })} disabled={ocupado}>
            Nueva marca
          </Button>
        )}
      </div>

      {!q.isPending && !q.isError && !admin && <StatusMessage tono="pending" titulo="Sólo lectura" detalle="Sólo un administrador puede crear, desactivar o eliminar marcas." />}
      <p className={styles.nota}>{AUTORIDAD.marcasNombre}</p>

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} />}

      {q.isError ? (
        <StatusMessage tono="error" titulo={codigo(q.error) === 'sin_permiso' ? 'Tu rol no tiene acceso a las marcas.' : mensajeErrorMaestro(codigo(q.error))} />
      ) : (
        <>
          <div className={styles.barra}>
            <input
              className={cx(styles.control, styles.buscar)}
              type="search"
              placeholder="Buscar marca"
              aria-label="Buscar marca"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <select className={styles.selectFiltro} aria-label="Filtrar por estado" value={estado} onChange={(e) => setEstado(e.target.value as FiltroEstado)}>
              <option value="todas">Todas</option>
              <option value="activas">Activas</option>
              <option value="inactivas">Inactivas</option>
            </select>
            {q.data && <span className={styles.nota}>{visibles.length === lista.length ? `${lista.length} marcas` : `${visibles.length} de ${lista.length}`}</span>}
          </div>
          <ResponsiveTable
            columns={columnas}
            rows={visibles}
            rowKey={(m) => m.id}
            isLoading={q.isPending}
            emptyMessage={lista.length === 0 ? 'Esta empresa todavía no tiene marcas.' : 'Ninguna marca coincide con el filtro.'}
            {...(admin ? { actions: (m: Marca) => <Acciones m={m} deshabilitado={ocupado} abrir={abrir} /> } : {})}
            renderCard={(m) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  <span className={styles.nombre}>{m.nombre}</span>
                  <ChipActiva activa={m.activa} />
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Productos</dt>
                  <dd>{m.productos.toLocaleString('es-AR')}</dd>
                  <dt>Equipos</dt>
                  <dd>{m.equipos.toLocaleString('es-AR')}</dd>
                </dl>
                {admin && (
                  <div className={styles.cardAcciones}>
                    <Acciones m={m} deshabilitado={ocupado} abrir={abrir} />
                  </div>
                )}
              </article>
            )}
          />
        </>
      )}

      {pendiente?.tipo === 'crear' && (
        <DialogoNombre
          titulo="Nueva marca"
          etiqueta="Nombre de la marca"
          textoBoton="Crear marca"
          existentes={lista}
          ayuda="Se guarda sin espacios de más. No se distinguen mayúsculas para detectar duplicados."
          guardando={acciones.crearMarca.isPending}
          error={errorDialogo}
          onGuardar={(n) => void crear(n)}
          onCerrar={cerrar}
        />
      )}
      {pendiente && pendiente.tipo !== 'crear' && (
        <Dialogo
          titulo={{ desactivar: 'Desactivar marca', reactivar: 'Reactivar marca', eliminar: 'Eliminar marca' }[pendiente.tipo]}
          onCerrar={cerrar}
          bloqueado={ocupado}
          pie={
            <>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button className={pendiente.tipo === 'eliminar' ? styles.peligro : undefined} onClick={() => void confirmar()} disabled={ocupado}>
                {ocupado ? 'Guardando…' : { desactivar: 'Desactivar', reactivar: 'Reactivar', eliminar: 'Eliminar' }[pendiente.tipo]}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>
            {pendiente.tipo === 'desactivar'
              ? textoDesactivar(pendiente.m)
              : pendiente.tipo === 'reactivar'
                ? `«${pendiente.m.nombre}» vuelve a aparecer en los filtros del Catálogo.`
                : `«${pendiente.m.nombre}» no tiene productos ni equipos. Se elimina y queda registrado en la bitácora.`}
          </p>
          {errorDialogo && <StatusMessage tono="error" titulo={errorDialogo} />}
        </Dialogo>
      )}
    </>
  )
}

function ChipActiva({ activa }: { activa: boolean }) {
  return <span className={cx(styles.chip, activa ? styles.tono_ok : styles.tono_neutro)}>{activa ? 'Activa' : 'Inactiva'}</span>
}

function Acciones({ m, deshabilitado, abrir }: { m: Marca; deshabilitado: boolean; abrir: (p: Pendiente) => void }) {
  const eliminar = puedeEliminarMarca(m)
  return (
    <span className={styles.acciones}>
      {m.activa ? (
        <Button variant="secondary" onClick={() => abrir({ tipo: 'desactivar', m })} disabled={deshabilitado}>
          Desactivar
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => abrir({ tipo: 'reactivar', m })} disabled={deshabilitado}>
          Reactivar
        </Button>
      )}
      {eliminar.ok && (
        <Button variant="ghost" onClick={() => abrir({ tipo: 'eliminar', m })} disabled={deshabilitado}>
          Eliminar
        </Button>
      )}
    </span>
  )
}
