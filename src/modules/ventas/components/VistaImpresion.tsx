import { formatearCantidad, formatearFecha, formatearImporte } from '../lib/formato'
import { queMostrar, type DocumentoImprimible, type EmpresaImpresion, type OpcionesImpresion } from '../lib/impresion'
import styles from './VistaImpresion.module.css'

export interface VistaImpresionProps {
  doc: DocumentoImprimible
  empresa: EmpresaImpresion
  opciones: OpcionesImpresion
}

/**
 * El documento, tal como se imprime.
 *
 * **Es el mismo componente para la vista previa y para la impresión.** El
 * legacy armaba un string de HTML y lo escribía en un iframe; eso significaba
 * que la previsualización y el PDF salían de dos caminos parecidos pero no
 * idénticos, y se ve una cosa y se imprime otra. Acá hay un solo árbol de
 * React y una hoja `@media print`: lo que se ve es literalmente lo que sale.
 */
export function VistaImpresion({ doc, empresa, opciones }: VistaImpresionProps) {
  const ver = queMostrar(opciones.formato)
  const moneda = doc.moneda

  if (ver.ticket) {
    return (
      <div className={`${styles.hoja} ${styles.ticket}`} data-impresion="ticket">
        <div className={styles.tHeader}>
          <div className={styles.tLogo}>{empresa.nombre.toUpperCase()}</div>
          <div className={styles.tEmpresa}>
            {empresa.razonSocial ? <div>{empresa.razonSocial}</div> : null}
            {empresa.cuit ? <div>CUIT {empresa.cuit}</div> : null}
            {empresa.direccion ? <div>{empresa.direccion}</div> : null}
            {empresa.telefono ? <div>Tel.: {empresa.telefono}</div> : null}
            {empresa.email ? <div>{empresa.email}</div> : null}
          </div>
        </div>
        <div className={styles.tTipo}>{doc.titulo}</div>
        <div className={styles.tRef}>N° {doc.numero}</div>
        <div className={styles.tData}>
          <div>
            <span>Fecha:</span>
            <b>{formatearFecha(doc.fecha)}</b>
          </div>
          <div>
            <span>Cliente:</span>
            <b>{doc.cliente}</b>
          </div>
          {doc.formaPago ? (
            <div>
              <span>Pago:</span>
              <b>{doc.formaPago}</b>
            </div>
          ) : null}
        </div>
        <div className={styles.tItemsTitle}>DETALLE</div>
        {doc.lineas.map((l) =>
          l.esCapitulo ? (
            <div key={l.id} className={styles.tChapter}>
              {l.nombre}
            </div>
          ) : (
            <div key={l.id} className={styles.tItem}>
              <div className={styles.tItemName}>{l.nombre ?? l.sku}</div>
              {l.sku && l.nombre ? <div className={styles.tItemSku}>{l.sku}</div> : null}
              <div className={styles.tItemRow}>
                <span>
                  {formatearCantidad(l.cantidad)} × {formatearImporte(l.precio, moneda)}
                  {l.descuentoPct > 0 ? ` (−${l.descuentoPct}%)` : ''}
                </span>
                <b>{formatearImporte(l.subtotal, moneda)}</b>
              </div>
            </div>
          ),
        )}
        {ver.totales ? (
          <div className={styles.tTotales}>
            <div>
              <span>Subtotal:</span>
              <b>{formatearImporte(doc.subtotal, moneda)}</b>
            </div>
            {ver.impuestos ? (
              <div>
                <span>Impuestos:</span>
                <b>{formatearImporte(doc.impuesto, moneda)}</b>
              </div>
            ) : null}
            <div className={styles.tTotal}>
              <span>TOTAL</span>
              <span>{formatearImporte(doc.total, moneda)}</span>
            </div>
          </div>
        ) : null}
        <div className={styles.tFooter}>
          <div className={styles.tThanks}>¡Gracias por su compra!</div>
          {empresa.web ? <div>{empresa.web}</div> : null}
        </div>
      </div>
    )
  }

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
        <div>
          <span className={styles.etiqueta}>Cliente</span>
          <strong>{doc.cliente}</strong>
        </div>
        {doc.contacto ? (
          <div>
            <span className={styles.etiqueta}>Contacto</span>
            <strong>{doc.contacto}</strong>
          </div>
        ) : null}
        {doc.formaPago ? (
          <div>
            <span className={styles.etiqueta}>Forma de pago</span>
            <strong>{doc.formaPago}</strong>
          </div>
        ) : null}
        {doc.moneda ? (
          <div>
            <span className={styles.etiqueta}>Moneda</span>
            <strong>{doc.moneda}</strong>
          </div>
        ) : null}
        {doc.origen ? (
          <div>
            <span className={styles.etiqueta}>Origen</span>
            <strong>{doc.origen}</strong>
          </div>
        ) : null}
      </section>

      <table className={styles.tabla}>
        <thead>
          <tr>
            <th className={styles.col1}>#</th>
            <th>Referencia</th>
            <th>Descripción</th>
            <th className={styles.num}>Uds.</th>
            {ver.precios ? <th className={styles.num}>Precio</th> : null}
            {ver.precios ? <th className={styles.num}>% Dto.</th> : null}
            {ver.precios ? <th className={styles.num}>Subtotal</th> : null}
          </tr>
        </thead>
        <tbody>
          {doc.lineas.map((l) =>
            l.esCapitulo ? (
              <tr key={l.id} className={styles.capitulo}>
                <td colSpan={ver.precios ? 7 : 4}>{l.nombre}</td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td className={styles.col1}>{l.numero}</td>
                <td className={styles.sku}>{l.sku ?? '—'}</td>
                <td>
                  <div>{l.nombre ?? '—'}</div>
                  {l.descripcion && l.descripcion !== l.nombre ? (
                    <div className={styles.desc}>{l.descripcion}</div>
                  ) : null}
                </td>
                <td className={styles.num}>{formatearCantidad(l.cantidad)}</td>
                {ver.precios ? (
                  <td className={styles.num}>{formatearImporte(l.precio, moneda)}</td>
                ) : null}
                {ver.precios ? (
                  <td className={styles.num}>{l.descuentoPct > 0 ? `${l.descuentoPct}%` : '—'}</td>
                ) : null}
                {ver.precios ? (
                  <td className={styles.num}>
                    <b>{formatearImporte(l.subtotal, moneda)}</b>
                  </td>
                ) : null}
              </tr>
            ),
          )}
        </tbody>
      </table>

      {ver.totales ? (
        <section className={styles.totales}>
          <div>
            <span>Subtotal</span>
            <b>{formatearImporte(doc.subtotal, moneda)}</b>
          </div>
          {ver.impuestos ? (
            <div>
              <span>Impuestos y percepciones</span>
              <b>{formatearImporte(doc.impuesto, moneda)}</b>
            </div>
          ) : null}
          <div className={styles.granTotal}>
            <span>TOTAL</span>
            <b>{formatearImporte(doc.total, moneda)}</b>
          </div>
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
        {doc.esHistorico ? (
          <span className={styles.historico}>Documento migrado del sistema anterior</span>
        ) : null}
      </footer>
    </div>
  )
}
