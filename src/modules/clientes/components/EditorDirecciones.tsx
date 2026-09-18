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
import { FalloDeAgenda } from '../services/edicion'
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
  onRecargar?: () => void
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
    activo: d.activo,
  }
}

const ETIQUETA_TIPO: Record<string, string> = Object.fromEntries(
  TIPOS_DE_DIRECCION.map((t) => [t.valor, t.etiqueta]),
)

/**
 * Las direcciones del cliente.
 *
 * El legacy no guardaba direcciones estructuradas, sólo texto libre dentro del
 * documento. Nada se autocompleta ni se deduce de un dominio: se cargan a mano
 * cuando alguien las sepa.
 *
 * Fase 17 · E3: pasaron de ser un dato de la ficha a ser **el domicilio de
 * entrega del pedido**. Una dirección de tipo entrega —o de los dos tipos— se
 * puede elegir en el pedido, y el remito la congela al emitirse. Por eso ahora
 * se guardan con `guardar_direccion` (una transacción, con la principal por
 * tipo resuelta adentro y testigo de concurrencia) y una dirección que ya
 * figura en un pedido no se borra: se desactiva.
 */
export function EditorDirecciones({
  clienteId,
  direcciones,
  cargando,
  puedeEditar,
  onRecargar,
}: EditorDireccionesProps) {
  const id = useId()
  const { guardar, borrar } = useDireccionesEdicion(clienteId)
  const [editando, setEditando] = useState<string | null>(null)
  const [esperado, setEsperado] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosDireccion>(DIRECCION_VACIA)
  const [errores, setErrores] = useState<string[]>([])
  const [confirmando, setConfirmando] = useState<DireccionCliente | null>(null)

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarDireccion(datos)
    setErrores(encontrados)
    if (encontrados.length > 0) return
    guardar.mutate(
      { id: editando === 'nueva' ? null : editando, esperado, datos },
      { onSuccess: () => setEditando(null) },
    )
  }

  const cambiarActivo = (d: DireccionCliente, activo: boolean) => {
    guardar.mutate({ id: d.id, esperado: d.actualizadoEn, datos: { ...aDatos(d), activo } })
  }

  const esConflicto = guardar.error instanceof FalloDeAgenda && guardar.error.esConflicto
  const referenciada = borrar.error instanceof FalloDeAgenda && borrar.error.esReferenciado

  const campo = (
    clave: keyof DatosDireccion,
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

  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={enviar} noValidate>
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
      <Checkbox
        label="Principal para este tipo"
        help="La que se propone primero al elegir el domicilio de entrega de un pedido."
        checked={datos.esPrincipal}
        disabled={!datos.activo}
        onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })}
      />
      {editando !== 'nueva' ? (
        <Checkbox
          label="Activa"
          help="Desactivada deja de poder elegirse en pedidos nuevos; los ya emitidos la siguen nombrando."
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
          title={guardar.error ? 'No se pudo guardar' : 'Revisá la dirección'}
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

  if (cargando) return <SkeletonRows rows={2} columns={2} label="Cargando direcciones…" />

  return (
    <div className={styles.wrap}>
      {direcciones.length === 0 && editando === null ? (
        <EmptyState
          compact
          headingLevel={3}
          icon="map-pin"
          title="Sin direcciones cargadas"
          description="El sistema anterior no las guardaba estructuradas y no se deducen de otro dato. Una dirección de entrega se puede elegir después en el pedido."
        />
      ) : null}

      <ul className={styles.lista}>
        {direcciones.map((d) =>
          editando === d.id ? (
            <li key={d.id} className={styles.itemForm}>
              {formulario('Guardar')}
            </li>
          ) : (
            <li key={d.id} className={d.activo ? styles.item : `${styles.item} ${styles.inactivo}`}>
              <div className={styles.cabecera}>
                <span className={styles.nombre}>{ETIQUETA_TIPO[d.tipo] ?? d.tipo}</span>
                {d.esPrincipal ? <Badge tone="brand">Principal</Badge> : null}
                {d.activo ? null : <Badge tone="neutral">Desactivada</Badge>}
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
                      setEsperado(d.actualizadoEn)
                      setEditando(d.id)
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cambiarActivo(d, !d.activo)}
                    disabled={guardar.isPending}
                  >
                    {d.activo ? 'Desactivar' : 'Reactivar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.peligro}
                    icon={<Icon name="trash" size={16} />}
                    onClick={() => setConfirmando(d)}
                  >
                    Borrar
                  </Button>
                </div>
              ) : null}
            </li>
          ),
        )}

        {editando === 'nueva' ? (
          <li className={styles.itemForm}>{formulario('Agregar dirección')}</li>
        ) : null}
      </ul>

      {borrar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo borrar la dirección">
          <p>{borrar.error.message}</p>
        </Alert>
      ) : null}

      {editando === null && guardar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar la dirección">
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
          onClick={() => {
            setDatos({
              ...DIRECCION_VACIA,
              esPrincipal: !direcciones.some((d) => d.activo && d.tipo === DIRECCION_VACIA.tipo),
            })
            setErrores([])
            setEsperado(null)
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
        description={
          referenciada
            ? 'Figura en pedidos ya emitidos, así que no se puede borrar. Lo que corresponde es desactivarla.'
            : confirmando?.texto
              ? `${confirmando.texto}. Si figura en algún pedido no se va a poder borrar: en ese caso, desactivala.`
              : 'Si figura en algún pedido no se va a poder borrar: en ese caso, desactivala.'
        }
        confirmLabel={referenciada ? 'Desactivarla' : 'Borrar dirección'}
        cancelLabel="Volver"
        busy={borrar.isPending || guardar.isPending}
        onConfirm={() => {
          if (!confirmando) return
          if (referenciada) {
            cambiarActivo(confirmando, false)
            setConfirmando(null)
            borrar.reset()
            return
          }
          borrar.mutate(confirmando.id, {
            onSuccess: () => setConfirmando(null),
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
