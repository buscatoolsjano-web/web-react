import { useId, useState } from 'react'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { MONEDAS } from '../lib/estados'
import { formatearFechaHora, formatearImporte, formatearNumero } from '../lib/formato'
import { errorDe, validarRepuesto, type ErrorDeCampo } from '../lib/validacion'
import { SelectorProducto } from './SelectorProducto'
import type { DatosRepuesto, Deposito, RepuestoDeOrden } from '../types'
import type { ProductoBuscado } from '../services/catalogo'
import styles from './PanelCotizacion.module.css'

export interface PanelRepuestosProps {
  repuestos: readonly RepuestoDeOrden[]
  depositos: readonly Deposito[]
  cargando: boolean
  puedeEditar: boolean
  guardando: boolean
  consumiendo: boolean
  error: string | null
  onAgregar: (d: DatosRepuesto) => void
  onBorrar: (id: string) => void
  onConsumir: () => void
}

const aNumero = (s: string): number => {
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Los repuestos de la orden, y el consumo.
 *
 * Lo que define esta pantalla:
 *
 *   · **Agregar un repuesto NO mueve stock.** El stock se mueve una sola vez,
 *     al confirmar el consumo. Hasta entonces la columna «después» es una
 *     proyección, no un hecho.
 *   · **El costo es carga manual o nada.** No se completa desde ninguna lista
 *     de precios: esas listas son de VENTA y copiar un precio de venta como
 *     costo inflaría el costo del servicio con el margen. Si se carga un
 *     costo, hay que decir en qué moneda.
 *   · **Un saldo negativo no detiene el consumo.** La reparación ya ocurrió:
 *     negarse a registrarla haría que el sistema mienta sobre una herramienta
 *     que ya tiene el repuesto puesto. Se avisa, y se deja registrar.
 *   · **Un repuesto ya consumido no se edita ni se borra.** Ahí está el
 *     movimiento de stock que lo respalda.
 */
export function PanelRepuestos({
  repuestos,
  depositos,
  cargando,
  puedeEditar,
  guardando,
  consumiendo,
  error,
  onAgregar,
  onBorrar,
  onConsumir,
}: PanelRepuestosProps) {
  const id = useId()
  const isMobile = useIsMobile()
  const [producto, setProducto] = useState<ProductoBuscado | null>(null)
  const [depositoId, setDepositoId] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState('1')
  const [costo, setCosto] = useState('')
  const [moneda, setMoneda] = useState('')
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  // El depósito por defecto se preselecciona una sola vez, cuando llegan. Se
  // ajusta DURANTE el render y no en un efecto: llamar a setState dentro de un
  // efecto provoca un render en cascada.
  const [vistos, setVistos] = useState(false)
  if (!vistos && depositos.length > 0) {
    setVistos(true)
    setDepositoId(depositos.find((d) => d.porDefecto)?.id ?? depositos[0]?.id ?? null)
  }

  const pendientes = repuestos.filter((r) => r.consumidoEn === null)
  const consumidos = repuestos.filter((r) => r.consumidoEn !== null)

  /**
   * Cuánto quedaría en cada depósito si se confirmara el consumo.
   *
   * Se agrupa por producto Y depósito, y se restan TODAS las líneas pendientes
   * de ese par: dos líneas del mismo repuesto se descuentan las dos.
   */
  const proyeccion = new Map<string, number>()
  for (const r of pendientes) {
    const clave = `${r.productoId}|${r.depositoId}`
    const base = proyeccion.get(clave) ?? r.stockActual ?? 0
    proyeccion.set(clave, base - r.cantidad)
  }
  const despuesDe = (r: RepuestoDeOrden) => proyeccion.get(`${r.productoId}|${r.depositoId}`) ?? null
  const quedanNegativos = [...proyeccion.values()].some((v) => v < 0)

  const agregar = () => {
    const d = {
      productoId: producto?.id ?? null,
      depositoId,
      cantidad: aNumero(cantidad),
      costoUnitario: costo.trim() === '' ? null : aNumero(costo),
      monedaCosto: moneda === '' ? null : moneda,
    }
    const encontrados = validarRepuesto(d)
    setErrores(encontrados)
    if (encontrados.length > 0) return

    onAgregar({
      productoId: d.productoId!,
      sku: producto?.sku ?? null,
      nombre: producto?.nombre ?? null,
      depositoId: d.depositoId!,
      cantidad: d.cantidad,
      costoUnitario: d.costoUnitario,
      monedaCosto: d.monedaCosto,
    })
    setProducto(null)
    setCantidad('1')
    setCosto('')
    setMoneda('')
  }

  const nombreDe = (r: RepuestoDeOrden) => r.nombre ?? r.sku ?? '(producto sin nombre guardado)'

  return (
    <div className={styles.panel}>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {cargando ? (
        <p className={styles.nota}>Cargando los repuestos…</p>
      ) : repuestos.length === 0 ? (
        <p className={styles.vacio}>Todavía no se cargó ningún repuesto.</p>
      ) : isMobile ? (
        <ul className={styles.tarjetas}>
          {repuestos.map((r) => (
            <li key={r.id} className={styles.tarjeta}>
              <span className={styles.tarjetaTitulo}>{nombreDe(r)}</span>
              <span className={styles.tarjetaDato}>
                {r.sku ?? '—'} · {r.deposito ?? '—'}
              </span>
              <span className={styles.tarjetaTotal}>{formatearNumero(r.cantidad)}</span>
              <span className={styles.tarjetaDato}>
                Costo:{' '}
                {r.costoUnitario === null
                  ? 'sin cargar'
                  : formatearImporte(r.costoUnitario, r.monedaCosto)}
              </span>
              {r.consumidoEn === null ? (
                <span className={styles.tarjetaDato}>
                  Stock {formatearNumero(r.stockActual)} → {formatearNumero(despuesDe(r))}
                </span>
              ) : (
                <span className={styles.tarjetaDato}>
                  Consumido el {formatearFechaHora(r.consumidoEn)}
                </span>
              )}
              {puedeEditar && r.consumidoEn === null ? (
                <span className={styles.tarjetaAcciones}>
                  <button
                    type="button"
                    className={styles.mini}
                    disabled={guardando}
                    onClick={() => onBorrar(r.id)}
                  >
                    Quitar
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th scope="col">Repuesto</th>
                <th scope="col">Depósito</th>
                <th scope="col" className={styles.derecha}>
                  Cantidad
                </th>
                <th scope="col" className={styles.derecha}>
                  Costo
                </th>
                <th scope="col" className={styles.derecha}>
                  Stock
                </th>
                <th scope="col" className={styles.derecha}>
                  Después
                </th>
                <th scope="col">Estado</th>
                {puedeEditar ? <th scope="col" /> : null}
              </tr>
            </thead>
            <tbody>
              {repuestos.map((r) => {
                const despues = despuesDe(r)
                return (
                  <tr key={r.id}>
                    <td>
                      {nombreDe(r)}
                      {r.sku ? <span className={styles.tarjetaDato}> · {r.sku}</span> : null}
                    </td>
                    <td>{r.deposito ?? '—'}</td>
                    <td className={styles.derecha}>{formatearNumero(r.cantidad)}</td>
                    <td className={styles.derecha}>
                      {r.costoUnitario === null ? (
                        <span className={styles.tarjetaDato}>sin cargar</span>
                      ) : (
                        formatearImporte(r.costoUnitario, r.monedaCosto)
                      )}
                    </td>
                    <td className={styles.derecha}>{formatearNumero(r.stockActual)}</td>
                    <td className={styles.derecha}>
                      {r.consumidoEn === null ? formatearNumero(despues) : '—'}
                    </td>
                    <td>
                      {r.consumidoEn === null
                        ? 'A consumir'
                        : `Consumido ${formatearFechaHora(r.consumidoEn)}`}
                    </td>
                    {puedeEditar ? (
                      <td>
                        {r.consumidoEn === null ? (
                          <button
                            type="button"
                            className={styles.mini}
                            disabled={guardando}
                            onClick={() => onBorrar(r.id)}
                          >
                            Quitar
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {puedeEditar ? (
        <>
          {buscando ? (
            <SelectorProducto
              onElegir={(p) => {
                setProducto(p)
                setBuscando(false)
              }}
              onCerrar={() => setBuscando(false)}
            />
          ) : null}

          <div className={styles.formulario}>
            <div className={`${styles.campo} ${styles.anchoCompleto}`}>
              <span className={styles.etiqueta}>Repuesto *</span>
              {producto ? (
                <span className={styles.tarjetaAcciones}>
                  <strong>{producto.sku}</strong> {producto.nombre}
                  <button type="button" className={styles.mini} onClick={() => setBuscando(true)}>
                    Cambiar
                  </button>
                </span>
              ) : (
                <button type="button" className={styles.secundario} onClick={() => setBuscando(true)}>
                  Elegir del catálogo
                </button>
              )}
              {errorDe(errores, 'productoId') ? (
                <span className={styles.campoError}>{errorDe(errores, 'productoId')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-dep`}>
                Depósito *
              </label>
              <select
                id={`${id}-dep`}
                className={styles.select}
                value={depositoId ?? ''}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'depositoId') ? true : undefined}
                onChange={(e) => setDepositoId(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">Elegir…</option>
                {depositos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
              {errorDe(errores, 'depositoId') ? (
                <span className={styles.campoError}>{errorDe(errores, 'depositoId')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-cant`}>
                Cantidad *
              </label>
              <input
                id={`${id}-cant`}
                type="text"
                inputMode="decimal"
                className={styles.numero}
                value={cantidad}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'cantidad') ? true : undefined}
                onChange={(e) => setCantidad(e.target.value)}
              />
              {errorDe(errores, 'cantidad') ? (
                <span className={styles.campoError}>{errorDe(errores, 'cantidad')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-costo`}>
                Costo unitario
              </label>
              <input
                id={`${id}-costo`}
                type="text"
                inputMode="decimal"
                className={styles.numero}
                value={costo}
                disabled={guardando}
                aria-invalid={errorDe(errores, 'costoUnitario') ? true : undefined}
                onChange={(e) => setCosto(e.target.value)}
                placeholder="opcional"
              />
              {errorDe(errores, 'costoUnitario') ? (
                <span className={styles.campoError}>{errorDe(errores, 'costoUnitario')}</span>
              ) : null}
            </div>

            <div className={styles.campo}>
              <label className={styles.etiqueta} htmlFor={`${id}-moneda`}>
                Moneda del costo
              </label>
              <select
                id={`${id}-moneda`}
                className={styles.select}
                value={moneda}
                disabled={guardando || costo.trim() === ''}
                aria-invalid={errorDe(errores, 'monedaCosto') ? true : undefined}
                onChange={(e) => setMoneda(e.target.value)}
              >
                <option value="">—</option>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {errorDe(errores, 'monedaCosto') ? (
                <span className={styles.campoError}>{errorDe(errores, 'monedaCosto')}</span>
              ) : null}
            </div>

            <div className={`${styles.acciones} ${styles.anchoCompleto}`}>
              <button
                type="button"
                className={styles.primario}
                disabled={guardando}
                onClick={agregar}
              >
                + Agregar repuesto
              </button>
            </div>

            <p className={`${styles.nota} ${styles.anchoCompleto}`}>
              El costo es opcional y <strong>no se completa solo</strong>: las listas de precios
              del catálogo son de venta, y usar un precio de venta como costo le sumaría el margen
              al costo del servicio. Si lo cargás, decí en qué moneda. Agregar un repuesto{' '}
              <strong>no mueve stock</strong>.
            </p>
          </div>
        </>
      ) : null}

      {pendientes.length > 0 && puedeEditar ? (
        <div className={styles.resolver}>
          <h3 className={styles.etiqueta}>Confirmar el consumo</h3>
          <p className={styles.nota}>
            Descuenta del stock {pendientes.length}{' '}
            {pendientes.length === 1 ? 'repuesto' : 'repuestos'} de una sola vez. Es definitivo: un
            repuesto consumido no se edita ni se borra. Confirmarlo dos veces no duplica nada.
          </p>

          {quedanNegativos ? (
            <p className={styles.aviso} role="note">
              Con este consumo algún saldo queda <strong>negativo</strong>. No lo impide: la
              reparación ya ocurrió y no registrarla haría que el sistema mienta sobre una
              herramienta que ya tiene el repuesto puesto. El faltante queda a la vista en el
              saldo.
            </p>
          ) : null}

          <div className={styles.acciones}>
            {confirmando ? (
              <>
                <button
                  type="button"
                  className={styles.primario}
                  disabled={consumiendo}
                  onClick={() => {
                    onConsumir()
                    setConfirmando(false)
                  }}
                >
                  {consumiendo ? 'Registrando…' : 'Sí, descontar del stock'}
                </button>
                <button
                  type="button"
                  className={styles.secundario}
                  disabled={consumiendo}
                  onClick={() => setConfirmando(false)}
                >
                  Volver
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.primario}
                disabled={consumiendo}
                onClick={() => setConfirmando(true)}
              >
                Confirmar consumo
              </button>
            )}
          </div>
        </div>
      ) : null}

      {consumidos.length > 0 && pendientes.length === 0 ? (
        <p className={styles.nota}>
          Los {consumidos.length}{' '}
          {consumidos.length === 1 ? 'repuesto ya está descontado' : 'repuestos ya están descontados'}{' '}
          del stock.
        </p>
      ) : null}
    </div>
  )
}
