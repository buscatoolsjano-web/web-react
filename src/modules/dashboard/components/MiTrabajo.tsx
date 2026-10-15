import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { etiquetaRol } from '@/modules/configuracion/lib/usuarios'
import { mesLargo } from '../lib/panel'
import { totalDe, totalHecho, type PendienteDePersona } from '../services/pendientePorPersona'
import styles from './Panel.module.css'

export interface MiTrabajoProps {
  /** Mi fila del tablero. `null` cuando el servidor no marcó ninguna. */
  mio: PendienteDePersona | null
  /** Documentos del mes que entraron sin autor, o sea por la sincronización. */
  sinAutor: number
  /** `YYYY-MM-DD` del mes en curso, el mismo que titula el panel. */
  mes: string | null
  cargando: boolean
}

interface Linea {
  clave: string
  icono: IconName
  n: number
  singular: string
  plural: string
  destino?: string
}

/** Una línea: el número adelante y el sustantivo que le corresponde. */
function Lineas({ lineas, vacio }: { lineas: Linea[]; vacio: string }) {
  const hay = lineas.some((l) => l.n > 0)
  if (!hay) return <p className={styles.miVacio}>{vacio}</p>

  return (
    <ul className={styles.miLista}>
      {lineas
        .filter((l) => l.n > 0)
        .map((l) => {
          const palabra = l.n === 1 ? l.singular : l.plural
          return (
            <li key={l.clave} className={styles.miLinea}>
              {/* Decorativo —`Icon` ya es `aria-hidden`—: la línea se lee
                  «4 correos enviados» sin él. */}
              <Icon name={l.icono} size={16} />
              {l.destino ? (
                <Link to={l.destino} className={styles.miDato}>
                  <strong className={styles.miNumero}>{l.n}</strong> {palabra}
                </Link>
              ) : (
                <span className={styles.miDato}>
                  <strong className={styles.miNumero}>{l.n}</strong> {palabra}
                </span>
              )}
            </li>
          )
        })}
    </ul>
  )
}

/**
 * Lo mío, antes que lo de los demás (Fase 64).
 *
 * «Si yo entro con el usuario Jano, primero quiero ver lo que yo tengo
 * pendiente o qué es lo que estuve haciendo durante este mes. Y después abajo,
 * el pendiente del resto».
 *
 * NO CUESTA UNA CONSULTA MÁS. Es la misma RPC `pendiente_por_persona` que ya
 * alimenta la tabla de abajo: el servidor marca con `auth.uid()` cuál de las
 * filas es la del que mira, y el cliente la separa. Pedir «lo mío» aparte
 * serían 220 ms de ida y vuelta para traer una fila que ya estaba en la mano.
 *
 * LO HECHO SÓLO CUENTA LO QUE NACIÓ EN EL ERP, y el pie lo dice con el número
 * exacto. No es una excusa: `salesperson_id` está en null en los 751
 * documentos de la empresa, así que la única marca de autoría real es
 * `created_by`, y la tienen nada más que los documentos creados acá. Los demás
 * entran por la sincronización de STEL. Sin ese pie, «1 pedido» se leería como
 * «este mes hiciste un solo pedido» cuando la empresa hizo veintidós.
 *
 * LO PENDIENTE ES LO MISMO PERO AL REVÉS (Fase 72). «Tenés pendiente» estaba
 * vacío para todos, siempre, porque repartía por `salesperson_id` —el campo
 * que está en null en los 751—. Ahora cuenta lo que tiene tu nombre O lo que
 * creaste vos, que es la misma regla que la columna Vendedor del listado desde
 * la Fase 43. Los de STEL no tienen ninguno de los dos y siguen cayendo abajo,
 * en «Sin asignar», que es donde corresponde.
 */
export function MiTrabajo({ mio, sinAutor, mes, cargando }: MiTrabajoProps) {
  const id = useId()

  // Sin fila propia no hay bloque: el panel de abajo queda completo, que es
  // exactamente lo que había antes de esta fase.
  if (!cargando && !mio) return null

  const nombreMes = mes ? (mesLargo(mes).split(' ')[0]?.toLowerCase() ?? 'el mes') : 'el mes'

  const pendientes: Linea[] = mio
    ? [
        {
          clave: 'correos',
          icono: 'mail',
          n: mio.correos,
          singular: 'correo sin responder',
          plural: 'correos sin responder',
          destino: `/emails?sinresponder=1&asignado=${mio.userId}`,
        },
        {
          clave: 'cotizaciones',
          icono: 'cart',
          n: mio.cotizaciones,
          singular: 'cotización esperando',
          plural: 'cotizaciones esperando',
        },
        {
          clave: 'pedidos',
          icono: 'truck',
          n: mio.pedidos,
          singular: 'pedido por entregar',
          plural: 'pedidos por entregar',
        },
      ]
    : []

  const hechos: Linea[] = mio
    ? [
        { clave: 'cotizaciones', icono: 'cart', n: mio.hecho.cotizaciones, singular: 'cotización', plural: 'cotizaciones' },
        { clave: 'pedidos', icono: 'truck', n: mio.hecho.pedidos, singular: 'pedido', plural: 'pedidos' },
        { clave: 'entregas', icono: 'package', n: mio.hecho.entregas, singular: 'remito', plural: 'remitos' },
        { clave: 'correos', icono: 'mail', n: mio.hecho.correos, singular: 'correo enviado', plural: 'correos enviados' },
      ]
    : []

  return (
    <section className={styles.miTrabajo} aria-labelledby={`${id}-t`}>
      <div className={styles.miCabecera}>
        {/* El punto medio es un nodo de texto DE VERDAD y no un `gap` de CSS:
            el separador visual no llega al nombre accesible, y el encabezado
            se anunciaba «Lo tuyoJano». */}
        <h2 id={`${id}-t`} className={styles.miTitulo}>
          Lo tuyo
          {mio ? (
            <>
              {' · '}
              <span className={styles.miNombre}>{mio.nombre}</span>
            </>
          ) : null}
        </h2>
        {mio?.rol ? <span className={styles.miRol}>{etiquetaRol(mio.rol)}</span> : null}
      </div>

      {cargando || !mio ? (
        <SkeletonRows rows={3} columns={2} label="Cargando tu trabajo…" />
      ) : (
        <>
          <div className={styles.miColumnas}>
            <div className={styles.miCaja} data-tono="pendiente">
              <h3 className={styles.miCajaTitulo}>
                Tenés pendiente
                <span className={styles.miCajaCuenta}>{totalDe(mio)}</span>
              </h3>
              <Lineas
                lineas={pendientes}
                vacio="No tenés nada pendiente a tu nombre. Lo que no es de nadie se ve abajo."
              />
            </div>

            <div className={styles.miCaja} data-tono="hecho">
              <h3 className={styles.miCajaTitulo}>
                Hiciste en {nombreMes}
                <span className={styles.miCajaCuenta}>{totalHecho(mio)}</span>
              </h3>
              <Lineas lineas={hechos} vacio={`No cargaste nada desde el ERP en ${nombreMes}.`} />
            </div>
          </div>

          {/* El pie que impide que el bloque mienta. Ver el comentario de arriba. */}
          {sinAutor > 0 ? (
            <p className={styles.miPie}>
              Sólo cuenta lo que se cargó desde el ERP. Los otros {sinAutor} documentos de {nombreMes}{' '}
              entraron por la sincronización de STEL y no registran quién los hizo.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
