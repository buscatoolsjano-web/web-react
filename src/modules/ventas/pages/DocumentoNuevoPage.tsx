import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection, Totals } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { CabeceraCotizacion, type ValoresCabecera } from '../components/CabeceraCotizacion'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { SelectorProducto } from '../components/SelectorProducto'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { DOC_TYPE_DE, MENSAJES_WORKFLOW, mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import { escribeVentas } from '../lib/permisos'
import { crearCotizacion, type LineaNueva } from '../services/cotizaciones'
import { crearPedido } from '../services/pedidos'
import { lineaCapitulo, lineaDeProducto, lineaLibre, mover, renumerar } from '../lib/lineaNueva'
import { tasaDe } from '../lib/tratamientos'
import { formatearImporte } from '../lib/formato'
import { totalesPrevios } from '../lib/totales'
import { RUTA_DE, type LineaDocumento } from '../types'
import editor from './EditorCotizacion.module.css'

const HOY = () => new Date().toISOString().slice(0, 10)

const INICIALES: ValoresCabecera = {
  customerId: '',
  titulo: '',
  fecha: HOY(),
  validaHasta: '',
  // Fase 14 E3: sin moneda preseleccionada. Un USD visible que en realidad es un
  // valor por defecto terminaba guardado sin que nadie lo eligiera.
  moneda: '',
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

export interface DocumentoNuevoProps {
  tipo: 'cotizacion' | 'pedido'
}

/**
 * Alta de cotización o de pedido.
 *
 * Es la misma pantalla para los dos: el legacy también usaba un solo editor
 * —`renderCotEditor` con `_tipoDoc`— y no hay razón para tener dos copias que
 * se van separando de a poco. Lo único que cambia es a qué tabla se escribe
 * al guardar.
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
export function DocumentoNuevoPage({ tipo }: DocumentoNuevoProps) {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()

  const [cab, setCab] = useState<ValoresCabecera>(INICIALES)
  const [lineas, setLineas] = useState<LineaDocumento[]>([])
  const [buscando, setBuscando] = useState(false)

  // Crear es de admin y employee: el mismo conjunto que `quotes_write`,
  // `orders_write` y `next_document_number`.
  const escribe = escribeVentas(activa?.rol)
  // Fase 12 E2.5: guardar consume la numeración. Con STEL como autoridad la
  // base lo rechaza; acá se anticipa para no armar un documento en vano.
  const autoridad = useAutoridadNumeracion()
  const stel = autoridad.stel(DOC_TYPE_DE[tipo])

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
      if (!cab.moneda) throw new Error(MENSAJES_WORKFLOW.DOCUMENT_CURRENCY_REQUIRED)

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

      const comun = {
        companyId: activa.companyId,
        customerId: cab.customerId,
        contactId: null,
        titulo: cab.titulo.trim() || null,
        fecha: cab.fecha,
        moneda: cab.moneda,
        tipoCambio: aNum(cab.tipoCambio),
        formaPago: cab.formaPago.trim() || null,
        notas: cab.notas.trim() || null,
        descuentoPct: aNum(cab.descuentoPct),
        percepcionPct: aNum(cab.percepcionPct),
      }
      const filas = renumerar(lineas).map(aLinea)

      return tipo === 'cotizacion'
        ? crearCotizacion({ ...comun, validaHasta: cab.validaHasta || null }, filas)
        : crearPedido({ ...comun, origen: 'manual', quoteId: null }, filas)
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`${RUTA_DE[tipo]}/${id}`, { replace: true })
    },
  })

  // Previsualización mientras se arma el documento. El total que vale lo
  // calcula el servidor al guardar; esto es sólo para no editar a ciegas.
  const previo = totalesPrevios(lineas, aNum(cab.descuentoPct), aNum(cab.percepcionPct))

  const listado = tipo === 'cotizacion' ? 'Cotizaciones' : 'Pedidos'

  if (!escribe) {
    return (
      <EmptyState
        headingLevel={1}
        icon="alert-circle"
        title="Tu rol no crea documentos de venta"
        description="Crear cotizaciones y pedidos es de administradores y empleados. Podés consultarlos en el listado."
        action={
          <LinkButton to={RUTA_DE[tipo]} icon={<Icon name="arrow-left" size={16} />}>
            Volver a {listado}
          </LinkButton>
        }
      />
    )
  }

  return (
    <div className={docUi.pagina}>
      <PageHeader
        back={{ to: RUTA_DE[tipo], label: listado }}
        title={tipo === 'cotizacion' ? 'Nueva cotización' : 'Nuevo pedido'}
        subtitle="El número se asigna al guardar, desde la numeración del servidor."
      />

      {stel ? (
        <AvisoAutoridadStel detalle="No se puede crear este documento desde el ERP hasta completar la migración: se sigue emitiendo en STEL. Podés volver al listado para consultar y exportar." />
      ) : null}

      <DocSection title="Datos del documento">
        <CabeceraCotizacion
          valores={cab}
          editable
          monedaEditable
          mostrarValidez={tipo === 'cotizacion'}
          onCambiar={cambiarCabecera}
        />
      </DocSection>

      <DocSection
        title="Líneas"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={() => setBuscando(true)}>
              Añadir producto
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="plus" size={16} />}
              onClick={() => setLineas((ls) => [...ls, lineaLibre(ls.length + 1)])}
            >
              Nueva línea
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLineas((ls) => [...ls, lineaCapitulo(ls.length + 1)])}>
              Nuevo capítulo
            </Button>
          </>
        }
      >
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

        <EditorLineas
          lineas={lineas}
          moneda={cab.moneda}
          editable
          onCambiar={cambiarLinea}
          onEliminar={(id) => setLineas((ls) => renumerar(ls.filter((l) => l.id !== id)))}
          onMover={(id, dir) => setLineas((ls) => mover(ls, id, dir))}
        />

        <Totals
          rows={[
            { label: 'Subtotal estimado', value: formatearImporte(previo.subtotal, cab.moneda) },
            { label: 'Impuestos y percepciones', value: formatearImporte(previo.impuesto, cab.moneda) },
            { label: 'Total estimado', value: formatearImporte(previo.total, cab.moneda), strong: true },
          ]}
          note={
            <>
              Es una estimación: <strong>los totales que quedan guardados los calcula el servidor</strong> a partir de
              las líneas, el descuento global y la percepción.
            </>
          }
        />
      </DocSection>

      {guardar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{mensajeErrorVentas(guardar.error)}</p>
        </Alert>
      ) : null}

      <ActionBar
        label="Guardar documento"
        primary={
          <Button
            icon={<Icon name="check" size={16} />}
            onClick={() => guardar.mutate()}
            loading={guardar.isPending}
            disabled={!cab.customerId || stel || autoridad.cargando}
            aria-describedby={stel ? 'motivo-guardar' : !cab.customerId ? 'motivo-cliente' : undefined}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        }
        secondary={
          <LinkButton to={RUTA_DE[tipo]} variant="ghost">
            Cancelar
          </LinkButton>
        }
        note={
          stel ? (
            <p id="motivo-guardar">{motivoBloqueo(DOC_TYPE_DE[tipo])}</p>
          ) : !cab.customerId ? (
            <p id="motivo-cliente">Elegí un cliente para poder guardar.</p>
          ) : null
        }
      />
    </div>
  )
}
