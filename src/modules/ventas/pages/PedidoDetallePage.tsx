import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { CabeceraCotizacion, type CampoCabecera, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { ChipEstado } from '../components/ChipEstado'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { PanelPendientes } from '../components/PanelPendientes'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { PanelStock } from '../components/PanelStock'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { presentarCumplimiento, presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { lineaCapitulo, lineaDeProducto, lineaLibre } from '../lib/lineaNueva'
import { tasaDe } from '../lib/tratamientos'
import {
  useDisponibilidad,
  useDocumento,
  usePendientes,
  useRelacionados,
} from '../hooks/useDocumentos'
import { esSensible, registrarEvento } from '../services/auditoria'
import { ordenarLineas, type LineaNueva } from '../services/cotizaciones'
import {
  actualizarCabeceraPedido,
  actualizarLineaPedido,
  agregarLineaPedido,
  cambiarEstadoPedido,
  editabilidadPedido,
  eliminarLineaPedido,
  intercambiarOrdenPedido,
} from '../services/pedidos'
import type { DocumentoDetalle, LineaDocumento } from '../types'
import styles from './DetallePage.module.css'
import editor from './EditorCotizacion.module.css'

/** Campo lógico del editor → columna real de `sales_order_lines`. */
const COLUMNA_LINEA: Record<CampoLinea, string> = {
  sku_snapshot: 'sku_snapshot',
  name_snapshot: 'name_snapshot',
  description_snapshot: 'description_snapshot',
  // La única que cambia de nombre respecto de la cotización.
  quantity: 'quantity_ordered',
  unit_price: 'unit_price',
  discount_pct: 'discount_pct',
  tax_treatment: 'tax_treatment',
  tax_rate_snapshot: 'tax_rate_snapshot',
}

const COLUMNA: Record<CampoCabecera, string> = {
  customerId: 'customer_id',
  titulo: 'title',
  fecha: 'order_date',
  validaHasta: 'order_date', // el pedido no tiene validez; el campo se oculta
  moneda: 'currency_code',
  tipoCambio: 'exchange_rate',
  formaPago: 'payment_terms',
  descuentoPct: 'discount_pct',
  percepcionPct: 'perception_pct',
  notas: 'notes',
}

const TEXTO: CampoCabecera[] = ['titulo', 'formaPago', 'notas']
const NUMERO: CampoCabecera[] = ['tipoCambio', 'descuentoPct', 'percepcionPct']

const texto = (n: number | null) => (n === null ? '' : String(n))

function aValores(d: DocumentoDetalle): ValoresCabecera {
  return {
    customerId: d.clienteId ?? '',
    titulo: d.titulo ?? '',
    fecha: d.fecha.slice(0, 10),
    validaHasta: '',
    moneda: d.moneda ?? 'USD',
    tipoCambio: texto(d.tipoCambio),
    formaPago: d.formaPago ?? '',
    descuentoPct: texto(d.descuentoPct),
    percepcionPct: texto(d.percepcionPct),
    notas: d.notas ?? '',
  }
}

/**
 * Detalle y edición de un pedido.
 *
 * Igual que la cotización, con dos cosas propias: el panel de entregas —con
 * las cuatro reglas del histórico que aprobamos en Stage 2.5— y el de stock,
 * que es SÓLO INFORMATIVO: crear o editar un pedido no reserva ni descuenta
 * nada.
 */
export function PedidoDetallePage() {
  const { id } = useParams<{ id: string }>()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('pedido', id)
  const relacionados = useRelacionados('pedido', id)
  const pendientes = usePendientes(doc)

  const [modoEdicion, setModoEdicion] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  const productIds = useMemo(
    () => lineas.flatMap((l) => (l.productId ? [l.productId] : [])),
    [lineas],
  )
  const stock = useDisponibilidad(productIds)

  // Un pedido con entregas tiene las líneas congeladas, y lo impone un trigger.
  const tieneEntregas = (relacionados.data?.entregas.length ?? 0) > 0
  const permiso = editabilidadPedido(doc?.estado ?? '', esInterno, tieneEntregas)
  const editando = modoEdicion && permiso.editable

  const guardar = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      setUltimoError(null)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
    },
    onError: (e: Error) => setUltimoError(e.message),
  })

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer el pedido: {error.message}
      </p>
    )
  }

  if (!doc) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró el pedido. Puede que no exista o que no tengas acceso.
        </p>
        <Link to="/ventas/pedidos" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const cambiarCampo = (campo: CampoCabecera, valor: string) => {
    if (campo === 'validaHasta' || campo === 'moneda') return
    const columna = COLUMNA[campo]
    let valorFinal: string | number | null = valor
    if (NUMERO.includes(campo)) {
      const t = valor.trim()
      valorFinal = t === '' ? null : Number(t.replace(',', '.'))
      if (valorFinal !== null && !Number.isFinite(valorFinal)) return
    } else if (TEXTO.includes(campo)) {
      valorFinal = valor.trim() === '' ? null : valor
    } else if (valor === '') {
      valorFinal = null
    }

    guardar.mutate(async () => {
      await actualizarCabeceraPedido(doc.id, { [columna]: valorFinal })
      if (permiso.audita && esSensible(columna)) {
        await registrarEvento('sales_order', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: null, to: valorFinal },
        })
      }
    })
  }

  const cambiarLinea = (lineaId: string, campo: CampoLinea, valor: string | number | null) => {
    const linea = lineas.find((l) => l.id === lineaId)
    const columna = COLUMNA_LINEA[campo]
    const cambios: Record<string, string | number | null> = { [columna]: valor }
    if (campo === 'tax_treatment') {
      const tasa = tasaDe(String(valor))
      if (tasa !== null) cambios['tax_rate_snapshot'] = tasa
    }
    guardar.mutate(async () => {
      await actualizarLineaPedido(lineaId, cambios)
      if (permiso.audita && esSensible(columna) && linea) {
        const antes =
          campo === 'unit_price' ? linea.precioUnitario
          : campo === 'quantity' ? linea.cantidad
          : linea.descuentoPct
        await registrarEvento('sales_order', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: antes, to: valor },
        })
      }
    })
  }

  const proximoNumeroDeLinea = () =>
    lineas.reduce((max, l) => Math.max(max, l.numeroLinea ?? 0), 0) + 1

  const insertar = (nueva: LineaDocumento) => {
    if (!activa) return
    const l: LineaNueva = {
      tipoLinea: nueva.tipoLinea,
      productId: nueva.productId,
      sku: nueva.sku,
      nombre: nueva.nombre,
      descripcion: nueva.descripcion,
      marca: null,
      cantidad: nueva.cantidad,
      precioUnitario: nueva.precioUnitario ?? 0,
      precioLista: null,
      descuentoPct: nueva.descuentoPct ?? 0,
      tratamientoImpuesto: nueva.tratamientoImpuesto ?? 'vat_21',
      tasaImpuesto: nueva.tasaImpuesto ?? 0,
    }
    guardar.mutate(() =>
      agregarLineaPedido(activa.companyId, doc.id, nueva.numeroLinea ?? proximoNumeroDeLinea(), l),
    )
  }

  const moverLinea = (lineaId: string, direccion: -1 | 1) => {
    const i = lineas.findIndex((l) => l.id === lineaId)
    const a = lineas[i]
    const b = lineas[i + direccion]
    if (!a || !b || a.numeroLinea === null || b.numeroLinea === null) return
    guardar.mutate(() =>
      intercambiarOrdenPedido(
        { id: a.id, numeroLinea: a.numeroLinea! },
        { id: b.id, numeroLinea: b.numeroLinea! },
      ),
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/ventas/pedidos" className={styles.volver}>
        ← Pedidos
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{doc.numero}</h1>
          <div className={styles.chips}>
            <ChipEstado estado={presentarEstado('pedido', doc.estado)} />
            {doc.estadoSecundario ? (
              <ChipEstado estado={presentarCumplimiento(doc.estadoSecundario)} />
            ) : null}
            {doc.esHistorico ? (
              <span className={styles.historico}>Migrado del sistema anterior</span>
            ) : null}
            {guardar.isPending ? <span className={editor.guardando}>Guardando…</span> : null}
          </div>
          {doc.titulo && !editando ? <p className={styles.subtitulo}>{doc.titulo}</p> : null}
        </div>
        <div className={styles.importe}>
          <span className={styles.importeValor}>{formatearImporte(doc.total, doc.moneda)}</span>
          <span className={styles.importeEtiqueta}>Total</span>
        </div>
      </header>

      <AvisosHistoricos
        motivos={doc.motivosRevision}
        numeroFueraDeSerie={doc.numeroFueraDeSerie}
        numeroSospechado={doc.numeroSospechado}
        esHistorico={doc.esHistorico}
      />

      {ultimoError ? (
        <p className={styles.error} role="alert">
          {ultimoError}
        </p>
      ) : null}

      <section className={styles.bloque}>
        {editando ? (
          <CabeceraCotizacion
            valores={aValores(doc)}
            editable
            monedaEditable={false}
            onCambiar={cambiarCampo}
          />
        ) : (
          <dl className={styles.datos}>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Cliente</dt>
              <dd className={styles.datoValor}>{doc.clienteNombre}</dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Contacto</dt>
              <dd className={styles.datoValor}>{doc.contactoNombre ?? '—'}</dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Fecha</dt>
              <dd className={styles.datoValor}>{formatearFecha(doc.fecha)}</dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Moneda</dt>
              <dd className={styles.datoValor}>
                {doc.moneda ?? <span className={styles.falta}>Sin registrar</span>}
              </dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Tipo de cambio</dt>
              <dd className={styles.datoValor}>
                {doc.tipoCambio ?? <span className={styles.falta}>Sin registrar</span>}
              </dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Vendedor</dt>
              <dd className={styles.datoValor}>
                {doc.vendedor ?? <span className={styles.falta}>Sin registrar</span>}
              </dd>
            </div>
            {doc.origen ? (
              <div className={styles.dato}>
                <dt className={styles.datoEtiqueta}>Cotización de origen</dt>
                <dd className={styles.datoValor}>
                  <Link to={`/ventas/cotizaciones/${doc.origen.id}`} className={styles.enlace}>
                    {doc.origen.numero}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        {!editando && doc.notas ? <p className={styles.notas}>{doc.notas}</p> : null}
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Líneas</h2>

        {editando ? (
          <>
            <EditorLineas
              lineas={lineas}
              moneda={doc.moneda ?? 'USD'}
              editable
              onCambiar={cambiarLinea}
              onEliminar={(lineaId) => guardar.mutate(() => eliminarLineaPedido(lineaId))}
              onMover={moverLinea}
            />
            <div className={editor.acciones}>
              <button type="button" className={editor.boton} onClick={() => setBuscando(true)}>
                Añadir producto
              </button>
              <button
                type="button"
                className={editor.boton}
                onClick={() => insertar(lineaLibre(proximoNumeroDeLinea()))}
              >
                Nueva línea
              </button>
              <button
                type="button"
                className={editor.boton}
                onClick={() => insertar(lineaCapitulo(proximoNumeroDeLinea()))}
              >
                Nuevo capítulo
              </button>
            </div>
            {buscando ? (
              <div className={editor.selector}>
                <SelectorProducto
                  moneda={doc.moneda ?? 'USD'}
                  onCerrar={() => setBuscando(false)}
                  onElegir={(p, precio) => {
                    insertar(lineaDeProducto(p, precio, proximoNumeroDeLinea()))
                    setBuscando(false)
                  }}
                />
              </div>
            ) : null}
          </>
        ) : (
          <TablaLineas lineas={lineas} moneda={doc.moneda} tipo="pedido" />
        )}

        <dl className={styles.totales}>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatearImporte(doc.subtotal, doc.moneda)}</dd>
          </div>
          <div>
            <dt>Impuestos y percepciones</dt>
            <dd>{formatearImporte(doc.impuesto, doc.moneda)}</dd>
          </div>
          <div className={styles.totalFinal}>
            <dt>Total</dt>
            <dd>{formatearImporte(doc.total, doc.moneda)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Entregas</h2>
        <PanelPendientes
          lineas={lineas}
          resultado={pendientes.data}
          cargando={pendientes.isPending}
        />
      </section>

      {esInterno ? (
        <section className={styles.bloque}>
          <h2 className={styles.h2}>Stock</h2>
          <PanelStock
            lineas={lineas}
            disponibilidad={stock.data}
            cargando={stock.isPending && productIds.length > 0}
            esInterno={esInterno}
          />
        </section>
      ) : null}

      <div className={editor.barra}>
        {permiso.editable ? (
          <button
            type="button"
            className={editando ? editor.boton : editor.primario}
            onClick={() => setModoEdicion((v) => !v)}
          >
            {editando ? 'Terminar edición' : 'Editar'}
          </button>
        ) : (
          <span className={editor.candado}>{permiso.motivo}</span>
        )}
        {permiso.editable && permiso.motivo ? (
          <span className={editor.aviso}>{permiso.motivo}</span>
        ) : null}

        <span className={editor.espacio} />

        <div className={editor.estados}>
          {doc.estado === 'draft' ? (
            <button
              type="button"
              className={editor.boton}
              onClick={() => guardar.mutate(() => cambiarEstadoPedido(doc.id, 'draft', 'confirmed'))}
            >
              Confirmar pedido
            </button>
          ) : null}
          {doc.estado === 'confirmed' && !tieneEntregas ? (
            <button
              type="button"
              className={editor.boton}
              onClick={() =>
                guardar.mutate(() => cambiarEstadoPedido(doc.id, 'confirmed', 'cancelled'))
              }
            >
              Cancelar pedido
            </button>
          ) : null}
        </div>
      </div>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Relacionados</h2>
        <PanelRelacionados
          relacionados={relacionados.data}
          cargando={relacionados.isPending}
          idActual={doc.id}
        />
      </section>
    </div>
  )
}
