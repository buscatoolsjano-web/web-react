import { useId, useState } from 'react'
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
  const [confirmando, setConfirmando] = useState<string | null>(null)

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

  const formulario = (etiquetaBoton: string) => (
    <form className={styles.form} onSubmit={guardar} noValidate>
      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-tipo`}>
          Tipo
        </label>
        <select
          id={`${id}-tipo`}
          className={styles.control}
          value={datos.tipo}
          onChange={(e) => setDatos({ ...datos, tipo: e.target.value })}
        >
          {TIPOS_DE_DIRECCION.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </div>
      {campo('calle', 'Calle y número *', { required: true, autoFocus: true })}
      {campo('ciudad', 'Ciudad')}
      {campo('provincia', 'Provincia')}
      {campo('codigoPostal', 'Código postal')}
      {campo('pais', 'País', { placeholder: 'AR', maxLength: 2 })}
      {campo('notas', 'Notas')}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={datos.esPrincipal}
          onChange={(e) => setDatos({ ...datos, esPrincipal: e.target.checked })}
        />
        Principal para este tipo
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

  if (cargando) return <p className={styles.nota}>Cargando direcciones…</p>

  return (
    <div className={styles.wrap}>
      {direcciones.length === 0 && editando === null ? (
        <p className={styles.nota}>
          Sin direcciones cargadas. El sistema anterior no las guardaba estructuradas y no
          se deducen de otro dato.
        </p>
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
                {d.esPrincipal ? <span className={styles.principal}>Principal</span> : null}
              </div>
              <div className={styles.datos}>
                <span className={styles.dato}>{d.texto || '—'}</span>
                {d.notas ? <span className={styles.dato}>{d.notas}</span> : null}
              </div>
              {puedeEditar ? (
                <div className={styles.acciones}>
                  <button
                    type="button"
                    className={styles.secundario}
                    onClick={() => {
                      setDatos(aDatos(d))
                      setErrores([])
                      setEditando(d.id)
                    }}
                  >
                    Editar
                  </button>
                  {confirmando === d.id ? (
                    <>
                      <button
                        type="button"
                        className={styles.peligro}
                        disabled={borrar.isPending}
                        onClick={() =>
                          borrar.mutate(d.id, { onSuccess: () => setConfirmando(null) })
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
                      onClick={() => setConfirmando(d.id)}
                    >
                      Borrar
                    </button>
                  )}
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
        <p className={styles.error} role="alert">
          {borrar.error.message}
        </p>
      ) : null}

      {puedeEditar && editando === null ? (
        <button
          type="button"
          className={styles.primario}
          onClick={() => {
            setDatos({ ...DIRECCION_VACIA, esPrincipal: direcciones.length === 0 })
            setErrores([])
            setEditando('nueva')
          }}
        >
          + Agregar dirección
        </button>
      ) : null}
    </div>
  )
}
