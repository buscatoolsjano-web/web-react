import { useId, useState } from 'react'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { dominioDeUrl, validarEdicion } from '../lib/edicionProducto'
import { atributosDeLaCategoria } from '../lib/nuevoProducto'
import type { EdicionProducto } from '../services/edicionProducto'
import type { DefinicionAtributo } from '../types'
import styles from './EditorProducto.module.css'

export interface EditorProductoProps {
  valores: EdicionProducto
  marcas: readonly { id: string; nombre: string }[]
  categorias: readonly { id: string; nombre: string }[]
  definiciones: readonly DefinicionAtributo[]
  /** Qué atributos declara cada categoría, para mostrar los que corresponden. */
  atributosPorCategoria: ReadonlyMap<string, ReadonlySet<string>> | undefined
  guardando: boolean
  error: string | null
  onCambiar: (valores: EdicionProducto) => void
  onGuardar: () => void
  onCancelar: () => void
}

/**
 * Editar un producto desde su ficha (Fase 40).
 *
 * Hasta ahora un producto sólo se podía crear: una vez cargado, corregirle el
 * modelo o completarle un atributo exigía entrar a la base.
 *
 * Tres bloques, y el orden es el de la confianza: primero lo que el cliente
 * ve —nombre, descripción, características—, después lo que es sólo nuestro
 * —la observación privada y de dónde lo compramos—. Esos dos últimos están
 * marcados como internos en la pantalla y además viven en tablas que un
 * externo no puede leer: el cartel es un recordatorio, no la defensa.
 *
 * Los atributos que se muestran son los que declara la categoría elegida. Los
 * que el producto tenga y su categoría no declare viajan igual al guardar, sin
 * mostrarse: dejar de mandarlos los borraría en silencio.
 */
export function EditorProducto({
  valores,
  marcas,
  categorias,
  definiciones,
  atributosPorCategoria,
  guardando,
  error,
  onCambiar,
  onGuardar,
  onCancelar,
}: EditorProductoProps) {
  const id = useId()
  const [mostrarErrores, setMostrarErrores] = useState(false)
  const errores = validarEdicion(valores)

  const set = <K extends keyof EdicionProducto>(campo: K, valor: EdicionProducto[K]) =>
    onCambiar({ ...valores, [campo]: valor })

  const delCategoria = atributosDeLaCategoria(definiciones, valores.categoriaId, atributosPorCategoria)

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    setMostrarErrores(true)
    if (errores.length > 0) return
    onGuardar()
  }

  const campo = (
    etiqueta: string,
    clave: 'nombre' | 'modelo' | 'tipo' | 'serie' | 'origen' | 'ncm' | 'pesoG' | 'volumenCm3',
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <Field label={etiqueta} id={`${id}-${clave}`}>
      <Input value={valores[clave]} onChange={(e) => set(clave, e.target.value)} {...extra} />
    </Field>
  )

  return (
    <form className={styles.form} onSubmit={enviar}>
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

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Datos del producto</legend>
        <div className={styles.grilla}>
          {campo('Nombre', 'nombre', { required: true })}
          {campo('Modelo', 'modelo')}

          <Field label="Marca" id={`${id}-marca`}>
            <Select value={valores.marcaId} onChange={(e) => set('marcaId', e.target.value)}>
              <option value="">Sin marca</option>
              {marcas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Categoría"
            required
            id={`${id}-categoria`}
            help="Decide qué características se piden abajo."
          >
            <Select value={valores.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
              <option value="">Elegí una categoría…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Select>
          </Field>

          {campo('Tipo', 'tipo')}
          {campo('Serie', 'serie')}
          {campo('Origen', 'origen')}
          {campo('NCM', 'ncm')}
          {campo('Peso (g)', 'pesoG', { type: 'number', min: '0', step: '1' })}
          {campo('Volumen (cm³)', 'volumenCm3', { type: 'number', min: '0', step: '1' })}

          <Field label="Código de barras" id={`${id}-barras`}>
            <Input value={valores.codigoBarras} onChange={(e) => set('codigoBarras', e.target.value)} />
          </Field>
        </div>

        <Field label="Descripción" id={`${id}-desc`} help="Una línea: es la que se ve en el listado y en los documentos.">
          <Input value={valores.descripcion} onChange={(e) => set('descripcion', e.target.value)} />
        </Field>

        <Field label="Descripción larga" id={`${id}-desclarga`}>
          <Textarea rows={3} value={valores.descripcionLarga} onChange={(e) => set('descripcionLarga', e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Características</legend>
        {valores.categoriaId === '' ? (
          <p className={styles.nota}>Elegí una categoría para ver sus características.</p>
        ) : delCategoria.length === 0 ? (
          <p className={styles.nota}>Esta categoría todavía no tiene características definidas.</p>
        ) : (
          <div className={styles.grilla}>
            {delCategoria.map((d) => (
              <Field
                key={d.key}
                label={d.unidad ? `${d.label} (${d.unidad})` : d.label}
                id={`${id}-at-${d.key}`}
              >
                <Input
                  value={valores.atributos[d.key] ?? ''}
                  onChange={(e) => set('atributos', { ...valores.atributos, [d.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        )}
      </fieldset>

      {/* ── lo que el cliente no ve ─────────────────────────────────────── */}
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>
          Interno <span className={styles.marcaInterna}>no sale en documentos</span>
        </legend>
        <p className={styles.nota}>
          Esto queda sólo para la gente de la empresa. No se imprime, no se exporta y un cliente no
          puede leerlo.
        </p>

        <Field label="Observaciones privadas" id={`${id}-notas`}>
          <Textarea
            rows={3}
            value={valores.notasPrivadas}
            placeholder="Lo que convenga recordar: con quién conviene pedirlo, qué suele fallar, qué equivale…"
            onChange={(e) => set('notasPrivadas', e.target.value)}
          />
        </Field>

        <div className={styles.links}>
          <span className={styles.subtitulo}>Dónde lo compramos</span>
          {valores.links.length === 0 ? (
            <p className={styles.nota}>Sin links cargados.</p>
          ) : (
            <ul className={styles.listaLinks}>
              {valores.links.map((l, i) => (
                <li key={i} className={styles.link}>
                  <Field label="Dónde" hideLabel>
                    <Input
                      value={l.label}
                      placeholder={l.url ? dominioDeUrl(l.url) : 'Proveedor o sitio'}
                      aria-label={`Dónde se compra, link ${i + 1}`}
                      onChange={(e) => {
                        const links = [...valores.links]
                        links[i] = { ...links[i]!, label: e.target.value }
                        set('links', links)
                      }}
                    />
                  </Field>
                  <Field label="Link" hideLabel>
                    <Input
                      type="url"
                      value={l.url}
                      placeholder="https://…"
                      aria-label={`Link ${i + 1}`}
                      onChange={(e) => {
                        const links = [...valores.links]
                        links[i] = { ...links[i]!, url: e.target.value }
                        set('links', links)
                      }}
                    />
                  </Field>
                  <Field label="Nota" hideLabel>
                    <Input
                      value={l.notas}
                      placeholder="Precio, fecha, lo que sirva"
                      aria-label={`Nota del link ${i + 1}`}
                      onChange={(e) => {
                        const links = [...valores.links]
                        links[i] = { ...links[i]!, notas: e.target.value }
                        set('links', links)
                      }}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="trash" size={16} />}
                    aria-label={`Quitar el link ${i + 1}`}
                    onClick={() => set('links', valores.links.filter((_, j) => j !== i))}
                  />
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="plus" size={16} />}
            onClick={() => set('links', [...valores.links, { label: '', url: '', notas: '' }])}
          >
            Agregar link
          </Button>
        </div>
      </fieldset>

      <div className={styles.acciones}>
        <Button type="submit" loading={guardando} disabled={guardando}>
          Guardar cambios
        </Button>
        <Button variant="secondary" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
