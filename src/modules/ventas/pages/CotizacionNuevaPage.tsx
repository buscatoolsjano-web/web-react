import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { defaultsDeCliente } from '../services/clientes'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { DOC_TYPE_DE, mensajeErrorVentas, motivoBloqueo } from '../lib/autoridad'
import {
  aPayloadCreacion,
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
import {
  aplicarDefaults,
  type DefaultsComerciales,
} from '../lib/defaults'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { crearCotizacion } from '../services/cotizaciones'
import type { DocumentoDetalle } from '../types'
import editor from './EditorCotizacion.module.css'

/** El día de hoy en Argentina: a las 22 h acá, en UTC ya es mañana. */
const hoyLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

/** Lo que el legacy ponía en todas las cotizaciones; se puede cambiar. */
const FORMA_PAGO_HABITUAL = '30 DIAS F/F con ECHEQ'

/** Los campos de `EditorLineas` mapeados al borrador. */
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
 * Nueva cotización (Fase 15 · E3).
 *
 * El mismo modelo mental que la edición de E2: **todo vive en un borrador en
 * memoria y no se escribe nada hasta «Crear cotización»**. Antes el alta hacía
 * cuatro viajes al servidor —número, cabecera, líneas, auditoría—; ahora es una
 * sola llamada a `crear_cotizacion`, que valida, numera, inserta, calcula los
 * totales y audita en una transacción. Si algo falla no queda nada, ni siquiera
 * un número consumido de la serie.
 *
 * Tres cosas que el alta no tenía y la edición sí: contacto, vendedor y tarifa.
 * La tarifa además alimenta el precio sugerido de cada línea nueva.
 *
 * Sin moneda por defecto: se elige. Sin número hasta el final: lo da el
 * servidor. Y si la numeración la administra STEL, no se puede crear y se dice
 * por qué.
 */
export function CotizacionNuevaPage() {
  const { activa } = useEmpresa()
  const navegar = useNavigate()
  const queryClient = useQueryClient()

  /**
   * El cliente puede venir puesto en la URL (Fase 17 · E4).
   *
   * Es como se llega desde «Nueva cotización» o «Nuevo pedido» en la ficha del
   * cliente. Entra en el borrador **inicial**, no por un efecto: así el
   * documento nace con el cliente puesto en vez de empezar vacío y cambiar, y
   * llegar con el cliente ya elegido no cuenta como «cambios sin guardar».
   */
  const [parametros] = useSearchParams()
  const clienteDeLaUrl = parametros.get('cliente')
  const inicial = useMemo(() => {
    const vacio = borradorNuevo(hoyLocal(), FORMA_PAGO_HABITUAL)
    return clienteDeLaUrl ? cambiarCliente(vacio, clienteDeLaUrl).borrador : vacio
    // Sólo al montar: cambiar de cliente después no vuelve a mirar la URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [b, setB] = useState<Borrador>(inicial)
  const [buscando, setBuscando] = useState(false)
  const [avisoContacto, setAvisoContacto] = useState(false)
  const [avisoTarifa, setAvisoTarifa] = useState(false)
  // Fase 17 · E2. `tocados` es la memoria de lo que eligió la persona: el
  // default de un cliente nunca pisa un campo que ya tocó. `defaults` se
  // guarda para volver a evaluarlo cuando aparece la moneda.
  const [tocados, setTocados] = useState<ReadonlySet<CampoCabecera>>(new Set())
  const [defaults, setDefaults] = useState<DefaultsComerciales | null>(null)
  const [avisosCliente, setAvisosCliente] = useState<string[]>([])
  // Si se cambia de cliente dos veces seguidas, la respuesta que llega tarde
  // no tiene que pisar a la del cliente que quedó elegido.
  const pedidoDeDefaults = useRef(0)

  /**
   * Los defaults que llegaron y todavía no se aplicaron.
   *
   * Hasta la Fase 19 · E1 la respuesta se aplicaba dentro del `.then()`, sobre
   * un borrador guardado en una referencia que un efecto sincronizaba. El
   * problema no era que la respuesta llegara **tarde**: era que llegaba
   * **temprano**. Un efecto pasivo React lo agenda, no lo corre en el acto, así
   * que una promesa ya resuelta gana la carrera, la referencia todavía apunta
   * al borrador ANTERIOR al click, y el `setB` que venía después pisaba el
   * cliente recién elegido con uno vacío.
   *
   * Acá se aplican en un efecto. Un efecto corre **después del commit**, así
   * que ve el borrador de verdad; no hay referencia que pueda quedar vieja
   * porque no hay referencia.
   */
  const porAplicar = useRef<DefaultsComerciales | null | undefined>(undefined)

  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  const stel = autoridad.stel(DOC_TYPE_DE['cotizacion'])

  const tarifas = useTarifas(escribe)
  const vendedores = useVendedores(escribe)
  const contactos = useContactos(b.cabecera.customerId || null)

  /**
   * El alta recibe el payload COMO VARIABLE, no lo saca del estado.
   *
   * Cerrando sobre `b`, lo que se manda es el borrador del render en el que
   * React Query fijó las opciones del observer —y v5 las fija en un EFECTO—.
   * Apretar «Crear» en el mismo tick en que entran los defaults del cliente
   * mandaba el borrador anterior: la pantalla mostraba la tarifa y la moneda,
   * y el documento se creaba sin ninguna de las dos. Armar el payload en el
   * `onClick` lo toma del render que la persona está viendo.
   */
  const crear = useMutation({
    mutationFn: (payload: ReturnType<typeof aPayloadCreacion>) =>
      crearCotizacion(activa!.companyId, payload.cabecera, payload.lineas),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      // `replace`: volver atrás no tiene que traer de nuevo el formulario vacío.
      void navegar(`/ventas/cotizaciones/${r.id}`, { replace: true })
    },
  })

  // Con el alta ya enviada no se pregunta nada: el borrador se convirtió en
  // documento y la navegación es parte del guardado.
  const sucio = hayCambios(b, inicial) && !crear.isSuccess && !crear.isPending
  const salida = useSalidaConCambios(sucio)

  const lineasVisibles = comoLineasDocumento(b)
  const falta = faltaParaCrear(b)

  const SUGERIBLES: CampoCabecera[] = ['vendedorId', 'listaPrecioId', 'formaPago', 'moneda']

  const cambiarCampoCabecera = (campo: CampoCabecera, valor: string) => {
    // Lo que se cambia a mano queda marcado y deja de sugerirse.
    if (SUGERIBLES.includes(campo)) {
      setTocados((t) => new Set([...t, campo]))
    }
    setB((x) => cambiarCampo(x, campo, valor))
  }

  const opcionesValidas = () => ({
    tarifas: tarifas.data ?? [],
    vendedores: vendedores.data ?? [],
  })

  /**
   * Pide los defaults del cliente y los aplica cuando llegan.
   *
   * Está separado de `elegirCliente` porque hay dos caminos hasta acá: elegir
   * un cliente a mano, y llegar con uno puesto en la URL. Los dos tienen que
   * terminar en la MISMA regla —la de E2 y E3—, no en dos copias.
   */
  const pedirDefaults = (customerId: string) => {
    if (customerId === '' || !activa) {
      setDefaults(null)
      setAvisosCliente([])
      return
    }

    // Una sola consulta, de cuatro columnas: el cliente sugiere vendedor,
    // tarifa, forma de pago y moneda. Nada de traer la ficha entera.
    const turno = ++pedidoDeDefaults.current
    void defaultsDeCliente(activa.companyId, customerId)
      .then((d) => {
        if (turno !== pedidoDeDefaults.current) return
        // Sólo se anota lo que llegó. Aplicarlo es del efecto de abajo.
        porAplicar.current = d
        setDefaults(d)
      })
      .catch(() => {
        // Que no se puedan leer los defaults no impide cargar el documento.
        if (turno === pedidoDeDefaults.current) setAvisosCliente([])
      })
  }

  const elegirCliente = (customerId: string) => {
    // Directo y no funcional: desde que los defaults se aplican en un efecto
    // —y un efecto corre después del commit— nadie más escribe el borrador
    // entre este click y el commit. Con la forma funcional habría que llamar
    // a `setAvisoContacto` DENTRO del updater, que es un efecto dentro de una
    // función que tiene que ser pura: React puede volver a ejecutarla y el
    // aviso se dispararía de nuevo o se perdería lo aplicado en el medio.
    const r = cambiarCliente(b, customerId)
    setAvisoContacto(r.contactoLimpiado)
    setB(r.borrador)
    pedirDefaults(customerId)
  }

  /**
   * Aplica los defaults que hayan llegado, sobre el borrador ya confirmado.
   *
   * También corre cuando llegan las tarifas o los vendedores: si los defaults
   * del cliente ganan la carrera a esas listas —el caso del cliente que viene
   * en la URL, donde las tres consultas salen juntas—, la tarifa sugerida se
   * descartaba por «no existe en la empresa» y encima se avisaba. Reintentar
   * cuando la lista aparece es barato: `aplicarDefaults` es pura y sólo llena
   * lo que está vacío y nadie tocó.
   */
  useEffect(() => {
    const d = porAplicar.current
    if (d === undefined) return
    const ap = aplicarDefaults(b, d, tocados, opcionesValidas())
    // Se deja anotado mientras las listas no estén: recién cuando llegan se
    // da por aplicado y se deja de reintentar.
    if (tarifas.data && vendedores.data) porAplicar.current = undefined
    setAvisosCliente(ap.avisos)
    setB(ap.borrador)
    // `b` y `tocados` NO van en las dependencias: el efecto no tiene que
    // volver a correr porque la persona escribió, sólo cuando llega algo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, tarifas.data, vendedores.data])

  // Los defaults del cliente que vino en la URL: una sola vez, al montar. El
  // `setState` ocurre dentro del `.then()`, no en el cuerpo del efecto.
  const yaPedidos = useRef(false)
  useEffect(() => {
    if (yaPedidos.current || !clienteDeLaUrl || !activa) return
    yaPedidos.current = true
    pedirDefaults(clienteDeLaUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDeLaUrl, activa])

  const elegirMoneda = (moneda: string) => {
    const actual = tarifas.data?.find((t) => t.id === b.cabecera.listaPrecioId)
    const r = cambiarMoneda(b, moneda, actual?.moneda ?? null)
    setAvisoTarifa(r.tarifaLimpiada)

    // Con la moneda ya elegida, la tarifa del cliente puede entrar —o quedar
    // descartada por incompatible, que también se dice.
    const conMoneda = new Set<CampoCabecera>([...tocados, 'moneda'])
    setTocados(conMoneda)
    const ap = aplicarDefaults(r.borrador, defaults, conMoneda, opcionesValidas())
    setAvisosCliente(ap.avisos)
    setB(ap.borrador)
  }

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
        description="Crear cotizaciones es de administradores y empleados. Podés consultarlas en el listado."
        action={
          <LinkButton to="/ventas/cotizaciones" icon={<Icon name="arrow-left" size={16} />}>
            Volver a Cotizaciones
          </LinkButton>
        }
      />
    )
  }

  // Previsualización con la misma fórmula del servidor para el subtotal. El
  // impuesto y el total quedan en null: dependen del descuento global y de la
  // percepción, y mostrar una cifra propia sería inventar el total.
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
        back={{ to: '/ventas/cotizaciones', label: 'Cotizaciones' }}
        title="Nueva cotización"
        subtitle="Se arma acá y se guarda de una sola vez. El número lo asigna el servidor al crearla."
      />

      {stel ? <AvisoAutoridadStel detalle={motivoBloqueo(DOC_TYPE_DE['cotizacion'])} /> : null}

      {/* Fase 17 · E2: cuando un default del cliente no se puede aplicar, se
          dice por qué. Nunca se aplica un reemplazo en silencio. */}
      {avisosCliente.length > 0 ? (
        <Alert tone="info" role="status" title="Sobre los datos del cliente">
          <ul>
            {avisosCliente.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <DocSection title="Datos del documento">
        <EditorCabecera
          valores={b.cabecera}
          contactos={contactos.data ?? []}
          tarifas={tarifas.data ?? []}
          vendedores={vendedores.data ?? []}
          cargandoContactos={contactos.isPending && b.cabecera.customerId !== ''}
          avisoContacto={avisoContacto}
          avisoTarifa={avisoTarifa}
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
                // La tarifa del documento SUGIERE el precio; después se puede
                // escribir a mano y cambiar la tarifa no lo recalcula.
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
          onCambiar={cambiarLinea}
          onEliminar={(clave) => setB((x) => quitarLinea(x, clave))}
          onMover={(clave, d) => setB((x) => moverLinea(x, clave, d))}
        />

        <TotalesDocumento
          doc={previo}
          lineas={lineasVisibles}
          nota="Previsualización. Los totales definitivos los calcula el servidor al crear la cotización, a partir de las líneas, el descuento global y la percepción."
        />
      </DocSection>

      {crear.error ? (
        <Alert tone="danger" role="alert" title="No se pudo crear la cotización">
          <p>{mensajeErrorVentas(crear.error)}</p>
        </Alert>
      ) : null}

      <ActionBar
        label="Crear cotización"
        primary={
          <Button
            icon={<Icon name="check" size={16} />}
            onClick={() => crear.mutate(aPayloadCreacion(b))}
            loading={crear.isPending}
            disabled={falta.length > 0 || stel || autoridad.cargando}
            aria-describedby={stel || falta.length > 0 ? 'motivo-crear' : undefined}
          >
            {crear.isPending ? 'Creando…' : 'Crear cotización'}
          </Button>
        }
        secondary={
          <LinkButton to="/ventas/cotizaciones" variant="ghost">
            Cancelar
          </LinkButton>
        }
        note={
          stel ? (
            <p id="motivo-crear">{motivoBloqueo(DOC_TYPE_DE['cotizacion'])}</p>
          ) : falta.length > 0 ? (
            <p id="motivo-crear">{falta.join(' ')}</p>
          ) : null
        }
      />

      <DialogoCambiosSinGuardar open={salida.preguntando} onSalir={salida.salir} onQuedarse={salida.quedarse} />
    </div>
  )
}
