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
  /**
   * Dónde vive el buscador (Fase 27 · E7).
   *
   * `erp` es el de siempre: el panel del formulario, sobre fondo oscuro, y
   * sin cliente se abre directamente el campo de búsqueda porque elegirlo es
   * lo primero que hay que hacer.
   *
   * `hoja` es adentro del documento. Ahí la caja de búsqueda del ERP —con su
   * fondo oscuro y su texto de ayuda— rompe la hoja: se ve una caja negra en
   * el medio de un papel blanco. En ese modo el cliente se muestra como
   * TEXTO del documento y el buscador aparece recién al tocarlo.
   */
  apariencia?: 'erp' | 'hoja' | undefined
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
export function BuscadorCliente({ valor, editable, onElegir, apariencia = 'erp' }: BuscadorClienteProps) {
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

  // El buscador está a la vista cuando se puede editar y todavía no hay cliente,
  // o cuando se tocó «Cambiar». `abierto` solo no alcanzaba: en un documento
  // nuevo el campo se mostraba pero la consulta quedaba deshabilitada, así que
  // nunca aparecía ningún cliente. Se vio al emitir la primera cotización desde
  // el ERP, que hasta el cutover no se podía crear.
  const enHoja = apariencia === 'hoja'
  const buscando = editable && (valor === null || abierto)

  const resultados = useQuery({
    queryKey: ['ventas', companyId, 'buscar-cliente', consulta],
    queryFn: () => buscarClientes(companyId!, consulta),
    // Fase 22 · A8: la consulta no sale hasta que haya algo que buscar. El
    // servicio ya devuelve [] con menos de dos caracteres; no habilitarla
    // evita además el request.
    enabled: companyId !== null && buscando && consulta.trim().length >= 2,
    staleTime: 30_000,
  })

  // La misma condición que habilita la consulta, negada: antes acá había una
  // copia escrita a mano y por eso `apariencia` no cambiaba nada —el early
  // return seguía mostrando el buscador abierto en la hoja—.
  if (!buscando) {
    return (
      <div className={enHoja ? styles.elegidoHoja : styles.elegido}>
        <span className={enHoja ? styles.nombreHoja : styles.nombre}>
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
            aria-label={valor === null ? 'Elegir cliente' : 'Cambiar el cliente'}
            className={enHoja ? styles.cambiarHoja : styles.cambiar}
            onClick={() => {
              setTexto('')
              setConsulta('')
              setAbierto(true)
            }}
          >
            {enHoja ? (valor === null ? 'Elegir cliente…' : 'Cambiar') : 'Cambiar'}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={enHoja ? `${styles.panel} ${styles.panelHoja}` : styles.panel}>
      <input
        id={id}
        type="search"
        className={enHoja ? `${styles.input} ${styles.inputHoja}` : styles.input}
        value={texto}
        placeholder={enHoja ? 'Nombre del cliente' : 'Nombre, CUIT o referencia…'}
        aria-label="Buscar cliente"
        onChange={(e) => setTexto(e.target.value)}
        autoFocus={valor !== null}
      />
      {resultados.error ? (
        <p className={styles.error} role="alert">
          {resultados.error.message}
        </p>
      ) : (
        <ul className={enHoja ? `${styles.lista} ${styles.listaHoja}` : styles.lista}>
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
                {c.referencia ? <span className={styles.referencia}>{c.referencia}</span> : null}
                <span>{c.nombre}</span>
              </button>
            </li>
          ))}
          {resultados.isFetching ? <li className={styles.nota}>Buscando…</li> : null}
          {/* En la hoja, con menos de dos letras no se dice nada: es una caja
              de texto y los clientes aparecen al escribir (Fase 28 · E9). El
              panel del formulario sí lleva la ayuda, que ahí es texto de campo
              y no un cartel en el medio del documento. */}
          {!resultados.isFetching && (resultados.data ?? []).length === 0 && !(enHoja && consulta.trim().length < 2) ? (
            <li className={styles.nota}>
              {consulta.trim().length < 2
                ? 'Escribí al menos dos letras del nombre, el CUIT o la referencia.'
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
