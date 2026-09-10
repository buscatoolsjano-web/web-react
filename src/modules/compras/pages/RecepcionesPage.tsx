import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { permisosDe } from '../lib/permisos'
import { descargarCsv, recepcionesACsv } from '../lib/csv'
import { exportarRecepciones } from '../services/recepciones'
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

  /**
   * Exportar.
   *
   * Se lleva lo que muestran los filtros. **Sin importes**: la recepción no
   * está valorizada y no se le inventa un precio para llenar una columna.
   *
   * Va acá arriba, antes del `return` por permisos: un hook después de un
   * retorno temprano cambia el orden de los hooks entre renders.
   */
  const exportar = useMutation({
    mutationFn: () => exportarRecepciones(activa!.companyId, filtros),
    onSuccess: ({ filas }) =>
      descargarCsv(
        `recepciones-${new Date().toISOString().slice(0, 10)}.csv`,
        recepcionesACsv(filas),
      ),
  })

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
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.secundario}
            disabled={exportar.isPending || total === 0}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending ? 'Exportando…' : 'Exportar a CSV'}
          </button>
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
