import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarClientes, nombreDeCliente } from '../services/clientes'
import styles from './BuscadorCliente.module.css'

export interface BuscadorClienteProps {
  /** El cliente ya elegido, si hay uno. */
  valor: string | null
  editable: boolean
  onElegir: (id: string | null) => void
}

/**
 * Elegir el cliente de un documento nuevo.
 *
 * Antes era un `<select>` con todos los clientes de la empresa. Con 60
 * andaba; después de migrar el maestro de la Fase 5 son **1.010**, y un
 * desplegable de mil opciones no se usa: hay que scrollear a ciegas y en el
 * teléfono es peor.
 *
 * Ahora es el mismo patrón que el buscador de productos: cada tecla
 * —debounceada— pide como mucho 20 filas al servidor.
 *
 * Un cliente **dado de baja o inactivo no aparece**. Sigue existiendo y sus
 * documentos lo siguen nombrando; lo que no se puede es armarle uno nuevo.
 */
export function BuscadorCliente({ valor, editable, onElegir }: BuscadorClienteProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const id = useId()
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(t)
  }, [texto])

  // El nombre del cliente ya elegido: sin esto, al abrir un documento
  // existente el campo aparece vacío aunque tenga cliente.
  const elegido = useQuery({
    queryKey: ['ventas', companyId, 'cliente', valor],
    queryFn: () => nombreDeCliente(companyId!, valor!),
    enabled: companyId !== null && valor !== null,
    staleTime: 5 * 60_000,
  })

  const resultados = useQuery({
    queryKey: ['ventas', companyId, 'buscar-cliente', consulta],
    queryFn: () => buscarClientes(companyId!, consulta),
    enabled: companyId !== null && abierto,
    staleTime: 30_000,
  })

  if (!editable || (valor !== null && !abierto)) {
    return (
      <div className={styles.elegido}>
        <span className={styles.nombre}>
          {valor === null
            ? 'Sin cliente'
            : elegido.isPending
              ? 'Cargando…'
              : (elegido.data?.nombre ?? 'Cliente no accesible')}
        </span>
        {elegido.data?.dadoDeBaja ? <span className={styles.baja}>dado de baja</span> : null}
        {editable ? (
          <button
            type="button"
            className={styles.cambiar}
            onClick={() => {
              setTexto('')
              setConsulta('')
              setAbierto(true)
            }}
          >
            Cambiar
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <input
        id={id}
        type="search"
        className={styles.input}
        value={texto}
        placeholder="Nombre, CUIT o referencia…"
        aria-label="Buscar cliente"
        onChange={(e) => setTexto(e.target.value)}
        autoFocus={valor !== null}
      />
      {resultados.error ? (
        <p className={styles.error} role="alert">
          {resultados.error.message}
        </p>
      ) : (
        <ul className={styles.lista}>
          {(resultados.data ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={styles.opcion}
                onClick={() => {
                  onElegir(c.id)
                  setAbierto(false)
                }}
              >
                {c.nombre}
              </button>
            </li>
          ))}
          {resultados.isFetching ? <li className={styles.nota}>Buscando…</li> : null}
          {!resultados.isFetching && (resultados.data ?? []).length === 0 ? (
            <li className={styles.nota}>
              {consulta.trim() === ''
                ? 'Escribí para buscar.'
                : 'Ningún cliente activo coincide.'}
            </li>
          ) : null}
        </ul>
      )}
      {valor !== null ? (
        <button type="button" className={styles.cambiar} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      ) : null}
    </div>
  )
}
