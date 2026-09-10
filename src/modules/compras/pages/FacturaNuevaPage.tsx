import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { BuscadorProveedor } from '../components/BuscadorProveedor'
import { GrillaFactura, type CargaPorLinea } from '../components/GrillaFactura'
import { LineasLibresFactura } from '../components/LineasLibresFactura'
import { PanelTotales } from '../components/PanelTotales'
import { permisosDe } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { MONEDAS } from '../lib/validacion'
import { obtenerProveedorBreve, type ProveedorBuscado } from '../services/catalogo'
import type { LineaAFacturar } from '../services/facturas'
import { useCrearFactura, usePendienteDeFacturar } from '../hooks/useFacturas'
import { useQuery } from '@tanstack/react-query'
import { totalesDeFactura } from '../lib/facturacion'
import cab from '../components/CabeceraPedido.module.css'
import styles from './ProveedorDetallePage.module.css'

const hoy = () => new Date().toISOString().slice(0, 10)

/**
 * Alta de factura de proveedor.
 *
 * Se puede llegar de tres formas y las tres terminan en la misma pantalla:
 * desde el menú, desde un pedido (`?proveedor=`) o desde una recepción
 * (`?recepcion=`). Lo que cambia es qué viene precompletado.
 *
 * **Una factura no es una recepción.** Puede cubrir varias recepciones del
 * mismo proveedor, puede ser parcial, y puede traer conceptos que no salen de
 * ninguna mercadería —flete, seguro, un gasto—. La pantalla está armada así: la
 * grilla de arriba es lo recibido pendiente de facturar, y abajo hay un bloque
 * aparte para lo demás.
 */
export function FacturaNuevaPage() {
  const [params] = useSearchParams()
  const recepcionInicial = params.get('recepcion')
  const proveedorInicial = params.get('proveedor')
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const navegar = useNavigate()
  const crear = useCrearFactura()

  const [proveedorId, setProveedorId] = useState<string | null>(proveedorInicial)
  const [numeroProveedor, setNumeroProveedor] = useState('')
  const [moneda, setMoneda] = useState('')
  const [tipoCambio, setTipoCambio] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [vencimiento, setVencimiento] = useState('')
  const [notas, setNotas] = useState('')
  const [carga, setCarga] = useState<CargaPorLinea>(new Map())
  const [libres, setLibres] = useState<LineaAFacturar[]>([])
  const [intentado, setIntentado] = useState(false)

  const proveedor = useQuery<ProveedorBuscado | null>({
    queryKey: ['compras', companyId, 'proveedor-breve', proveedorId],
    queryFn: () => obtenerProveedorBreve(companyId!, proveedorId!),
    enabled: companyId !== null && proveedorId !== null,
    staleTime: 5 * 60_000,
  })

  const pendiente = usePendienteDeFacturar(
    proveedorId,
    recepcionInicial ? [recepcionInicial] : null,
  )
  const lineasPendientes = pendiente.data ?? []

  // La moneda se hereda de lo que se está facturando: todas las recepciones
  // pendientes de un proveedor vienen de pedidos, y el pedido tiene moneda. Se
  // ajusta DURANTE el render, no en un useEffect.
  const monedasPosibles = [...new Set(lineasPendientes.map((l) => l.moneda).filter((m): m is string => m !== null))]
  const [monedaVista, setMonedaVista] = useState<string | null>(null)
  if (moneda === '' && monedasPosibles.length === 1 && monedaVista !== monedasPosibles[0]) {
    setMonedaVista(monedasPosibles[0]!)
    setMoneda(monedasPosibles[0]!)
  }

  if (!permisos.crearProveedor) {
    return (
      <div className={styles.page}>
        <Link to="/compras/facturas" className={styles.volver}>
          ← Facturas de proveedor
        </Link>
        <p className={styles.nota}>Tu rol no puede cargar facturas de proveedor.</p>
      </div>
    )
  }

  // Sólo se ofrecen las líneas de la moneda elegida: una factura, una moneda.
  const visibles = moneda === ''
    ? lineasPendientes
    : lineasPendientes.filter((l) => l.moneda === null || l.moneda === moneda)

  const cambiarLinea = (id: string, cambios: Partial<LineaAFacturar>) =>
    setCarga((m) => {
      const n = new Map(m)
      const p = lineasPendientes.find((x) => x.goodsReceiptLineId === id)
      const actual = n.get(id) ?? {
        goodsReceiptLineId: id,
        purchaseOrderLineId: p?.purchaseOrderLineId ?? null,
        productId: p?.productId ?? null,
        sku: p?.sku ?? null,
        descripcion: p?.descripcion ?? null,
        cantidad: 0,
        precioUnitario: p?.precioPedido ?? 0,
        descuentoPct: 0,
        tratamientoImpuesto: p?.tratamientoPedido ?? 'vat_21',
        tasaImpuesto: tasaDe(p?.tratamientoPedido ?? 'vat_21'),
      }
      const siguiente = { ...actual, ...cambios }
      if (siguiente.cantidad <= 0) n.delete(id)
      else n.set(id, siguiente)
      return n
    })

  const facturarTodo = () =>
    setCarga(
      new Map(
        visibles
          .filter((p) => p.pendiente > 0)
          .map((p) => [
            p.goodsReceiptLineId,
            {
              goodsReceiptLineId: p.goodsReceiptLineId,
              purchaseOrderLineId: p.purchaseOrderLineId,
              productId: p.productId,
              sku: p.sku,
              descripcion: p.descripcion,
              cantidad: p.pendiente,
              precioUnitario: p.precioPedido ?? 0,
              descuentoPct: 0,
              tratamientoImpuesto: p.tratamientoPedido ?? 'vat_21',
              tasaImpuesto: tasaDe(p.tratamientoPedido ?? 'vat_21'),
            } satisfies LineaAFacturar,
          ]),
      ),
    )

  const todas = [...carga.values(), ...libres.filter((l) => l.cantidad > 0)]
  const previo = totalesDeFactura(todas)
  const excede = visibles.some(
    (p) => (carga.get(p.goodsReceiptLineId)?.cantidad ?? 0) > p.pendiente,
  )

  const problemas: string[] = []
  if (proveedorId === null) problemas.push('Elegí un proveedor.')
  if (moneda === '') problemas.push('La moneda es obligatoria.')
  if (todas.length === 0) problemas.push('No hay ninguna línea cargada.')
  if (libres.some((l) => l.cantidad > 0 && !(l.descripcion ?? '').trim())) {
    problemas.push('Los conceptos sin recepción necesitan una descripción.')
  }

  const guardar = () => {
    setIntentado(true)
    if (problemas.length > 0 || excede) return
    crear.mutate(
      {
        datos: {
          proveedorId: proveedorId!,
          numeroProveedor,
          moneda,
          tipoCambio,
          fecha,
          vencimiento,
          formaPago: proveedor.data?.formaPago ?? '',
          notas,
        },
        lineas: todas,
      },
      { onSuccess: ({ id }) => void navegar(`/compras/facturas/${id}`) },
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/compras/facturas" className={styles.volver}>
        ← Facturas de proveedor
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>Nueva factura de proveedor</h1>
          <p className={styles.subtitulo}>
            Nace en borrador. Registrarla es otra acción, y no mueve stock: el stock ya entró
            con la recepción.
          </p>
        </div>
      </header>

      <section className={styles.bloque}>
        <div className={cab.grilla}>
          <BuscadorProveedor
            elegido={proveedor.data ?? null}
            error={intentado && proveedorId === null ? 'Elegí un proveedor.' : null}
            onElegir={(p) => {
              setProveedorId(p.id)
              setCarga(new Map())
              setMoneda('')
              setMonedaVista(null)
            }}
            onLimpiar={() => setProveedorId(null)}
          />

          <div className={cab.campo}>
            <label className={cab.etiqueta} htmlFor="numprov">
              Número de la factura del proveedor
            </label>
            <input
              id="numprov"
              className={cab.control}
              value={numeroProveedor}
              placeholder="0001-00012345"
              onChange={(e) => setNumeroProveedor(e.target.value)}
            />
            <span className={cab.ayuda}>
              El número que figura en el papel. No se puede repetir para el mismo proveedor. La
              referencia interna FP la asigna el servidor.
            </span>
          </div>

          <div className={cab.campo}>
            <label className={cab.etiqueta} htmlFor="moneda">
              Moneda *
            </label>
            <select
              id="moneda"
              className={cab.control}
              value={moneda}
              onChange={(e) => {
                setMoneda(e.target.value)
                setCarga(new Map())
              }}
            >
              <option value="">Elegí una moneda</option>
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className={monedasPosibles.length > 1 ? cab.error : cab.ayuda}>
              {monedasPosibles.length > 1
                ? `Este proveedor tiene recepciones en ${monedasPosibles.join(' y ')}. Una factura lleva una sola moneda: elegí cuál.`
                : 'Se hereda del pedido. Una factura tiene una sola moneda.'}
            </span>
          </div>

          <div className={cab.campo}>
            <label className={cab.etiqueta} htmlFor="tc">
              Tipo de cambio
            </label>
            <input
              id="tc"
              type="number"
              step="any"
              min="0"
              className={cab.control}
              value={tipoCambio}
              placeholder="opcional"
              onChange={(e) => setTipoCambio(e.target.value)}
            />
            <span className={cab.ayuda}>Se guarda como referencia. No convierte nada.</span>
          </div>

          <div className={cab.campo}>
            <label className={cab.etiqueta} htmlFor="fecha">
              Fecha de la factura *
            </label>
            <input
              id="fecha"
              type="date"
              className={cab.control}
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>

          <div className={cab.campo}>
            <label className={cab.etiqueta} htmlFor="venc">
              Vencimiento
            </label>
            <input
              id="venc"
              type="date"
              className={cab.control}
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
            />
          </div>

          <div className={cab.campoAncho}>
            <label className={cab.etiqueta} htmlFor="notas">
              Notas
            </label>
            <textarea
              id="notas"
              className={cab.area}
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>
      </section>

      {proveedorId === null ? (
        <p className={styles.nota}>Elegí un proveedor para ver qué hay pendiente de facturar.</p>
      ) : (
        <section className={styles.bloque}>
          {pendiente.isPending ? (
            <p className={styles.nota}>Cargando lo pendiente de facturar…</p>
          ) : pendiente.error ? (
            <p className={styles.error} role="alert">
              {pendiente.error.message}
            </p>
          ) : (
            <GrillaFactura
              pendientes={visibles}
              carga={carga}
              moneda={moneda}
              editable
              onCambiar={cambiarLinea}
              onFacturarTodo={facturarTodo}
            />
          )}
        </section>
      )}

      <section className={styles.bloque}>
        <LineasLibresFactura
          lineas={libres}
          moneda={moneda}
          editable
          onCambiar={(i, cambios) =>
            setLibres((l) => l.map((x, j) => (j === i ? { ...x, ...cambios } : x)))
          }
          onAgregar={() =>
            setLibres((l) => [
              ...l,
              {
                goodsReceiptLineId: null,
                purchaseOrderLineId: null,
                productId: null,
                sku: null,
                descripcion: '',
                cantidad: 1,
                precioUnitario: 0,
                descuentoPct: 0,
                tratamientoImpuesto: 'vat_21',
                tasaImpuesto: tasaDe('vat_21'),
              },
            ])
          }
          onQuitar={(i) => setLibres((l) => l.filter((_, j) => j !== i))}
        />

        <PanelTotales moneda={moneda} servidor={null} previo={previo} sinGuardar />

        {intentado && problemas.length > 0 ? (
          <ul className={styles.problemas} role="alert">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {crear.error ? (
          <p className={styles.error} role="alert">
            {crear.error.message}
          </p>
        ) : null}

        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.primario}
            disabled={crear.isPending || excede}
            onClick={guardar}
          >
            {crear.isPending ? 'Guardando…' : 'Crear factura en borrador'}
          </button>
          <button
            type="button"
            className={styles.secundario}
            disabled={crear.isPending}
            onClick={() => void navegar('/compras/facturas')}
          >
            Cancelar
          </button>
        </div>
      </section>
    </div>
  )
}
