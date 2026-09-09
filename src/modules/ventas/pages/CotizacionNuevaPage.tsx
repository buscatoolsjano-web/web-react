import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { CabeceraCotizacion, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { SelectorProducto } from '../components/SelectorProducto'
import { crearCotizacion, type LineaNueva } from '../services/cotizaciones'
import { lineaCapitulo, lineaDeProducto, lineaLibre, mover, renumerar } from '../lib/lineaNueva'
import { tasaDe } from '../lib/tratamientos'
import { formatearImporte } from '../lib/formato'
import { totalesPrevios } from '../lib/totales'
import type { LineaDocumento } from '../types'
import styles from './DetallePage.module.css'
import editor from './EditorCotizacion.module.css'

const HOY = () => new Date().toISOString().slice(0, 10)

const INICIALES: ValoresCabecera = {
  customerId: '',
  titulo: '',
  fecha: HOY(),
  validaHasta: '',
  moneda: 'USD',
  tipoCambio: '',
  formaPago: '30 DIAS F/F con ECHEQ',
  descuentoPct: '',
  percepcionPct: '',
  notas: '',
}

const aNum = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Alta de cotización.
 *
 * El documento se arma en memoria y recién se escribe al guardar. Eso es
 * deliberado por dos razones:
 *
 *   · el número sale de `next_document_number()` en el momento de guardar,
 *     así que un borrador abandonado no se come un número de la serie;
 *   · no hay un «borrador global» como el del legacy, que vivía en
 *     localStorage y era uno solo para toda la aplicación: abrir un segundo
 *     documento pisaba el primero. Acá cada pestaña arma el suyo.
 */
export function CotizacionNuevaPage() {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()

  const [cab, setCab] = useState<ValoresCabecera>(INICIALES)
  const [lineas, setLineas] = useState<LineaDocumento[]>([])
  const [buscando, setBuscando] = useState(false)

  const esInterno = activa?.esInterno ?? false

  const cambiarCabecera = (campo: keyof ValoresCabecera, valor: string) =>
    setCab((v) => ({ ...v, [campo]: valor }))

  const cambiarLinea = (id: string, campo: CampoLinea, valor: string | number | null) => {
    setLineas((ls) =>
      ls.map((l) => {
        if (l.id !== id) return l
        switch (campo) {
          case 'sku_snapshot':
            return { ...l, sku: valor as string | null }
          case 'name_snapshot':
            return { ...l, nombre: valor as string | null }
          case 'description_snapshot':
            return { ...l, descripcion: valor as string | null }
          case 'quantity':
            return { ...l, cantidad: Number(valor) }
          case 'unit_price':
            return { ...l, precioUnitario: Number(valor) }
          case 'discount_pct':
            return { ...l, descuentoPct: Number(valor) }
          case 'tax_treatment': {
            const t = String(valor)
            const tasa = tasaDe(t)
            return { ...l, tratamientoImpuesto: t, tasaImpuesto: tasa ?? l.tasaImpuesto ?? 0 }
          }
          case 'tax_rate_snapshot':
            return { ...l, tasaImpuesto: Number(valor) }
        }
      }),
    )
  }

  const guardar = useMutation({
    mutationFn: async () => {
      if (!activa) throw new Error('Sin empresa activa')
      if (!cab.customerId) throw new Error('Elegí un cliente antes de guardar.')

      const aLinea = (l: LineaDocumento): LineaNueva => ({
        tipoLinea: l.tipoLinea,
        productId: l.productId,
        sku: l.sku,
        nombre: l.nombre,
        descripcion: l.descripcion,
        marca: null,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario ?? 0,
        precioLista: null,
        descuentoPct: l.descuentoPct ?? 0,
        tratamientoImpuesto: l.tratamientoImpuesto ?? 'vat_21',
        tasaImpuesto: l.tasaImpuesto ?? 0,
      })

      return crearCotizacion(
        {
          companyId: activa.companyId,
          customerId: cab.customerId,
          contactId: null,
          titulo: cab.titulo.trim() || null,
          fecha: cab.fecha,
          validaHasta: cab.validaHasta || null,
          moneda: cab.moneda,
          tipoCambio: aNum(cab.tipoCambio),
          formaPago: cab.formaPago.trim() || null,
          notas: cab.notas.trim() || null,
          descuentoPct: aNum(cab.descuentoPct),
          percepcionPct: aNum(cab.percepcionPct),
        },
        renumerar(lineas).map(aLinea),
      )
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/cotizaciones/${id}`, { replace: true })
    },
  })

  // Previsualización mientras se arma el documento. El total que vale lo
  // calcula el servidor al guardar; esto es sólo para no editar a ciegas.
  const previo = totalesPrevios(lineas, aNum(cab.descuentoPct), aNum(cab.percepcionPct))

  if (!esInterno) {
    return (
      <p className={styles.nota}>
        Sólo el equipo interno puede crear cotizaciones.
      </p>
    )
  }

  return (
    <div className={styles.page}>
      <Link to="/ventas/cotizaciones" className={styles.volver}>
        ← Cotizaciones
      </Link>

      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Nueva cotización</h1>
          <p className={styles.subtitulo}>
            El número se asigna al guardar, desde la numeración del servidor.
          </p>
        </div>
      </header>

      <section className={styles.bloque}>
        <CabeceraCotizacion
          valores={cab}
          editable
          monedaEditable
          onCambiar={cambiarCabecera}
        />
      </section>

      <section className={styles.bloque}>
        <h2 className={styles.h2}>Líneas</h2>

        <EditorLineas
          lineas={lineas}
          moneda={cab.moneda}
          editable
          onCambiar={cambiarLinea}
          onEliminar={(id) => setLineas((ls) => renumerar(ls.filter((l) => l.id !== id)))}
          onMover={(id, dir) => setLineas((ls) => mover(ls, id, dir))}
        />

        <div className={editor.acciones}>
          <button type="button" className={editor.boton} onClick={() => setBuscando(true)}>
            Añadir producto
          </button>
          <button
            type="button"
            className={editor.boton}
            onClick={() => setLineas((ls) => [...ls, lineaLibre(ls.length + 1)])}
          >
            Nueva línea
          </button>
          <button
            type="button"
            className={editor.boton}
            onClick={() => setLineas((ls) => [...ls, lineaCapitulo(ls.length + 1)])}
          >
            Nuevo capítulo
          </button>
          <span className={editor.espacio} />
          <span className={editor.neto}>
            Total estimado: <strong>{formatearImporte(previo.total, cab.moneda)}</strong>
          </span>
        </div>

        {buscando ? (
          <div className={editor.selector}>
            <SelectorProducto
              moneda={cab.moneda}
              onCerrar={() => setBuscando(false)}
              onElegir={(p, precio) => {
                setLineas((ls) => [...ls, lineaDeProducto(p, precio, ls.length + 1)])
                setBuscando(false)
              }}
            />
          </div>
        ) : null}

        <p className={editor.aviso}>
          Subtotal {formatearImporte(previo.subtotal, cab.moneda)} · impuestos y percepciones{' '}
          {formatearImporte(previo.impuesto, cab.moneda)}. Es una estimación:{' '}
          <strong>los totales que quedan guardados los calcula el servidor</strong> a partir de las
          líneas, el descuento global y la percepción.
        </p>
      </section>

      <div className={editor.barra}>
        <button
          type="button"
          className={editor.primario}
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending || !cab.customerId}
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar cotización'}
        </button>
        <Link to="/ventas/cotizaciones" className={editor.boton}>
          Cancelar
        </Link>
        {!cab.customerId ? (
          <span className={editor.aviso}>Elegí un cliente para poder guardar.</span>
        ) : null}
        {guardar.error ? (
          <span className={editor.error} role="alert">
            {guardar.error.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
