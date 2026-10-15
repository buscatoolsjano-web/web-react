import { useId } from 'react'
import { ErrorState } from '@/components/feedback/ErrorState'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { SIN_VENDEDOR } from '@/modules/ventas/types'
import { Lineas, type Linea } from './LineasDeTrabajo'
import { totalDe, type PendienteDePersona } from '../services/pendientePorPersona'
import styles from './Panel.module.css'

export interface PendientePorPersonaProps {
  /** Ya SIN mi fila: la mía va arriba, en «Lo tuyo». */
  filas: readonly PendienteDePersona[] | undefined
  cargando: boolean
  error: boolean
  onReintentar: () => void
}

const TITULO = 'Pendiente del resto'

/** Cómo se nombra a esta fila en la URL del listado: su id, o «nadie». */
const quien = (f: PendienteDePersona) => f.userId ?? SIN_VENDEDOR

/** Los tres renglones de una persona, con su enlace a la lista filtrada. */
function lineasDe(f: PendienteDePersona): Linea[] {
  const q = quien(f)
  return [
    {
      clave: 'correos',
      icono: 'mail',
      n: f.correos,
      singular: 'correo sin responder',
      plural: 'correos sin responder',
      destino: `/emails?sinresponder=1&asignado=${f.userId ?? 'nadie'}`,
    },
    {
      clave: 'cotizaciones',
      icono: 'cart',
      n: f.cotizaciones,
      singular: 'cotización esperando',
      plural: 'cotizaciones esperando',
      destino: `/ventas/cotizaciones?estado=sent&vendedor=${q}`,
    },
    {
      clave: 'pedidos',
      icono: 'truck',
      n: f.pedidos,
      singular: 'pedido por entregar',
      plural: 'pedidos por entregar',
      destino: `/ventas/pedidos?pendiente=1&vendedor=${q}`,
    },
  ]
}

/**
 * Lo pendiente del resto del equipo (Fase 40, rehecho en la 74).
 *
 * El panel ya decía cuánto hay pendiente; esto dice DE QUIÉN, que es lo que
 * hace falta para repartir trabajo o para ver si alguien quedó tapado.
 *
 * ── Por qué dejó de ser una tabla ───────────────────────────────────────────
 *
 * Era una tabla de cinco columnas donde casi todas las celdas decían 0, y los
 * encabezados obligaban a mirar arriba para saber qué significaba cada número.
 * Ahora es una tarjeta por persona con los MISMOS renglones que «Lo tuyo»
 * —«2 correos sin responder»— y por el mismo motivo: un renglón que se lee
 * solo no necesita encabezado. Es literalmente el mismo componente
 * (`LineasDeTrabajo`), así que las dos mitades del tablero no se pueden ver
 * distinto por descuido.
 *
 * ── Quien no tiene nada no lleva tarjeta ────────────────────────────────────
 *
 * Antes ocupaba una fila entera de ceros. Ahora va al pie, en una línea:
 * «Sin nada pendiente: Admin, Facundo». La información está —que alguien esté
 * libre es un dato cuando hay que repartir— sin gastarle al que mira cinco
 * tarjetas vacías antes de llegar a la que importa.
 *
 * ── «Sin asignar» va al final, y es la grande ───────────────────────────────
 *
 * HOY VA A ESTAR CASI TODO AHÍ, y está bien que se vea así: el panel no
 * reparte lo que nadie repartió, y ponerle nombre a eso sería inventarlo.
 * Todos los números se pueden abrir: la bandeja con `asignado` y el listado de
 * Ventas con `vendedor`, que existe desde la Fase 73.
 */
export function PendientePorPersona({ filas, cargando, error, onReintentar }: PendientePorPersonaProps) {
  const id = useId()

  const marco = (dentro: React.ReactNode) => (
    <section className={styles.seccion} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.seccionTitulo}>
        {TITULO}
      </h2>
      {dentro}
    </section>
  )

  if (error) {
    return marco(<ErrorState title="No se pudo leer el pendiente por persona." onRetry={onReintentar} />)
  }
  if (cargando) {
    return marco(<SkeletonRows rows={4} columns={2} label="Cargando el pendiente por persona…" />)
  }

  const todas = filas ?? []
  const conTrabajo = todas.filter((f) => totalDe(f) > 0)
  const libres = todas.filter((f) => totalDe(f) === 0 && f.userId !== null)

  if (conTrabajo.length === 0) {
    return marco(
      <p className={styles.vacio}>
        Nadie más tiene trabajo pendiente: sin correo sin responder, sin cotizaciones esperando y sin
        pedidos por entregar.
      </p>,
    )
  }

  return marco(
    <>
      <ul className={styles.miColumnas}>
        {conTrabajo.map((f) => (
          <li key={f.userId ?? 'sin-asignar'} className={styles.miCaja} data-tono={f.userId === null ? 'pendiente' : undefined}>
            <h3 className={styles.miCajaTitulo}>
              {f.nombre}
              {f.rol ? <span className={styles.miRol}>{etiquetaRol(f.rol)}</span> : null}
              <span className={styles.miCajaCuenta}>{totalDe(f)}</span>
            </h3>
            <Lineas lineas={lineasDe(f)} vacio="Sin nada pendiente." />
          </li>
        ))}
      </ul>

      {/* Quien está libre, en una línea. Ver el comentario de arriba. */}
      {libres.length > 0 ? (
        <p className={styles.miPie}>Sin nada pendiente: {libres.map((f) => f.nombre).join(', ')}.</p>
      ) : null}
    </>,
  )
}
