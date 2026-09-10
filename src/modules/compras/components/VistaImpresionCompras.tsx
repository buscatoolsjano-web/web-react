import { formatearFecha, formatearImporte, formatearNumero } from '../lib/formato'
import {
  columnasDe,
  type DocumentoImprimible,
  type EmpresaImpresion,
  type OpcionesImpresion,
} from '../lib/impresion'
import styles from './VistaImpresionCompras.module.css'

export interface VistaImpresionComprasProps {
  doc: DocumentoImprimible
  empresa: EmpresaImpresion
  opciones: OpcionesImpresion
}

/**
 * El documento de Compras, tal como se imprime.
 *
 * **Es el mismo componente para la vista previa y para la impresión**, igual
 * que en Ventas: un solo árbol de React y una hoja `@media print`. El legacy
 * escribía un string de HTML en un iframe, así que la previsualización y el
 * PDF salían de dos caminos parecidos pero no idénticos.
 *
 * La tabla cambia de columnas según el documento —la recepción no lleva
 * importes— y eso lo decide `columnasDe()`, no un `if` suelto acá adentro.
 */
export function VistaImpresionCompras({ doc, empresa, opciones }: VistaImpresionComprasProps) {
  const col = columnasDe(doc.tipo)
  const moneda = doc.moneda ?? ''
  const columnas = 3 + (col.origen ? 1 : 0) + 1 + (col.precios ? 2 : 0) + (col.impuesto ? 1 : 0) + (col.precios ? 1 : 0)

  return (
    <div
      className={`${styles.hoja} ${opciones.papel === 'carta' ? styles.carta : styles.a4}`}
      data-impresion="hoja"
    >
      <header className={styles.encabezado} style={{ borderColor: empresa.color }}>
        <div>
          <div className={styles.marca} style={{ color: empresa.color }}>
            {empresa.nombre.toUpperCase()}
          </div>
          <div className={styles.empresa}>
            {empresa.razonSocial ? <div>{empresa.razonSocial}</div> : null}
            {empresa.cuit ? <div>CUIT {empresa.cuit}</div> : null}
            {empresa.direccion ? <div>{empresa.direccion}</div> : null}
            {empresa.telefono ? <div>Tel.: {empresa.telefono}</div> : null}
            {empresa.email ? <div>{empresa.email}</div> : null}
          </div>
        </div>
        <div className={styles.identidad}>
          <div className={styles.tipoDoc} style={{ background: empresa.color }}>
            {doc.titulo}
          </div>
          <div className={styles.numero}>N° {doc.numero}</div>
          <div className={styles.fecha}>{formatearFecha(doc.fecha)}</div>
        </div>
      </header>

      <section className={styles.datos}>
        {doc.datos.map((d) => (
          <div key={d.etiqueta}>
            <span className={styles.etiqueta}>{d.etiqueta}</span>
            <strong>{d.valor}</strong>
          </div>
        ))}
      </section>

      <table className={styles.tabla}>
        <thead>
          <tr>
            <th className={styles.col1}>#</th>
            {col.origen ? <th>Origen</th> : null}
            <th>Referencia</th>
            <th>Descripción</th>
            <th className={styles.num}>Cant.</th>
            {col.precios ? <th className={styles.num}>Precio</th> : null}
            {col.precios ? <th className={styles.num}>% Dto.</th> : null}
            {col.impuesto ? <th>Impuesto</th> : null}
            {col.precios ? <th className={styles.num}>Neto</th> : null}
          </tr>
        </thead>
        <tbody>
          {doc.lineas.map((l) =>
            l.esCapitulo ? (
              <tr key={l.id} className={styles.capitulo}>
                <td colSpan={columnas}>{l.nombre}</td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td className={styles.col1}>{l.numero}</td>
                {col.origen ? <td className={styles.sku}>{l.origen ?? '—'}</td> : null}
                <td className={styles.sku}>{l.sku ?? '—'}</td>
                <td>
                  <div>{l.nombre ?? '—'}</div>
                  {l.descripcion && l.descripcion !== l.nombre ? (
                    <div className={styles.desc}>{l.descripcion}</div>
                  ) : null}
                </td>
                <td className={styles.num}>{formatearNumero(l.cantidad)}</td>
                {col.precios ? (
                  <td className={styles.num}>{formatearImporte(l.precio ?? 0, moneda)}</td>
                ) : null}
                {col.precios ? (
                  <td className={styles.num}>{l.descuentoPct > 0 ? `${l.descuentoPct}%` : '—'}</td>
                ) : null}
                {col.impuesto ? <td>{l.impuesto ?? '—'}</td> : null}
                {col.precios ? (
                  <td className={styles.num}>
                    <b>{formatearImporte(l.neto ?? 0, moneda)}</b>
                  </td>
                ) : null}
              </tr>
            ),
          )}
          {doc.lineas.length === 0 ? (
            <tr>
              <td colSpan={columnas} className={styles.vacio}>
                Este documento no tiene líneas.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {doc.totales ? (
        <section className={styles.totales}>
          <div>
            <span>Subtotal</span>
            <b>{formatearImporte(doc.totales.subtotal, moneda)}</b>
          </div>
          <div>
            <span>Impuestos</span>
            <b>{formatearImporte(doc.totales.impuesto, moneda)}</b>
          </div>
          <div className={styles.granTotal}>
            <span>TOTAL</span>
            <b>{formatearImporte(doc.totales.total, moneda)}</b>
          </div>
        </section>
      ) : (
        <p className={styles.sinValor}>
          Documento logístico: registra qué llegó, no cuánto cuesta. Los importes están en el
          pedido de compra y en la factura.
        </p>
      )}

      {doc.relacionados.length > 0 ? (
        <section className={styles.observaciones}>
          <span className={styles.etiqueta}>Documentos relacionados</span>
          <p>{doc.relacionados.join(' · ')}</p>
        </section>
      ) : null}

      {doc.notas ? (
        <section className={styles.observaciones}>
          <span className={styles.etiqueta}>Observaciones</span>
          <p>{doc.notas}</p>
        </section>
      ) : null}

      <footer className={styles.pie}>
        {empresa.web ? <span>{empresa.web}</span> : null}
        <span className={styles.firma}>Firma y aclaración</span>
      </footer>
    </div>
  )
}
