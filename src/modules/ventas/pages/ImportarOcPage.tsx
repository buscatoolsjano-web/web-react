import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { ActionBar } from '@/components/document/ActionBar'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { BuscadorCliente } from '../components/BuscadorCliente'
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
  emparejarCliente,
  emparejarLineas,
  importarOc,
  leerOcDesdePdf,
  type OcLeida,
  type ResultadoImportacion,
} from '../services/importarOc'
import { formatearImporte } from '../lib/formato'
import styles from './ImportarOcPage.module.css'

const MONEDAS = ['ARS', 'USD', 'EUR', 'BRL']

/**
 * Importar la orden de compra del cliente (Fase 30 · E6).
 *
 * Tres pasos y uno solo a la vez: el archivo, la revisión, y el resultado. La
 * revisión es la que importa — todo lo demás existe para llegar hasta ahí.
 *
 * La regla que ordena la pantalla: **la IA propone y la persona confirma**.
 * Nada se escribe hasta apretar «Importar», y lo que la base emparejó por
 * parecido llega marcado, porque un parecido de 0,97 sigue siendo un parecido.
 */
export function ImportarOcPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const navegar = useNavigate()

  const [archivo, setArchivo] = useState<File | null>(null)
  const [leida, setLeida] = useState<OcLeida | null>(null)
  const [clienteId, setClienteId] = useState<string | null>(null)
  const [candidatos, setCandidatos] = useState<CandidatoCliente[]>([])
  const [lineas, setLineas] = useState<LineaEmparejada[]>([])
  const [cotis, setCotis] = useState<CandidataCotizacion[]>([])
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState('')
  const [moneda, setMoneda] = useState('ARS')
  const [hecho, setHecho] = useState<ResultadoImportacion | null>(null)

  /** Leer el PDF y, con lo que salga, buscar cliente. */
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

  // ── 3 · listo ──────────────────────────────────────────────────────────
  if (hecho) {
    return (
      <div className={styles.pagina}>
        <PageHeader title="Orden de compra importada" />
        <Alert tone="success" role="status" title={`Se creó la cotización ${hecho.cotizacion}`}>
          <p>
            {hecho.vinculada
              ? 'La orden quedó vinculada a la cotización que elegiste.'
              : 'Se armó una cotización nueva con lo que pedía la orden.'}
          </p>
          {hecho.sinMatch > 0 ? (
            <p>
              {hecho.sinMatch === 1
                ? 'Una línea quedó sin producto del catálogo: está en la cotización con el texto del cliente, para completarla a mano.'
                : `${hecho.sinMatch} líneas quedaron sin producto del catálogo: están en la cotización con el texto del cliente, para completarlas a mano.`}
            </p>
          ) : null}
        </Alert>
        <ActionBar
          primary={
            <Button
              icon={<Icon name="arrow-right" size={16} />}
              onClick={() => void navegar(`/ventas/cotizaciones/${hecho.quoteId}`)}
            >
              Abrir la cotización
            </Button>
          }
          secondary={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Importar otra
            </Button>
          }
        />
      </div>
    )
  }

  // ── 1 · el archivo ─────────────────────────────────────────────────────
  if (!leida) {
    return (
      <div className={styles.pagina}>
        <PageHeader
          title="Importar orden de compra"
          subtitle="Subí el PDF que mandó el cliente y se arma la cotización."
        />
        <section className={styles.caja}>
          <Field
            label="El PDF de la orden de compra"
            help="Se lee el archivo y se propone a qué cliente y a qué productos corresponde. Nada se guarda hasta que lo confirmes."
          >
            <input
              type="file"
              accept="application/pdf"
              className={styles.archivo}
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Button
            icon={<Icon name="arrow-right" size={16} />}
            disabled={archivo === null || companyId === null}
            loading={leer.isPending}
            onClick={() => archivo && leer.mutate(archivo)}
          >
            {leer.isPending ? 'Leyendo…' : 'Leer la orden'}
          </Button>
          {errorLeer ? (
            <Alert
              tone={errorLeer.codigo === 'sin_desplegar' ? 'info' : 'danger'}
              role="alert"
              title={errorLeer.codigo === 'sin_desplegar' ? 'Todavía no está disponible' : 'No se pudo leer el PDF'}
            >
              <p>{errorLeer.message}</p>
            </Alert>
          ) : null}
        </section>
      </div>
    )
  }

  // ── 2 · revisar ────────────────────────────────────────────────────────
  return (
    <div className={styles.pagina}>
      <PageHeader
        title="Revisar la orden de compra"
        subtitle="Esto es lo que se leyó. Nada se guarda hasta que aprietes «Importar»."
      />

      <section className={styles.caja}>
        <h2 className={styles.titulo}>1 · El cliente</h2>
        {clienteId === null ? (
          <>
            {leida.cliente.nombre || leida.cliente.cuit ? (
              <p className={styles.leido}>
                La orden dice: <strong>{leida.cliente.nombre ?? 'sin nombre'}</strong>
                {leida.cliente.cuit ? ` · CUIT ${leida.cliente.cuit}` : ''}
              </p>
            ) : (
              <p className={styles.leido}>La orden no trae ni nombre ni CUIT del cliente.</p>
            )}
            {candidatos.length > 0 ? (
              <ul className={styles.candidatos}>
                {candidatos.map((c) => (
                  <li key={c.customerId}>
                    <button type="button" className={styles.candidato} onClick={() => void elegirCliente(c.customerId)}>
                      <span className={styles.candidatoNombre}>{c.nombre ?? 'Sin nombre'}</span>
                      <Badge tone={c.metodo === 'parecido' ? 'warning' : 'success'}>
                        {EXPLICACION_CLIENTE[c.metodo]}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Field label="Buscarlo a mano" optional>
              <BuscadorCliente valor={null} editable onElegir={(id) => id && void elegirCliente(id)} />
            </Field>
          </>
        ) : (
          <div className={styles.elegido}>
            <BuscadorCliente valor={clienteId} editable onElegir={(id) => id && void elegirCliente(id)} />
          </div>
        )}
      </section>

      <section className={styles.caja}>
        <h2 className={styles.titulo}>2 · Los datos de la orden</h2>
        <div className={styles.grilla}>
          <Field label="Número de la orden" required>
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
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
        <section className={styles.caja}>
          <h2 className={styles.titulo}>3 · Los productos</h2>
          <p className={styles.resumen}>
            {resumen.total} línea{resumen.total === 1 ? '' : 's'} · {resumen.resueltas} resuelta
            {resumen.resueltas === 1 ? '' : 's'}
            {resumen.aConfirmar > 0 ? ` · ${resumen.aConfirmar} a confirmar` : ''}
            {resumen.sinProducto > 0 ? ` · ${resumen.sinProducto} sin producto` : ''}
          </p>
          {resumen.sinProducto > 0 ? (
            <Alert tone="info" title="Las líneas sin producto se importan igual">
              <p>
                Entran a la cotización con el texto del cliente y sin precio de lista, para completarlas
                a mano. Perderlas sería peor que importarlas incompletas.
              </p>
            </Alert>
          ) : null}
          <ul className={styles.lineas}>
            {lineas.map((l) => (
              <li key={l.n} className={necesitaRevision(l) ? `${styles.linea} ${styles.revisar}` : styles.linea}>
                <span className={styles.pidio}>
                  <strong>{l.codigo ?? '—'}</strong>
                  <span>{l.descripcion ?? ''}</span>
                </span>
                <span className={styles.flecha} aria-hidden="true">→</span>
                <span className={styles.nuestro}>
                  {l.productId === null ? (
                    <em className={styles.nada}>No se encontró en el catálogo</em>
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
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cotis.length > 0 ? (
        <section className={styles.caja}>
          <h2 className={styles.titulo}>4 · ¿Responde a una cotización?</h2>
          <p className={styles.resumen}>
            Estas cotizaciones tienen productos en común con la orden. Si elegís una, la orden queda
            vinculada a ella en vez de crear una nueva.
          </p>
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
                  <span>{formatearImporte(c.total, c.moneda ?? moneda)}</span>
                </label>
              </li>
            ))}
            <li>
              <label className={styles.coti}>
                <input type="radio" name="cotizacion" checked={quoteId === null} onChange={() => setQuoteId(null)} />
                <span className={styles.cotiNumero}>Ninguna</span>
                <span>Armar una cotización nueva con lo que pide la orden</span>
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

      <ActionBar
        pegajosa
        volver={{ to: '/ventas/cotizaciones', label: 'Cotizaciones' }}
        primary={
          <Button
            icon={<Icon name="check" size={16} />}
            disabled={falta.length > 0 || importar.isPending}
            loading={importar.isPending}
            onClick={() => importar.mutate()}
          >
            {importar.isPending ? 'Importando…' : 'Importar la orden'}
          </Button>
        }
        note={falta.length > 0 ? <p>{falta.join(' ')}</p> : null}
      />
    </div>
  )
}
