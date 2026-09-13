import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FiltrosEmails } from '../components/FiltrosEmails'
import { ListadoEmails } from '../components/ListadoEmails'
import { useAsignables, useBandeja, useCuentas, useFiltrosEmails } from '../hooks/useEmails'
import { useRealtimeEmails } from '../hooks/useRealtimeEmails'
import { TAMANOS_BANDEJA } from '../lib/filtros'
import { puedeUsarEmails } from '../lib/permisos'
import styles from '../components/Emails.module.css'

/**
 * La bandeja.
 *
 * Sale de `email_threads`, nunca de Gmail: metadata, paginada en el servidor,
 * de a 25. El legacy mandaba 766 kB por request, 716 de ellos en `body_text`.
 */
export function EmailsPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Emails</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a la bandeja de correo.</p>
      </div>
    )
  }
  return <Bandeja />
}

function Bandeja() {
  const { filtros, aplicar, limpiar, hayFiltros } = useFiltrosEmails()
  const cuentas = useCuentas()
  const asignables = useAsignables()
  const bandeja = useBandeja(filtros)
  const { canal, reconectar } = useRealtimeEmails()

  const buzones = useMemo(
    () => new Map((cuentas.data ?? []).map((c) => [c.id, c.direccion] as const)),
    [cuentas.data],
  )
  const conError = (cuentas.data ?? []).filter((c) => c.errorSync)
  const total = bandeja.data?.total ?? 0
  const sinLeer = bandeja.data?.totalSinLeer ?? 0
  const paginas = Math.max(1, Math.ceil(total / filtros.porPagina))
  const unaCuenta = cuentas.data?.length === 1 ? cuentas.data[0] : null

  return (
    <div className={styles.page}>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Emails</h1>
          <p className={styles.subtitulo}>
            {bandeja.isPending
              ? 'Cargando…'
              : `${total} ${total === 1 ? 'hilo' : 'hilos'} · ${sinLeer} sin leer`}
            {unaCuenta ? ` · ${unaCuenta.direccion}` : ''}
          </p>
        </div>
        <span className={styles.accionesEncabezado}>
        <Link to="/emails/redactar" className={styles.botonPrimario}>
          Nuevo email
        </Link>
        <Link to="/emails/borradores" className={styles.boton}>
          Borradores
        </Link>
        <button
          type="button"
          className={styles.boton}
          onClick={reconectar}
          disabled={bandeja.isFetching}
          aria-label="Actualizar la bandeja"
        >
          {bandeja.isFetching && !bandeja.isPending ? 'Actualizando…' : 'Actualizar'}
        </button>
        </span>
      </header>

      {canal === 'caido' ? (
        <div className={styles.aviso} role="status">
          <span>La actualización en vivo se desconectó. Lo nuevo no va a aparecer solo.</span>
          <button type="button" className={styles.boton} onClick={reconectar}>
            Reconectar
          </button>
        </div>
      ) : null}

      {conError.map((c) => (
        <div key={c.id} className={styles.aviso} role="status">
          <span>
            La sincronización de {c.direccion} tuvo un problema
            {c.errorSyncEn ? ` (${new Date(c.errorSyncEn).toLocaleString('es-AR')})` : ''}. Puede faltar correo
            reciente hasta que se recupere.
          </span>
        </div>
      ))}

      <FiltrosEmails
        filtros={filtros}
        hayFiltros={hayFiltros}
        cuentas={cuentas.data ?? []}
        asignables={asignables.data ?? []}
        onAplicar={aplicar}
        onLimpiar={limpiar}
      />

      {bandeja.error ? (
        <div className={styles.error} role="alert">
          <span>No se pudo leer la bandeja: {bandeja.error.message}</span>
          <button type="button" className={styles.boton} onClick={() => void bandeja.refetch()}>
            Reintentar
          </button>
        </div>
      ) : cuentas.data && cuentas.data.length === 0 ? (
        <div className={styles.vacio}>
          <p>Esta empresa no tiene ninguna cuenta de correo conectada.</p>
        </div>
      ) : bandeja.isPending ? (
        <p className={styles.nota}>Cargando la bandeja…</p>
      ) : total === 0 ? (
        <div className={styles.vacio}>
          {hayFiltros ? (
            <>
              <p>Ningún hilo coincide con los filtros.</p>
              <button type="button" className={styles.boton} onClick={limpiar}>
                Limpiar filtros
              </button>
            </>
          ) : (
            <p>La bandeja está vacía.</p>
          )}
        </div>
      ) : (bandeja.data?.filas ?? []).length === 0 ? (
        <div className={styles.vacio}>
          <p>No hay hilos en esta página.</p>
          <button type="button" className={styles.boton} onClick={() => aplicar({ pagina: 1 })}>
            Ir a la primera página
          </button>
        </div>
      ) : (
        <ListadoEmails filas={bandeja.data?.filas ?? []} buzones={buzones} />
      )}

      {total > 0 ? (
        <nav className={styles.paginador} aria-label="Paginación">
          <span className={styles.rango} aria-live="polite">
            {`${(filtros.pagina - 1) * filtros.porPagina + 1}–${Math.min(filtros.pagina * filtros.porPagina, total)} de ${total}`}
          </span>
          <select
            className={styles.select}
            value={filtros.porPagina}
            onChange={(e) => aplicar({ porPagina: Number(e.target.value) })}
            aria-label="Hilos por página"
          >
            {TAMANOS_BANDEJA.map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
          <span className={styles.barra}>
            <button
              type="button"
              className={styles.boton}
              disabled={filtros.pagina <= 1 || bandeja.isFetching}
              onClick={() => aplicar({ pagina: filtros.pagina - 1 })}
            >
              ← Anterior
            </button>
            <span className={styles.rango}>
              {filtros.pagina} / {paginas}
            </span>
            <button
              type="button"
              className={styles.boton}
              disabled={filtros.pagina >= paginas || bandeja.isFetching}
              onClick={() => aplicar({ pagina: filtros.pagina + 1 })}
            >
              Siguiente →
            </button>
          </span>
        </nav>
      ) : null}
    </div>
  )
}
