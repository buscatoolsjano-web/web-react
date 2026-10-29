import { Fragment, type ReactNode } from 'react'
import { formatearCantidad, formatearFecha, formatearImporte } from '../lib/formato'
import { FORMAS_DE_PAGO, queMostrar, type DocumentoImprimible, type EmpresaImpresion, type LineaImpresa, type OpcionesImpresion } from '../lib/impresion'
import { verDePlantilla, type ConfigPlantilla } from '../lib/plantillas'
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
  /**
   * El nombre, la descripción y la referencia de la línea, editables desde la
   * hoja (Fase 190). Son opcionales: el remito no los trae —ahí esos datos
   * vienen del pedido— y quedan de sólo lectura.
   */
  onNombre?: ((id: string, valor: string) => void) | undefined
  onDescripcion?: ((id: string, valor: string) => void) | undefined
  onReferencia?: ((id: string, valor: string) => void) | undefined
  onEliminar: (id: string) => void
  onAgregar: () => void
  /**
   * Una nota en el medio del documento (Fase 27 · E2, Fase 28 · E11).
   *
   * Un texto que se imprime entre las líneas y no lleva referencia, cantidad
   * ni precio: dónde se entrega, una aclaración. Es UNA caja de texto y nada
   * más — ni siquiera un título, que era una casilla de más para escribir una
   * frase.
   */
  onNuevoCapitulo?: (() => void) | undefined
  /** El texto de la nota, editable en la hoja. */
  onTextoCapitulo?: ((id: string, texto: string) => void) | undefined
  /** La fecha, editable desde la hoja. Sin esto se muestra como texto. */
  onFecha?: ((valor: string) => void) | undefined
  /**
   * El título del documento, editable desde la hoja (Fase 29 · E17).
   *
   * Es el renglón que va debajo del tipo —«COTIZACIÓN DE VENTA»— y es lo
   * único que le dice al cliente de qué es la hoja que recibe. Hasta acá se
   * cargaba sólo desde el panel, que es donde menos se lo ve: en la hoja, el
   * hueco vacío se nota, y es obligatorio.
   *
   * Ojo con no confundirlo con `doc.titulo`, que es el TIPO de documento y no
   * se edita: el del usuario es `doc.subtitulo`.
   */
  onTitulo?: ((valor: string) => void) | undefined
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
  /**
   * Una plantilla del admin (Fase 152). Cuando viene, ella decide qué columnas y
   * bloques se ven y qué textos lleva, en vez del `formato` de las opciones. Es
   * la MISMA hoja: la plantilla sólo elige qué se muestra.
   */
  plantilla?: ConfigPlantilla | null
  /** Si viene, la hoja se puede editar. En impresión nunca viene. */
  edicion?: EdicionEnHoja | null
}

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
export function VistaImpresion({ doc, empresa, opciones, plantilla = null, edicion = null }: VistaImpresionProps) {
  const ver = plantilla ? verDePlantilla(plantilla) : queMostrar(opciones.formato)
  const moneda = doc.moneda
  // Con plantilla manda ella; si no, el formato y la opción de foto.
  const conFotos = plantilla ? plantilla.columnas.foto : opciones.conFotos
  const verFirmas = plantilla ? plantilla.bloques.firmas : ver.packing !== 'no'
  const titulo = plantilla?.titulo ?? doc.titulo
  // Los bloques que una plantilla puede apagar (sin plantilla, todos van).
  const verEmpresa = plantilla ? plantilla.bloques.empresa : true
  const verCliente = plantilla ? plantilla.bloques.cliente : true
  const verDatos = plantilla ? plantilla.bloques.datos : true
  const verNotas = plantilla ? plantilla.bloques.notas : true

  if (ver.ticket) {
    return (
      <div className={`${styles.hoja} ${styles.ticket}`} data-impresion="ticket">
        <div className={styles.tHeader}>
          {empresa.logoUrl ? <img src={empresa.logoUrl} alt={empresa.nombre} className={styles.tLogoImg} /> : null}
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

  /*
   * La columna de descuento sólo existe si hay alguno (Fase 82).
   *
   * Pedido: «si no hay descuento que ni aparezca; así todo se desplaza un
   * poco más y entra bien la descripción». Son 16 mm que casi siempre están
   * llenos de guiones, y se los lleva la columna del nombre, que es la que
   * se queda corta.
   *
   * Mientras se edita SIEMPRE está: si no, no habría dónde escribir el
   * primer descuento —la columna aparecería recién después de cargarlo, que
   * es justo cuando ya no hace falta—.
   */
  const permitirDescuento = plantilla ? plantilla.columnas.descuento : true
  const hayDescuento = permitirDescuento && (edicion !== null || doc.lineas.some((l) => l.descuentoPct > 0))
  const verDescuento = ver.precios && hayDescuento
  const columnas = 3 + (ver.precios ? 2 : 0) + (verDescuento ? 1 : 0) + (ver.impuestos ? 1 : 0)

  /* Con fotos manda el marco de 20 mm. Sin fotos, el alto depende de si
     alguna línea tiene algo escrito debajo del nombre. En el packing «simple»
     —o si la plantilla la apaga— la descripción no se muestra. */
  const mostrarDescripcion = plantilla ? plantilla.columnas.descripcion : ver.packing !== 'simple'
  const hayDescripcion =
    mostrarDescripcion &&
    doc.lineas.some((l) => l.partes.length > 0 || (l.descripcion !== null && l.descripcion !== l.nombre))
  const altoDeFila = conFotos ? 'filasFoto' : hayDescripcion ? 'filasDesc' : 'filasSimples'
  // La columna del botón de borrar sólo existe en pantalla y sólo editando.
  const columnasVisibles = columnas + (edicion ? 1 : 0)

  return (
    <div
      className={`${styles.hoja} ${opciones.papel === 'carta' ? styles.carta : styles.a4}`}
      data-impresion="hoja"
    >
      {/* ── A · la empresa ──────────────────────────────────────────── */}
      {verEmpresa ? (
        <>
          <header className={styles.encabezado}>
            {/* Cada empresa su logo; sin logo, no se dibuja la caja (Fase 188).
                Sin width/height fijos: cada logo tiene su proporción. */}
            {empresa.logoUrl ? (
              <div className={styles.cajaLogo}>
                <img src={empresa.logoUrl} alt={empresa.nombre} className={styles.logo} />
              </div>
            ) : null}
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
        </>
      ) : null}

      {/* ── B · el documento ────────────────────────────────────────── */}
      <h1 className={styles.titulo}>{titulo}</h1>
      {edicion?.onTitulo ? (
        <input
          type="text"
          className={styles.tituloEditable}
          aria-label="Título del documento"
          placeholder="Título del documento"
          value={doc.subtitulo ?? ''}
          onChange={(e) => edicion.onTitulo?.(e.target.value)}
        />
      ) : (
        <p className={styles.subtitulo}>{doc.subtitulo ?? ''}</p>
      )}

      {/* El encabezado libre de la plantilla (Fase 152), si lo tiene. */}
      {plantilla?.encabezado ? <p className={styles.textoPlantilla}>{plantilla.encabezado}</p> : null}

      {/* ── C · datos del documento y del cliente ───────────────────── */}
      {verDatos || verCliente ? (
      <section className={styles.bloques}>
        {verDatos ? (
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
        ) : null}
        {verCliente ? (
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
        ) : null}
      </section>
      ) : null}

      {/* ── D · productos ───────────────────────────────────────────── */}
      {/*
        Todas las filas miden lo mismo, y cuánto lo decide el DOCUMENTO
        (Fase 74). Si ninguna línea trae descripción no se reserva lugar para
        ninguna: así un presupuesto de 19 renglones simples sigue entrando en
        una hoja. El detalle de las tres alturas está en el CSS.
      */}
      <table className={`${styles.tabla} ${styles[altoDeFila]}`}>
        <colgroup>
          {/* La referencia lleva la foto abajo, en la misma celda: es como lo
              arma el sistema anterior (`app.js:25439`, `td.ref-cell`). Una
              columna aparte movía el ancho de la tabla según el formato. */}
          <col style={{ width: '26mm' }} />
          <col />
          <col style={{ width: '16mm' }} />
          {ver.precios ? <col style={{ width: '24mm' }} /> : null}
          {verDescuento ? <col style={{ width: '16mm' }} /> : null}
          {ver.precios ? <col style={{ width: '26mm' }} /> : null}
          {ver.impuestos ? <col style={{ width: '18mm' }} /> : null}
        </colgroup>
        <thead>
          <tr>
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
            {verDescuento ? (
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
              // La plantilla puede apagar las notas entre líneas (Fase 152).
              !verNotas ? null : (
              <tr key={l.id} className={styles.capitulo}>
                {/* Una caja de texto y el botón de quitar. Nada de «Capítulo»
                    escrito de fábrica: el renglón arranca vacío y quien lo usa
                    escribe lo que tenga que decir. */}
                <td colSpan={columnas}>
                  {edicion?.onTextoCapitulo ? (
                    <textarea
                      className={styles.notaTexto}
                      value={l.nombre ?? ''}
                      rows={2}
                      placeholder="Escribí una nota: dónde se entrega, una aclaración…"
                      aria-label="Nota del documento"
                      onChange={(e) => edicion.onTextoCapitulo?.(l.id, e.target.value)}
                    />
                  ) : (
                    <div className={styles.capituloTexto}>{l.nombre ?? ''}</div>
                  )}
                </td>
                {edicion ? (
                  <td className={styles.colAccion}>
                    <button
                      type="button"
                      className={styles.quitar}
                      onClick={() => edicion.onEliminar(l.id)}
                      aria-label="Quitar la nota"
                      title="Quitar del documento"
                    >
                      ×
                    </button>
                  </td>
                ) : null}
              </tr>
              )
            ) : (
              <tr key={l.id}>
                {/* Referencia arriba y foto abajo, en una sola celda. El hueco
                    de la foto existe en TODAS las filas: con imagen se usa, sin
                    imagen queda vacío, y así todas las filas miden lo mismo.
                    Vacío NO se dibuja: ocupa el lugar y no se ve. */}
                <td className={styles.celdaRef}>
                  {edicion?.onReferencia ? (
                    <input
                      className={styles.refEditable}
                      aria-label="Referencia"
                      value={l.sku ?? ''}
                      onChange={(e) => edicion.onReferencia?.(l.id, e.target.value)}
                    />
                  ) : (
                    <div className={styles.sku}>{l.sku ?? '—'}</div>
                  )}
                  {conFotos ? (
                    <div className={l.foto ? styles.marcoFoto : `${styles.marcoFoto} ${styles.marcoVacio}`}>
                      {l.foto ? <img src={l.foto} alt="" className={styles.foto} loading="lazy" /> : null}
                    </div>
                  ) : null}
                </td>
                <td>
                  {edicion?.onNombre ? (
                    <input
                      className={styles.nombreEditable}
                      aria-label="Nombre del producto"
                      value={l.nombre ?? ''}
                      onChange={(e) => edicion.onNombre?.(l.id, e.target.value)}
                    />
                  ) : (
                    <div className={styles.nombre}>{l.nombre ?? '—'}</div>
                  )}
                  {/* La caja de «texto comercial» sólo aparece cuando hace falta
                      (Fase 217): en una línea escrita a mano (sin atributos) o si
                      ya tiene un texto propio para modificar. Un producto del
                      catálogo YA trae su descripción —el concatenado de Marca,
                      Modelo, Tipo, Medida…— así que no se repite una caja vacía
                      al lado; esa descripción se ve abajo. */}
                  {edicion?.onDescripcion && (l.partes.length === 0 || (l.descripcion ?? '') !== '') ? (
                    <textarea
                      className={styles.descEditable}
                      aria-label="Descripción"
                      rows={1}
                      placeholder="Descripción / texto comercial"
                      value={l.descripcion ?? ''}
                      onChange={(e) => edicion.onDescripcion?.(l.id, e.target.value)}
                    />
                  ) : !edicion?.onDescripcion && mostrarDescripcion ? (
                    <DescripcionLinea linea={l} />
                  ) : null}
                  {/* Marca, Modelo… del producto se siguen viendo al editar: son
                      datos del producto, no se editan acá. */}
                  {edicion?.onDescripcion && l.partes.length > 0 ? (
                    <DescripcionLinea linea={{ ...l, descripcion: null }} />
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
                {verDescuento ? (
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
                  {edicion.onNuevoCapitulo ? (
                    <button type="button" className={styles.agregar} onClick={edicion.onNuevoCapitulo}>
                      + Nuevo capítulo
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

      {/* ── E2 · el cierre del Packing List (Fase 149) ──────────────── */}
      {/*
        La hoja de empaque no lleva totales: lleva cuántos bultos viajan y las
        dos firmas, la de quien preparó y la de quien recibe. Es lo que convierte
        el listado en un comprobante de entrega.
      */}
      {verFirmas ? (
        <section className={styles.packingCierre}>
          <div className={styles.packingBultos}>
            <span>Bultos: <span className={styles.lineaDato} /></span>
            <span>Peso total: <span className={styles.lineaDato} /></span>
          </div>
          <div className={styles.firmas}>
            <div className={styles.firma}>
              <span className={styles.lineaFirma} />
              Preparó
            </div>
            <div className={styles.firma}>
              <span className={styles.lineaFirma} />
              Recibió conforme
            </div>
          </div>
        </section>
      ) : null}

      {/* ── F · los totales, contra el margen de abajo ──────────────── */}
      {/*
        Acá al lado iban las OBSERVACIONES del documento, y se fueron en la
        Fase 84: «eso es algo privado». Son notas de trabajo —«generada al
        importar la orden de compra 4800027334», el motivo de un precio, con
        quién se habló— escritas para adentro, y la hoja va al cliente. Siguen
        en «Información del documento» y en la exportación, que es donde se
        las mira.

        El renglón que SÍ es para el cliente es el título del documento, que
        sale arriba debajo del tipo: ahí va lo que se le quiera decir.
      */}
      {ver.totales ? (
        <section className={styles.cierre}>
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
        </section>
      ) : null}

      {/* El pie libre de la plantilla (Fase 152), si lo tiene. */}
      {plantilla?.pie ? <p className={styles.textoPlantilla}>{plantilla.pie}</p> : null}

      {/* ── G · pie ─────────────────────────────────────────────────── */}
      {/*
        El pie llevaba la dirección web, que ya está arriba en el bloque de
        contacto de la empresa: era el mismo dato dos veces y un renglón con
        su raya que le sacaba 12 mm a los productos (Fase 84). Sin él, los
        totales quedan contra el margen de abajo.

        Queda sólo para los documentos migrados, donde la aclaración no es
        decoración: explica por qué el número no sigue la numeración de acá.
      */}
      {doc.esHistorico ? (
        <footer className={styles.pie}>
          <span className={styles.historico}>Documento migrado del sistema anterior</span>
        </footer>
      ) : null}
    </div>
  )
}

/**
 * Lo que va debajo del nombre del producto.
 *
 * Con datos del producto se arman las partes —Marca, Modelo, Origen, NCM y los
 * atributos que lo distinguen—, cada una en su propio `span` que no se parte:
 * «Encastre: 1/4 HEX» nunca queda con el valor en el renglón siguiente. Sin
 * datos cae en la descripción libre de la línea, que es lo que tienen las
 * líneas escritas a mano.
 *
 * El corte a tres renglones lo hace el CSS: acá no se recorta el texto, porque
 * cuántas partes entran depende del ancho, y el ancho lo sabe el navegador.
 */
function DescripcionLinea({ linea }: { linea: LineaImpresa }) {
  if (linea.partes.length > 0) {
    return (
      <div className={styles.desc}>
        {/* El espacio entre partes es un espacio DE VERDAD y no sólo un
            margen: cada parte no se parte al medio, y sin un espacio entre
            una y otra el navegador no tiene dónde cortar el renglón. Con
            margen solo, los siete datos quedaban en UNA línea que se iba de
            la celda —medido: 7 partes en 197 px y 16 px de alto—. */}
        {linea.partes.map((p) => (
          <Fragment key={p.etiqueta}>
            <span className={styles.parte}>
              <b>{p.etiqueta}:</b> {p.valor}
            </span>{' '}
          </Fragment>
        ))}
      </div>
    )
  }
  if (linea.descripcion && linea.descripcion !== linea.nombre) {
    return <div className={styles.desc}>{linea.descripcion}</div>
  }
  return null
}
