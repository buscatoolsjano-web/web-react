import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarActivos, type ActivoBuscado } from '../services/activos'
import styles from './BuscadorCliente.module.css'

export interface BuscadorActivoProps {
  elegido: ActivoBuscado | null
  deshabilitado?: boolean
  error?: string | null
  onElegir: (a: ActivoBuscado) => void
  onLimpiar: () => void
}

/**
 * Buscador de equipos, contra el servidor.
 *
 * Se busca por referencia, serial o etiqueta interna: son las tres formas en
 * que alguien identifica una herramienta en el mostrador. El resultado muestra
 * **el dueño actual** al lado, porque es lo que se precarga como cliente de la
 * orden inmediatamente después.
 */
export function BuscadorActivo({
  elegido,
  deshabilitado = false,
  error = null,
  onElegir,
  onLimpiar,
}: BuscadorActivoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const id = useId()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

  const { data, isFetching } = useQuery({
    queryKey: ['mantenimiento', companyId, 'buscar-activo', consulta],
    queryFn: () => buscarActivos(companyId!, consulta),
    enabled: companyId !== null && abierto,
    staleTime: 30_000,
  })

  if (elegido && !abierto) {
    return (
      <div className={styles.campo}>
        <span className={styles.etiqueta}>Equipo *</span>
        <div className={styles.elegido}>
          <span className={styles.nombre}>{elegido.referencia}</span>
          <span className={styles.ref}>{elegido.serie ?? 'sin serie'}</span>
          {!deshabilitado ? (
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
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.campo}>
      <label className={styles.etiqueta} htmlFor={id}>
        Equipo *
      </label>
      <input
        id={id}
        type="search"
        className={styles.control}
        placeholder="Referencia EQ000…, número de serie o etiqueta"
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
              {(data ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={styles.fila}
                    onClick={() => {
                      onElegir(a)
                      setAbierto(false)
                    }}
                  >
                    <span className={styles.filaRef}>{a.referencia}</span>
                    <span className={styles.filaNombre}>
                      {a.serie ?? 'sin serie'}
                      {a.modelo ? ` · ${a.modelo}` : ''}
                    </span>
                    <span className={styles.filaExtra}>{a.dueno ?? 'sin dueño'}</span>
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
