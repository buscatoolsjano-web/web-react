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
import { FalloDeAgenda } from '../services/edicion'
import { CONTACTO_VACIO, validarContacto, type DatosContacto } from '../lib/validacion'
import type { ContactoCliente } from '../types'
import styles from './EditorContactos.module.css'

export interface EditorContactosProps {
  clienteId: string
  contactos: readonly ContactoCliente[]
  cargando: boolean
  /** Lo decide el rol y el cliente; lo IMPIDE `app.puede_administrar_cliente`. */
  puedeEditar: boolean
  /** Para volver a leer la lista cuando hubo un conflicto de edición. */
  onRecargar?: () => void
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
    activo: c.activo,
  }
}

/**
 * Los contactos del cliente.
 *
 * La relación es siempre `customer_id`, que es NOT NULL: no existe la opción
 * de guardar un contacto «de tal empresa» escribiendo el nombre, que es como
 * los tenía el legacy y por qué renombrar un cliente le perdía la agenda.
 *
 * Fase 17 · E3, tres cambios de fondo:
 *
 * - **Una sola escritura.** Antes eran dos —bajar el principal anterior y
 *   después guardar— y entre las dos el cliente podía quedar sin ninguno.
 *   Ahora es `guardar_contacto`, una transacción.
 * - **Concurrencia.** Se manda el `updated_at` que se leyó. Si alguien guardó
 *   en el medio, el servidor corta y la pantalla ofrece recargar; el borrador
 *   queda intacto.
 * - **Desactivar en vez de borrar.** Un contacto que figura en documentos
 *   emitidos no se borra: se desactiva. Deja de ofrecerse en los documentos
 *   nuevos y los viejos lo siguen nombrando.
 */
export function EditorContactos({
  clienteId,
  contactos,
  cargando,
  puedeEditar,
  onRecargar,
}: EditorContactosProps) {
  const id = useId()
  const { guardar, borrar } = useContactosEdicion(clienteId)
  const [editando, setEditando] = useState<string | null>(null)
  const [esperado, setEsperado] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosContacto>(CONTACTO_VACIO)
  const [errores, setErrores] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState<ContactoCliente | null>(null)

  const abrirNuevo = () => {
    setDatos({ ...CONTACTO_VACIO, esPrincipal: contactos.filter((c) => c.activo).length === 0 })
    setErrores([])
    setEsperado(null)
    setEditando('nuevo')
  }

  const abrirEdicion = (c: ContactoCliente) => {
    setDatos(aDatos(c))
    setErrores([])
    setEsperado(c.actualizadoEn)
    setEditando(c.id)
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarContacto(datos)
    setErrores(encontrados)
    if (encontrados.length > 0) return
    guardar.mutate(
      { id: editando === 'nuevo' ? null : editando, esperado, datos },
      { onSuccess: () => setEditando(null) },
    )
  }

  /** Activar o desactivar desde la fila: un solo campo, sin abrir el formulario. */
  const cambiarActivo = (c: ContactoCliente, activo: boolean) => {
    guardar.mutate({ id: c.id, esperado: c.actualizadoEn, datos: { ...aDatos(c), activo } })
  }

  const fallo = guardar.error ?? borrar.error
  const esConflicto = fallo instanceof FalloDeAgenda && fallo.esConflicto
  const referenciado = borrar.error instanceof FalloDeAgenda && borrar.error.esReferenciado

  const campo = (
    clave: keyof DatosContacto,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> & { requerido?: boolean } = {},
  ) => {
    const { requerido = false, ...resto } = extra
    return (
      <Field label={etiqueta} required={requerido} id={`${id}-${clave}`}>
        <Input
          value={String(datos[clave] ?? '')}
          onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })}
          {...resto}
        />
      </Field>
    )
  }

  /** El mismo formulario para el alta y para la edición. */
  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={enviar} noValidate>
      <div className={styles.grilla}>
        {campo('nombre', 'Nombre', { requerido: true, autoFocus: true })}
        {campo('cargo', 'Cargo')}
        {campo('email', 'Email', { type: 'email' })}
        {campo('telefono', 'Teléfono', { type: 'tel' })}
        {campo('fax', 'Fax')}
      </div>
      <Checkbox
        label="Contacto principal"
        help="Es el que se sugiere al armar una cotización o un pedido nuevo. Sólo puede haber uno."
        checked={datos.esPrincipal}
        disabled={!datos.activo}
        onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })}
      />
      {editando !== 'nuevo' ? (
        <Checkbox
          label="Activo"
          help="Desactivado deja de ofrecerse en documentos nuevos; los ya emitidos lo siguen nombrando."
          checked={datos.activo}
          onChange={(e) =>
            setDatos({
              ...datos,
              activo: e.target.checked,
              esPrincipal: e.target.checked ? datos.esPrincipal : false,
            })
          }
        />
      ) : null}
      {errores.length > 0 || guardar.error ? (
        <Alert
          tone="danger"
          role="alert"
          title={guardar.error ? 'No se pudo guardar' : 'Revisá el contacto'}
        >
          {errores.map((m) => (
            <p key={m}>{m}</p>
          ))}
          {guardar.error ? <p>{guardar.error.message}</p> : null}
          {esConflicto && onRecargar ? (
            <Button variant="secondary" size="sm" onClick={onRecargar}>
              Recargar
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <div className={styles.acciones}>
        <Button type="submit" variant="primary" loading={guardar.isPending}>
          {guardar.isPending ? 'Guardando…' : etiquetaBoton}
        </Button>
        <Button variant="ghost" onClick={() => setEditando(null)} disabled={guardar.isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  )

  if (cargando) return <SkeletonRows rows={3} columns={2} label="Cargando contactos…" />

  // Fase 17 · E5. Los 87 contactos migrados quedaron sin principal y **no se
  // marcó ninguno por script**: quién atiende a cada cliente no lo sabe una
  // migración. Lo que sí corresponde es decirlo donde se puede arreglar.
  const hayActivos = contactos.some((c) => c.activo)
  const sinPrincipal = hayActivos && !contactos.some((c) => c.activo && c.esPrincipal)

  return (
    <div className={styles.wrap}>
      {sinPrincipal ? (
        <Alert tone="info" role="status" title="Este cliente no tiene un contacto principal">
          <p>
            El principal es el que se propone al armar una cotización o un pedido nuevo.
            {puedeEditar ? ' Marcalo con «Editar» en el contacto que corresponda.' : ''}
          </p>
        </Alert>
      ) : null}
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
            <li key={c.id} className={c.activo ? styles.item : `${styles.item} ${styles.inactivo}`}>
              <div className={styles.cabecera}>
                <span className={styles.nombre}>{c.nombre}</span>
                {c.esPrincipal ? <Badge tone="brand">Principal</Badge> : null}
                {c.activo ? null : <Badge tone="neutral">Desactivado</Badge>}
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
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="edit" size={16} />}
                    onClick={() => abrirEdicion(c)}
                  >
                    Editar
                  </Button>
                  {c.activo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cambiarActivo(c, false)}
                      disabled={guardar.isPending}
                    >
                      Desactivar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cambiarActivo(c, true)}
                      disabled={guardar.isPending}
                    >
                      Reactivar
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.peligro}
                    icon={<Icon name="trash" size={16} />}
                    onClick={() => setConfirmando(c)}
                  >
                    Borrar
                  </Button>
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
        <Alert tone="danger" role="alert" title="No se pudo borrar el contacto">
          <p>{borrar.error.message}</p>
        </Alert>
      ) : null}

      {editando === null && guardar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar el contacto">
          <p>{guardar.error.message}</p>
          {esConflicto && onRecargar ? (
            <Button variant="secondary" size="sm" onClick={onRecargar}>
              Recargar
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {puedeEditar && editando === null ? (
        <Button
          variant="secondary"
          className={styles.agregar}
          icon={<Icon name="plus" size={16} />}
          onClick={abrirNuevo}
        >
          Agregar contacto
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmando !== null}
        tone="danger"
        title={`¿Borrar el contacto ${confirmando?.nombre ?? ''}?`}
        description={
          referenciado
            ? 'Figura en documentos ya emitidos, así que no se puede borrar. Lo que corresponde es desactivarlo.'
            : 'Si figura en algún documento no se va a poder borrar: en ese caso, desactivalo.'
        }
        confirmLabel={referenciado ? 'Desactivarlo' : 'Borrar contacto'}
        cancelLabel="Volver"
        busy={borrar.isPending || guardar.isPending}
        onConfirm={() => {
          if (!confirmando) return
          if (referenciado) {
            cambiarActivo(confirmando, false)
            setConfirmando(null)
            borrar.reset()
            return
          }
          borrar.mutate(confirmando.id, {
            onSuccess: () => setConfirmando(null),
            // Si no se pudo borrar porque está referenciado, el diálogo queda
            // abierto y cambia de oferta: desactivarlo.
            onError: (e) => {
              if (!(e instanceof FalloDeAgenda && e.esReferenciado)) setConfirmando(null)
            },
          })
        }}
        onCancel={() => {
          setConfirmando(null)
          borrar.reset()
        }}
      />
    </div>
  )
}
