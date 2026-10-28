import { useState, type DragEvent } from 'react'
import { Icon } from '@/components/icons/Icon'
import { IconButton } from '@/components/ui/IconButton'
import { cx } from '@/utils/cx'
import type { UltimoPrecio } from '@/modules/clientes/types'
import type { ProductoListado } from '@/modules/catalogo/types'
import { formatearCantidad, formatearImporte } from '../lib/formato'
import { TRATAMIENTOS } from '../lib/tratamientos'
import { netoDeLinea } from '../lib/totales'
import { avisoDePrecio } from '../lib/ultimoPrecio'
import type { LineaDocumento, TipoDocumento } from '../types'
import { BuscadorProductoLinea } from './BuscadorProductoLinea'
import type { PrecioPropuesto } from './ModalCatalogoProductos'
import styles from './TablaLineas.module.css'

/** Los campos editables de una línea, con el nombre que espera el borrador. */
export type CampoLinea =
  | 'sku_snapshot'
  | 'name_snapshot'
  | 'description_snapshot'
  | 'quantity'
  | 'unit_price'
  | 'discount_pct'
  | 'tax_treatment'
  | 'tax_rate_snapshot'

/**
 * Lo que convierte la MISMA tabla en editable (Fase 155).
 *
 * Cuando viene, cada celda que se puede cambiar pasa a ser un input; el resto
 * —el número de línea, el subtotal— sigue siendo texto. Es el mismo truco que
 * `VistaImpresion`: una sola maqueta para ver y para editar, así nunca se rompe
 * el formato al apretar «Editar».
 */
export interface EdicionLineas {
  onCambiar: (lineaId: string, campo: CampoLinea, valor: string | number | null) => void
  onEliminar: (lineaId: string) => void
  onMover: (lineaId: string, direccion: -1 | 1) => void
  /**
   * Reordenar arrastrando (Fase 214): soltar una línea en otra posición. Si
   * viene, en vez de las flechitas de subir/bajar se muestra un tirador de seis
   * puntos que se agarra y se mueve.
   */
  onReordenar?: ((lineaId: string, destino: number) => void) | undefined
  /** El último precio de este cliente por producto, para el aviso en naranja. */
  historicos?: Map<string, UltimoPrecio> | undefined
  /**
   * Autocompletar el nombre con productos del catálogo (Fase 163).
   *
   * Cuando viene, el nombre de una línea LIBRE (sin producto) busca mientras se
   * escribe y, al elegir uno de la lista, rellena esa misma línea. Sin esto, el
   * nombre es un campo de texto común, como siempre.
   */
  catalogo?:
    | {
        listaPrecioId: string | null
        onElegirProducto: (lineaId: string, producto: ProductoListado, precio: PrecioPropuesto) => void
      }
    | undefined
}

export interface TablaLineasProps {
  lineas: readonly LineaDocumento[]
  moneda: string | null
  tipo: TipoDocumento
  /** Si viene, la tabla se edita in situ sin cambiar su forma. */
  edicion?: EdicionLineas | null
}

/** Una sola instancia: un `new Map()` por render rompería las memos. */
const SIN_HISTORICO: Map<string, UltimoPrecio> = new Map()

function aNumero(v: string): number {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Subtotal de una línea, sólo si hay precio. Sin precio no se inventa un 0. */
function subtotal(l: LineaDocumento): number | null {
  if (l.precioUnitario === null) return null
  const bruto = l.precioUnitario * l.cantidad
  const dto = l.descuentoPct ?? 0
  return bruto * (1 - dto / 100)
}

/**
 * Cómo se muestra el impuesto de la línea.
 *
 * Se prefiere la etiqueta del tratamiento («IVA 21 %») y no la alícuota suelta:
 * «Exento» y «No gravado» son los dos 0 % y no significan lo mismo.
 */
function impuesto(l: LineaDocumento): string {
  const t = TRATAMIENTOS.find((x) => x.valor === l.tratamientoImpuesto)
  if (t && t.tasa !== null) return t.etiqueta
  if (l.tasaImpuesto !== null) return `${formatearCantidad(l.tasaImpuesto)} %`
  return t?.etiqueta ?? '—'
}

export function TablaLineas({ lineas, moneda, tipo, edicion = null }: TablaLineasProps) {
  const editando = edicion !== null
  const historicos = edicion?.historicos ?? SIN_HISTORICO
  // Qué descripciones inline están ampliadas: por defecto van cortadas a pocas
  // líneas y se abren al tocarlas (Fase 186). Es sólo la vista en pantalla; la
  // hoja/PDF usa su propio recorte.
  const [descAmpliadas, setDescAmpliadas] = useState<ReadonlySet<string>>(() => new Set<string>())
  const alternarDesc = (id: string) =>
    setDescAmpliadas((previas) => {
      const siguiente = new Set(previas)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })

  // Qué línea se está arrastrando (Fase 214). La fila donde se suelta es el
  // destino. Se guarda la clave, no el índice, porque el índice cambia al mover.
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const permitirSoltar = (e: DragEvent) => {
    if (arrastrando !== null) e.preventDefault()
  }
  const soltarEn = (destino: number) => (e: DragEvent) => {
    e.preventDefault()
    if (arrastrando !== null && edicion?.onReordenar) edicion.onReordenar(arrastrando, destino)
    setArrastrando(null)
  }

  if (lineas.length === 0) {
    return (
      <p className={styles.vacio}>
        {editando ? 'Todavía no hay líneas.' : 'Este documento no tiene líneas.'}
      </p>
    )
  }

  // Editando SIEMPRE hay columnas de precio: se está armando el documento. En
  // lectura, las 600 entregas históricas sin precio ocultan esas columnas.
  const hayPrecios = editando || lineas.some((l) => l.precioUnitario !== null)
  // Columnas de datos (sin la de acciones): #, ref, producto, desc, cant + 4 de
  // precio. El `colSpan` del capítulo las cubre.
  const columnas = 5 + (hayPrecios ? 4 : 0)

  return (
    <>
      <div className={styles.scroll}>
        <table className={styles.tabla}>
          <caption className="sr-only">Líneas del documento</caption>
          {/* Anchos coherentes y compactos para las columnas de números (Fase
              190): un descuento o una cantidad no necesitan el ancho que se
              llevaban. Lo que sobra va a Producto y Descripción, que es donde
              se lee. */}
          <colgroup>
            <col className={styles.colNum} />
            <col className={styles.colRef} />
            <col className={styles.colProducto} />
            <col className={styles.colDesc} />
            <col className={styles.colCant} />
            {hayPrecios ? (
              <>
                <col className={styles.colPrecio} />
                <col className={styles.colDto} />
                <col className={styles.colImp} />
                <col className={styles.colSub} />
              </>
            ) : null}
            {editando ? <col className={styles.colAcc} /> : null}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={styles.num}>
                #
              </th>
              <th scope="col">Referencia</th>
              <th scope="col">Producto</th>
              <th scope="col" className={styles.colDescripcion}>
                Descripción
              </th>
              <th scope="col" className={styles.derecha}>
                Cant.
              </th>
              {hayPrecios ? (
                <>
                  <th scope="col" className={styles.derecha}>
                    Precio
                  </th>
                  <th scope="col" className={styles.derecha}>
                    % Dto.
                  </th>
                  <th scope="col" className={styles.derecha}>
                    Impuesto
                  </th>
                  <th scope="col" className={styles.derecha}>
                    Subtotal
                  </th>
                </>
              ) : null}
              {editando ? (
                <th scope="col" className={styles.colAccion}>
                  <span className="sr-only">Acciones</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const acciones = editando ? (
                <td className={styles.celdaAccion}>
                  {edicion.onReordenar ? (
                    // Un solo botón que se agarra y se arrastra (Fase 214), en vez
                    // de las dos flechitas: se gana lugar a la derecha.
                    <button
                      type="button"
                      className={styles.tirador}
                      draggable
                      aria-label="Arrastrar para reordenar la línea"
                      title="Arrastrá para mover la línea"
                      onDragStart={(e) => {
                        setArrastrando(l.id)
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => setArrastrando(null)}
                    >
                      <span className={styles.grip} aria-hidden="true">
                        <svg viewBox="0 0 10 16" width="10" height="16">
                          <circle cx="3" cy="4" r="1.3" />
                          <circle cx="7" cy="4" r="1.3" />
                          <circle cx="3" cy="8" r="1.3" />
                          <circle cx="7" cy="8" r="1.3" />
                          <circle cx="3" cy="12" r="1.3" />
                          <circle cx="7" cy="12" r="1.3" />
                        </svg>
                      </span>
                    </button>
                  ) : (
                    <>
                      <IconButton icon="arrow-up" aria-label="Subir" size="sm" onClick={() => edicion.onMover(l.id, -1)} disabled={i === 0} />
                      <IconButton icon="arrow-down" aria-label="Bajar" size="sm" onClick={() => edicion.onMover(l.id, 1)} disabled={i === lineas.length - 1} />
                    </>
                  )}
                  <IconButton icon="trash" aria-label="Eliminar línea" size="sm" variant="danger" onClick={() => edicion.onEliminar(l.id)} />
                </td>
              ) : null

              // Un capítulo es un título dentro del documento: ocupa toda la fila.
              if (l.tipoLinea === 'chapter') {
                return (
                  <tr
                    key={l.id}
                    className={cx(styles.capitulo, arrastrando === l.id && styles.arrastrando)}
                    onDragOver={editando ? permitirSoltar : undefined}
                    onDrop={editando ? soltarEn(i) : undefined}
                  >
                    <td colSpan={columnas}>
                      {editando ? (
                        // Como el título del STEL: un área que se agarra del
                        // tirador y se estira para leer el texto entero cuando
                        // es largo, en vez de cortarse en un renglón (Fase 200).
                        <textarea
                          className={styles.notaArea}
                          rows={1}
                          value={l.nombre ?? ''}
                          placeholder="Escribí una nota: dónde se entrega, una aclaración…"
                          aria-label="Nota del documento"
                          onChange={(e) => edicion.onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                        />
                      ) : (
                        (l.nombre ?? l.descripcion ?? '—')
                      )}
                    </td>
                    {acciones}
                  </tr>
                )
              }

              const aviso =
                editando && l.productId ? avisoDePrecio(historicos.get(l.productId), l.precioUnitario ?? 0) : null

              return (
                <tr
                  key={l.id}
                  className={cx(arrastrando === l.id && styles.arrastrando)}
                  onDragOver={editando ? permitirSoltar : undefined}
                  onDrop={editando ? soltarEn(i) : undefined}
                >
                  <td className={styles.num} data-label="#">
                    {l.numeroLinea ?? i + 1}
                  </td>
                  <td className={styles.sku} data-label="Referencia">
                    {/* La REFERENCIA no se edita desde ventas (Fase 200): es
                        nuestro identificador del producto y cambiarlo acá
                        rompería el vínculo. Se muestra como texto, mirando o
                        editando. La toma del catálogo al elegir el producto. */}
                    {l.sku ?? '—'}
                    {l.sku && l.productId === null ? (
                      <span
                        className={styles.sinProducto}
                        title="El SKU quedó guardado, pero el producto no está en el catálogo actual"
                      >
                        <Icon name="alert-triangle" size={16} />
                        <span className="sr-only">Producto fuera del catálogo actual</span>
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.celdaNombre} data-label="Producto">
                    {editando ? (
                      edicion.catalogo && l.productId === null ? (
                        // Línea libre + catálogo disponible: el nombre busca
                        // productos y, al elegir uno, rellena esta misma línea.
                        <BuscadorProductoLinea
                          valor={l.nombre}
                          listaPrecioId={edicion.catalogo.listaPrecioId}
                          moneda={moneda}
                          historicos={historicos}
                          claseInput={styles.inputTexto}
                          onTexto={(t) => edicion.onCambiar(l.id, 'name_snapshot', t || null)}
                          onElegir={(p, precio) => edicion.catalogo!.onElegirProducto(l.id, p, precio)}
                        />
                      ) : (
                        // Como la descripción (Fase 190): arranca en un renglón y
                        // se arrastra para abajo para ver el nombre entero cuando
                        // es largo, en vez de que se corte en una línea.
                        <textarea
                          className={styles.descripcionArea}
                          rows={1}
                          value={l.nombre ?? ''}
                          placeholder="Nombre del producto"
                          aria-label="Producto"
                          onChange={(e) => edicion.onCambiar(l.id, 'name_snapshot', e.target.value || null)}
                        />
                      )
                    ) : (
                      <>
                        <span className={styles.nombre}>{l.nombre ?? '—'}</span>
                        {l.descripcion && l.descripcion !== l.nombre ? (
                          <button
                            type="button"
                            className={cx(styles.descripcionInline, descAmpliadas.has(l.id) && styles.descAmpliada)}
                            onClick={() => alternarDesc(l.id)}
                            aria-expanded={descAmpliadas.has(l.id)}
                            title={descAmpliadas.has(l.id) ? 'Contraer descripción' : 'Ampliar descripción'}
                          >
                            {l.descripcion}
                          </button>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className={styles.colDescripcion} data-label="Descripción">
                    {/* Como el STEL (Fase 165): la descripción es una caja chica,
                        colapsada a un renglón, con el tirador abajo a la derecha
                        para deslizarla y abrirla. Igual al editar que al ver —al
                        ver es de sólo lectura, pero se arrastra para leerla—. */}
                    {editando ? (
                      <textarea
                        className={styles.descripcionArea}
                        rows={1}
                        value={l.descripcion ?? ''}
                        placeholder="Texto comercial"
                        aria-label="Descripción de la línea"
                        onChange={(e) => edicion.onCambiar(l.id, 'description_snapshot', e.target.value || null)}
                      />
                    ) : l.descripcion && l.descripcion !== l.nombre ? (
                      <textarea
                        className={styles.descripcionArea}
                        rows={1}
                        value={l.descripcion}
                        readOnly
                        aria-label="Descripción de la línea"
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${styles.derecha} ${styles.cantidad}`} data-label="Cant.">
                    {editando ? (
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        className={styles.inputNum}
                        value={l.cantidad}
                        aria-label="Cantidad"
                        onChange={(e) => edicion.onCambiar(l.id, 'quantity', aNumero(e.target.value))}
                      />
                    ) : (
                      formatearCantidad(l.cantidad)
                    )}
                  </td>
                  {hayPrecios ? (
                    <>
                      <td className={`${styles.derecha} ${styles.precio}`} data-label="Precio">
                        {editando ? (
                          <>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              inputMode="decimal"
                              className={styles.inputNum}
                              value={l.precioUnitario ?? 0}
                              aria-label="Precio unitario"
                              onChange={(e) => edicion.onCambiar(l.id, 'unit_price', aNumero(e.target.value))}
                            />
                            {aviso ? (
                              <p
                                role="status"
                                className={aviso.tono === 'historico' ? styles.avisoHistorico : styles.avisoIgual}
                              >
                                {aviso.texto}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          formatearImporte(l.precioUnitario, moneda)
                        )}
                      </td>
                      <td className={`${styles.derecha} ${styles.dto}`} data-label="% Dto.">
                        {editando ? (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            max="100"
                            inputMode="decimal"
                            className={styles.inputNum}
                            value={l.descuentoPct ?? 0}
                            aria-label="Descuento"
                            onChange={(e) => edicion.onCambiar(l.id, 'discount_pct', aNumero(e.target.value))}
                          />
                        ) : l.descuentoPct === null || l.descuentoPct === 0 ? (
                          '—'
                        ) : (
                          `${formatearCantidad(l.descuentoPct)} %`
                        )}
                      </td>
                      <td className={`${styles.derecha} ${styles.impuestoCelda}`} data-label="Impuesto">
                        {editando ? (
                          <>
                            <select
                              className={styles.inputSelect}
                              value={l.tratamientoImpuesto ?? 'vat_21'}
                              aria-label="Tratamiento de impuesto"
                              onChange={(e) => edicion.onCambiar(l.id, 'tax_treatment', e.target.value)}
                            >
                              {TRATAMIENTOS.map((t) => (
                                <option key={t.valor} value={t.valor}>
                                  {t.etiqueta}
                                </option>
                              ))}
                            </select>
                            {l.tratamientoImpuesto === 'other' ? (
                              <input
                                type="number"
                                step="any"
                                min="0"
                                max="100"
                                inputMode="decimal"
                                className={styles.inputNum}
                                value={l.tasaImpuesto ?? 0}
                                aria-label="Alícuota"
                                onChange={(e) => edicion.onCambiar(l.id, 'tax_rate_snapshot', aNumero(e.target.value))}
                              />
                            ) : null}
                          </>
                        ) : (
                          impuesto(l)
                        )}
                      </td>
                      <td className={`${styles.derecha} ${styles.subtotal}`} data-label="Subtotal">
                        {editando ? formatearImporte(netoDeLinea(l), moneda) : formatearImporte(subtotal(l), moneda)}
                      </td>
                    </>
                  ) : null}
                  {acciones}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!hayPrecios && tipo === 'entrega' ? (
        <p className={styles.nota}>
          Esta entrega no tiene precios por línea: el sistema anterior sólo guardaba el importe en
          la cabecera del remito. <strong>No se reparte el total entre las líneas</strong> — sería
          inventar el dato.
        </p>
      ) : null}
    </>
  )
}
