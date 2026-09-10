import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarProveedores, type ProveedorBuscado } from '../services/catalogo'
import styles from './BuscadorProveedor.module.css'

export interface BuscadorProveedorProps {
  /** El proveedor ya elegido, para mostrarlo sin volver a buscarlo. */
  elegido: ProveedorBuscado | null
  deshabilitado?: boolean
  error?: string | null
  onElegir: (p: ProveedorBuscado) => void
  onLimpiar: () => void
}

/**
 * Buscador de proveedores, contra el servidor.
 *
 * Un `<select>` con los 142 ya sería incómodo, y con 500 sería el error que
 * cometimos en Ventas: un desplegable de 1.010 clientes que había que
 * reemplazar. Se busca por razón social, nombre comercial y referencia, y
 * vuelven como mucho 20 filas.
 *
 * Los dados de baja y los inactivos **no aparecen**: para eso sirve la baja
 * lógica. Un pedido viejo los sigue nombrando igual.
 */
export function BuscadorProveedor({
  elegido,
  deshabilitado = false,
  error = null,
  onElegir,
  onLimpiar,
}: BuscadorProveedorProps) {
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
    queryKey: ['compras', companyId, 'buscar-proveedor', consulta],
    queryFn: () => buscarProveedores(companyId!, consulta),
    enabled: companyId !== null && abierto,
    staleTime: 30_000,
  })

  if (elegido && !abierto) {
    return (
      <div className={styles.campo}>
        <span className={styles.etiqueta}>Proveedor *</span>
        <div className={styles.elegido}>
          <span className={styles.nombre}>{elegido.razonSocial}</span>
          {elegido.referencia ? (
            <span className={styles.ref}>{elegido.referencia}</span>
          ) : null}
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
        Proveedor *
      </label>
      <input
        id={id}
        type="search"
        className={styles.control}
        placeholder="Razón social, nombre comercial o PROV00…"
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
          ) : (data ?? []).length === 0 ? (
            <p className={styles.nota}>Sin resultados.</p>
          ) : (
            <ul className={styles.lista}>
              {(data ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.fila}
                    onClick={() => {
                      onElegir(p)
                      setAbierto(false)
                    }}
                  >
                    <span className={styles.filaRef}>{p.referencia ?? '—'}</span>
                    <span className={styles.filaNombre}>{p.razonSocial}</span>
                    <span className={styles.filaExtra}>{p.formaPago ?? ''}</span>
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
