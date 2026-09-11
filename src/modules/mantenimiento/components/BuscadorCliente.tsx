import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarClientes, type ClienteBuscado } from '../services/catalogo'
import styles from './BuscadorCliente.module.css'

export interface BuscadorClienteProps {
  /** El cliente ya elegido, para mostrarlo sin volver a buscarlo. */
  elegido: ClienteBuscado | null
  etiqueta: string
  /** El dueño de un equipo puede no existir; el cliente de una orden, no. */
  obligatorio?: boolean
  deshabilitado?: boolean
  error?: string | null
  onElegir: (c: ClienteBuscado) => void
  onLimpiar: () => void
}

/**
 * Buscador de clientes, contra el servidor.
 *
 * Hay 1.010 clientes. Un `<select>` con todos fue exactamente el error que
 * hubo que deshacer en Ventas. Se busca por razón social, nombre comercial y
 * referencia, y vuelven como mucho 20 filas.
 */
export function BuscadorCliente({
  elegido,
  etiqueta,
  obligatorio = false,
  deshabilitado = false,
  error = null,
  onElegir,
  onLimpiar,
}: BuscadorClienteProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')

  // Se espera a que la persona pare de tipear.
  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

  const { data, isFetching } = useQuery({
    queryKey: ['mantenimiento', companyId, 'buscar-cliente', consulta],
    queryFn: () => buscarClientes(companyId!, consulta),
    enabled: companyId !== null && abierto,
    staleTime: 30_000,
  })

  const titulo = obligatorio ? `${etiqueta} *` : etiqueta

  if (elegido && !abierto) {
    return (
      <div className={styles.campo}>
        <span className={styles.etiqueta}>{titulo}</span>
        <div className={styles.elegido}>
          <span className={styles.nombre}>{elegido.razonSocial}</span>
          {elegido.referencia ? <span className={styles.ref}>{elegido.referencia}</span> : null}
          {!deshabilitado ? (
            <>
              <button
                type="button"
                className={styles.cambiar}
                onClick={() => {
                  setAbierto(true)
                  setTexto('')
                  setConsulta('')
                }}
              >
                Cambiar
              </button>
              {!obligatorio ? (
                <button type="button" className={styles.cambiar} onClick={onLimpiar}>
                  Quitar
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.campo}>
      <label className={styles.etiqueta} htmlFor={id}>
        {titulo}
      </label>
      <input
        id={id}
        type="search"
        className={styles.control}
        placeholder="Razón social, nombre comercial o CLI00…"
        value={texto}
        disabled={deshabilitado}
        aria-invalid={error ? true : undefined}
        onFocus={() => setAbierto(true)}
        onChange={(e) => setTexto(e.target.value)}
      />

      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}

      {abierto ? (
        <div className={styles.panel}>
          {isFetching ? (
            <p className={styles.nota}>Buscando…</p>
          ) : consulta.trim().length < 2 ? (
            <p className={styles.nota}>Escribí al menos dos caracteres.</p>
          ) : (data ?? []).length === 0 ? (
            <p className={styles.nota}>Sin resultados.</p>
          ) : (
            <ul className={styles.lista}>
              {(data ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={styles.fila}
                    onClick={() => {
                      onElegir(c)
                      setAbierto(false)
                    }}
                  >
                    <span className={styles.filaRef}>{c.referencia ?? '—'}</span>
                    <span className={styles.filaNombre}>{c.razonSocial}</span>
                    <span className={styles.filaExtra}>{c.nombreComercial ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.cerrar}
              onClick={() => {
                setAbierto(false)
                if (!elegido) onLimpiar()
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
