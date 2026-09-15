import { useId, useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input } from '@/components/forms/controls'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
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
 * no se borra nunca es el cliente. Fase 13 · E4: el borrado pide confirmación
 * en un `ConfirmDialog` (antes, «Confirmar borrado / No» en línea).
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
  const [confirmando, setConfirmando] = useState<ContactoCliente | null>(null)

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
    extra: React.InputHTMLAttributes<HTMLInputElement> & { requerido?: boolean } = {},
  ) => {
    const { requerido = false, ...resto } = extra
    return (
      <Field label={etiqueta} required={requerido} id={`${id}-${clave}`}>
        <Input value={String(datos[clave] ?? '')} onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} {...resto} />
      </Field>
    )
  }

  /** El mismo formulario para el alta y para la edición. */
  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={guardar} noValidate>
      <div className={styles.grilla}>
        {campo('nombre', 'Nombre', { requerido: true, autoFocus: true })}
        {campo('cargo', 'Cargo')}
        {campo('email', 'Email', { type: 'email' })}
        {campo('telefono', 'Teléfono', { type: 'tel' })}
        {campo('fax', 'Fax')}
      </div>
      <Checkbox label="Contacto principal" checked={datos.esPrincipal} onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })} />
      {errores.length > 0 || errorAlGuardar ? (
        <Alert tone="danger" role="alert" title={errorAlGuardar ? 'No se pudo guardar' : 'Revisá el contacto'}>
          {errores.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {errorAlGuardar ? <p>{errorAlGuardar}</p> : null}
        </Alert>
      ) : null}
      <div className={styles.acciones}>
        <Button type="submit" variant="primary" loading={guardando}>
          {guardando ? 'Guardando…' : etiquetaBoton}
        </Button>
        <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardando}>
          Cancelar
        </Button>
      </div>
    </form>
  )

  if (cargando) return <SkeletonRows rows={3} columns={2} label="Cargando contactos…" />

  return (
    <div className={styles.wrap}>
      {contactos.length === 0 && editando === null ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="users"
          title="Sin contactos cargados"
          description="Las personas de la empresa se cargan acá: nombre, cargo, email y teléfono."
        />
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
                {c.esPrincipal ? <Badge tone="brand">Principal</Badge> : null}
              </div>
              {c.cargo ? <span className={styles.secundario}>{c.cargo}</span> : null}
              <div className={styles.datos}>
                {c.email ? (
                  <a className={styles.enlace} href={`mailto:${c.email}`}>
                    <Icon name="mail" size={16} />
                    {c.email}
                  </a>
                ) : null}
                {c.telefono ? (
                  <span className={styles.dato}>
                    <Icon name="phone" size={16} />
                    {c.telefono}
                  </span>
                ) : null}
                {c.fax ? <span className={styles.dato}>Fax {c.fax}</span> : null}
              </div>
              {c.notas ? <p className={styles.notas}>{c.notas}</p> : null}
              {puedeEditar ? (
                <div className={styles.acciones}>
                  <Button variant="secondary" size="sm" icon={<Icon name="edit" size={16} />} onClick={() => abrirEdicion(c)}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" className={styles.peligro} icon={<Icon name="trash" size={16} />} onClick={() => setConfirmando(c)}>
                    Borrar
                  </Button>
                </div>
              ) : null}
            </li>
          ),
        )}

        {editando === 'nuevo' ? <li className={styles.itemForm}>{formulario('Agregar contacto')}</li> : null}
      </ul>

      {borrar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo borrar el contacto">
          <p>{borrar.error.message}</p>
        </Alert>
      ) : null}

      {puedeEditar && editando === null ? (
        <Button variant="secondary" className={styles.agregar} icon={<Icon name="plus" size={16} />} onClick={abrirNuevo}>
          Agregar contacto
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmando !== null}
        tone="danger"
        title={`¿Borrar el contacto ${confirmando?.nombre ?? ''}?`}
        description="Se borra de la ficha del cliente. No se puede deshacer."
        confirmLabel="Borrar contacto"
        cancelLabel="Volver"
        busy={borrar.isPending}
        onConfirm={() => {
          if (!confirmando) return
          borrar.mutate(confirmando.id, {
            onSuccess: () => setConfirmando(null),
            onError: () => setConfirmando(null),
          })
        }}
        onCancel={() => setConfirmando(null)}
      />
    </div>
  )
}
