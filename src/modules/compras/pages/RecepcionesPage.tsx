import { useEffect, useState } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { permisosDe } from '../lib/permisos'
import { ListadoRecepciones } from '../components/ListadoRecepciones'
import { Paginador } from '../components/Paginador'
import { useDepositos, useRecepciones } from '../hooks/useRecepciones'
import { useFiltrosRecepciones } from '../hooks/useFiltrosRecepciones'
import { useProveedores } from '../hooks/useProveedores'
import { FILTROS_INICIALES, type FiltrosRecepciones, type OrdenRecepciones } from '../types'
import filtros_ from '../components/FiltrosPedidos.module.css'
import styles from './ProveedoresPage.module.css'

/** Cuántos filtros hay puestos, sin contar el buscador que está a la vista. */
function contarActivos(f: FiltrosRecepciones): number {
  return [
    f.proveedorId !== null,
    f.pedidoId !== null,
    f.estado !== '',
    f.depositoId !== null,
    f.desde !== '',
    f.hasta !== '',
  ].filter(Boolean).length
}

/**
 * El listado de recepciones.
 *
 * Sin columna de importe: una recepción **no está valorizada** en el schema y
 * no se inventó una. Los filtros se pliegan en mobile, igual que en pedidos.
 */
export function RecepcionesPage() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosRecepciones()
  const { data, isPending, isFetching, error } = useRecepciones(filtros)
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const isMobile = useIsMobile()
  const depositos = useDepositos()
  const proveedores = useProveedores({
    ...FILTROS_INICIALES,
    porPagina: 100,
    orden: 'nombre',
    direccion: 'asc',
  })

  const [desplegado, setDesplegado] = useState(false)
  const [texto, setTexto] = useState(filtros.q)

  // Si el filtro cambia desde afuera hay que reflejarlo en el input. Se ajusta
  // DURANTE el render, no en un useEffect.
  const [qPrevia, setQPrevia] = useState(filtros.q)
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q)
    setTexto(filtros.q)
  }

  useEffect(() => {
    if (texto === filtros.q) return
    const id = setTimeout(() => aplicar({ q: texto }), 300)
    return () => clearTimeout(id)
  }, [texto, filtros.q, aplicar])

  const ordenar = (columna: OrdenRecepciones) => {
    aplicar(
      columna === filtros.orden
        ? { direccion: filtros.direccion === 'asc' ? 'desc' : 'asc' }
        : { orden: columna, direccion: 'desc' },
    )
  }

  if (!permisos.verProveedores) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Notas de entrada</h1>
        <p className={styles.error} role="note">
          Tu rol no tiene acceso a Compras. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  const total = data?.total ?? 0
  const activos = contarActivos(filtros)
  const mostrarTodos = !isMobile || desplegado

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Notas de entrada</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${total} ${total === 1 ? 'recepción' : 'recepciones'}`}
          </p>
        </div>
      </header>

      <p className={styles.subtitulo}>
        Una recepción se crea desde un pedido de compra confirmado, con el botón «Recibir
        mercadería».
      </p>

      <div className={filtros_.barra}>
        <input
          type="search"
          className={filtros_.buscador}
          placeholder="Número de recepción: NEP000…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar por número"
        />

        {isMobile ? (
          <button
            type="button"
            className={filtros_.desplegar}
            aria-expanded={desplegado}
            onClick={() => setDesplegado((v) => !v)}
          >
            {desplegado ? 'Ocultar filtros' : 'Filtros'}
            {activos > 0 ? <span className={filtros_.contador}>{activos}</span> : null}
          </button>
        ) : null}

        {mostrarTodos ? (
          <>
            <select
              className={filtros_.select}
              value={filtros.proveedorId ?? ''}
              onChange={(e) => aplicar({ proveedorId: e.target.value || null })}
              aria-label="Proveedor"
            >
              <option value="">Todos los proveedores</option>
              {(proveedores.data?.filas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razonSocial}
                </option>
              ))}
            </select>

            <select
              className={filtros_.select}
              value={filtros.estado}
              onChange={(e) => aplicar({ estado: e.target.value })}
              aria-label="Estado"
            >
              <option value="">Borradores y confirmadas</option>
              <option value="draft">Borradores</option>
              <option value="confirmed">Confirmadas</option>
            </select>

            {(depositos.data ?? []).length > 1 ? (
              <select
                className={filtros_.select}
                value={filtros.depositoId ?? ''}
                onChange={(e) => aplicar({ depositoId: e.target.value || null })}
                aria-label="Depósito"
              >
                <option value="">Todos los depósitos</option>
                {(depositos.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            ) : null}

            <label className={filtros_.fecha}>
              <span className={filtros_.fechaLabel}>Desde</span>
              <input
                type="date"
                className={filtros_.select}
                value={filtros.desde}
                onChange={(e) => aplicar({ desde: e.target.value })}
              />
            </label>
            <label className={filtros_.fecha}>
              <span className={filtros_.fechaLabel}>hasta</span>
              <input
                type="date"
                className={filtros_.select}
                value={filtros.hasta}
                onChange={(e) => aplicar({ hasta: e.target.value })}
              />
            </label>
          </>
        ) : null}

        {hayFiltros ? (
          <button type="button" className={filtros_.limpiar} onClick={limpiar}>
            Limpiar
          </button>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          No se pudo leer el listado: {error.message}
        </p>
      ) : (
        <>
          <ListadoRecepciones
            filas={data?.filas ?? []}
            orden={filtros.orden}
            direccion={filtros.direccion}
            onOrdenar={ordenar}
            cargando={isPending}
          />
          <Paginador
            pagina={filtros.pagina}
            porPagina={filtros.porPagina}
            total={total}
            cargando={isFetching}
            onIr={(pagina) => aplicar({ pagina })}
            onTamano={(porPagina) => aplicar({ porPagina })}
          />
        </>
      )}
    </div>
  )
}
