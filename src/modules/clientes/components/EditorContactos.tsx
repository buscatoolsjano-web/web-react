import { useId, useState } from 'react'
import { useContactosEdicion } from '../hooks/useEdicionClientes'
import { CONTACTO_VACIO, validarContacto, type DatosContacto } from '../lib/validacion'
import type { ContactoCliente } from '../types'
import styles from './EditorContactos.module.css'

export interface EditorContactosProps {
  clienteId: string
  contactos: readonly ContactoCliente[]
  cargando: boolean
  /** Lo decide el rol; lo IMPIDE la policy `contacts_write`. */
  puedeEditar: boolean
}

function aDatos(c: ContactoCliente): DatosContacto {
  return {
    nombre: c.nombre,
    cargo: c.cargo ?? '',
    email: c.email ?? '',
    telefono: c.telefono ?? '',
    fax: c.fax ?? '',
    esPrincipal: c.esPrincipal,
    notas: c.notas ?? '',
  }
}

/**
 * Los contactos del cliente, con alta, edición y borrado.
 *
 * La relación es siempre `customer_id`, que es NOT NULL: no existe la opción
 * de guardar un contacto «de tal empresa» escribiendo el nombre, que es como
 * los tenía el legacy y por qué renombrar un cliente le perdía la agenda.
 *
 * Un contacto **sí** se borra de verdad: no tiene documentos colgando. El que
 * no se borra nunca es el cliente.
 */
export function EditorContactos({
  clienteId,
  contactos,
  cargando,
  puedeEditar,
}: EditorContactosProps) {
  const id = useId()
  const { crear, actualizar, borrar } = useContactosEdicion(clienteId)
  const [editando, setEditando] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosContacto>(CONTACTO_VACIO)
  const [errores, setErrores] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const abrirNuevo = () => {
    setDatos({ ...CONTACTO_VACIO, esPrincipal: contactos.length === 0 })
    setErrores([])
    setEditando('nuevo')
  }

  const abrirEdicion = (c: ContactoCliente) => {
    setDatos(aDatos(c))
    setErrores([])
    setEditando(c.id)
  }

  const guardar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarContacto(datos)
    setErrores(encontrados)
    if (encontrados.length > 0) return
    const alTerminar = { onSuccess: () => setEditando(null) }
    if (editando === 'nuevo') crear.mutate(datos, alTerminar)
    else if (editando) actualizar.mutate({ id: editando, datos }, alTerminar)
  }

  const guardando = crear.isPending || actualizar.isPending
  const errorAlGuardar = crear.error?.message ?? actualizar.error?.message ?? null

  const campo = (
    clave: keyof DatosContacto,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className={styles.campo}>
      <label className={styles.etiqueta} htmlFor={`${id}-${clave}`}>
        {etiqueta}
      </label>
      <input
        id={`${id}-${clave}`}
        className={styles.control}
        value={String(datos[clave] ?? '')}
        onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })}
        {...extra}
      />
    </div>
  )

  /** El mismo formulario para el alta y para la edición. */
  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={guardar} noValidate>
      {campo('nombre', 'Nombre *', { required: true, autoFocus: true })}
      {campo('cargo', 'Cargo')}
      {campo('email', 'Email', { type: 'email' })}
      {campo('telefono', 'Teléfono')}
      {campo('fax', 'Fax')}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={datos.esPrincipal}
          onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })}
        />
        Contacto principal
      </label>
      {errores.map((m) => (
        <p key={m} className={styles.error} role="alert">
          {m}
        </p>
      ))}
      {errorAlGuardar ? (
        <p className={styles.error} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}
      <div className={styles.acciones}>
        <button type="submit" className={styles.primario} disabled={guardando}>
          {guardando ? 'Guardando…' : etiquetaBoton}
        </button>
        <button
          type="button"
          className={styles.secundario}
          onClick={() => setEditando(null)}
          disabled={guardando}
        >
          Cancelar
        </button>
      </div>
    </form>
  )

  if (cargando) return <p className={styles.nota}>Cargando contactos…</p>

  return (
    <div className={styles.wrap}>
      {contactos.length === 0 && editando === null ? (
        <p className={styles.nota}>Este cliente no tiene contactos cargados.</p>
      ) : null}

      <ul className={styles.lista}>
        {contactos.map((c) =>
          editando === c.id ? (
            <li key={c.id} className={styles.itemForm}>
              {formulario('Guardar')}
            </li>
          ) : (
            <li key={c.id} className={styles.item}>
              <div className={styles.cabecera}>
                <span className={styles.nombre}>{c.nombre}</span>
                {c.esPrincipal ? <span className={styles.principal}>Principal</span> : null}
              </div>
              {c.cargo ? <span className={styles.cargo}>{c.cargo}</span> : null}
              <div className={styles.datos}>
                {c.email ? (
                  <a className={styles.enlace} href={`mailto:${c.email}`}>
                    {c.email}
                  </a>
                ) : null}
                {c.telefono ? <span className={styles.dato}>{c.telefono}</span> : null}
                {c.fax ? <span className={styles.dato}>fax {c.fax}</span> : null}
              </div>
              {c.notas ? <p className={styles.notas}>{c.notas}</p> : null}
              {puedeEditar ? (
                <div className={styles.acciones}>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => abrirEdicion(c)}
                  >
                    Editar
                  </button>
                  {confirmando === c.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.peligro}
                        disabled={borrar.isPending}
                        onClick={() =>
                          borrar.mutate(c.id, { onSuccess: () => setConfirmando(null) })
                        }
                      >
                        {borrar.isPending ? 'Borrando…' : 'Confirmar borrado'}
                      </button>
                      <button
                        type="button"
                        className={styles.secundario}
                        onClick={() => setConfirmando(null)}
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.secundario}
                      onClick={() => setConfirmando(c.id)}
                    >
                      Borrar
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ),
        )}

        {editando === 'nuevo' ? (
          <li className={styles.itemForm}>{formulario('Agregar contacto')}</li>
        ) : null}
      </ul>

      {borrar.error ? (
        <p className={styles.error} role="alert">
          {borrar.error.message}
        </p>
      ) : null}

      {puedeEditar && editando === null ? (
        <button type="button" className={styles.primario} onClick={abrirNuevo}>
          + Agregar contacto
        </button>
      ) : null}
    </div>
  )
}
