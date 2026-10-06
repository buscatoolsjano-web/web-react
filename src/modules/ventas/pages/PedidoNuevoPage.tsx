import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ActionBar } from '@/components/document/ActionBar'
import { DocSection } from '@/components/document/DocSection'
import docUi from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { Icon } from '@/components/icons/Icon'
import { DialogoCambiosSinGuardar } from '@/components/modals/DialogoCambiosSinGuardar'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSalidaConCambios } from '@/hooks/useSalidaConCambios'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { AvisoAutoridadStel } from '../components/AvisoAutoridadStel'
import { BuscadorCliente } from '../components/BuscadorCliente'
import { EditorCabecera } from '../components/EditorCabecera'
import { useUltimoPrecio } from '../hooks/useUltimoPrecio'
import { EditorLineas, type CampoLinea } from '../components/EditorLineas'
import { ModalCatalogoProductos } from '../components/ModalCatalogoProductos'
import { usePrecargarCatalogoDeDocumento } from '../hooks/useCatalogoParaDocumento'
import { ModalContactos } from '../components/ModalContactos'
import { TotalesDocumento } from '../components/TotalesDocumento'
import { ControlesDeHoja } from '../components/ControlesDeHoja'
import { useOpcionesDeHoja } from '../hooks/useOpcionesDeHoja'
import { VistaPreviaBorrador } from '../components/VistaPreviaBorrador'
import {
  useContactos,
  useNombreDeCliente,
  useDireccionesEntrega,
  useSeries,
  useTarifas,
  useVendedores,
} from '../hooks/useDocumentos'
import { defaultsDeCliente } from '../services/clientes'
import { useAutoridadNumeracion } from '../hooks/useAutoridadNumeracion'
import { DOC_TYPE_DE, mensajeErrorVentas, motivoBloqueo, motivoSerieStel } from '../lib/autoridad'
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
import {
  aplicarDefaults,
  sugerirDeLaAgenda,
  type DefaultsComerciales,
} from '../lib/defaults'
import { cadenaVacia } from '../lib/cadena'
import { CadenaDocumento } from '../components/CadenaDocumento'
import { escribeVentas } from '../lib/permisos'
import { tasaDe } from '../lib/tratamientos'
import { crearPedido } from '../services/pedidos'
import { guardarContactosDocumento } from '../services/contactosDocumento'
import { guardarVendedoresDocumento } from '../services/vendedoresDocumento'
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
  // Fase 28 · E1: el catálogo completo, para elegir desde la hoja.
  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  // Fase 28 · E14: la agenda del cliente, sin abandonar el documento.
  const [contactosAbiertos, setContactosAbiertos] = useState(false)
  // Fase 28 · E12: el formato de la hoja lo maneja la pantalla, para poder
  // ponerlo adentro de la barra de acciones en vez de arriba de la hoja.
  const { opciones: opcionesDeHoja, controles } = useOpcionesDeHoja()
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
   * Acá se aplican en un efecto, que corre **después del commit** y por lo
   * tanto ve el borrador de verdad. Es el mismo arreglo que en «Nueva
   * cotización»: son la misma pantalla con distinto documento.
   */
  const porAplicar = useRef<DefaultsComerciales | null | undefined>(undefined)

  const escribe = escribeVentas(activa?.rol)
  const autoridad = useAutoridadNumeracion()
  /**
   * La serie del documento (Fase 19 · E4).
   *
   * Igual que en «Nueva cotización»: el borrador nace con la serie vacía, que
   * significa «la que la empresa tenga por defecto», y lo que bloquea la
   * emisión pasa a ser la autoridad de ESTA serie y no la general del tipo.
   * A `PDV-ERP` se llega eligiéndola; nunca se selecciona sola.
   */
  const series = useSeries('pedido', escribe)
  const porDefecto = (series.data ?? []).find((x) => x.esPorDefecto) ?? null
  const serieVisible = b.cabecera.serie || porDefecto?.codigo || ''
  const serieElegida = (series.data ?? []).find((x) => x.codigo === serieVisible) ?? null
  // Mientras las series no llegaron se usa la autoridad general, que es lo
  // conservador: no se promete una emisión que la base puede rechazar.
  const stel = serieElegida ? serieElegida.autoridad === 'STEL' : autoridad.stel(DOC_TYPE_DE['pedido'])
  // Si hay de dónde elegir, el motivo habla de LA SERIE y dice qué hacer.
  const motivo =
    serieElegida && (series.data ?? []).length > 1
      ? motivoSerieStel(serieElegida.codigo)
      : motivoBloqueo(DOC_TYPE_DE['pedido'])

  const tarifas = useTarifas(escribe)
  const vendedores = useVendedores(escribe)
  const contactos = useContactos(b.cabecera.customerId || null)
  // Para la hoja hace falta el NOMBRE del cliente, no su id.
  const clienteElegido = useNombreDeCliente(b.cabecera.customerId || null)
  const direcciones = useDireccionesEntrega(b.cabecera.customerId || null)

  // Fase 17 · E3: el contacto principal y el domicilio de entrega principal se
  // sugieren cuando llegan las dos listas, que la pantalla ya pedía para sus
  // desplegables —no cuesta ninguna consulta más—. Va en su propio efecto y no
  // dentro de `aplicarDefaults` porque son respuestas distintas y ninguna tiene
  // por qué esperar a la otra. Sólo llena lo que está vacío y nadie tocó, así
  // que correr de más no pisa nada.
  const agendaSugerida = useRef('')
  useEffect(() => {
    // Una vez por combinación de cliente y listas. La guarda no es cosmética:
    // acá `b` se lee directo —un efecto corre DESPUÉS del commit, así que es
    // el borrador confirmado— y sin ella un `setB` derivado de `b` podría
    // encadenar renders.
    const firma = `${b.cabecera.customerId}|${contactos.data?.length ?? -1}|${direcciones.data?.length ?? -1}`
    if (agendaSugerida.current === firma) return
    agendaSugerida.current = firma

    const r = sugerirDeLaAgenda(
      b,
      { contactos: contactos.data ?? [], direcciones: direcciones.data ?? [] },
      tocados,
    )
    if (r.aplicados.length === 0) return
    // La regla avisa de renders encadenados porque el valor sale de `b` y `b`
    // está en las dependencias. El encadenamiento lo corta `agendaSugerida`:
    // por cada combinación de cliente y listas esto corre UNA vez. Antes la
    // regla no saltaba porque el borrador venía de una referencia —la misma
    // que se quedaba vieja en el `.then()` de los defaults—, así que el
    // silencio era el síntoma, no la solución.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setB(r.borrador)
    // El cliente entra en las dependencias a propósito: las listas pueden
    // llegar ANTES de que se elija el cliente, y la sugerencia recién tiene
    // sentido cuando hay cliente. `tocados` NO entra: que la persona marque un
    // campo no es motivo para volver a sugerir, y si entrara, limpiar el
    // contacto a mano lo haría reaparecer en el acto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.cabecera.customerId, contactos.data, direcciones.data])

  /**
   * El alta recibe el payload COMO VARIABLE, no lo saca del estado: ver el
   * comentario gemelo en «Nueva cotización». React Query v5 fija las opciones
   * del observer en un efecto, así que un `mutationFn` que cierra sobre `b`
   * puede mandar el borrador del render anterior.
   */
  const crear = useMutation({
    mutationFn: async (payload: ReturnType<typeof aPayloadCreacionPedido>) => {
      const r = await crearPedido(activa!.companyId, payload.cabecera, payload.lineas)
      /*
       * Los secundarios, recién después de que el documento exista (Fase 40).
       *
       * No es atómico y no puede serlo desde el navegador: el alta es una RPC
       * que devuelve el id, y hasta tenerlo no hay a qué colgarlos. Si esta
       * segunda llamada fallara, el pedido queda creado con su contacto
       * principal —que sí viaja en el alta— y sin los acompañantes, que se
       * agregan editándolo. Es el peor caso posible y es recuperable.
       */
      if (b.cabecera.contactosExtra.length > 0) {
        await guardarContactosDocumento(
          'pedido',
          r.id,
          b.cabecera.contactoId === '' ? null : b.cabecera.contactoId,
          b.cabecera.contactosExtra,
        )
      }
      if (b.cabecera.vendedoresExtra.length > 0) {
        await guardarVendedoresDocumento(
          'pedido',
          r.id,
          b.cabecera.vendedorId === '' ? null : b.cabecera.vendedorId,
          b.cabecera.vendedoresExtra,
        )
      }
      return r
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['ventas', activa?.companyId] })
      void navegar(`/ventas/pedidos/${r.id}`, { replace: true })
    },
  })

  // El catálogo, pedido antes de que lo abran (Fase 29 · E18).
  // En el alta se agregan líneas sí o sí: se precarga siempre.
  usePrecargarCatalogoDeDocumento(b.cabecera.listaPrecioId || null, true)

  const sucio = hayCambios(b, inicial) && !crear.isSuccess && !crear.isPending
  const salida = useSalidaConCambios(sucio)

  const lineasVisibles = comoLineasDocumento(b)

  /* El último precio de este cliente, una sola consulta para la pantalla
     entera: la comparten el editor de líneas y el modal del catálogo. */
  const { historicos } = useUltimoPrecio(b.cabecera.customerId || null, b.cabecera.moneda)
  const falta = faltaParaCrear(b)

  const SUGERIBLES: CampoCabecera[] = [
    'vendedorId',
    'listaPrecioId',
    'formaPago',
    'moneda',
    'contactoId',
    'direccionEntregaId',
  ]

  const cambiarCampoCabecera = (campo: CampoCabecera, valor: string) => {
    // Lo que se cambia a mano queda marcado y deja de sugerirse.
    if (SUGERIBLES.includes(campo)) {
      setTocados((t) => new Set([...t, campo]))
    }
    setB((x) => cambiarCampo(x, campo, valor))
  }

  /**
   * El equipo de contactos: principal y secundarios cambian JUNTOS (Fase 40).
   *
   * Hacer principal a alguien que ya estaba en la lista mueve dos cosas a la
   * vez; mandarlas por separado dejaría al documento, entre una y otra, con
   * dos principales o con ninguno.
   */
  const cambiarContactos = (principal: string, secundarios: string[]) => {
    // El contacto se sugiere solo al elegir el cliente; tocarlo a mano apaga
    // esa sugerencia, igual que cualquier otro campo sugerible.
    setTocados((t) => new Set([...t, 'contactoId']))
    setB((x) => ({
      ...x,
      cabecera: { ...x.cabecera, contactoId: principal, contactosExtra: secundarios },
    }))
  }

  /** Lo mismo para los vendedores (Fase 40): principal y acompañantes, juntos. */
  const cambiarVendedores = (principal: string, acompanan: string[]) => {
    setTocados((t) => new Set([...t, 'vendedorId']))
    setB((x) => ({
      ...x,
      cabecera: { ...x.cabecera, vendedorId: principal, vendedoresExtra: acompanan },
    }))
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
    // nadie más escribe el borrador entre este click y el commit, y con la
    // forma funcional habría que llamar a `setAvisoContacto` dentro de un
    // updater, que tiene que ser puro.
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
   * en la URL, donde las consultas salen juntas—, la tarifa sugerida se
   * descartaba por «no existe en la empresa» y encima se avisaba.
   */
  useEffect(() => {
    const d = porAplicar.current
    if (d === undefined) return
    const ap = aplicarDefaults(b, d, tocados, opcionesValidas())
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

  /**
   * Para la hoja: el nombre, no el id (Fase 26 · E2).
   *
   * Mientras no hay cliente elegido la hoja lo dice en vez de quedar en
   * blanco: un documento sin cliente no es un documento, y verlo vacío es
   * la forma de acordarse.
   */
  const nombreDelCliente = clienteElegido.data?.nombre ?? '(cliente sin elegir)'
  const nombreDelContacto =
    (contactos.data ?? []).find((c) => c.id === b.cabecera.contactoId)?.nombre ?? null

  /** Con 1280 px o más la hoja entra al lado del editor. */
  const pantallaAncha = useMediaQuery('(min-width: 1280px)')
  const [previaAbierta, setPreviaAbierta] = useState(false)
  const verPrevia = pantallaAncha || previaAbierta

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
    <div className={`${docUi.pagina} ${docUi.paginaAncha}`}>
      {/* Fase 28 · E12: el encabezado entero se fue. El título ya no se
          dibujaba (E5) y el «volver» se mudó a la barra de acciones, que es
          donde está el resto de lo que se puede hacer acá. El h1 vive en la
          barra, invisible, para que la página siga teniendo encabezado. */}

      {stel ? <AvisoAutoridadStel detalle={motivo} /> : null}

      {crear.error ? (
        <Alert tone="danger" role="alert" title="No se pudo crear el pedido">
          <p>{mensajeErrorVentas(crear.error)}</p>
        </Alert>
      ) : null}

      <ActionBar
        pegajosa
        volver={{ to: '/ventas/pedidos', label: 'Pedidos' }}
        titulo="Nuevo pedido"
        label="Crear pedido"
        /* El circuito también al armar el pedido (Fase 29 · E17). Acá la cadena
           va vacía: este alta es para un pedido que nace suelto. Uno que sale
           de una cotización se crea desde ella, y esa pantalla sí trae la
           cadena de verdad. */
        pasos={<CadenaDocumento cadena={cadenaVacia()} actual="pedido" />}
        primary={
          <Button
            icon={<Icon name="check" size={16} />}
            onClick={() => crear.mutate(aPayloadCreacionPedido(b))}
            loading={crear.isPending}
            disabled={falta.length > 0 || stel || autoridad.cargando}
            aria-describedby={stel || falta.length > 0 ? 'motivo-crear-pedido' : undefined}
          >
            {crear.isPending ? 'Creando…' : 'Crear pedido'}
          </Button>
        }
        secondary={
          <>
            {/* Fase 28 · E12: el formato de la hoja vive acá y no arriba de la
                hoja: son 40 px que le sacaba al documento. */}
            <ControlesDeHoja {...controles} />
            {/* Con pantalla ancha la hoja ya está al lado: el botón sobra. */}
            {!pantallaAncha ? (
              <Button
                variant="secondary"
                icon={<Icon name="eye" size={16} />}
                onClick={() => setPreviaAbierta((v) => !v)}
                aria-expanded={previaAbierta}
              >
                {previaAbierta ? 'Ocultar vista previa' : 'Vista previa'}
              </Button>
            ) : null}
            <LinkButton to="/ventas/pedidos" variant="ghost">
              Cancelar
            </LinkButton>
          </>
        }
        note={
          stel ? (
            <p id="motivo-crear-pedido">{motivo}</p>
          ) : falta.length > 0 ? (
            <p id="motivo-crear-pedido">{falta.join(' ')}</p>
          ) : null
        }
      />

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

      <div className={verPrevia && pantallaAncha ? editor.conPrevia : undefined}>
        <div className={editor.columnaEditor}>

      {/* Fase 27 · E1: la serie vive dentro de «1. Datos generales», al lado
          del número, en vez de ser una tarjeta con su propio texto de ayuda. */}
      <DocSection title="Datos del documento">
        <EditorCabecera
                onAbrirContactos={() => setContactosAbiertos(true)}
          series={series.data ?? []}
          serie={serieVisible}
          onCambiarSerie={(codigo) => setB((x) => cambiarCampo(x, 'serie', codigo))}
          valores={b.cabecera}
          contactos={contactos.data ?? []}
          direcciones={direcciones.data ?? []}
          cargandoDirecciones={direcciones.isPending && b.cabecera.customerId !== ''}
          tarifas={tarifas.data ?? []}
          vendedores={vendedores.data ?? []}
          cargandoContactos={contactos.isPending && b.cabecera.customerId !== ''}
          avisoContacto={avisoContacto}
          avisoTarifa={avisoTarifa}
          onCambiar={cambiarCampoCabecera}
          onCambiarContactos={cambiarContactos}
          onCambiarVendedores={cambiarVendedores}
          onCambiarCliente={elegirCliente}
          onCambiarMoneda={elegirMoneda}
        />
      </DocSection>

      <DocSection
        title="Líneas"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Icon name="search" size={16} />} onClick={() => setCatalogoAbierto(true)}>
              Añadir producto
            </Button>
            <Button variant="secondary" size="sm" icon={<Icon name="plus" size={16} />} onClick={() => nueva()}>
              Nueva línea
            </Button>
            <Button variant="ghost" size="sm" onClick={() => nueva({ tipoLinea: 'chapter', tasaImpuesto: 0 })}>
              Nuevo capítulo
            </Button>
          </>
        }
      >
        <EditorLineas
          lineas={lineasVisibles}
          moneda={b.cabecera.moneda}
          editable
          documento="del pedido"
          historicos={historicos}
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

        </div>

        {verPrevia ? (
          <div className={editor.columnaPrevia}>
            <VistaPreviaBorrador
              tipo="pedido"
              fecha={b.cabecera.fecha}
              titulo={b.cabecera.titulo}
              cliente={nombreDelCliente}
              contacto={nombreDelContacto}
              moneda={b.cabecera.moneda || null}
              formaPago={b.cabecera.formaPago || null}
              notas={b.cabecera.notas || null}
              lineas={lineasVisibles}
              ajustarAlAncho={pantallaAncha}
              opcionesDeHoja={opcionesDeHoja}
              /* La hoja edita EL MISMO borrador que el panel de la
                 izquierda: hay un documento, no dos que sincronizar. */
              edicion={{
                onFecha: (valor) => setB((x) => cambiarCampo(x, 'fecha', valor)),
                // El título también desde la hoja: es donde se ve el hueco.
                onTitulo: (valor) => setB((x) => cambiarCampo(x, 'titulo', valor)),
                onFormaPago: (valor) => setB((x) => cambiarCampo(x, 'formaPago', valor)),
                selectorCliente: (
                  <BuscadorCliente
                    valor={b.cabecera.customerId || null}
                    editable
                    apariencia="hoja"
                    onElegir={(elegido) => elegirCliente(elegido ?? '')}
                  />
                ),
                onNuevoCapitulo: () =>
                  nueva({ tipoLinea: 'chapter', cantidad: 0, precioUnitario: 0, tasaImpuesto: 0, tratamientoImpuesto: 'exempt' }),
                onTextoCapitulo: (id, texto) => cambiarLinea(id, 'name_snapshot', texto),
                onCantidad: (id, valor) => cambiarLinea(id, 'quantity', valor),
                onPrecio: (id, valor) => cambiarLinea(id, 'unit_price', valor),
                onDescuento: (id, valor) => cambiarLinea(id, 'discount_pct', valor),
                onEliminar: (id) => setB((x) => quitarLinea(x, id)),
                onAgregar: () => setCatalogoAbierto(true),
              }}
            />
          </div>
        ) : null}
      </div>


      {/* Fase 28 · E1: el catálogo entero, con sus categorías, para elegir
          sin salir del documento. Agrega con el MISMO `nueva()` que el
          buscador de la izquierda: una sola forma de sumar una línea. */}
      {contactosAbiertos && b.cabecera.customerId !== '' ? (
        <ModalContactos
          clienteId={b.cabecera.customerId}
          clienteNombre={nombreDelCliente || 'el cliente'}
          onCerrar={() => setContactosAbiertos(false)}
        />
      ) : null}

      {catalogoAbierto ? (
        <ModalCatalogoProductos
          listaPrecioId={b.cabecera.listaPrecioId || null}
          moneda={b.cabecera.moneda || null}
          esInterno={activa?.esInterno ?? false}
          historicos={historicos}
          onCerrar={() => setCatalogoAbierto(false)}
          onAgregar={(p, cantidad, precio) =>
            nueva({
              productId: p.id,
              sku: p.sku,
              nombre: p.nombre,
              cantidad,
              // El precio lo decide el modal: si este cliente ya compró este
              // producto, el que se le cobró; si no, la tarifa del documento.
              // Sin ninguno de los dos, la línea entra en cero y se ve.
              precioUnitario: precio.precio,
            })
          }
        />
      ) : null}

      <DialogoCambiosSinGuardar open={salida.preguntando} onSalir={salida.salir} onQuedarse={salida.quedarse} />
    </div>
  )
}
