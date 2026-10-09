import { Link } from 'react-router-dom'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Spinner } from '@/components/ui/Spinner'
import { formatearPrecio } from '@/modules/catalogo/lib/formato'
import { useDesgloseDeCelda } from '../hooks/useListas'
import type { VentaMaxima } from '../services/listas'
import { fechaLarga, formatearImporte } from '../lib/formato'
import styles from './DesglosePrecio.module.css'

/** Qué celda se tocó. `fecha` null = la columna de lo máximo vendido. */
export interface CeldaElegida {
  sourceId: string
  fuente: string
  reference: string
  descripcion: string | null
  fecha: string | null
  valor: number | null
  ventaMaxima: VentaMaxima | null
}

export interface DesglosePrecioProps {
  celda: CeldaElegida | null
  onCerrar: () => void
}

/**
 * De dónde sale un número de la planilla (Fase 56).
 *
 * POR QUÉ EXISTE. Un precio en una celda es un número que hay que creer. Acá se
 * puede tocar y ver la fuente, el archivo con su enlace al Drive, la fecha, el
 * renglón crudo con TODAS las columnas del original —no sólo la que se usó— y la
 * fórmula que rige, para poder reproducir la cuenta a mano.
 *
 * Y para la columna de lo máximo vendido, lo mismo del otro lado: a quién,
 * cuándo, en qué documento y a qué precio, con el enlace para abrir ese
 * documento.
 */
export function DesglosePrecio({ celda, onCerrar }: DesglosePrecioProps) {
  const esVenta = celda !== null && celda.fecha === null

  const desglose = useDesgloseDeCelda(
    celda !== null && !esVenta ? celda.sourceId : null,
    celda !== null && !esVenta ? celda.reference : null,
    celda !== null && !esVenta ? celda.fecha : null,
  )

  if (celda === null) return null

  return (
    <Dialog
      open
      onClose={onCerrar}
      size="md"
      title={esVenta ? 'Lo máximo que se vendió' : 'De dónde sale este precio'}
      description={
        <>
          <code>{celda.reference}</code>
          {celda.descripcion ? ` · ${celda.descripcion}` : ''}
        </>
      }
    >
      {esVenta ? <Venta venta={celda.ventaMaxima} /> : null}

      {!esVenta && desglose.isPending ? <Spinner /> : null}

      {!esVenta && desglose.error ? (
        <Alert tone="danger" role="alert" title="No se pudo leer el desglose">
          <p>{desglose.error.message}</p>
        </Alert>
      ) : null}

      {!esVenta && desglose.data ? <Lista d={desglose.data} /> : null}

      {!esVenta && !desglose.isPending && !desglose.error && desglose.data === null ? (
        <Alert tone="info" title="Ese renglón no está en esta versión.">
          <p>La celda está vacía porque el producto no figuraba en la lista de esa fecha.</p>
        </Alert>
      ) : null}
    </Dialog>
  )
}

/** El lado de la lista o la factura. */
function Lista({ d }: { d: NonNullable<ReturnType<typeof useDesgloseDeCelda>['data']> }) {
  const base = d.formula?.claveBase ?? null
  const valorBase = base !== null ? Number(d.columnas[base]) : d.anchor
  const pvp =
    d.formula !== null && Number.isFinite(valorBase) && valorBase !== null
      ? Math.round(Number(valorBase) * d.formula.multiplicador * 100) / 100
      : null

  return (
    <div className={styles.cuerpo}>
      <dl className={styles.datos}>
        <Dato rotulo="Fuente" valor={d.fuente} />
        <Dato rotulo="Fecha de la lista" valor={fechaLarga(d.fecha)} />
        <Dato rotulo="Moneda" valor={d.moneda} />
        <Dato
          rotulo="Origen"
          valor={
            d.origen === 'factura'
              ? 'Factura de compra'
              : d.origen === 'drive'
                ? 'Archivo del Drive'
                : d.origen === 'mail'
                  ? 'Adjunto de un mail'
                  : 'Carga manual'
          }
        />
      </dl>

      {/*
        El archivo, con enlace. Es lo que convierte «confiá en el número» en
        «mirá el papel»: se abre el PDF o el Excel original en el Drive.
      */}
      {d.archivo ? (
        <p className={styles.archivo}>
          {d.enlace ? (
            <a href={d.enlace} target="_blank" rel="noreferrer">
              {d.archivo}
            </a>
          ) : (
            d.archivo
          )}
        </p>
      ) : null}

      {/*
        TODAS las columnas del renglón original, no sólo la que se usó. Si el
        archivo traía PVP España, costo y PVP Argentina, están las cuatro: así
        se ve qué se eligió y qué había al lado.
      */}
      <h3 className={styles.titulo}>El renglón, como vino en el archivo</h3>
      <table className={styles.columnas}>
        <tbody>
          <tr>
            <th scope="row">Referencia</th>
            <td>
              <code>{d.reference}</code>
            </td>
          </tr>
          {d.anchor !== null ? (
            <tr>
              <th scope="row">{d.columnaAncla}</th>
              <td>{formatearImporte(d.anchor, d.moneda)}</td>
            </tr>
          ) : null}
          {Object.entries(d.columnas).map(([clave, valor]) => (
            <tr key={clave} className={clave === base ? styles.usada : undefined}>
              <th scope="row">
                {clave}
                {clave === base ? <span className={styles.marca}>la que usa la fórmula</span> : null}
              </th>
              <td>{comoTexto(valor, d.moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* La cuenta, escrita, para poder repetirla a mano. */}
      {d.formula !== null ? (
        <>
          <h3 className={styles.titulo}>La cuenta</h3>
          <p className={styles.cuenta}>
            {base ?? d.columnaAncla} {formatearImporte(Number(valorBase), d.moneda)} ×{' '}
            {d.formula.multiplicador.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
            {pvp !== null ? ` = ${formatearPrecio(pvp, d.moneda)}` : ''}
          </p>
          {!d.formula.baseEsCosto ? (
            <Alert tone="warning" title="Esta lista no trae costo.">
              <p>
                La base es el precio de venta del proveedor, así que el resultado es una referencia
                y no un margen.
              </p>
            </Alert>
          ) : null}
          {!d.formula.fijaPrecio ? (
            <Alert tone="info" title="Esta fuente NO fija el precio de venta.">
              <p>
                El costo queda registrado, pero el precio lo sigue decidiendo STEL hasta que se
                defina el múltiplo de la marca.
              </p>
            </Alert>
          ) : null}
          {d.formula.nota ? <p className={styles.nota}>{d.formula.nota}</p> : null}
        </>
      ) : null}

      {d.nota ? (
        <>
          <h3 className={styles.titulo}>Nota de la carga</h3>
          <p className={styles.nota}>{d.nota}</p>
        </>
      ) : null}
    </div>
  )
}

/** El lado de lo vendido: a quién, cuándo y en qué documento. */
function Venta({ venta }: { venta: VentaMaxima | null }) {
  if (venta === null) {
    return (
      <Alert tone="info" title="Todavía no se vendió ni se cotizó.">
        <p>Cuando este producto entre en una cotización o un pedido, el precio aparece acá.</p>
      </Alert>
    )
  }

  const ruta = venta.tipo === 'pedido' ? '/ventas/pedidos' : '/ventas/cotizaciones'

  return (
    <div className={styles.cuerpo}>
      <p className={styles.monto}>
        {formatearImporte(venta.monto, venta.moneda)} <span className={styles.moneda}>{venta.moneda}</span>
      </p>

      <dl className={styles.datos}>
        <Dato rotulo="Cliente" valor={venta.cliente ?? '—'} />
        <Dato rotulo="Fecha" valor={venta.fecha !== null ? fechaLarga(venta.fecha) : '—'} />
        <Dato rotulo={venta.tipo === 'pedido' ? 'Pedido' : 'Cotización'} valor={venta.numero ?? '—'} />
        <Dato rotulo="Cantidad" valor={venta.cantidad !== null ? String(venta.cantidad) : '—'} />
      </dl>

      {/*
        El descuento se muestra sólo si hubo: el máximo es el precio NETO, y sin
        esta línea no se entendería por qué no coincide con el de lista.
      */}
      {venta.descuentoPct !== null && venta.descuentoPct > 0 ? (
        <p className={styles.nota}>
          De lista {formatearImporte(venta.precioLista ?? 0, venta.moneda)} menos{' '}
          {venta.descuentoPct} % de descuento.
        </p>
      ) : null}

      {/*
        Un PEDIDO es una venta; una COTIZACIÓN es una oferta que pudo no
        cerrarse. Llamar «vendido» a lo segundo sería afirmar algo que no pasó.
      */}
      {venta.tipo === 'cotizacion' ? (
        <Alert tone="warning" title="Es el máximo COTIZADO, no vendido.">
          <p>
            Este precio salió de una cotización, que pudo no cerrarse.
            {venta.vecesVendido > 0
              ? ` De las ${venta.veces} veces que apareció, ${venta.vecesVendido} terminaron en pedido.`
              : ' Todavía no entró en ningún pedido.'}
          </p>
        </Alert>
      ) : (
        <p className={styles.nota}>
          Apareció {venta.veces === 1 ? 'una vez' : `${venta.veces} veces`}
          {venta.vecesVendido > 0
            ? `, ${venta.vecesVendido === 1 ? 'una' : venta.vecesVendido} como pedido`
            : ''}
          .
        </p>
      )}

      {venta.documentoId !== null ? (
        <p className={styles.archivo}>
          <Link to={`${ruta}/${venta.documentoId}`} onClick={() => undefined}>
            Abrir {venta.tipo === 'pedido' ? 'el pedido' : 'la cotización'} {venta.numero ?? ''}
          </Link>
        </p>
      ) : null}
    </div>
  )
}

function Dato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className={styles.dato}>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  )
}

/**
 * Un valor del jsonb del archivo, en texto.
 *
 * Los valores son `unknown` porque el jsonb guarda lo que traía el archivo, y
 * eso incluye textos —el número de factura, el país de origen— además de
 * números. Sin este formateo, un objeto saldría impreso como `[object Object]`,
 * que es justo lo que se viene a evitar en una pantalla de trazabilidad.
 */
function comoTexto(valor: unknown, moneda: string): string {
  if (valor === null || valor === undefined) return '—'
  if (typeof valor === 'number') return formatearImporte(valor, moneda)
  if (typeof valor === 'string') return valor === '' ? '—' : valor
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  // Un objeto o un array: se muestra su JSON, que es el dato real.
  try {
    return JSON.stringify(valor)
  } catch {
    return '—'
  }
}
