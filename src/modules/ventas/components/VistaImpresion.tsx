import type { ReactNode } from 'react'
import { formatearCantidad, formatearFecha, formatearImporte } from '../lib/formato'
import { FORMAS_DE_PAGO, queMostrar, type DocumentoImprimible, type EmpresaImpresion, type OpcionesImpresion } from '../lib/impresion'
import { CeldaEditable } from './CeldaEditable'
import styles from './VistaImpresion.module.css'

/**
 * Armar el documento DESDE la hoja (Fase 22 · A3).
 *
 * Cuando esto viene, la hoja deja de ser una vista previa y pasa a ser el
 * editor: se agregan productos, se corrigen cantidades y se borran líneas ahí
 * mismo, que es como se armaba una cotización en el sistema anterior.
 *
 * No hay un segundo documento: cada cambio va al MISMO borrador que usa el
 * panel de la izquierda, y la hoja vuelve a dibujarse con él.
 *
 * Nada de esto se imprime. Los controles son de pantalla y el `@media print`
 * los apaga: en papel sale el documento y nada más.
 */
export interface EdicionEnHoja {
  onCantidad: (id: string, valor: number) => void
  onPrecio: (id: string, valor: number) => void
  onDescuento: (id: string, valor: number) => void
  onEliminar: (id: string) => void
  onAgregar: () => void
  /**
   * Una línea suelta, sin producto (Fase 27 · E2).
   *
   * Es la que se usa para una nota en el medio del documento: un texto que
   * se imprime entre las líneas y no lleva cantidad ni precio.
   */
  onNuevaLinea?: (() => void) | undefined
  /** La fecha, editable desde la hoja. Sin esto se muestra como texto. */
  onFecha?: ((valor: string) => void) | undefined
  /** La forma de pago, elegible desde la hoja (Fase 27 · E7). */
  onFormaPago?: ((valor: string) => void) | undefined
  /**
   * El selector de cliente, ya armado.
   *
   * Viene como nodo y no como callback a propósito: esta hoja es la MISMA
   * que se imprime, y no tiene por qué saber cómo se buscan los clientes.
   * Importar el buscador acá le metería el cliente de Supabase a la
   * plantilla de impresión.
   */
  selectorCliente?: ReactNode | undefined
}

export interface VistaImpresionProps {
  doc: DocumentoImprimible
  empresa: EmpresaImpresion
  opciones: OpcionesImpresion
  /** Si viene, la hoja se puede editar. En impresión nunca viene. */
  edicion?: EdicionEnHoja | null
}

/** El logo real, servido desde `public/brand`. Es el mismo del ERP. */
const LOGO = `${import.meta.env.BASE_URL}brand/buscatools-logo.png`

/** El nombre del bloque de datos, por tipo de documento. */
const BLOQUE_DE: Record<DocumentoImprimible['tipo'], string> = {
  cotizacion: 'Datos de la cotización',
  pedido: 'Datos del pedido',
  entrega: 'Datos de la entrega',
}

/**
 * El documento, tal como se imprime.
 *
 * **Es el mismo componente para la vista previa y para la impresión.** El
 * legacy armaba un string de HTML y lo escribía en un iframe; eso significaba
 * que la previsualización y el PDF salían de dos caminos parecidos pero no
 * idénticos, y se ve una cosa y se imprime otra. Acá hay un solo árbol de
 * React y una hoja `@media print`: lo que se ve es literalmente lo que sale.
 *
 * Fase 19 · E6: y es UNA sola composición para los tres documentos. La
 * cotización, el pedido y el remito no tienen plantillas distintas: tienen los
 * mismos bloques en las mismas posiciones, con las etiquetas y las columnas
 * que le corresponden a cada uno. Lo que cambia son los datos.
 */
export function VistaImpresion({ doc, empresa, opciones, edicion = null }: VistaImpresionProps) {
  const ver = queMostrar(opciones.formato)
  const moneda = doc.moneda

  if (ver.ticket) {
    return (
      <div className={`${styles.hoja} ${styles.ticket}`} data-impresion="ticket">
        <div className={styles.tHeader}>
          <img src={LOGO} alt={empresa.nombre} className={styles.tLogoImg} />
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

  const columnas = 3 + (opciones.conFotos ? 1 : 0) + (ver.precios ? 3 : 0) + (ver.impuestos ? 1 : 0)
  // La columna del botón de borrar sólo existe en pantalla y sólo editando.
  const columnasVisibles = columnas + (edicion ? 1 : 0)

  return (
    <div
      className={`${styles.hoja} ${opciones.papel === 'carta' ? styles.carta : styles.a4}`}
      data-impresion="hoja"
    >
      {/* ── A · la empresa ──────────────────────────────────────────── */}
      <header className={styles.encabezado}>
        <div className={styles.cajaLogo}>
          <img src={LOGO} alt={empresa.nombre} className={styles.logo} width={1400} height={673} />
        </div>
        <div className={styles.empresa}>
          {empresa.razonSocial ? <strong>{empresa.razonSocial}</strong> : null}
          {empresa.direccion ? <div>{empresa.direccion}</div> : null}
          {empresa.cuit ? <div>{empresa.cuit}</div> : null}
        </div>
        <div className={styles.empresaContacto}>
          {empresa.email ? <div>{empresa.email}</div> : null}
          {empresa.web ? <div>{empresa.web}</div> : null}
          {empresa.telefono ? <div>Tel.: {empresa.telefono}</div> : null}
        </div>
      </header>
      <div className={styles.reglaNaranja} />

      {/* ── B · el documento ────────────────────────────────────────── */}
      <h1 className={styles.titulo}>{doc.titulo}</h1>
      <p className={styles.subtitulo}>{doc.subtitulo ?? ''}</p>

      {/* ── C · datos del documento y del cliente ───────────────────── */}
      <section className={styles.bloques}>
        <div>
          <h2 className={styles.tituloBloque}>{BLOQUE_DE[doc.tipo]}</h2>
          <dl className={styles.campos}>
            <dt>Número:</dt>
            <dd>{doc.numero}</dd>
            <dt>Fecha:</dt>
            <dd>
              {edicion?.onFecha ? (
                <input
                  type="date"
                  className={styles.fechaEditable}
                  aria-label="Fecha del documento"
                  value={doc.fecha.slice(0, 10)}
                  onChange={(e) => edicion.onFecha?.(e.target.value)}
                />
              ) : (
                formatearFecha(doc.fecha)
              )}
            </dd>
            {/* Fase 27 · E7: con `onFormaPago` es un desplegable acá mismo,
                como en el sistema anterior. */}
            {edicion?.onFormaPago ? (
              <>
                <dt>Forma de pago:</dt>
                <dd>
                  <select
                    className={styles.selectEditable}
                    aria-label="Forma de pago"
                    value={doc.formaPago ?? ''}
                    onChange={(e) => edicion.onFormaPago?.(e.target.value)}
                  >
                    {/* Lo que ya tenía el documento, aunque no esté en la
                        lista: cambiar la lista no puede borrar un dato. */}
                    {doc.formaPago && !(FORMAS_DE_PAGO as readonly string[]).includes(doc.formaPago) ? (
                      <option value={doc.formaPago}>{doc.formaPago}</option>
                    ) : null}
                    {doc.formaPago ? null : <option value="">Sin forma de pago</option>}
                    {FORMAS_DE_PAGO.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </dd>
              </>
            ) : doc.formaPago ? (
              <>
                <dt>Forma de pago:</dt>
                <dd>{doc.formaPago}</dd>
              </>
            ) : null}
            {doc.moneda ? (
              <>
                <dt>Moneda:</dt>
                <dd>{doc.moneda}</dd>
              </>
            ) : null}
            {doc.origen ? (
              <>
                <dt>Origen:</dt>
                <dd>{doc.origen}</dd>
              </>
            ) : null}
            {doc.vendedor ? (
              <>
                <dt>Vendedor:</dt>
                <dd>{doc.vendedor}</dd>
              </>
            ) : null}
            {/* Del remito, sólo lo que se registró al emitirlo. */}
            {doc.transporte ? (
              <>
                <dt>Transporte:</dt>
                <dd>{doc.transporte}</dd>
              </>
            ) : null}
            {doc.seguimiento ? (
              <>
                <dt>Seguimiento:</dt>
                <dd>{doc.seguimiento}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <div>
          <h2 className={styles.tituloBloque}>Datos del cliente</h2>
          <dl className={styles.campos}>
            <dt>Cliente:</dt>
            <dd>{edicion?.selectorCliente ?? doc.cliente}</dd>
            <dt>CUIT:</dt>
            <dd>{doc.clienteCuit ?? '—'}</dd>
            {doc.contacto ? (
              <>
                <dt>Contacto:</dt>
                <dd>{doc.contacto}</dd>
              </>
            ) : null}
            {/* Sólo el remito, y sólo si quedó registrado al emitirlo. */}
            {doc.domicilioEntrega ? (
              <>
                <dt>Entregar en:</dt>
                <dd>{doc.domicilioEntrega}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </section>

      {/* ── D · productos ───────────────────────────────────────────── */}
      <table className={styles.tabla}>
        <colgroup>
          {opciones.conFotos ? <col style={{ width: '18mm' }} /> : null}
          <col style={{ width: '24mm' }} />
          <col />
          <col style={{ width: '16mm' }} />
          {ver.precios ? <col style={{ width: '24mm' }} /> : null}
          {ver.precios ? <col style={{ width: '16mm' }} /> : null}
          {ver.precios ? <col style={{ width: '26mm' }} /> : null}
          {ver.impuestos ? <col style={{ width: '18mm' }} /> : null}
        </colgroup>
        <thead>
          <tr>
            {opciones.conFotos ? <th scope="col">Foto</th> : null}
            <th scope="col">Ref.</th>
            <th scope="col">Nombre / descripción</th>
            <th scope="col" className={styles.num}>
              Uds.
            </th>
            {ver.precios ? (
              <th scope="col" className={styles.num}>
                Precio
              </th>
            ) : null}
            {ver.precios ? (
              <th scope="col" className={styles.num}>
                % Dto.
              </th>
            ) : null}
            {ver.precios ? (
              <th scope="col" className={styles.num}>
                Subtotal
              </th>
            ) : null}
            {/* La alícuota por línea, como el documento del sistema anterior. */}
            {ver.impuestos ? (
              <th scope="col" className={styles.num}>
                Imp.
              </th>
            ) : null}
            {edicion ? (
              <th scope="col" className={styles.colAccion}>
                <span className="sr-only">Quitar</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {doc.lineas.map((l) =>
            l.esCapitulo ? (
              <tr key={l.id} className={styles.capitulo}>
                <td colSpan={columnasVisibles}>{l.nombre}</td>
              </tr>
            ) : (
              <tr key={l.id}>
                {/* El hueco de la foto existe en TODAS las filas cuando el
                    formato las lleva: con imagen se usa, sin imagen queda
                    vacío. Así las columnas no se mueven de una fila a otra. */}
                {opciones.conFotos ? (
                  <td className={styles.celdaFoto}>
                    <div className={styles.marcoFoto}>
                      {l.foto ? <img src={l.foto} alt="" className={styles.foto} loading="lazy" /> : null}
                    </div>
                  </td>
                ) : null}
                <td className={styles.sku}>{l.sku ?? '—'}</td>
                <td>
                  <div className={styles.nombre}>{l.nombre ?? '—'}</div>
                  {l.descripcion && l.descripcion !== l.nombre ? (
                    <div className={styles.desc}>{l.descripcion}</div>
                  ) : null}
                </td>
                <td className={styles.num}>
                  {edicion ? (
                    <CeldaEditable valor={l.cantidad} etiqueta="Cantidad" min={0} paso={1} onCambiar={(v) => edicion.onCantidad(l.id, v)}>
                      {formatearCantidad(l.cantidad)}
                    </CeldaEditable>
                  ) : (
                    formatearCantidad(l.cantidad)
                  )}
                </td>
                {ver.precios ? (
                  <td className={styles.num}>
                    {edicion && l.precio !== null ? (
                      <CeldaEditable valor={l.precio} etiqueta="Precio unitario" min={0} paso={0.01} onCambiar={(v) => edicion.onPrecio(l.id, v)}>
                        {formatearImporte(l.precio, moneda)}
                      </CeldaEditable>
                    ) : (
                      formatearImporte(l.precio, moneda)
                    )}
                  </td>
                ) : null}
                {ver.precios ? (
                  <td className={styles.num}>
                    {edicion ? (
                      <CeldaEditable valor={l.descuentoPct} etiqueta="Descuento por ciento" min={0} max={100} paso={1} onCambiar={(v) => edicion.onDescuento(l.id, v)}>
                        {l.descuentoPct > 0 ? `${l.descuentoPct}%` : '—'}
                      </CeldaEditable>
                    ) : l.descuentoPct > 0 ? (
                      `${l.descuentoPct}%`
                    ) : (
                      '—'
                    )}
                  </td>
                ) : null}
                {ver.precios ? (
                  <td className={styles.num}>
                    <b>{formatearImporte(l.subtotal, moneda)}</b>
                  </td>
                ) : null}
                {ver.impuestos ? (
                  <td className={styles.num}>
                    {l.impuestoPct === null ? '—' : `IVA ${formatearCantidad(l.impuestoPct)} %`}
                  </td>
                ) : null}
                {edicion ? (
                  <td className={styles.colAccion}>
                    <button
                      type="button"
                      className={styles.quitar}
                      onClick={() => edicion.onEliminar(l.id)}
                      aria-label={`Quitar ${l.nombre ?? 'la línea'}`}
                      title="Quitar del documento"
                    >
                      ×
                    </button>
                  </td>
                ) : null}
              </tr>
            ),
          )}
          {edicion ? (
            <tr className={styles.filaAgregar}>
              <td colSpan={columnasVisibles}>
                <div className={styles.agregarFila}>
                  <button type="button" className={styles.agregar} onClick={edicion.onAgregar}>
                    + Agregar producto
                  </button>
                  {edicion.onNuevaLinea ? (
                    <button type="button" className={styles.agregar} onClick={edicion.onNuevaLinea}>
                      + Nueva línea
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* ── E · el relleno que ancla el cierre abajo ────────────────── */}
      <div className={styles.relleno} />

      {/* ── F · observaciones y totales ─────────────────────────────── */}
      <section className={styles.cierre}>
        <div>
          {doc.notas ? (
            <>
              <div className={styles.tituloObs}>Observaciones</div>
              <div className={styles.observaciones}>{doc.notas}</div>
            </>
          ) : null}
        </div>
        {ver.totales ? (
          <div className={styles.totales}>
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
          </div>
        ) : (
          <div />
        )}
      </section>

      {/* ── G · pie ─────────────────────────────────────────────────── */}
      <footer className={styles.pie}>
        <span>{empresa.web ?? ''}</span>
        {doc.esHistorico ? (
          <span className={styles.historico}>Documento migrado del sistema anterior</span>
        ) : null}
      </footer>
    </div>
  )
}
