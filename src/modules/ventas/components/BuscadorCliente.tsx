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
  const termino = consulta.trim()

  const resultados = useQuery({
    queryKey: ['ventas', companyId, 'buscar-cliente', consulta],
    queryFn: () => buscarClientes(companyId!, consulta),
    // Fase 22 · A8: la consulta no sale hasta que haya algo que buscar. El
    // servicio ya devuelve [] con menos de dos caracteres; no habilitarla
    // evita además el request.
    enabled: companyId !== null && buscando && termino.length >= 2,
    staleTime: 30_000,
  })

  const opciones = resultados.data ?? []
  const sinCoincidencias = termino.length >= 2 && !resultados.isFetching && opciones.length === 0

  /**
   * La lista existe sólo cuando tiene algo adentro.
   *
   * Antes salía siempre, y con menos de dos letras su único renglón era «Escribí
   * al menos dos letras del nombre, el CUIT o la referencia». Con el borde y el
   * fondo de la lista, ese cartel se leía como un SEGUNDO campo vacío debajo del
   * buscador: lo primero que se ve al abrir un documento nuevo era un formulario
   * que parece pedir dos cosas. Y era redundante —el placeholder ya dice
   * «Nombre, CUIT o referencia…»—, así que se fue.
   *
   * Sin esta condición el `<ul>` vacío seguiría dibujando su borde: una franja
   * de dos píxeles colgando del campo.
   */
  const hayLista = opciones.length > 0 || resultados.isFetching || sinCoincidencias

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
      ) : hayLista ? (
        <ul className={enHoja ? `${styles.lista} ${styles.listaHoja}` : styles.lista}>
          {opciones.map((c) => (
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
          {sinCoincidencias ? <li className={styles.nota}>Ningún cliente activo coincide.</li> : null}
        </ul>
      ) : null}
      {valor !== null ? (
        <button type="button" className={styles.cambiar} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      ) : null}
    </div>
  )
}
