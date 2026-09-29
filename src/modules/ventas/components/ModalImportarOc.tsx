import { useEffect, useRef, useState } from 'react'
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
export function ModalImportarOc({ onCerrar }: ModalImportarOcProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const navegar = useNavigate()

  const [archivo, setArchivo] = useState<File | null>(null)
  const [urlPrevia, setUrlPrevia] = useState<string | null>(null)
  const [encima, setEncima] = useState(false)
  const [leida, setLeida] = useState<OcLeida | null>(null)
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [candidatos, setCandidatos] = useState<CandidatoCliente[]>([])
  const [lineas, setLineas] = useState<LineaEmparejada[]>([])
  const [editando, setEditando] = useState<number | null>(null)
  const [cotis, setCotis] = useState<CandidataCotizacion[]>([])
  const [quoteId, setQuoteId] = useState<string | null>(null)
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
      const solo = clienteAutomatico(cands)
      if (solo) await elegirCliente(solo.customerId, oc)
    },
  })

  /**
   * Elegido el cliente, se emparejan las líneas y se buscan cotizaciones.
   *
   * En ese orden y no al revés: los alias del catálogo son POR CLIENTE, así
   * que emparejar antes de saber quién es daría peores resultados.
   */
  const elegirCliente = async (id: string, oc: OcLeida | null = leida) => {
    setClienteId(id)
    if (!oc || companyId === null) return
    const ls = await emparejarLineas(companyId, id, oc.lineas)
    setLineas(ls)
    setCotis(await cotizacionesPara(companyId, id, ls))
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
          ? { ...l, productId: p.id, sku: p.sku, nombre: p.nombre, metodo: 'alias', confianza: 1 }
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
      }),
    onSuccess: setHecho,
  })

  const resumen = resumirLineas(lineas)
  const falta = faltaParaImportar({ clienteId, numero, lineas })
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
            <object data={urlPrevia ?? ''} type="application/pdf" className={styles.visor}>
              <p className={styles.sinVisor}>
                Tu navegador no muestra PDF acá. El archivo es <strong>{archivo.name}</strong>.
              </p>
            </object>
            <aside className={styles.costado}>
              <p className={styles.nombreArchivo}>{archivo.name}</p>
              <p className={styles.peso}>{(archivo.size / MB).toFixed(2)} MB</p>
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
            <BuscadorCliente valor={clienteId} editable onElegir={(id) => id && void elegirCliente(id)} />
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

        {clienteId !== null ? (
          <section className={styles.bloque}>
            <h3 className={styles.titulo}>3 · Los productos</h3>
            <p className={styles.leido}>
              {resumen.total} línea{resumen.total === 1 ? '' : 's'} · {resumen.resueltas} resuelta
              {resumen.resueltas === 1 ? '' : 's'}
              {resumen.aConfirmar > 0 ? ` · ${resumen.aConfirmar} a confirmar` : ''}
              {resumen.sinProducto > 0 ? ` · ${resumen.sinProducto} sin producto` : ''}
            </p>
            <ul className={styles.lineas}>
              {lineas.map((l) => (
                <li key={l.n} className={necesitaRevision(l) ? `${styles.linea} ${styles.revisar}` : styles.linea}>
                  <span className={styles.pidio}>
                    <strong>{l.codigo ?? l.descripcion ?? '—'}</strong>
                    <span>{l.codigo ? (l.descripcion ?? '') : ''}</span>
                  </span>
                  <span className={styles.flecha} aria-hidden="true">→</span>
                  <span className={styles.nuestro}>
                    {l.productId === null ? (
                      <em className={styles.nada}>Sin producto</em>
                    ) : (
                      <>
                        <strong>{l.sku}</strong>
                        <span>{l.nombre}</span>
                      </>
                    )}
                    <Badge tone={l.productId === null ? 'danger' : l.metodo === 'parecido' ? 'warning' : 'success'}>
                      {EXPLICACION_LINEA[l.metodo]}
                    </Badge>
                  </span>
                  <span className={styles.cantidad}>
                    {l.cantidad} × {l.precio === null ? '—' : formatearImporte(l.precio, moneda)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setEditando(editando === l.n ? null : l.n)}>
                    {l.productId === null ? 'Elegir' : 'Cambiar'}
                  </Button>
                  {editando === l.n ? (
                    <div className={styles.buscador}>
                      <BuscadorProducto
                        texto={l.descripcion ?? l.codigo ?? ''}
                        onElegir={(p) => linkear(l.n, p)}
                        onCancelar={() => setEditando(null)}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
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
                  </label>
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
            <object data={urlPrevia} type="application/pdf" className={styles.visorLateral}>
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
