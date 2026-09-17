import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { EditorCabecera } from '../components/EditorCabecera'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { SelectorProducto } from '../components/SelectorProducto'
import { TotalesDocumento } from '../components/TotalesDocumento'
import { useContactos, useTarifas, useVendedores } from '../hooks/useDocumentos'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { DOC_TYPE_DE, mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import {
  aPayloadCreacionPedido,
  agregarLinea,
  borradorNuevo,
  cambiarCampo,
  cambiarCliente,
  cambiarLinea as cambiarLineaBorrador,
  cambiarMoneda,
  comoLineasDocumento,
  faltaParaCrear,
  hayCambios,
  moverLinea,
  quitarLinea,
  type Borrador,
  type CampoCabecera,
} from '../lib/borrador'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { crearPedido } from '../services/pedidos'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

/** El día de hoy en Argentina: a las 22 h acá, en UTC ya es mañana. */
const hoyLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

const FORMA_PAGO_HABITUAL = '30 DIAS F/F con ECHEQ'

const CAMPO_BORRADOR: Record<CampoLinea, Parameters<typeof cambiarLineaBorrador>[2]> = {
  sku_snapshot: 'sku',
  name_snapshot: 'nombre',
  description_snapshot: 'descripcion',
  quantity: 'cantidad',
  unit_price: 'precioUnitario',
  discount_pct: 'descuentoPct',
  tax_treatment: 'tratamientoImpuesto',
  tax_rate_snapshot: 'tasaImpuesto',
}

/**
 * Nuevo pedido manual (Fase 15 · E4).
 *
 * La misma pantalla que «Nueva cotización», con el mismo modelo: borrador en
 * memoria y **una sola escritura** al final, con `crear_pedido`. Hasta E3 el
 * alta del pedido eran cuatro viajes desde el navegador y no ofrecía contacto,
 * vendedor ni tarifa.
 *
 * La mayoría de los pedidos nacen de una cotización («Generar pedido» en la
 * cotización); esta pantalla es para el pedido que entra directo.
 */
export function PedidoNuevoPage() {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()

  const inicial = useMemo(() => borradorNuevo(hoyLocal(), FORMA_PAGO_HABITUAL), [])
  const [b, setB] = useState<Borrador>(inicial)
  const [buscando, setBuscando] = useState(false)
  const [avisoContacto, setAvisoContacto] = useState(false)
  const [avisoTarifa, setAvisoTarifa] = useState(false)

  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  const stel = autoridad.stel(DOC_TYPE_DE['pedido'])

  const tarifas = useTarifas(escribe)
  const vendedores = useVendedores(escribe)
  const contactos = useContactos(b.cabecera.customerId || null)

  const crear = useMutation({
    mutationFn: () => {
      const payload = aPayloadCreacionPedido(b)
      return crearPedido(activa!.companyId, payload.cabecera, payload.lineas)
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/pedidos/${r.id}`, { replace: true })
    },
  })

  const sucio = hayCambios(b, inicial) && !crear.isSuccess && !crear.isPending
  const salida = useSalidaConCambios(sucio)

  const lineasVisibles = comoLineasDocumento(b)
  const falta = faltaParaCrear(b)

  const cambiarCampoCabecera = (campo: CampoCabecera, valor: string) => setB((x) => cambiarCampo(x, campo, valor))

  const elegirCliente = (customerId: string) =>
    setB((x) => {
      const r = cambiarCliente(x, customerId)
      setAvisoContacto(r.contactoLimpiado)
      return r.borrador
    })

  const elegirMoneda = (moneda: string) =>
    setB((x) => {
      const actual = tarifas.data?.find((t) => t.id === x.cabecera.listaPrecioId)
      const r = cambiarMoneda(x, moneda, actual?.moneda ?? null)
      setAvisoTarifa(r.tarifaLimpiada)
      return r.borrador
    })

  const cambiarLinea = (clave: string, campo: CampoLinea, valor: string | number | null) =>
    setB((x) => {
      let siguiente = cambiarLineaBorrador(x, clave, CAMPO_BORRADOR[campo], valor)
      if (campo === 'tax_treatment') {
        const tasa = tasaDe(String(valor))
        if (tasa !== null) siguiente = cambiarLineaBorrador(siguiente, clave, 'tasaImpuesto', tasa)
      }
      return siguiente
    })

  const nueva = (over: Partial<Parameters<typeof agregarLinea>[1]> = {}) =>
    setB((x) =>
      agregarLinea(x, {
        tipoLinea: 'item', productId: null, sku: null, nombre: null, descripcion: null,
        cantidad: 1, precioUnitario: 0, descuentoPct: 0,
        tratamientoImpuesto: 'vat_21', tasaImpuesto: 21, ...over,
      }),
    )

  if (!escribe) {
    return (
      <EmptyState
        headingLevel={1}
        icon="alert-circle"
        title="Tu rol no crea documentos de venta"
        description="Crear pedidos es de administradores y empleados. Podés consultarlos en el listado."
        action={
          <LinkButton to="/ventas/pedidos" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Pedidos
          </LinkButton>
        }
      />
    )
  }

  const numero = (v: string): number | null => {
    if (v.trim() === '') return null
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  const previo = {
    moneda: b.cabecera.moneda,
    subtotal: lineasVisibles.reduce(
      (s, l) => s + (l.tipoLinea === 'chapter' ? 0 : l.cantidad * (l.precioUnitario ?? 0) * (1 - (l.descuentoPct ?? 0) / 100)),
      0,
    ),
    descuentoPct: numero(b.cabecera.descuentoPct),
    percepcionPct: numero(b.cabecera.percepcionPct),
    impuesto: null,
    total: null,
  } as DocumentoDetalle

  return (
    <div className={docUi.pagina}>
      <PageHeader
        back={{ to: '/ventas/pedidos', label: 'Pedidos' }}
        title="Nuevo pedido"
        subtitle="Se arma acá y se guarda de una sola vez. El número lo asigna el servidor al crearlo."
      />

      {stel ? <AvisoAutoridadStel detalle={motivoBloqueo(DOC_TYPE_DE['pedido'])} /> : null}

      <DocSection title="Datos del documento">
        <EditorCabecera
          valores={b.cabecera}
          contactos={contactos.data ?? []}
          tarifas={tarifas.data ?? []}
          vendedores={vendedores.data ?? []}
          cargandoContactos={contactos.isPending && b.cabecera.customerId !== ''}
          avisoContacto={avisoContacto}
          avisoTarifa={avisoTarifa}
          mostrarValidez={false}
          onCambiar={cambiarCampoCabecera}
          onCambiarCliente={elegirCliente}
          onCambiarMoneda={elegirMoneda}
        />
      </DocSection>

      <DocSection
        title="Líneas"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={() => setBuscando(true)}>
              Añadir producto
            </Button>
            <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => nueva()}>
              Nueva línea
            </Button>
            <Button variant="ghost" size="sm" onClick={() => nueva({ tipoLinea: 'chapter', nombre: 'Capítulo', tasaImpuesto: 0 })}>
              Nuevo capítulo
            </Button>
          </>
        }
      >
        {buscando ? (
          <div className={editor.selector}>
            <SelectorProducto
              moneda={b.cabecera.moneda}
              listaPrecioId={b.cabecera.listaPrecioId || null}
              onCerrar={() => setBuscando(false)}
              onElegir={(p, precio) => {
                nueva({ productId: p.id, sku: p.sku, nombre: p.nombre, precioUnitario: precio ?? 0 })
                setBuscando(false)
              }}
            />
          </div>
        ) : null}

        <EditorLineas
          lineas={lineasVisibles}
          moneda={b.cabecera.moneda}
          editable
          documento="del pedido"
          onCambiar={cambiarLinea}
          onEliminar={(clave) => setB((x) => quitarLinea(x, clave))}
          onMover={(clave, d) => setB((x) => moverLinea(x, clave, d))}
        />

        <TotalesDocumento
          doc={previo}
          lineas={lineasVisibles}
          nota="Previsualización. Los totales definitivos los calcula el servidor al crear el pedido, a partir de las líneas, el descuento global y la percepción."
        />
      </DocSection>

      {crear.error ? (
        <Alert tone="danger" role="alert" title="No se pudo crear el pedido">
          <p>{mensajeErrorVentas(crear.error)}</p>
        </Alert>
      ) : null}

      <ActionBar
        label="Crear pedido"
        primary={
          <Button
            icon={<Icon name="check" size={16} />}
            onClick={() => crear.mutate()}
            loading={crear.isPending}
            disabled={falta.length > 0 || stel || autoridad.cargando}
            aria-describedby={stel || falta.length > 0 ? 'motivo-crear-pedido' : undefined}
          >
            {crear.isPending ? 'Creando…' : 'Crear pedido'}
          </Button>
        }
        secondary={
          <LinkButton to="/ventas/pedidos" variant="ghost">
            Cancelar
          </LinkButton>
        }
        note={
          stel ? (
            <p id="motivo-crear-pedido">{motivoBloqueo(DOC_TYPE_DE['pedido'])}</p>
          ) : falta.length > 0 ? (
            <p id="motivo-crear-pedido">{falta.join(' ')}</p>
          ) : null
        }
      />

      <DialogoCambiosSinGuardar open={salida.preguntando} onSalir={salida.salir} onQuedarse={salida.quedarse} />
    </div>
  )
}
