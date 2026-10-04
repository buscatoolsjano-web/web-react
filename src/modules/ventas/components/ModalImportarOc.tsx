import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { BuscadorCliente } from './BuscadorCliente'
import { BuscadorProducto } from './BuscadorProducto'
import { VistaCotizacionCandidata } from './VistaCotizacionCandidata'
import {
  EXPLICACION_CLIENTE,
  EXPLICACION_LINEA,
  clienteAutomatico,
  faltaParaImportar,
  necesitaRevision,
  resumirLineas,
  type CandidataCotizacion,
  type CandidatoCliente,
  type LineaEmparejada,
  type MetodoCliente,
} from '../lib/importarOc'
import {
  FalloDeImportacion,
  cotizacionesPara,
  estadoDeLectura,
  emparejarCliente,
  emparejarLineas,
  importarOc,
  leerOcDesdePdf,
  type OcLeida,
  type ResultadoImportacion,
} from '../services/importarOc'
import { formatearImporte } from '../lib/formato'
import styles from './ModalImportarOc.module.css'

const MONEDAS = ['ARS', 'USD', 'EUR', 'BRL']
const MB = 1024 * 1024

export interface ModalImportarOcProps {
  /**
   * Un PDF que ya viene elegido, para abrir el importador desde otro lado
   * (Fase 40: el adjunto de un correo).
   *
   * NO dispara la lectura. El paso de «¿Es este el PDF correcto?» existe a
   * propósito —mirar el documento antes de gastar una llamada al modelo— y
   * llegar con el archivo puesto no es razón para saltearlo: desde un correo
   * es MÁS fácil equivocarse de adjunto, no menos.
   */
  archivoInicial?: File | undefined
  /** De dónde vino el archivo, para decirlo en pantalla. */
  origen?: string | undefined
  onCerrar: () => void
}

/**
 * Importar la orden de compra del cliente (Fase 30 · E6).
 *
 * Cuatro pasos y uno a la vez: elegir el archivo, mirarlo, revisar lo que
 * leyó la IA, y confirmar.
 *
 * El paso de MIRAR el PDF antes de procesarlo no es decorativo: arrastrar el
 * archivo equivocado es lo más fácil del mundo, y procesarlo cuesta una
 * llamada al modelo y —peor— puede terminar en una cotización para el cliente
 * que no era. Se ve el documento y recién entonces se aprieta.
 *
 * La regla de fondo: **la IA propone y la persona confirma**. Nada se escribe
 * hasta el último botón.
 */
export function ModalImportarOc({ archivoInicial, origen, onCerrar }: ModalImportarOcProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const navegar = useNavigate()

  const [archivo, setArchivo] = useState<File | null>(null)
  const [urlPrevia, setUrlPrevia] = useState<string | null>(null)
  const [encima, setEncima] = useState(false)
  const [leida, setLeida] = useState<OcLeida | null>(null)
  const [clienteId, setClienteId] = useState<string | null>(null)
  /**
   * Por qué se resolvió solo, cuando se resolvió solo.
   *
   * Sin esto, el cliente aparece elegido y no se sabe de dónde salió. Importa
   * sobre todo con `memoria`: la orden dice «DREAN S.A.» y en la pantalla se
   * lee «Mabe Argentina», y hay que poder ver que eso no es un error sino una
   * corrección que alguien hizo antes. Cuando lo elige una persona queda en
   * `null`: ya sabe por qué.
   */
  const [porQue, setPorQue] = useState<MetodoCliente | null>(null)
  const [candidatos, setCandidatos] = useState<CandidatoCliente[]>([])
  const [lineas, setLineas] = useState<LineaEmparejada[]>([])
  const [editando, setEditando] = useState<number | null>(null)
  const [cotis, setCotis] = useState<CandidataCotizacion[]>([])
  const [quoteId, setQuoteId] = useState<string | null>(null)
  /* Qué cotización candidata está abierta para mirarla. Una a la vez: dos
     listas de líneas al mismo tiempo se comparan peor que de a una. */
  const [viendo, setViendo] = useState<string | null>(null)
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState('')
  const [moneda, setMoneda] = useState('ARS')
  const [hecho, setHecho] = useState<ResultadoImportacion | null>(null)

  /* El cartel de arriba tiene que decir la verdad: se le pregunta a la
     función, que es la única que sabe si hay proveedor configurado. */
  const estado = useQuery({
    queryKey: ['ventas', 'oc', 'estado-lectura'],
    queryFn: estadoDeLectura,
    staleTime: 5 * 60_000,
  })
  const entrada = useRef<HTMLInputElement>(null)

  /**
   * La URL del blob se libera al cambiar de archivo y al cerrar el diálogo: si
   * no, el PDF queda en memoria del navegador hasta recargar la página.
   *
   * Va por `ref` y no por efecto porque crear la URL es consecuencia de elegir
   * el archivo, no de que el estado haya cambiado. Escrito como efecto había
   * que llamar a `setState` adentro —que es lo que marca
   * `react-hooks/set-state-in-effect`— y además pintaba una vez sin previa.
   */
  const urlRef = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const soltarUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }

  const elegirArchivo = (f: File | null | undefined) => {
    if (!f) return
    soltarUrl()
    urlRef.current = URL.createObjectURL(f)
    setUrlPrevia(urlRef.current)
    setArchivo(f)
    leer.reset()
  }

  const quitarArchivo = () => {
    soltarUrl()
    setUrlPrevia(null)
    setArchivo(null)
  }

  const leer = useMutation({
    mutationFn: async (f: File) => {
      const oc = await leerOcDesdePdf(f)
      const cands = await emparejarCliente(companyId!, oc.cliente.nombre, oc.cliente.cuit)
      return { oc, cands }
    },
    onSuccess: async ({ oc, cands }) => {
      setLeida(oc)
      setNumero(oc.numero)
      setFecha(oc.fecha ?? '')
      setMoneda(oc.moneda ?? 'ARS')
      setCandidatos(cands)
      /**
       * Las líneas entran YA, sin producto, en cuanto se leen.
       *
       * Antes había dos listas: una de sólo lectura hasta elegir cliente y
       * otra emparejada después. Eso dejaba las filas sin el botón de machear
       * justo cuando la persona ya está mirando el PDF y sabe qué es cada
       * cosa. Ahora la lista es UNA sola desde el principio y se le van
       * llenando los productos.
       */
      setLineas(
        oc.lineas.map((l) => ({
          ...l,
          productId: null,
          sku: null,
          nombre: null,
          metodo: 'sin_match' as const,
          confianza: 0,
        })),
      )
      const solo = clienteAutomatico(cands)
      if (solo) await elegirCliente(solo.customerId, oc, solo.metodo)
    },
  })

  /*
   * El archivo que llega de afuera se adopta UNA vez, al abrir (Fase 40).
   *
   * Tiene que ir DESPUÉS de `leer`, no arriba con el resto del estado:
   * `elegirArchivo` llama a `leer.reset()`, y desde un efecto declarado antes
   * eso es leer una variable que todavía no existe. Los manejadores de evento
   * se salvaban por tiempo —corren después del render— pero un efecto no.
   *
   * Con `ref` y no con una dependencia: si el padre vuelve a renderizar y pasa
   * otro `File`, esto NO tiene que arrancar de nuevo y pisar lo que la persona
   * estaba revisando. Y si lo quitó con «Cambiar archivo», tampoco vuelve solo.
   */
  const adoptado = useRef(false)
  useEffect(() => {
    if (adoptado.current || !archivoInicial) return
    adoptado.current = true
    elegirArchivo(archivoInicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoInicial])

  /**
   * Elegido el cliente, se emparejan las líneas y se buscan cotizaciones.
   *
   * En ese orden y no al revés: los alias del catálogo son POR CLIENTE, así
   * que emparejar antes de saber quién es daría peores resultados.
   */
  const elegirCliente = async (
    id: string,
    oc: OcLeida | null = leida,
    metodo: MetodoCliente | null = null,
  ) => {
    setClienteId(id)
    setPorQue(metodo)
    if (!oc || companyId === null) return
    const ls = await emparejarLineas(companyId, id, oc.lineas)

    /**
     * Lo macheado a mano MANDA sobre lo que propone el emparejador.
     *
     * Se puede machear antes de elegir cliente —mirando el PDF ya se sabe qué
     * es cada cosa—, y después cambiar de cliente porque el primero estaba
     * mal. Sin esta mezcla, ese cambio borraba en silencio todo el trabajo
     * hecho a mano y lo reemplazaba por sugerencias.
     */
    const aMano = new Map(
      lineas.filter((l) => l.metodo === 'manual').map((l) => [l.n, l]),
    )
    const finales = ls.map((l) => aMano.get(l.n) ?? l)

    setLineas(finales)
    setCotis(await cotizacionesPara(companyId, id, finales))
    setQuoteId(null)
  }

  /**
   * Linkear una línea a mano.
   *
   * Se marca con el método `alias` y confianza 1: lo eligió una persona, que
   * es la fuente más confiable que hay. Y al importar, eso queda guardado en
   * la memoria del cliente, así la próxima OC que diga lo mismo se empareja
   * sola.
   */
  const linkear = (n: number, p: { id: string; sku: string; nombre: string }) => {
    setLineas((ls) =>
      ls.map((l) =>
        l.n === n
          ? { ...l, productId: p.id, sku: p.sku, nombre: p.nombre, metodo: 'manual', confianza: 1 }
          : l,
      ),
    )
    setEditando(null)
  }

  const importar = useMutation({
    mutationFn: () =>
      importarOc({
        companyId: companyId!,
        customerId: clienteId!,
        numero,
        fecha: fecha === '' ? null : fecha,
        moneda,
        lineas,
        quoteId,
        textoCrudo: leida?.textoCrudo ?? null,
        /**
         * Lo que decía el papel, para que la próxima OC de esta empresa
         * reconozca al cliente sola (Fase 30 · E7).
         *
         * Se manda siempre, también cuando el emparejado salió bien: la base
         * compara contra la ficha del cliente y sólo guarda lo que no se podía
         * deducir. Decidirlo acá obligaría a duplicar esa comparación.
         */
        clienteLeido: leida?.cliente ?? null,
      }),
    onSuccess: setHecho,
  })

  const resumen = resumirLineas(lineas)
  const falta = faltaParaImportar({ clienteId, numero, lineasLeidas: leida?.lineas.length ?? 0 })
  const errorLeer = leer.error instanceof FalloDeImportacion ? leer.error : null
  const errorImportar = importar.error instanceof FalloDeImportacion ? importar.error : null

  // ── 4 · listo ──────────────────────────────────────────────────────────
  if (hecho) {
    return (
      <Dialog
        open
        onClose={onCerrar}
        title="Orden de compra importada"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onCerrar}>
              Cerrar
            </Button>
            <Button
              icon={<Icon name="arrow-right" size={16} />}
              onClick={() => {
                onCerrar()
                void navegar(`/ventas/cotizaciones/${hecho.quoteId}`)
              }}
            >
              Abrir {hecho.cotizacion}
            </Button>
          </>
        }
      >
        <Alert tone="success" role="status" title={`Se creó la cotización ${hecho.cotizacion}`}>
          <p>
            {hecho.vinculada
              ? 'La orden quedó vinculada a la cotización que elegiste.'
              : 'Se armó una cotización nueva con lo que pedía la orden.'}
          </p>
          {hecho.sinMatch > 0 ? (
            <p>
              {hecho.sinMatch === 1 ? 'Una línea quedó' : `${hecho.sinMatch} líneas quedaron`} sin producto
              del catálogo: {hecho.sinMatch === 1 ? 'está' : 'están'} en la cotización con el texto del
              cliente, para completar a mano.
            </p>
          ) : null}
          {/* Lo que la próxima OC de este cliente va a resolver sola.
              Se dicen los NÚMEROS y no «esto se aprende solo»: lo primero se
              puede comprobar la próxima vez, lo segundo hay que creerlo. */}
          {hecho.memoriaLineas > 0 || hecho.memoriaCliente > 0 ? (
            <p>
              Quedó guardado en la memoria de este cliente:{' '}
              {hecho.memoriaLineas > 0
                ? `${hecho.memoriaLineas === 1 ? 'una referencia' : `${hecho.memoriaLineas} referencias`} de producto`
                : null}
              {hecho.memoriaLineas > 0 && hecho.memoriaCliente > 0 ? ' y ' : null}
              {hecho.memoriaCliente > 0
                ? hecho.memoriaCliente === 1
                  ? 'cómo se lo nombra en sus órdenes'
                  : 'su CUIT y cómo se lo nombra en sus órdenes'
                : null}
              . La próxima orden de compra se va a emparejar sola.
            </p>
          ) : null}
        </Alert>
      </Dialog>
    )
  }

  // ── 1 y 2 · el archivo, y mirarlo ──────────────────────────────────────
  if (!leida) {
    return (
      <Dialog
        open
        onClose={onCerrar}
        title="Importar orden de compra"
        size="xl"
        closeOnOverlay={false}
        busy={leer.isPending}
        footer={
          archivo === null ? (
            <Button variant="secondary" onClick={onCerrar}>
              Cancelar
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={leer.isPending} onClick={quitarArchivo}>
                Elegir otro PDF
              </Button>
              <Button
                icon={<Icon name="arrow-right" size={16} />}
                loading={leer.isPending}
                disabled={companyId === null}
                onClick={() => leer.mutate(archivo)}
              >
                {leer.isPending ? 'Procesando…' : 'Procesar con IA'}
              </Button>
            </>
          )
        }
      >
        {/* El cartel dice lo que la función contestó, no lo que nos gustaría.
            Con el proveedor en `falso` se avisa que los datos son de demo: si
            no, alguien prueba con una OC real y no entiende por qué salen
            siempre los mismos tres ítems. */}
        {estado.isSuccess ? (
          <p className={styles.estadoIa}>
            <Badge tone={estado.data.listo ? 'success' : 'neutral'}>
              {estado.data.listo ? '✓ IA activa' : 'IA en modo demo'}
            </Badge>
            {estado.data.listo ? null : (
              <span>Se va a leer el PDF, pero los ítems salen de un ejemplo fijo.</span>
            )}
          </p>
        ) : null}

        {archivo === null ? (
          <div
            className={encima ? `${styles.zona} ${styles.zonaEncima}` : styles.zona}
            onDragOver={(e) => {
              e.preventDefault()
              setEncima(true)
            }}
            onDragLeave={() => setEncima(false)}
            onDrop={(e) => {
              e.preventDefault()
              setEncima(false)
              elegirArchivo(e.dataTransfer.files[0])
            }}
          >
            <Icon name="upload" size={32} />
            <p className={styles.zonaTitulo}>Arrastrá el PDF de la OC acá</p>
            <p className={styles.zonaAyuda}>o elegí el archivo</p>
            <Button variant="secondary" onClick={() => entrada.current?.click()}>
              Seleccionar PDF
            </Button>
            <input
              ref={entrada}
              type="file"
              accept="application/pdf"
              className="sr-only"
              aria-label="El PDF de la orden de compra"
              onChange={(e) => elegirArchivo(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div className={styles.previa}>
            {/* Mirar el documento ANTES de gastar una llamada al modelo: el
                archivo equivocado es el error más fácil de cometer. */}
            <object data={`${urlPrevia ?? ''}#toolbar=0&navpanes=0&view=FitH`} type="application/pdf" className={styles.visor}>
              <p className={styles.sinVisor}>
                Tu navegador no muestra PDF acá. El archivo es <strong>{archivo.name}</strong>.
              </p>
            </object>
            <aside className={styles.costado}>
              <p className={styles.nombreArchivo}>{archivo.name}</p>
              <p className={styles.peso}>{(archivo.size / MB).toFixed(2)} MB</p>
              {/* De dónde vino, cuando no lo eligió a mano: desde un correo
                  hay varios adjuntos y conviene ver cuál se agarró. */}
              {origen ? <p className={styles.peso}>{origen}</p> : null}
              <h3 className={styles.pregunta}>¿Es este el PDF correcto?</h3>
              <p className={styles.zonaAyuda}>La IA va a leer el documento y sacar los ítems.</p>
              {errorLeer ? (
                <Alert
                  tone={errorLeer.codigo === 'sin_texto' ? 'warning' : 'danger'}
                  role="alert"
                  title={errorLeer.codigo === 'sin_texto' ? 'Este PDF no tiene texto' : 'No se pudo leer'}
                >
                  <p>{errorLeer.message}</p>
                </Alert>
              ) : null}
            </aside>
          </div>
        )}
      </Dialog>
    )
  }

  // ── 3 · revisar ────────────────────────────────────────────────────────
  return (
    <Dialog
      open
      onClose={onCerrar}
      title="Revisar la orden de compra"
      description="Esto es lo que se leyó. Nada se guarda hasta que aprietes «Importar»."
      size="xl"
      closeOnOverlay={false}
      busy={importar.isPending}
      footer={
        <>
          <Button variant="secondary" disabled={importar.isPending} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            icon={<Icon name="check" size={16} />}
            disabled={falta.length > 0 || importar.isPending}
            loading={importar.isPending}
            onClick={() => importar.mutate()}
          >
            {importar.isPending ? 'Importando…' : 'Importar la orden'}
          </Button>
        </>
      }
    >
      {/* Dos columnas, como el editor de un documento: el resumen a la
          izquierda y el PDF a la derecha, para ir comparando renglón por
          renglón sin cambiar de ventana. Cada columna scrollea por su cuenta,
          así el documento no se va de pantalla mientras se baja por la lista. */}
      <div className={urlPrevia === null ? styles.revision : styles.conPdf}>
        <div className={styles.revision}>
        <section className={styles.bloque}>
          <h3 className={styles.titulo}>1 · El cliente</h3>
          {clienteId === null ? (
            <>
              <p className={styles.leido}>
                {leida.cliente.nombre || leida.cliente.cuit
                  ? `La orden dice: ${leida.cliente.nombre ?? 'sin nombre'}${leida.cliente.cuit ? ` · CUIT ${leida.cliente.cuit}` : ''}`
                  : 'La orden no trae ni nombre ni CUIT del cliente.'}
              </p>
              {candidatos.map((c) => (
                <button
                  key={c.customerId}
                  type="button"
                  className={styles.candidato}
                  onClick={() => void elegirCliente(c.customerId)}
                >
                  <span className={styles.candidatoNombre}>{c.nombre ?? 'Sin nombre'}</span>
                  <Badge tone={c.metodo === 'parecido' ? 'warning' : 'success'}>
                    {EXPLICACION_CLIENTE[c.metodo]}
                  </Badge>
                </button>
              ))}
              <Field label="Buscarlo a mano" optional>
                <BuscadorCliente valor={null} editable onElegir={(id) => id && void elegirCliente(id)} />
              </Field>
            </>
          ) : (
            <>
              <BuscadorCliente valor={clienteId} editable onElegir={(id) => id && void elegirCliente(id)} />
              {porQue !== null && (
                <p className={styles.leido}>
                  {EXPLICACION_CLIENTE[porQue]}
                  {/* Se comprueba que haya TEXTO y no sólo que no sea `null`:
                      la IA puede devolver la cadena vacía, y entonces el
                      cartel diría «La orden dice «».» */}
                  {porQue === 'memoria' && (leida.cliente.nombre ?? '') !== ''
                    ? `. La orden dice «${leida.cliente.nombre}».`
                    : '.'}
                </p>
              )}
            </>
          )}
        </section>

        <section className={styles.bloque}>
          <h3 className={styles.titulo}>2 · Los datos</h3>
          <div className={styles.grilla}>
            {/* Cuando la IA no lo encontró se dice POR QUÉ está vacío y qué
                hacer. Un campo requerido en blanco, sin explicación, parece un
                error de la pantalla y no un dato que falta en el documento. */}
            <Field
              label="Número de la orden"
              required
              {...(leida.numero === ''
                ? { help: 'No se encontró en el documento: escribilo a mano.' }
                : {})}
            >
              <Input
                autoFocus={leida.numero === ''}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
              />
            </Field>
            <Field label="Fecha" optional>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
            <Field label="Moneda">
              <Select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
          </div>
        </section>


        {lineas.length > 0 ? (
          <section className={styles.bloque}>
            <h3 className={styles.titulo}>3 · Los productos</h3>
            <p className={styles.leido}>
              {resumen.total} línea{resumen.total === 1 ? '' : 's'} · {resumen.resueltas} resuelta
              {resumen.resueltas === 1 ? '' : 's'}
              {resumen.aConfirmar > 0 ? ` · ${resumen.aConfirmar} a confirmar` : ''}
              {resumen.sinProducto > 0 ? ` · ${resumen.sinProducto} sin producto` : ''}
            </p>
            {/* Que se sepa que macheando se enseña. Es lo que convierte el
                trabajo de hoy en que la próxima OC de este cliente salga sola,
                y si no se dice, nadie lo supone. */}
            <p className={styles.leido}>
              {clienteId === null
                ? 'Elegí el cliente y se emparejan solas con tu catálogo. Igual podés machear a mano desde ahora.'
                : 'Lo que machees queda guardado en la memoria de este cliente: la próxima orden que diga lo mismo se resuelve sola.'}
            </p>
            {/* Una fila por producto: su referencia, la nuestra y el estado.
                Es una tabla de verdad y no una lista de tarjetas porque lo que
                se hace acá es leer una columna de arriba abajo comparándola
                contra el PDF de al lado, y para eso las referencias tienen que
                estar alineadas entre sí. */}
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th scope="col">Pide el cliente</th>
                  <th scope="col">Nuestro producto</th>
                  <th scope="col" className={styles.colCant}>
                    Cant. × precio
                  </th>
                  <th scope="col">
                    <span className="sr-only">Estado</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const abierto = editando === l.n
                  /**
                   * Tres estados y una sola acción.
                   *
                   * El tilde y la cruz son los dos que se piden; el triángulo
                   * es el parecido, y existe porque mostrarlo como tilde sería
                   * aceptar una adivinanza en silencio. Los trigramas devuelven
                   * el más parecido que encontraron, no el correcto: con 21.775
                   * productos siempre hay algo que se parece.
                   *
                   * Tocar cualquiera de los tres abre el buscador, ya cargado
                   * con el texto del cliente.
                   */
                  const estado =
                    l.productId === null ? 'sin' : l.metodo === 'parecido' ? 'dudoso' : 'ok'
                  return (
                    <Fragment key={l.n}>
                      <tr className={necesitaRevision(l) ? styles.revisar : undefined}>
                        {/* El texto largo va en `title`: la referencia es lo
                            que se compara, y el nombre completo está en el PDF
                            de al lado. Cuando no hay código, la descripción ES
                            la referencia y se muestra ella. */}
                        <td className={styles.ref} title={l.descripcion ?? undefined}>
                          {l.codigo ?? l.descripcion ?? '—'}
                        </td>
                        <td className={styles.ref} title={l.nombre ?? undefined}>
                          {l.productId === null ? <em className={styles.nada}>Sin machear</em> : l.sku}
                        </td>
                        <td className={styles.colCant}>
                          {l.cantidad} × {l.precio === null ? '—' : formatearImporte(l.precio, moneda)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={`${styles.marca} ${styles[estado]}`}
                            aria-expanded={abierto}
                            /* El motivo viaja en el rótulo y en el `title`: el
                               icono solo no distingue «es nuestra referencia»
                               de «se parece al nombre», y no se revisan igual. */
                            title={`${EXPLICACION_LINEA[l.metodo]}. Tocá para elegir otro.`}
                            aria-label={`${EXPLICACION_LINEA[l.metodo]}. Elegir el producto para «${l.codigo ?? l.descripcion ?? `línea ${l.n}`}».`}
                            onClick={() => setEditando(abierto ? null : l.n)}
                          >
                            <Icon
                              name={estado === 'ok' ? 'check' : estado === 'dudoso' ? 'alert-triangle' : 'x'}
                              size={16}
                            />
                          </button>
                        </td>
                      </tr>
                      {abierto ? (
                        <tr>
                          <td colSpan={4} className={styles.buscador}>
                            <BuscadorProducto
                              texto={l.descripcion ?? l.codigo ?? ''}
                              onElegir={(p) => linkear(l.n, p)}
                              onCancelar={() => setEditando(null)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {cotis.length > 0 ? (
          <section className={styles.bloque}>
            <h3 className={styles.titulo}>4 · ¿Responde a una cotización?</h3>
            <ul className={styles.cotis}>
              {cotis.map((c) => (
                <li key={c.quoteId}>
                  <label className={styles.coti}>
                    <input
                      type="radio"
                      name="cotizacion"
                      checked={quoteId === c.quoteId}
                      onChange={() => setQuoteId(c.quoteId)}
                    />
                    <span className={styles.cotiNumero}>{c.numero}</span>
                    <span>{c.fecha}</span>
                    <span>
                      {c.lineasEnComun} de {c.lineasOc} productos en común
                    </span>
                    {/* «2 de 5 coinciden» no alcanza para decidir: pueden ser
                        dos productos que ese cliente compra siempre. Lo que
                        resuelve la duda es ver qué tiene adentro. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={viendo === c.quoteId}
                      onClick={(e) => {
                        e.preventDefault()
                        setViendo(viendo === c.quoteId ? null : c.quoteId)
                      }}
                    >
                      {viendo === c.quoteId ? 'Ocultar' : 'Ver cotización'}
                    </Button>
                  </label>
                  {viendo === c.quoteId ? (
                    <VistaCotizacionCandidata
                      quoteId={c.quoteId}
                      moneda={c.moneda ?? moneda}
                      productosDeLaOc={lineas
                        .map((l) => l.productId)
                        .filter((p): p is string => p !== null)}
                    />
                  ) : null}
                </li>
              ))}
              <li>
                <label className={styles.coti}>
                  <input type="radio" name="cotizacion" checked={quoteId === null} onChange={() => setQuoteId(null)} />
                  <span className={styles.cotiNumero}>Ninguna</span>
                  <span>Armar una cotización nueva</span>
                </label>
              </li>
            </ul>
          </section>
        ) : null}

        {errorImportar ? (
          <Alert tone="danger" role="alert" title="No se pudo importar">
            <p>{errorImportar.message}</p>
          </Alert>
        ) : null}

        {falta.length > 0 ? <p className={styles.falta}>{falta.join(' ')}</p> : null}
        </div>

        {urlPrevia !== null ? (
          <aside className={styles.pdfAlLado} aria-label="La orden de compra que subiste">
            <object
              data={`${urlPrevia}#toolbar=0&navpanes=0&view=FitH`}
              type="application/pdf"
              className={styles.visorLateral}
            >
              <p className={styles.sinVisor}>
                Tu navegador no muestra PDF acá. El archivo es{' '}
                <strong>{archivo?.name ?? 'el que subiste'}</strong>.
              </p>
            </object>
          </aside>
        ) : null}
      </div>
    </Dialog>
  )
}
