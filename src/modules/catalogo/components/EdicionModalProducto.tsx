import { useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { validarEdicion } from '../lib/edicionProducto'
import { atributosDeLaCategoria } from '../lib/nuevoProducto'
import { formatearPrecio } from '../lib/formato'
import type { EdicionProducto } from '../services/edicionProducto'
import type { DefinicionAtributo, ProductoDetalle } from '../types'
import { FotosProducto } from './FotosProducto'
import { ImagenProducto } from './ImagenProducto'
import modal from './ModalProducto.module.css'
import lista from './ListaAtributos.module.css'
import styles from './EdicionModalProducto.module.css'

/**
 * Editar el producto con el MISMO formato del modal (Fase 247).
 *
 * «Cuando pongo Editar quiero que tenga el mismo formato, sólo que sean
 * editables.» Antes «Editar» cambiaba la ficha por el formulario largo de la
 * página: otro orden, otros rótulos, y había que volver a encontrar cada dato.
 * Acá cada dato queda DONDE estaba —el nombre como título, la marca y la
 * categoría en la ficha, las características en sus dos columnas, los datos
 * físicos abajo— y se edita en el lugar.
 *
 * Es el mismo `EdicionProducto`, la misma validación y el mismo guardado que
 * el editor de la página: cambia la forma, no lo que se guarda. Lo que no se
 * edita acá (precio, stock) se ve igual que siempre, atenuado.
 */
export interface EdicionModalProductoProps {
  producto: ProductoDetalle
  valores: EdicionProducto
  companyId: string
  moneda: string | null
  esInterno: boolean
  marcas: readonly { id: string; nombre: string }[]
  categorias: readonly { id: string; nombre: string }[]
  definiciones: readonly DefinicionAtributo[]
  atributosPorCategoria: ReadonlyMap<string, ReadonlySet<string>> | undefined
  mostrarErrores: boolean
  error: string | null
  onCambiar: (valores: EdicionProducto) => void
}

export function EdicionModalProducto({
  producto,
  valores,
  companyId,
  moneda,
  esInterno,
  marcas,
  categorias,
  definiciones,
  atributosPorCategoria,
  mostrarErrores,
  error,
  onCambiar,
}: EdicionModalProductoProps) {
  const [verFotos, setVerFotos] = useState(false)
  const errores = validarEdicion(valores)
  const set = <K extends keyof EdicionProducto>(campo: K, valor: EdicionProducto[K]) =>
    onCambiar({ ...valores, [campo]: valor })
  /*
   * Las características que se editan: las que declara la categoría MÁS las
   * que el producto ya tiene cargadas. Con sólo las de la categoría, un
   * producto de «Puntas y tubos» —que no declara ninguna— mostraba Encastre,
   * Largo y Medida en la vista y nada al editar.
   */
  const declaradas = atributosDeLaCategoria(definiciones, valores.categoriaId, atributosPorCategoria)
  // Las mismas que muestra la vista: las marcadas `enFicha === false` (la hoja
  // del catálogo, por ejemplo) no se pintan ahí y tampoco acá. Viajan igual.
  const conValor = definiciones.filter(
    (d) => d.enFicha !== false && (valores.atributos[d.key] ?? '').trim() !== '',
  )
  const delCategoria = [...new Map([...declaradas, ...conValor].map((d) => [d.key, d])).values()].sort(
    (a, b) => a.posicion - b.posicion,
  )

  const texto = (
    etiqueta: string,
    clave: 'tipo' | 'serie' | 'modelo' | 'ncm' | 'origen' | 'pesoG' | 'volumenCm3' | 'codigoBarras',
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className={modal.dato}>
      <dt>{etiqueta}</dt>
      <dd>
        <input
          className={styles.campo}
          aria-label={etiqueta}
          value={valores[clave]}
          onChange={(e) => set(clave, e.target.value)}
          {...extra}
        />
      </dd>
    </div>
  )

  return (
    <div className={styles.editando}>
      {mostrarErrores && errores.length > 0 ? (
        <Alert tone="danger" role="alert" title="Falta corregir algo">
          <ul className={styles.errores}>
            {errores.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{error}</p>
        </Alert>
      ) : null}

      {/* ── 1 · identidad ─────────────────────────────────────────────── */}
      <section className={modal.identidad}>
        <div className={styles.columnaFoto}>
          <div className={modal.foto}>
            <ImagenProducto imagen={producto.imagen} alt={producto.nombre} tamano="full" />
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="image" size={16} />}
            aria-expanded={verFotos}
            onClick={() => setVerFotos(!verFotos)}
          >
            {verFotos ? 'Ocultar fotos' : 'Cambiar fotos'}
          </Button>
        </div>
        <div className={modal.datos}>
          <input
            className={`${styles.campo} ${styles.nombre}`}
            aria-label="Nombre"
            value={valores.nombre}
            placeholder="Nombre del producto"
            onChange={(e) => set('nombre', e.target.value)}
          />
          <input
            className={`${styles.campo} ${styles.descripcion}`}
            aria-label="Descripción"
            value={valores.descripcion}
            placeholder="Descripción corta: la que va en el listado y en los documentos"
            onChange={(e) => set('descripcion', e.target.value)}
          />

          <dl className={modal.ficha}>
            <div className={modal.dato}>
              <dt>Marca</dt>
              <dd>
                <select
                  className={styles.campo}
                  aria-label="Marca"
                  value={valores.marcaId}
                  onChange={(e) => set('marcaId', e.target.value)}
                >
                  <option value="">Sin marca</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div className={modal.dato}>
              <dt>Categoría</dt>
              <dd>
                <select
                  className={styles.campo}
                  aria-label="Categoría"
                  value={valores.categoriaId}
                  onChange={(e) => set('categoriaId', e.target.value)}
                >
                  <option value="">Elegí una…</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            {texto('Tipo', 'tipo')}
            {texto('Serie', 'serie')}
            {texto('Modelo', 'modelo')}
          </dl>

          {/* ── 2 · comercial: se ve, no se edita acá ────────────────────── */}
          <div
            className={`${modal.comercial} ${styles.soloLectura}`}
            title="El precio y el stock no se editan desde acá"
          >
            <div className={modal.precio}>
              <span className={modal.rotulo}>Precio</span>
              <strong className={modal.precioValor}>
                {formatearPrecio(producto.precio, moneda)}
              </strong>
            </div>
            {esInterno && producto.stock ? (
              <>
                <div className={modal.stockDato}>
                  <span className={modal.rotulo}>Stock real</span>
                  <strong>{producto.stock.real}</strong>
                </div>
                <div className={modal.stockDato}>
                  <span className={modal.rotulo}>Stock virtual</span>
                  <strong>{producto.stock.virtual}</strong>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {verFotos ? <FotosProducto companyId={companyId} productId={producto.id} /> : null}

      {/* ── 3 · características ─────────────────────────────────────────── */}
      <section className={modal.seccion}>
        <h3 className={modal.tituloSeccion}>Características</h3>
        {valores.categoriaId === '' ? (
          <p className={styles.nota}>Elegí una categoría para ver sus características.</p>
        ) : delCategoria.length === 0 ? (
          <p className={styles.nota}>Esta categoría todavía no tiene características definidas.</p>
        ) : (
          <dl className={lista.lista}>
            {delCategoria.map((d) => (
              <div key={d.key} className={lista.item}>
                <dt className={lista.etiqueta}>
                  {d.unidad ? `${d.label} (${d.unidad})` : d.label}
                </dt>
                <dd className={lista.valor}>
                  <input
                    className={`${styles.campo} ${styles.valorAtributo}`}
                    aria-label={d.label}
                    value={valores.atributos[d.key] ?? ''}
                    onChange={(e) =>
                      set('atributos', { ...valores.atributos, [d.key]: e.target.value })
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ── 4 · físicos y aduana ────────────────────────────────────────── */}
      <section className={modal.seccion}>
        <h3 className={modal.tituloSeccion}>Datos físicos y aduana</h3>
        <dl className={modal.ficha}>
          {texto('NCM', 'ncm')}
          {texto('Peso (g)', 'pesoG', {
            type: 'number',
            min: '0',
            step: '1',
            inputMode: 'numeric',
          })}
          {texto('Volumen (cm³)', 'volumenCm3', {
            type: 'number',
            min: '0',
            step: '1',
            inputMode: 'numeric',
          })}
          {texto('Origen', 'origen')}
        </dl>
      </section>

      {/* ── 5 · descripción larga ───────────────────────────────────────── */}
      <section className={modal.seccion}>
        <h3 className={modal.tituloSeccion}>Descripción larga</h3>
        <textarea
          className={`${styles.campo} ${styles.area}`}
          aria-label="Descripción larga"
          rows={3}
          value={valores.descripcionLarga}
          placeholder="El texto largo de la ficha y de la web"
          onChange={(e) => set('descripcionLarga', e.target.value)}
        />
      </section>

      {/* ── 6 · interno ─────────────────────────────────────────────────── */}
      {esInterno ? (
        <section className={modal.seccion}>
          <h3 className={modal.tituloSeccion}>Observaciones privadas</h3>
          <textarea
            className={`${styles.campo} ${styles.area}`}
            aria-label="Observaciones privadas"
            rows={2}
            value={valores.notasPrivadas}
            placeholder="Sólo para la gente de la empresa: no se imprime ni se exporta"
            onChange={(e) => set('notasPrivadas', e.target.value)}
          />
        </section>
      ) : null}
    </div>
  )
}
