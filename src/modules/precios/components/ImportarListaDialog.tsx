import { useMemo, useRef, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import {
  armarRenglones,
  detectarColumnas,
  detectarEncabezado,
  elegirAncla,
  elegirMarca,
  fechaDelNombre,
  marcasEnTexto,
  monedaDe,
  type Celda,
  type Columnas,
} from '../lib/importarLista'
import {
  detectarMarcaPorReferencias,
  importarLista,
  leerArchivoLista,
  type ResumenImportacion,
} from '../services/importarLista'
import { formatearImporte } from '../lib/formato'
import styles from './ImportarListaDialog.module.css'

interface Marca {
  id: string
  nombre: string
}

interface Lectura {
  archivo: string
  hoja: string | null
  encabezados: string[]
  datos: Celda[][]
  columnas: Columnas
  /** Cuántas referencias encontró la base en cada marca. */
  porReferencias: Map<string, number>
  /** Marcas nombradas en el archivo o en su título. */
  enElTexto: Set<string>
}

type Paso =
  | { tipo: 'elegir' }
  | { tipo: 'leyendo' }
  | { tipo: 'revisar'; lectura: Lectura }
  | { tipo: 'cargando'; hechos: number; total: number }
  | { tipo: 'listo'; resumen: ResumenImportacion; marca: string }

const MONEDAS = ['USD', 'EUR', 'ARS', 'GBP']

/**
 * Importar una lista de precios desde un Excel o un CSV.
 *
 * Se elige el archivo y la pantalla decide sola todo lo que puede —el renglón
 * de encabezados, las columnas, la marca, la fecha, la moneda— y lo muestra
 * para revisarlo antes de cargar. Lo que decidió mal se cambia ahí mismo.
 */
export function ImportarListaDialog({
  open,
  onClose,
  companyId,
  marcas,
  onImportada,
}: {
  open: boolean
  onClose: () => void
  companyId: string
  marcas: readonly Marca[]
  /** Al terminar, con la marca cargada, para mostrar su lista. */
  onImportada: (brandId: string) => void
}) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'elegir' })
  const [error, setError] = useState<string | null>(null)
  const [marcaId, setMarcaId] = useState('')
  const [fecha, setFecha] = useState('')
  const [moneda, setMoneda] = useState('USD')
  const [refCol, setRefCol] = useState<number | null>(null)
  const [anclaCol, setAnclaCol] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const reiniciar = () => {
    setPaso({ tipo: 'elegir' })
    setError(null)
  }
  const cerrar = () => {
    if (paso.tipo === 'cargando') return
    reiniciar()
    onClose()
  }

  const leer = async (archivo: File) => {
    setError(null)
    setPaso({ tipo: 'leyendo' })
    try {
      const { filas, hoja } = await leerArchivoLista(archivo)
      const iEnc = detectarEncabezado(filas)
      const encabezados = (filas[iEnc] ?? []).map((c) => (c === null ? '' : String(c).trim()))
      const datos = filas.slice(iEnc + 1)
      // El título (lo que está arriba de los encabezados) también dice cosas:
      // la marca, la moneda, a veces la fecha.
      const titulo = filas.slice(0, iEnc).flat().filter((c) => typeof c === 'string').join(' ')
      const monedaArchivo = monedaDe(`${archivo.name} ${titulo}`)
      const columnas = detectarColumnas(encabezados, datos, monedaArchivo)
      if (columnas.referencia === null || columnas.precios.length === 0) {
        throw new Error('No encontré una columna de referencias y otra de precios. Revisá que el archivo tenga encabezados.')
      }

      // Marca: referencias encontradas en el catálogo + nombre en el archivo.
      const claves = datos.flatMap((f) =>
        [columnas.referencia, columnas.modelo]
          .filter((i): i is number => i !== null)
          .map((i) => (f[i] === null || f[i] === undefined ? '' : String(f[i]).trim()))
          .filter((v) => v !== ''),
      )
      const encontradas = await detectarMarcaPorReferencias(companyId, claves)
      const porReferencias = new Map(encontradas.map((e) => [e.brandId, e.coincidencias]))
      const enElTexto = new Set(marcasEnTexto(`${archivo.name} ${titulo}`, marcas).map((m) => m.id))
      const elegida = elegirMarca(
        marcas.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          coincidencias: porReferencias.get(m.id) ?? 0,
          enElTexto: enElTexto.has(m.id),
        })),
      )

      const ancla = elegirAncla(columnas.precios)
      setMarcaId(elegida?.id ?? '')
      setFecha(fechaDelNombre(`${archivo.name} ${titulo}`, new Date()))
      setMoneda(ancla?.moneda ?? monedaArchivo ?? 'USD')
      setRefCol(columnas.referencia)
      setAnclaCol(ancla?.indice ?? null)
      setPaso({ tipo: 'revisar', lectura: { archivo: archivo.name, hoja, encabezados, datos, columnas, porReferencias, enElTexto } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
      setPaso({ tipo: 'elegir' })
    }
  }

  const lectura = paso.tipo === 'revisar' ? paso.lectura : null

  // Los renglones con las columnas elegidas (si se cambió la referencia o el
  // precio principal, se rearman).
  const armado = useMemo(() => {
    if (!lectura) return null
    const cols: Columnas = {
      ...lectura.columnas,
      referencia: refCol,
      precios: lectura.columnas.precios.filter((p) => p.indice !== refCol),
    }
    const ancla = cols.precios.find((p) => p.indice === anclaCol) ?? elegirAncla(cols.precios)
    return { ...armarRenglones(lectura.datos, cols, ancla), ancla, cols }
  }, [lectura, refCol, anclaCol])

  const cargar = async () => {
    if (!lectura || !armado || !armado.ancla || marcaId === '' || fecha === '') return
    setError(null)
    const total = armado.renglones.length
    setPaso({ tipo: 'cargando', hechos: 0, total })
    try {
      const resumen = await importarLista(
        {
          companyId,
          brandId: marcaId,
          fecha,
          moneda,
          ancla: armado.ancla.encabezado,
          archivo: lectura.archivo,
          nota: lectura.hoja ? `Hoja «${lectura.hoja}»` : null,
          renglones: armado.renglones,
        },
        (hechos) => setPaso({ tipo: 'cargando', hechos, total }),
      )
      setPaso({ tipo: 'listo', resumen, marca: marcas.find((m) => m.id === marcaId)?.nombre ?? '' })
      onImportada(marcaId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.')
      setPaso({ tipo: 'revisar', lectura })
    }
  }

  const porRef = lectura?.porReferencias.get(marcaId) ?? 0
  const marcaEnTexto = lectura?.enElTexto.has(marcaId) ?? false

  return (
    <Dialog
      open={open}
      onClose={cerrar}
      size="lg"
      busy={paso.tipo === 'cargando'}
      title="Importar lista de precios"
      description="Un Excel (.xlsx) o un CSV tal como lo manda el fabricante. Se detectan solas la marca, la fecha y las columnas; revisalas antes de cargar."
      footer={
        paso.tipo === 'revisar' ? (
          <>
            <Button variant="secondary" onClick={reiniciar}>
              Elegir otro archivo
            </Button>
            <Button
              onClick={() => void cargar()}
              disabled={!armado?.ancla || marcaId === '' || fecha === '' || (armado?.renglones.length ?? 0) === 0}
            >
              {`Cargar ${armado?.renglones.length.toLocaleString('es-AR') ?? 0} precios`}
            </Button>
          </>
        ) : paso.tipo === 'listo' ? (
          <Button onClick={cerrar}>Ver la lista</Button>
        ) : (
          <Button variant="secondary" onClick={cerrar} disabled={paso.tipo === 'cargando'}>
            Cancelar
          </Button>
        )
      }
    >
      {error ? (
        <Alert tone="danger" role="alert">
          <p>{error}</p>
        </Alert>
      ) : null}

      {paso.tipo === 'elegir' ? (
        <label
          className={styles.zona}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) void leer(f)
          }}
        >
          <Icon name="upload" size={24} />
          <strong>Elegí el archivo o arrastralo acá</strong>
          <span>Excel (.xlsx) o CSV</span>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className={styles.oculto}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void leer(f)
              e.target.value = ''
            }}
          />
        </label>
      ) : null}

      {paso.tipo === 'leyendo' ? (
        <p className={styles.estado} role="status">
          <Spinner size={20} /> Leyendo el archivo y buscando la marca…
        </p>
      ) : null}

      {paso.tipo === 'revisar' && lectura && armado ? (
        <div className={styles.revisar}>
          <p className={styles.archivo}>
            <Icon name="paperclip" size={16} /> {lectura.archivo}
            {lectura.hoja ? <span> · hoja «{lectura.hoja}»</span> : null}
          </p>

          <div className={styles.grilla}>
            <Field
              label="Marca"
              help={
                marcaId === ''
                  ? 'No la pude detectar: elegila.'
                  : porRef > 0 || marcaEnTexto
                    ? [
                        porRef > 0 ? `${porRef.toLocaleString('es-AR')} referencias ya están en su catálogo` : null,
                        marcaEnTexto ? 'el archivo la nombra' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Elegida a mano.'
              }
            >
              <Select value={marcaId} onChange={(e) => setMarcaId(e.target.value)}>
                <option value="">Elegí la marca…</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha de la lista" help="Si ya hay una lista de esta marca con esta fecha, se reemplaza.">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
            <Field label="Columna de referencia">
              <Select value={refCol ?? ''} onChange={(e) => setRefCol(e.target.value === '' ? null : Number(e.target.value))}>
                {lectura.encabezados.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Columna ${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Precio principal" help="Es el que se compara con la lista anterior. Las otras columnas de precio se guardan igual.">
              <Select value={armado.ancla?.indice ?? ''} onChange={(e) => setAnclaCol(Number(e.target.value))}>
                {armado.cols.precios.map((p) => (
                  <option key={p.indice} value={p.indice}>
                    {p.encabezado}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda">
              <Select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                {MONEDAS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
          </div>

          <p className={styles.resumen}>
            <strong>{armado.renglones.length.toLocaleString('es-AR')}</strong> precios para cargar
            {armado.cols.precios.length > 1 ? ` · ${armado.cols.precios.length} columnas de precio` : ''}
            {armado.cols.modelo !== null ? ' · con modelo' : ''}
            {armado.repetidas > 0 ? ` · ${armado.repetidas} referencias repetidas (queda la primera)` : ''}
            {armado.descartados > 0 ? ` · ${armado.descartados} renglones sin referencia o sin precio` : ''}
          </p>

          <div className={styles.tablaCaja}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Descripción</th>
                  <th className={styles.num}>{armado.ancla?.encabezado ?? 'Precio'}</th>
                </tr>
              </thead>
              <tbody>
                {armado.renglones.slice(0, 8).map((r) => (
                  <tr key={r.reference}>
                    <td className={styles.ref}>{r.reference}</td>
                    <td>{r.description ?? '—'}</td>
                    <td className={styles.num}>{r.anchor === null ? '—' : formatearImporte(r.anchor, moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {paso.tipo === 'cargando' ? (
        <div className={styles.estado} role="status">
          <Spinner size={20} />
          <span>
            Cargando {paso.hechos.toLocaleString('es-AR')} de {paso.total.toLocaleString('es-AR')}…
          </span>
          <progress max={paso.total} value={paso.hechos} className={styles.progreso} />
        </div>
      ) : null}

      {paso.tipo === 'listo' ? <Listo resumen={paso.resumen} marca={paso.marca} /> : null}
    </Dialog>
  )
}

function Listo({ resumen: r, marca }: { resumen: ResumenImportacion; marca: string }) {
  const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`
  return (
    <div className={styles.listo}>
      <Alert tone="success" title={`Lista de ${marca} cargada`}>
        <p>
          {r.renglones.toLocaleString('es-AR')} precios. {r.cruzan.toLocaleString('es-AR')} están en el catálogo; los
          demás se guardan igual, para cuando se carguen esos productos.
        </p>
      </Alert>
      {r.versionAnterior ? (
        <ul className={styles.cambios}>
          <li>
            <strong>{r.suben.toLocaleString('es-AR')}</strong> subieron
          </li>
          <li>
            <strong>{r.bajan.toLocaleString('es-AR')}</strong> bajaron
          </li>
          <li>
            <strong>{r.iguales.toLocaleString('es-AR')}</strong> sin cambio
          </li>
          <li>
            <strong>{r.nuevas.toLocaleString('es-AR')}</strong> referencias nuevas
          </li>
          {r.medianaPct !== null ? (
            <li>
              Aumento típico: <strong>{pct(r.medianaPct)}</strong>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className={styles.estado}>Es la primera lista de esta marca: no hay con qué comparar.</p>
      )}
    </div>
  )
}
