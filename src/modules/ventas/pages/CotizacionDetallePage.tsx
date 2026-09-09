import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AvisosHistoricos } from '../components/AvisosHistoricos'
import { CabeceraCotizacion, type CampoCabecera, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { ChipEstado } from '../components/ChipEstado'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { PanelRelacionados } from '../components/PanelRelacionados'
import { SelectorProducto } from '../components/SelectorProducto'
import { TablaLineas } from '../components/TablaLineas'
import { presentarEstado } from '../lib/estados'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { lineaCapitulo, lineaDeProducto, lineaLibre } from '../lib/lineaNueva'
import { tasaDe } from '../lib/tratamientos'
import { useDocumento, useRelacionados } from '../hooks/useDocumentos'
import { esSensible, registrarEvento } from '../services/auditoria'
import {
  actualizarCabecera,
  actualizarLinea,
  agregarLinea,
  cambiarEstado,
  editabilidad,
  eliminarLinea,
  intercambiarOrden,
  ordenarLineas,
  type LineaNueva,
} from '../services/cotizaciones'
import { convertirCotizacionEnPedido } from '../services/pedidos'
import type { DocumentoDetalle, LineaDocumento } from '../types'
import styles from './DetallePage.module.css'
import editor from './EditorCotizacion.module.css'

/** Los campos de la cabecera que se guardan, y con qué columna. */
const COLUMNA: Record<CampoCabecera, string> = {
  customerId: 'customer_id',
  titulo: 'title',
  fecha: 'quote_date',
  validaHasta: 'valid_until',
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
    validaHasta: d.validaHasta?.slice(0, 10) ?? '',
    moneda: d.moneda ?? 'USD',
    tipoCambio: texto(d.tipoCambio),
    formaPago: d.formaPago ?? '',
    descuentoPct: texto(d.descuentoPct),
    percepcionPct: texto(d.percepcionPct),
    notas: d.notas ?? '',
  }
}

/**
 * Detalle y edición de una cotización.
 *
 * Cada cambio se guarda solo, en cuanto el control pierde el foco y sólo si
 * el valor cambió. No hay autosave por temporizador —ni writes duplicados, ni
 * bucles— y los totales que se ven vuelven siempre del servidor: los calcula
 * un trigger, no el navegador.
 */
export function CotizacionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { activa } = useEmpresa()
  const queryClient = useQueryClient()
  const { data: doc, isPending, error } = useDocumento('cotizacion', id)
  const relacionados = useRelacionados('cotizacion', id)

  const [modoEdicion, setModoEdicion] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ultimoError, setUltimoError] = useState<string | null>(null)

  const esInterno = activa?.esInterno ?? false
  const permiso = editabilidad(doc?.estado ?? '', esInterno)
  const editando = modoEdicion && permiso.editable

  const refrescar = () =>
    queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId, 'cotizacion'] })

  const guardar = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      setUltimoError(null)
      void refrescar()
    },
    onError: (e: Error) => setUltimoError(e.message),
  })

  /**
   * Cotización → pedido.
   *
   * El botón se deshabilita si ya hay un pedido, pero lo que IMPIDE el
   * duplicado es un índice único sobre `(company_id, quote_id)`: dos pestañas
   * apretando a la vez sólo crean uno, y la segunda recibe el error.
   */
  const convertir = useMutation({
    mutationFn: () => convertirCotizacionEnPedido(activa!.companyId, id!),
    onSuccess: (pedidoId) => {
      setUltimoError(null)
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/pedidos/${pedidoId}`)
    },
    onError: (e: Error) => setUltimoError(e.message),
  })

  const lineas = useMemo(() => (doc ? ordenarLineas(doc.lineas) : []), [doc])
  // La cotización ya tiene pedido si el panel de relacionados encontró uno.
  const yaTienePedido = (relacionados.data?.pedidos.length ?? 0) > 0

  if (isPending) return <p className={styles.nota}>Cargando…</p>

  if (error) {
    return (
      <p className={styles.error} role="alert">
        No se pudo leer la cotización: {error.message}
      </p>
    )
  }

  if (!doc) {
    return (
      <div className={styles.page}>
        <p className={styles.nota}>
          No se encontró la cotización. Puede que no exista o que no tengas acceso.
        </p>
        <Link to="/ventas/cotizaciones" className={styles.volver}>
          ← Volver al listado
        </Link>
      </div>
    )
  }

  const valores = aValores(doc)

  const cambiarCampo = (campo: CampoCabecera, valor: string) => {
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
      await actualizarCabecera(doc.id, { [columna]: valorFinal })
      // Un cambio de precio o de descuento en un documento YA ENVIADO es un
      // hecho comercial, no un guardado técnico: queda registrado.
      if (doc.estado === 'sent' && esSensible(columna)) {
        await registrarEvento('sales_quote', doc.id, 'updated_sensitive_fields', null, null, {
          [columna]: { from: null, to: valorFinal },
        })
      }
    })
  }

  const cambiarLinea = (lineaId: string, campo: CampoLinea, valor: string | number | null) => {
    const linea = lineas.find((l) => l.id === lineaId)
    const cambios: Record<string, string | number | null> = { [campo]: valor }
    if (campo === 'tax_treatment') {
      const tasa = tasaDe(String(valor))
      if (tasa !== null) cambios['tax_rate_snapshot'] = tasa
    }
    guardar.mutate(async () => {
      await actualizarLinea(lineaId, cambios)
      if (doc.estado === 'sent' && esSensible(campo) && linea) {
        const antes =
          campo === 'unit_price' ? linea.precioUnitario
          : campo === 'quantity' ? linea.cantidad
          : linea.descuentoPct
        await registrarEvento('sales_quote', doc.id, 'updated_sensitive_fields', null, null, {
          [campo]: { from: antes, to: valor },
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
      agregarLinea(activa.companyId, doc.id, nueva.numeroLinea ?? proximoNumeroDeLinea(), l),
    )
  }

  const moverLinea = (lineaId: string, direccion: -1 | 1) => {
    const i = lineas.findIndex((l) => l.id === lineaId)
    const j = i + direccion
    const a = lineas[i]
    const b = lineas[j]
    if (!a || !b || a.numeroLinea === null || b.numeroLinea === null) return
    guardar.mutate(() =>
      intercambiarOrden(
        { id: a.id, numeroLinea: a.numeroLinea! },
        { id: b.id, numeroLinea: b.numeroLinea! },
      ),
    )
  }

  const transicion = (hasta: string) =>
    guardar.mutate(() => cambiarEstado(doc.id, doc.estado, hasta))

  return (
    <div className={styles.page}>
      <Link to="/ventas/cotizaciones" className={styles.volver}>
        ← Cotizaciones
      </Link>

      <header className={styles.encabezado}>
        <div className={styles.identidad}>
          <h1 className={styles.titulo}>{doc.numero}</h1>
          <div className={styles.chips}>
            <ChipEstado estado={presentarEstado('cotizacion', doc.estado)} />
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
            valores={valores}
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
              <dt className={styles.datoEtiqueta}>Serie</dt>
              <dd className={styles.datoValor}>{doc.serie ?? '—'}</dd>
            </div>
            <div className={styles.dato}>
              <dt className={styles.datoEtiqueta}>Vendedor</dt>
              <dd className={styles.datoValor}>
                {doc.vendedor ?? <span className={styles.falta}>Sin registrar</span>}
              </dd>
            </div>
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
              onEliminar={(lineaId) => guardar.mutate(() => eliminarLinea(lineaId))}
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
          <TablaLineas lineas={lineas} moneda={doc.moneda} tipo="cotizacion" />
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
        {editando ? (
          <p className={editor.aviso}>
            Los totales los calcula el servidor a partir de las líneas, el descuento global y la
            percepción. El navegador no los inventa.
          </p>
        ) : null}
      </section>

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

        <span className={editor.espacio} />

        <div className={editor.estados}>
          {esInterno && doc.estado !== 'rejected' ? (
            <button
              type="button"
              className={editor.primario}
              disabled={yaTienePedido || convertir.isPending}
              onClick={() => convertir.mutate()}
              title={yaTienePedido ? 'Esta cotización ya tiene un pedido' : undefined}
            >
              {convertir.isPending
                ? 'Generando…'
                : yaTienePedido
                  ? 'Ya tiene pedido'
                  : '→ Generar pedido'}
            </button>
          ) : null}
          {doc.estado === 'draft' ? (
            <button type="button" className={editor.boton} onClick={() => transicion('sent')}>
              Marcar como enviada
            </button>
          ) : null}
          {doc.estado === 'sent' ? (
            <>
              <button type="button" className={editor.boton} onClick={() => transicion('accepted')}>
                Marcar aceptada
              </button>
              <button type="button" className={editor.boton} onClick={() => transicion('rejected')}>
                Marcar rechazada
              </button>
            </>
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
