import { useId, useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import { useDireccionesEdicion } from '../hooks/useEdicionClientes'
import {
  DIRECCION_VACIA,
  TIPOS_DE_DIRECCION,
  validarDireccion,
  type DatosDireccion,
} from '../lib/validacion'
import type { DireccionCliente } from '../types'
import styles from './EditorContactos.module.css'

export interface EditorDireccionesProps {
  clienteId: string
  direcciones: readonly DireccionCliente[]
  cargando: boolean
  puedeEditar: boolean
}

function aDatos(d: DireccionCliente): DatosDireccion {
  return {
    tipo: d.tipo,
    calle: d.calle,
    ciudad: d.ciudad ?? '',
    provincia: d.provincia ?? '',
    codigoPostal: d.codigoPostal ?? '',
    pais: d.pais ?? '',
    notas: d.notas ?? '',
    esPrincipal: d.esPrincipal,
  }
}

const ETIQUETA_TIPO: Record<string, string> = Object.fromEntries(
  TIPOS_DE_DIRECCION.map((t) => [t.valor, t.etiqueta]),
)

/**
 * Las direcciones del cliente.
 *
 * `customer_addresses` está **vacía**: el legacy no guardaba direcciones
 * estructuradas, sólo texto libre dentro del documento. Nada se autocompleta
 * ni se deduce de un dominio: se cargan a mano cuando alguien las sepa.
 *
 * El tipo sale del CHECK de la tabla —`shipping`, `billing`, `both`—. No hay
 * un «otra»: agregarlo sería cambiar el modelo, y no se hace por simetría.
 *
 * Fase 13 · E4: el borrado pide confirmación en un `ConfirmDialog`.
 */
export function EditorDirecciones({
  clienteId,
  direcciones,
  cargando,
  puedeEditar,
}: EditorDireccionesProps) {
  const id = useId()
  const { crear, actualizar, borrar } = useDireccionesEdicion(clienteId)
  const [editando, setEditando] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosDireccion>(DIRECCION_VACIA)
  const [errores, setErrores] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState<DireccionCliente | null>(null)

  const guardar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarDireccion(datos)
    setErrores(encontrados)
    if (encontrados.length > 0) return
    const alTerminar = { onSuccess: () => setEditando(null) }
    if (editando === 'nueva') crear.mutate(datos, alTerminar)
    else if (editando) actualizar.mutate({ id: editando, datos }, alTerminar)
  }

  const guardando = crear.isPending || actualizar.isPending
  const errorAlGuardar = crear.error?.message ?? actualizar.error?.message ?? null

  const campo = (
    clave: keyof DatosDireccion,
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

  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={guardar} noValidate>
      <div className={styles.grilla}>
        <Field label="Tipo" id={`${id}-tipo`}>
          <Select value={datos.tipo} onChange={(e) => setDatos({ ...datos, tipo: e.target.value })}>
            {TIPOS_DE_DIRECCION.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </Select>
        </Field>
        {campo('calle', 'Calle y número', { requerido: true, autoFocus: true })}
        {campo('ciudad', 'Ciudad')}
        {campo('provincia', 'Provincia')}
        {campo('codigoPostal', 'Código postal')}
        {campo('pais', 'País', { placeholder: 'AR', maxLength: 2 })}
        {campo('notas', 'Notas')}
      </div>
      <Checkbox label="Principal para este tipo" checked={datos.esPrincipal} onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })} />
      {errores.length > 0 || errorAlGuardar ? (
        <Alert tone="danger" role="alert" title={errorAlGuardar ? 'No se pudo guardar' : 'Revisá la dirección'}>
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

  if (cargando) return <SkeletonRows rows={2} columns={2} label="Cargando direcciones…" />

  return (
    <div className={styles.wrap}>
      {direcciones.length === 0 && editando === null ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="map-pin"
          title="Sin direcciones cargadas"
          description="El sistema anterior no las guardaba estructuradas y no se deducen de otro dato."
        />
      ) : null}

      <ul className={styles.lista}>
        {direcciones.map((d) =>
          editando === d.id ? (
            <li key={d.id} className={styles.itemForm}>
              {formulario('Guardar')}
            </li>
          ) : (
            <li key={d.id} className={styles.item}>
              <div className={styles.cabecera}>
                <span className={styles.nombre}>{ETIQUETA_TIPO[d.tipo] ?? d.tipo}</span>
                {d.esPrincipal ? <Badge tone="brand">Principal</Badge> : null}
              </div>
              <div className={styles.datos}>
                <span className={styles.dato}>
                  <Icon name="map-pin" size={16} />
                  {d.texto || '—'}
                </span>
                {d.notas ? <span className={styles.secundario}>{d.notas}</span> : null}
              </div>
              {puedeEditar ? (
                <div className={styles.acciones}>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="edit" size={16} />}
                    onClick={() => {
                      setDatos(aDatos(d))
                      setErrores([])
                      setEditando(d.id)
                    }}
                  >
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" className={styles.peligro} icon={<Icon name="trash" size={16} />} onClick={() => setConfirmando(d)}>
                    Borrar
                  </Button>
                </div>
              ) : null}
            </li>
          ),
        )}

        {editando === 'nueva' ? <li className={styles.itemForm}>{formulario('Agregar dirección')}</li> : null}
      </ul>

      {borrar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo borrar la dirección">
          <p>{borrar.error.message}</p>
        </Alert>
      ) : null}

      {puedeEditar && editando === null ? (
        <Button
          variant="secondary"
          className={styles.agregar}
          icon={<Icon name="plus" size={16} />}
          onClick={() => {
            setDatos({ ...DIRECCION_VACIA, esPrincipal: direcciones.length === 0 })
            setErrores([])
            setEditando('nueva')
          }}
        >
          Agregar dirección
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirmando !== null}
        tone="danger"
        title={`¿Borrar la dirección de ${(confirmando && (ETIQUETA_TIPO[confirmando.tipo] ?? confirmando.tipo))?.toLowerCase() ?? ''}?`}
        description={confirmando?.texto ? `${confirmando.texto}. No se puede deshacer.` : 'No se puede deshacer.'}
        confirmLabel="Borrar dirección"
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
