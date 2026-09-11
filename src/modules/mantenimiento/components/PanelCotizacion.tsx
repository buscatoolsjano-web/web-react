import { useId, useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import {
  MONEDAS,
  OPCIONES_TIPO_LINEA,
  editabilidadDeCotizacion,
  etiquetaDeTipoLinea,
} from '../lib/estados'
import { formatearImporte, formatearNumero } from '../lib/formato'
import { errorDe, validarLinea, type ErrorDeCampo } from '../lib/validacion'
import { SelectorProducto } from './SelectorProducto'
import { ChipCotizacion } from './ChipEstado'
import type { DatosLinea, LineaCotizacion, OrdenDetalle, TipoLineaCotizacion } from '../types'
import type { ProductoBuscado } from '../services/catalogo'
import styles from './PanelCotizacion.module.css'

export interface PanelCotizacionProps {
  orden: OrdenDetalle
  lineas: readonly LineaCotizacion[]
  cargando: boolean
  puedeEditar: boolean
  guardando: boolean
  error: string | null
  /** Devuelven una promesa para que el formulario sepa si el servidor aceptó:
   *  si rechaza, lo escrito NO se pierde. */
  onCrear: (d: DatosLinea) => Promise<unknown>
  onActualizar: (id: string, d: DatosLinea) => Promise<unknown>
  onBorrar: (id: string) => void
  onMover: (a: LineaCotizacion, b: LineaCotizacion) => void
  onMoneda: (moneda: string | null) => void
  onAprobar: (por: string) => void
  onRechazar: (motivo: string) => void
}

const VACIA = {
  tipo: 'labour' as TipoLineaCotizacion,
  productoId: null as string | null,
  sku: null as string | null,
  descripcion: '',
  cantidad: '1',
  precioUnitario: '0',
}

const aNumero = (s: string): number => {
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * La cotización de la orden.
 *
 * Lo que define esta pantalla, y que no se decide acá:
 *
 *   · **El total lo calcula el servidor.** Mientras se escribe se muestra una
 *     vista previa; el número que vale es el que devuelve la base, y un total
 *     manipulado lo recalcula un trigger.
 *   · **Una línea con importe exige moneda.** Sin moneda elegida sólo se
 *     pueden cargar líneas sin cargo, y se dice por qué.
 *   · **Aprobar y rechazar son finales.** No hay «desaprobar»: sería reescribir
 *     una decisión del cliente. Después de resolverla, la cotización es de sólo
 *     lectura.
 *   · **Cambiar la moneda no convierte ningún importe.** No hay tipo de cambio
 *     en la base y no se inventa uno: los números siguen siendo los que cargó
 *     la persona.
 */
export function PanelCotizacion({
  orden,
  lineas,
  cargando,
  puedeEditar,
  guardando,
  error,
  onCrear,
  onActualizar,
  onBorrar,
  onMover,
  onMoneda,
  onAprobar,
  onRechazar,
}: PanelCotizacionProps) {
  const id = useId()
  const isMobile = useIsMobile()
  const [nueva, setNueva] = useState(VACIA)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [resolviendo, setResolviendo] = useState<'aprobar' | 'rechazar' | null>(null)
  const [por, setPor] = useState('')
  const [motivo, setMotivo] = useState('')

  const puede = editabilidadDeCotizacion(orden.estadoCotizacion, orden.estado)
  const editable = puedeEditar && puede.lineas
  const sinMoneda = orden.moneda === null

  const elegirProducto = (p: ProductoBuscado) => {
    setNueva((n) => ({
      ...n,
      tipo: 'part',
      productoId: p.id,
      sku: p.sku,
      descripcion: n.descripcion.trim() === '' ? p.nombre : n.descripcion,
    }))
    setBuscando(false)
  }

  const datos = (posicion: number): DatosLinea => ({
    posicion,
    tipo: nueva.tipo,
    productoId: nueva.productoId,
    sku: nueva.sku,
    descripcion: nueva.descripcion,
    cantidad: aNumero(nueva.cantidad),
    precioUnitario: aNumero(nueva.precioUnitario),
  })

  const guardar = async () => {
    const d = {
      descripcion: nueva.descripcion,
      cantidad: aNumero(nueva.cantidad),
      precioUnitario: aNumero(nueva.precioUnitario),
      productoId: nueva.productoId,
      tipo: nueva.tipo,
    }
    const encontrados = validarLinea(d)
    setErrores(encontrados)
    if (encontrados.length > 0) return

    try {
      if (editandoId) {
        const previa = lineas.find((l) => l.id === editandoId)
        await onActualizar(editandoId, datos(previa?.posicion ?? 1))
      } else {
        const siguiente = Math.max(0, ...lineas.map((l) => l.posicion)) + 1
        await onCrear(datos(siguiente))
      }
      // Sólo se limpia si el servidor aceptó. Si rechaza —por ejemplo una
      // línea con importe sin moneda elegida— lo escrito queda donde estaba y
      // el error se muestra arriba: perder lo tipeado sería castigar a la
      // persona por una regla que recién ahí se entera.
      setNueva(VACIA)
      setEditandoId(null)
    } catch {
      /* el mensaje del servidor ya se muestra en el panel */
    }
  }

  const empezarEdicion = (l: LineaCotizacion) => {
    setEditandoId(l.id)
    setErrores([])
    setNueva({
      tipo: l.tipo,
      productoId: l.productoId,
      sku: l.sku,
      descripcion: l.descripcion ?? '',
      cantidad: String(l.cantidad),
      precioUnitario: String(l.precioUnitario),
    })
  }

  // Vista previa mientras se escribe. El número que vale lo devuelve la base.
  const previa = aNumero(nueva.cantidad) * aNumero(nueva.precioUnitario)

  const filaAcciones = (l: LineaCotizacion, i: number) => (
    <>
      <button
        type="button"
        className={styles.mini}
        disabled={guardando || i === 0}
        onClick={() => {
          const anterior = lineas[i - 1]
          if (anterior) onMover(l, anterior)
        }}
        aria-label={`Subir ${l.descripcion ?? l.sku ?? 'la línea'}`}
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.mini}
        disabled={guardando || i === lineas.length - 1}
        onClick={() => {
          const siguiente = lineas[i + 1]
          if (siguiente) onMover(l, siguiente)
        }}
        aria-label={`Bajar ${l.descripcion ?? l.sku ?? 'la línea'}`}
      >
        ↓
      </button>
      <button type="button" className={styles.mini} disabled={guardando} onClick={() => empezarEdicion(l)}>
        Editar
      </button>
      <button
        type="button"
        className={styles.mini}
        disabled={guardando}
        onClick={() => onBorrar(l.id)}
      >
        Borrar
      </button>
    </>
  )

  return (
    <div className={styles.panel}>
      <div className={styles.cabecera}>
        <div className={styles.moneda}>
          <ChipCotizacion estado={orden.estadoCotizacion} />
          {puedeEditar && puede.moneda ? (
            <label className={styles.moneda}>
              <span className={styles.etiqueta}>Moneda</span>
              <select
                className={styles.select}
                value={orden.moneda ?? ''}
                disabled={guardando}
                onChange={(e) => onMoneda(e.target.value === '' ? null : e.target.value)}
                aria-label="Moneda de la cotización"
              >
                <option value="">Sin elegir</option>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className={styles.tarjetaDato}>Moneda: {orden.moneda ?? '—'}</span>
          )}
        </div>

        <div>
          <span className={styles.totalEtiqueta}>Total</span>
          <span className={styles.total}>{formatearImporte(orden.total, orden.moneda)}</span>
        </div>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {sinMoneda && editable ? (
        <p className={styles.aviso} role="note">
          Elegí la moneda antes de cargar una línea con importe. Un total sin moneda no dice
          cuánto es. Las líneas sin cargo —un diagnóstico bonificado, por ejemplo— se pueden
          cargar igual.
        </p>
      ) : null}

      {cargando ? (
        <p className={styles.nota}>Cargando la cotización…</p>
      ) : lineas.length === 0 ? (
        <p className={styles.vacio}>La cotización todavía no tiene líneas.</p>
      ) : isMobile ? (
        <ul className={styles.tarjetas}>
          {lineas.map((l, i) => (
            <li key={l.id} className={styles.tarjeta}>
              <span className={styles.tarjetaTitulo}>
                {l.descripcion ?? l.sku ?? '(sin descripción)'}
              </span>
              <span className={styles.tarjetaDato}>
                {etiquetaDeTipoLinea(l.tipo)}
                {l.sku ? ` · ${l.sku}` : ''}
              </span>
              <span className={styles.tarjetaDato}>
                {formatearNumero(l.cantidad)} × {formatearImporte(l.precioUnitario, orden.moneda)}
              </span>
              <span className={styles.tarjetaTotal}>{formatearImporte(l.total, orden.moneda)}</span>
              {editable ? <span className={styles.tarjetaAcciones}>{filaAcciones(l, i)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Tipo</th>
                <th scope="col">Concepto</th>
                <th scope="col" className={styles.derecha}>
                  Cantidad
                </th>
                <th scope="col" className={styles.derecha}>
                  Precio
                </th>
                <th scope="col" className={styles.derecha}>
                  Total
                </th>
                {editable ? <th scope="col">Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.id}>
                  <td className={styles.derecha}>{l.posicion}</td>
                  <td>{etiquetaDeTipoLinea(l.tipo)}</td>
                  <td>
                    {l.descripcion ?? '(sin descripción)'}
                    {l.sku ? <span className={styles.tarjetaDato}> · {l.sku}</span> : null}
                  </td>
                  <td className={styles.derecha}>{formatearNumero(l.cantidad)}</td>
                  <td className={styles.derecha}>
                    {formatearImporte(l.precioUnitario, orden.moneda)}
                  </td>
                  <td className={styles.derecha}>{formatearImporte(l.total, orden.moneda)}</td>
                  {editable ? (
                    <td>
                      <span className={styles.tarjetaAcciones}>{filaAcciones(l, i)}</span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable ? (
        <>
          {buscando ? (
            <SelectorProducto
              onElegir={elegirProducto}
              onCerrar={() => setBuscando(false)}
              pie="El producto es opcional en una línea de cotización: la mano de obra y el flete no están en el catálogo. El precio que se cobra se escribe acá, no sale de ninguna lista."
            />
          ) : null}

          <div className={styles.formulario}>
            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-tipo`}>
                Tipo
              </label>
              <select
                id={`${id}-tipo`}
                className={styles.select}
                value={nueva.tipo}
                disabled={guardando}
                onChange={(e) =>
                  setNueva({ ...nueva, tipo: e.target.value as TipoLineaCotizacion })
                }
              >
                {OPCIONES_TIPO_LINEA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            <div className={`${styles.campo} ${styles.anchoCompleto}`}>
              <label className={styles.etiqueta} htmlFor={`${id}-desc`}>
                Concepto
              </label>
              <input
                id={`${id}-desc`}
                type="text"
                className={styles.control}
                value={nueva.descripcion}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'descripcion') ? true : undefined}
                onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })}
                placeholder="Cambio de embrague, mano de obra…"
              />
              {errorDe(errores, 'descripcion') ? (
                <span className={styles.campoError}>{errorDe(errores, 'descripcion')}</span>
              ) : null}
              <span className={styles.tarjetaDato}>
                {nueva.sku ? (
                  <>
                    Producto: {nueva.sku}{' '}
                    <button
                      type="button"
                      className={styles.mini}
                      onClick={() => setNueva({ ...nueva, productoId: null, sku: null })}
                    >
                      Quitar
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.mini} onClick={() => setBuscando(true)}>
                    Elegir del catálogo
                  </button>
                )}
              </span>
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-cant`}>
                Cantidad
              </label>
              <input
                id={`${id}-cant`}
                type="text"
                inputMode="decimal"
                className={styles.numero}
                value={nueva.cantidad}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'cantidad') ? true : undefined}
                onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })}
              />
              {errorDe(errores, 'cantidad') ? (
                <span className={styles.campoError}>{errorDe(errores, 'cantidad')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-precio`}>
                Precio unitario {orden.moneda ? `(${orden.moneda})` : ''}
              </label>
              <input
                id={`${id}-precio`}
                type="text"
                inputMode="decimal"
                className={styles.numero}
                value={nueva.precioUnitario}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'precioUnitario') ? true : undefined}
                onChange={(e) => setNueva({ ...nueva, precioUnitario: e.target.value })}
              />
              {errorDe(errores, 'precioUnitario') ? (
                <span className={styles.campoError}>{errorDe(errores, 'precioUnitario')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <span className={styles.etiqueta}>Subtotal de la línea</span>
              <span className={styles.total}>
                {Number.isFinite(previa) ? formatearImporte(previa, orden.moneda) : '—'}
              </span>
              <span className={styles.tarjetaDato}>Vista previa: el total lo calcula el servidor.</span>
            </div>

            <div className={`${styles.acciones} ${styles.anchoCompleto}`}>
              <button
                type="button"
                className={styles.primario}
                disabled={guardando}
                onClick={() => void guardar()}
              >
                {editandoId ? 'Guardar la línea' : '+ Agregar línea'}
              </button>
              {editandoId ? (
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={guardando}
                  onClick={() => {
                    setEditandoId(null)
                    setNueva(VACIA)
                    setErrores([])
                  }}
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {puedeEditar && puede.resolver ? (
        <div className={styles.resolver}>
          <h3 className={styles.etiqueta}>Resolver la cotización</h3>
          <p className={styles.nota}>
            Aprobarla o rechazarla es <strong>definitivo</strong>: no hay vuelta atrás, porque
            sería reescribir una decisión del cliente. Y mientras siga pendiente, la orden no se
            puede cerrar.
          </p>

          {resolviendo === 'aprobar' ? (
            <>
              <label className={styles.etiqueta} htmlFor={`${id}-por`}>
                Quién la aprobó, del lado del cliente
              </label>
              <input
                id={`${id}-por`}
                type="text"
                className={styles.control}
                value={por}
                onChange={(e) => setPor(e.target.value)}
                placeholder="Nombre de quien dio el visto bueno"
              />
            </>
          ) : null}

          {resolviendo === 'rechazar' ? (
            <>
              <label className={styles.etiqueta} htmlFor={`${id}-motivo`}>
                Motivo del rechazo
              </label>
              <input
                id={`${id}-motivo`}
                type="text"
                className={styles.control}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Queda en el historial de la orden"
              />
            </>
          ) : null}

          <div className={styles.acciones}>
            {resolviendo === null ? (
              <>
                <button
                  type="button"
                  className={styles.primario}
                  disabled={guardando || lineas.length === 0}
                  onClick={() => setResolviendo('aprobar')}
                >
                  Aprobar
                </button>
                <button
                  type="button"
                  className={styles.peligro}
                  disabled={guardando}
                  onClick={() => setResolviendo('rechazar')}
                >
                  Rechazar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={resolviendo === 'aprobar' ? styles.primario : styles.peligro}
                  disabled={guardando}
                  onClick={() => {
                    if (resolviendo === 'aprobar') onAprobar(por)
                    else onRechazar(motivo)
                    setResolviendo(null)
                  }}
                >
                  {resolviendo === 'aprobar'
                    ? `Confirmar: aprobar por ${formatearImporte(orden.total, orden.moneda)}`
                    : 'Confirmar el rechazo'}
                </button>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={guardando}
                  onClick={() => setResolviendo(null)}
                >
                  Volver
                </button>
              </>
            )}
          </div>

          {lineas.length === 0 ? (
            <p className={styles.nota}>
              Una cotización sin ninguna línea no se puede aprobar. Rechazarla sí: que el cliente
              no haya querido presupuesto también es información.
            </p>
          ) : null}
        </div>
      ) : orden.estado === 'open' && !puede.resolver ? (
        <p className={styles.nota}>
          La cotización está resuelta y es de sólo lectura.
          {orden.estadoCotizacion === 'approved' && orden.quienAprobo
            ? ` La aprobó ${orden.quienAprobo}.`
            : ''}
        </p>
      ) : null}
    </div>
  )
}
