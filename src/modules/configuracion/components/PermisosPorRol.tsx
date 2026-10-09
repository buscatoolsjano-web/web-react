import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/forms/controls'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { useCapacidades, useConcesiones, useGuardarPermisos } from '../hooks/usePermisos'
import {
  alternar,
  capacidadesDeRol,
  hayCambios,
  mensajeErrorPermisos,
  PERMISOS_FIJOS,
  resumenDeRol,
  ROL_CON_TODO,
  ROLES_CONFIGURABLES,
  type Capacidad,
} from '../lib/capacidades'
import { etiquetaRol } from '../lib/usuarios'
import { ErrorPermisos } from '../services/permisos'
import styles from './PermisosPorRol.module.css'

/**
 * Qué puede hacer cada rol, y cómo cambiarlo (Fase 58 · E2).
 *
 * Vive dentro de Usuarios, que es donde se preguntó: «ahora está administrador,
 * empleado, vendedor y técnico pero yo no sé a qué tiene acceso cada cosa».
 *
 * CADA ROL SE GUARDA SOLO. Un botón por tarjeta y no uno general: la RPC
 * reemplaza los permisos DE UN ROL, así que dos administradores editando roles
 * distintos no se pisan. Y el botón aparece sólo cuando hay algo que guardar.
 *
 * EL ADMINISTRADOR SE MUESTRA PERO NO SE EDITA. Tiene todo siempre y no figura
 * en la tabla. Es lo que vuelve imposible quedarse afuera de esta pantalla por
 * haberse quitado un permiso a sí mismo.
 */
export function PermisosPorRol() {
  const { activa } = useEmpresa()
  const catalogo = useCapacidades()
  const concesiones = useConcesiones()

  const cargando = catalogo.isPending || concesiones.isPending
  const error = catalogo.error ?? concesiones.error

  return (
    <section className={styles.bloque} aria-labelledby="permisos-por-rol">
      <h2 id="permisos-por-rol" className={styles.titulo}>
        Permisos por rol
      </h2>
      <p className={styles.intro}>
        Qué puede hacer cada rol en {activa?.companyName ?? 'esta empresa'}. Lo aplica la base de datos: al quitar un
        permiso esos datos dejan de llegar, no se esconde el menú y nada más.
      </p>

      {error ? (
        <StatusMessage
          tono="error"
          titulo={mensajeErrorPermisos(error instanceof ErrorPermisos ? error.codigo : 'desconocido')}
        />
      ) : cargando ? (
        <SkeletonRows rows={4} columns={2} label="Cargando permisos…" />
      ) : (
        <>
          <div className={styles.roles}>
            <RolConTodo catalogo={catalogo.data ?? []} />
            {ROLES_CONFIGURABLES.map((rol) => (
              <TarjetaDeRol
                key={rol}
                rol={rol}
                catalogo={catalogo.data ?? []}
                // `capacidadesDeRol` y no un filtro acá: es la misma función que
                // decide el resumen y la que el test cubre.
                guardadas={capacidadesDeRol(rol, catalogo.data ?? [], concesiones.data ?? [])}
              />
            ))}
          </div>

          <div className={styles.fijos}>
            <h3 className={styles.fijosTitulo}>Lo que no se configura acá</h3>
            <ul className={styles.fijosLista}>
              {PERMISOS_FIJOS.map((p) => (
                <li key={p.titulo} className={styles.fijo}>
                  <span className={styles.fijoQuien}>
                    {p.titulo}: {p.quien}.
                  </span>{' '}
                  {p.porque}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  )
}

/** El administrador. Está para que se entienda el cuadro completo. */
function RolConTodo({ catalogo }: { catalogo: readonly Capacidad[] }) {
  return (
    <fieldset className={cx(styles.rol, styles.rolFijo)}>
      <legend className={styles.rolNombre}>{etiquetaRol(ROL_CON_TODO)}</legend>
      <div className={styles.rolCabecera}>
        {/* Enumerados y no «todos»: que se vea de qué se está hablando. */}
        <span className={styles.rolResumen}>{catalogo.map((c) => c.etiqueta).join(' · ')}</span>
        <Badge tone="neutral">No se configura</Badge>
      </div>
      <p className={styles.descripcion}>
        Para que la empresa no pueda quedarse sin nadie que pueda devolver un permiso, el administrador no se edita. Si
        alguien tiene que dejar de poder algo, cambiale el rol en la lista de arriba.
      </p>
    </fieldset>
  )
}

function TarjetaDeRol({
  rol,
  catalogo,
  guardadas,
}: {
  rol: string
  catalogo: readonly Capacidad[]
  guardadas: readonly string[]
}) {
  const guardar = useGuardarPermisos()
  /*
   * `null` significa «sin tocar»: así la tarjeta sigue mostrando lo que diga el
   * servidor hasta que alguien edite, y después de guardar vuelve sola a esa
   * fuente en vez de quedarse con una copia que podría ya no ser la verdad.
   */
  const [editado, setEditado] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actuales = editado ?? [...guardadas]
  const cambiado = editado !== null && hayCambios(guardadas, editado)

  function tocar(clave: string, prendido: boolean) {
    setError(null)
    setEditado(alternar(actuales, catalogo, clave, prendido))
  }

  async function confirmar() {
    setError(null)
    try {
      await guardar.mutateAsync({ rol, capacidades: actuales })
      // Se vuelve a «sin tocar»: la tarjeta pasa a mostrar lo que relea el hook.
      setEditado(null)
    } catch (e) {
      setError(mensajeErrorPermisos(e instanceof ErrorPermisos ? e.codigo : 'desconocido'))
    }
  }

  return (
    <fieldset className={styles.rol}>
      <legend className={styles.rolNombre}>{etiquetaRol(rol)}</legend>
      <div className={styles.rolCabecera}>
        <span className={styles.rolResumen}>{resumenDeRol(actuales, catalogo)}</span>
      </div>

      <div className={styles.casillas}>
        {catalogo.map((c) => (
          <div key={c.clave} className={styles.casilla}>
            <Checkbox
              label={c.etiqueta}
              checked={actuales.includes(c.clave)}
              disabled={guardar.isPending}
              onChange={(e) => tocar(c.clave, e.target.checked)}
            />
            <p className={styles.descripcion}>{c.descripcion}</p>
          </div>
        ))}
      </div>

      {error && <StatusMessage tono="error" titulo={error} />}

      {cambiado && (
        <div className={styles.acciones}>
          <Button onClick={() => void confirmar()} disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
          <Button variant="ghost" onClick={() => setEditado(null)} disabled={guardar.isPending}>
            Deshacer
          </Button>
        </div>
      )}
    </fieldset>
  )
}
