import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { permisosDe } from '../lib/permisos'
import { useEdicionDePuntos, usePuntos } from '../hooks/useCheckPoints'
import type { PuntoDeRevision } from '../types'
import styles from './Pagina.module.css'

/**
 * Configuración de los puntos de revisión.
 *
 * Los ocho que vienen sembrados —carcasa, tornillos, conectores, reversa,
 * software, embrague, cabezal, rotor— salen de las partes que revisa el
 * sistema anterior y aparecen con datos en sus fichas reales: no son
 * placeholders. Pero **son de un atornillador FEIN**, y el esquema es
 * multiempresa desde el primer día. Por eso están en una tabla y no en un
 * CHECK: si otra empresa revisa otra cosa, se configura acá y no hace falta
 * una migración.
 *
 * Borrar un punto que ya se usó en una orden lo impide la FK, y está bien:
 * dejaría revisiones apuntando a la nada. Para sacarlo de circulación está
 * «activo».
 */
export function PuntosPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const { data, isPending, error } = usePuntos(false)
  const edicion = useEdicionDePuntos()

  const [nuevo, setNuevo] = useState({ clave: '', etiqueta: '' })
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState({ clave: '', etiqueta: '', posicion: 0 })

  if (!permisos.configurar) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Puntos de revisión</h1>
        <p className={styles.error} role="note">
          Tu rol no puede configurar Mantenimiento. La sección es de administradores y empleados.
        </p>
      </div>
    )
  }

  const puntos = data ?? []
  const siguientePosicion =
    puntos.reduce((max, p) => Math.max(max, p.posicion), 0) + 10

  const empezarEdicion = (p: PuntoDeRevision) => {
    setEditandoId(p.id)
    setBorrador({ clave: p.clave, etiqueta: p.etiqueta, posicion: p.posicion })
  }

  const errorDeEdicion =
    edicion.crear.error?.message ??
    edicion.actualizar.error?.message ??
    edicion.borrar.error?.message ??
    null

  return (
    <div className={styles.page}>
      <Link to="/mantenimiento/ordenes" className={styles.volver}>
        ← Órdenes
      </Link>

      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Puntos de revisión</h1>
          <p className={styles.subtitulo}>
            {isPending ? 'Cargando…' : `${puntos.length} configurados en ${activa?.companyName ?? ''}`}
          </p>
        </div>
      </header>

      <p className={styles.nota}>
        Cada punto se marca OK, NOK o N/A en la ficha de la orden, en dos momentos: al
        diagnosticar y al reparar. Cada marca es una fila propia, no un campo JSON dentro de la
        orden, así que se puede preguntar cuántas veces falló cada parte.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          No se pudieron leer los puntos: {error.message}
        </p>
      ) : null}

      {errorDeEdicion ? (
        <p className={styles.error} role="alert">
          {errorDeEdicion}
        </p>
      ) : null}

      <div className={styles.scrollLineas}>
        <table className={styles.tablaLineas}>
          <thead>
            <tr>
              <th scope="col">Orden</th>
              <th scope="col">Clave</th>
              <th scope="col">Etiqueta</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {puntos.map((p) =>
              editandoId === p.id ? (
                <tr key={p.id}>
                  <td>
                    <input
                      type="number"
                      className={styles.selectDato}
                      value={borrador.posicion}
                      onChange={(e) =>
                        setBorrador({ ...borrador, posicion: Number(e.target.value) })
                      }
                      aria-label="Orden"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className={styles.selectDato}
                      value={borrador.clave}
                      onChange={(e) => setBorrador({ ...borrador, clave: e.target.value })}
                      aria-label="Clave"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className={styles.selectDato}
                      value={borrador.etiqueta}
                      onChange={(e) => setBorrador({ ...borrador, etiqueta: e.target.value })}
                      aria-label="Etiqueta"
                    />
                  </td>
                  <td>{p.activo ? 'Activo' : 'Inactivo'}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.primario}
                      disabled={edicion.actualizar.isPending}
                      onClick={() =>
                        edicion.actualizar.mutate(
                          { id: p.id, datos: borrador },
                          { onSuccess: () => setEditandoId(null) },
                        )
                      }
                    >
                      Guardar
                    </button>{' '}
                    <button
                      type="button"
                      className={styles.secundario}
                      onClick={() => setEditandoId(null)}
                    >
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td className={styles.mono}>{p.posicion}</td>
                  <td className={styles.mono}>{p.clave}</td>
                  <td>{p.etiqueta}</td>
                  <td className={p.activo ? undefined : styles.falta}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.secundario}
                      onClick={() => empezarEdicion(p)}
                    >
                      Editar
                    </button>{' '}
                    <button
                      type="button"
                      className={styles.secundario}
                      disabled={edicion.actualizar.isPending}
                      onClick={() =>
                        edicion.actualizar.mutate({ id: p.id, datos: { activo: !p.activo } })
                      }
                    >
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </button>{' '}
                    <button
                      type="button"
                      className={styles.peligro}
                      disabled={edicion.borrar.isPending}
                      onClick={() => edicion.borrar.mutate(p.id)}
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.bloque}>
        <h2 className={styles.subtitulo}>Agregar un punto</h2>
        <div className={styles.datos}>
          <div className={styles.dato}>
            <label className={styles.datoEtiqueta} htmlFor="punto-clave">
              Clave
            </label>
            <input
              id="punto-clave"
              type="text"
              className={styles.selectDato}
              value={nuevo.clave}
              onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })}
              placeholder="rodamiento"
            />
          </div>
          <div className={styles.dato}>
            <label className={styles.datoEtiqueta} htmlFor="punto-etiqueta">
              Etiqueta
            </label>
            <input
              id="punto-etiqueta"
              type="text"
              className={styles.selectDato}
              value={nuevo.etiqueta}
              onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })}
              placeholder="RODAMIENTO"
            />
          </div>
        </div>
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.primario}
            disabled={
              edicion.crear.isPending ||
              nuevo.clave.trim() === '' ||
              nuevo.etiqueta.trim() === ''
            }
            onClick={() =>
              edicion.crear.mutate(
                {
                  clave: nuevo.clave,
                  etiqueta: nuevo.etiqueta,
                  posicion: siguientePosicion,
                  activo: true,
                },
                { onSuccess: () => setNuevo({ clave: '', etiqueta: '' }) },
              )
            }
          >
            {edicion.crear.isPending ? 'Agregando…' : 'Agregar punto'}
          </button>
        </div>
        <p className={styles.nota}>
          La clave es el identificador estable —no cambia aunque se reescriba la etiqueta— y tiene
          que ser única dentro de la empresa.
        </p>
      </div>
    </div>
  )
}
