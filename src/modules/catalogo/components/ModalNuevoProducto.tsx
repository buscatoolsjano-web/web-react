import { useMemo, useState } from 'react'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select, Textarea } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  useAtributosPorCategoria,
  useCategorias,
  useDefinicionesDeAtributos,
  useMarcas,
} from '../hooks/useCatalogoFacetas'
import { useCrearProducto } from '../hooks/useCrearProducto'
import {
  atributosDeLaCategoria,
  CAMPOS_QUE_NO_ESTAN,
  ESTADOS_PRODUCTO,
  filaDesdeFormulario,
  FORMULARIO_VACIO,
  gramosDesdeKg,
  hayErrores,
  skuSugerido,
  validarNuevoProducto,
  type EstadoProducto,
  type FormularioNuevoProducto,
} from '../lib/nuevoProducto'
import styles from './ModalNuevoProducto.module.css'

export interface ModalNuevoProductoProps {
  onCerrar: () => void
  /** Al crearlo se abre el producto, para ver que quedó como se quería. */
  onCreado: (id: string) => void
}

/**
 * Alta de producto (Fase 26 · E3).
 *
 * Réplica del «Nuevo producto» del legacy (`app.js:14085`): las mismas
 * secciones, en el mismo orden, con los mismos campos **de los que la base
 * puede guardar**. Los que no, se listan abajo con el motivo en vez de
 * ofrecerse y perderse en silencio — que es lo que pasaría si la pantalla
 * pidiera un precio que `product_prices` no acepta escribir.
 *
 * Tres diferencias con el legacy, y ninguna es una elección de pantalla:
 *
 *  · **La categoría es obligatoria** (`products.category_id` es NOT NULL).
 *  · **El estado tiene tres opciones y no cuatro**: la base acepta `active`,
 *    `draft` y `discontinued`; el «inactivo» del legacy no existe.
 *  · **El peso se pide en gramos**, que es la unidad de la columna. Hay un
 *    botón para convertir desde kilos, que es como lo pide el legacy.
 */
export function ModalNuevoProducto({ onCerrar, onCreado }: ModalNuevoProductoProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null

  const marcas = useMarcas(companyId)
  const categorias = useCategorias(companyId)
  const definiciones = useDefinicionesDeAtributos(companyId)
  const porCategoria = useAtributosPorCategoria(companyId)
  const crear = useCrearProducto()

  const [f, setF] = useState<FormularioNuevoProducto>(FORMULARIO_VACIO)
  const [mostrarErrores, setMostrarErrores] = useState(false)
  const [kilos, setKilos] = useState('')

  const errores = validarNuevoProducto(f)
  const invalido = hayErrores(errores)
  const ver = (campo: keyof typeof errores) => (mostrarErrores ? errores[campo] : undefined)

  const cambiar = <K extends keyof FormularioNuevoProducto>(campo: K, valor: FormularioNuevoProducto[K]) =>
    setF((x) => ({ ...x, [campo]: valor }))

  const atributos = useMemo(
    () => atributosDeLaCategoria(definiciones.data ?? [], f.categoriaId, porCategoria.data),
    [definiciones.data, f.categoriaId, porCategoria.data],
  )

  const nombreDeMarca = (marcas.data ?? []).find((m) => m.id === f.marcaId)?.nombre ?? null

  const guardar = () => {
    setMostrarErrores(true)
    if (invalido) return
    crear.mutate(
      { fila: filaDesdeFormulario(f), imagenUrl: f.imagenUrl.trim() || null },
      {
        onSuccess: (r) => {
          setF(FORMULARIO_VACIO)
          setKilos('')
          setMostrarErrores(false)
          onCreado(r.id)
        },
      },
    )
  }

  const cerrar = () => {
    if (crear.isPending) return
    crear.reset()
    onCerrar()
  }

  return (
    <Dialog
      // El componente se monta sólo cuando se abre: así no paga las cuatro
      // consultas de marcas, categorías y atributos en cada visita al catálogo.
      open
      onClose={cerrar}
      title="Nuevo producto"
      size="lg"
      busy={crear.isPending}
      // Es un formulario con datos escritos: un click al fondo no lo tira.
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={crear.isPending}>
            Cancelar
          </Button>
          <Button icon={<Icon name="check" size={16} />} onClick={guardar} loading={crear.isPending}>
            {crear.isPending ? 'Creando…' : 'Crear producto'}
          </Button>
        </>
      }
    >
      {crear.error ? (
        <Alert tone="danger" role="alert" title="No se pudo crear el producto">
          <p>{crear.error.message}</p>
        </Alert>
      ) : null}

      {mostrarErrores && invalido ? (
        <Alert tone="warning" role="status" title="Faltan datos">
          <p>Lo que falta está marcado abajo.</p>
        </Alert>
      ) : null}

      <div className={styles.cuerpo}>
        {/* ── 1 · información general ─────────────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Información general</legend>

          <div className={styles.fila}>
            <Field label="Referencia" required error={ver('sku')} help="El código con el que se busca. Único por empresa.">
              <Input value={f.sku} onChange={(e) => cambiar('sku', e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Modelo" optional>
              <Input value={f.modelo} onChange={(e) => cambiar('modelo', e.target.value)} autoComplete="off" />
            </Field>
            <Button
              variant="secondary"
              size="sm"
              className={styles.sugerir}
              onClick={() => cambiar('sku', skuSugerido(nombreDeMarca, f.modelo))}
            >
              Sugerir referencia
            </Button>
          </div>

          <Field label="Nombre" required error={ver('nombre')}>
            <Input value={f.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />
          </Field>

          <Field label="Descripción" optional help="Una línea, la que se ve en el listado y en los documentos.">
            <Input value={f.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} />
          </Field>

          <Field label="Descripción larga" optional>
            <Textarea
              rows={4}
              value={f.descripcionLarga}
              onChange={(e) => cambiar('descripcionLarga', e.target.value)}
            />
          </Field>

          <Field label="Estado" help="«Borrador» no aparece para un cliente externo.">
            <Select value={f.estado} onChange={(e) => cambiar('estado', e.target.value as EstadoProducto)}>
              {ESTADOS_PRODUCTO.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.etiqueta}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>

        {/* ── 2 · marca, categoría y atributos ────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Marca, categoría y atributos</legend>

          <div className={styles.fila}>
            <Field
              label="Marca"
              optional
              help={marcas.isPending ? 'Cargando…' : 'Las marcas se crean en Configuración → Marcas.'}
            >
              <Select value={f.marcaId} onChange={(e) => cambiar('marcaId', e.target.value)}>
                <option value="">Sin marca</option>
                {(marcas.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Categoría"
              required
              error={ver('categoriaId')}
              help="Sólo se ofrecen las que están en el catálogo."
            >
              <Select value={f.categoriaId} onChange={(e) => cambiar('categoriaId', e.target.value)}>
                <option value="">Elegí una categoría…</option>
                {(categorias.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className={styles.fila}>
            <Field label="Subtipo" optional help="El «tipo» del producto: adaptador, punta, balanceador…">
              <Input value={f.tipo} onChange={(e) => cambiar('tipo', e.target.value)} />
            </Field>
            <Field label="Serie" optional>
              <Input value={f.serie} onChange={(e) => cambiar('serie', e.target.value)} />
            </Field>
          </div>

          <Checkbox
            label="Es un kit o set"
            help="Marca el producto como kit. Los componentes todavía no se pueden cargar (ver abajo)."
            checked={f.esKit}
            onChange={(e) => cambiar('esKit', e.target.checked)}
          />

          {/* Los atributos son los que la categoría elegida tiene definidos: sin
              categoría no hay nada que ofrecer, y ofrecerlos todos serían
              quince campos que no aplican. */}
          {f.categoriaId === '' ? (
            <p className={styles.nota}>Elegí una categoría para ver sus atributos técnicos.</p>
          ) : atributos.length === 0 ? (
            <p className={styles.nota}>Esta categoría todavía no tiene atributos definidos.</p>
          ) : (
            <div className={styles.atributos}>
              {atributos.map((d) => (
                <Field key={d.key} label={d.unidad ? `${d.label} (${d.unidad})` : d.label} optional>
                  <Input
                    value={f.atributos[d.key] ?? ''}
                    inputMode={d.tipo === 'number' ? 'decimal' : undefined}
                    onChange={(e) =>
                      setF((x) => ({ ...x, atributos: { ...x.atributos, [d.key]: e.target.value } }))
                    }
                  />
                </Field>
              ))}
            </div>
          )}
        </fieldset>

        {/* ── 3 · imagen ──────────────────────────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Imagen</legend>
          <Field
            label="Dirección de la imagen"
            optional
            error={ver('imagenUrl')}
            help="Queda como foto principal. Todavía no se puede subir un archivo desde acá."
          >
            <Input
              type="url"
              placeholder="https://…"
              value={f.imagenUrl}
              onChange={(e) => cambiar('imagenUrl', e.target.value)}
            />
          </Field>
          {f.imagenUrl.trim() !== '' && !ver('imagenUrl') ? (
            <img src={f.imagenUrl.trim()} alt="" className={styles.miniatura} />
          ) : null}
        </fieldset>

        {/* ── 4 · logística y aduana ──────────────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Logística y aduana</legend>

          <div className={styles.fila}>
            <Field label="Peso (g)" optional error={ver('pesoG')}>
              <Input value={f.pesoG} inputMode="numeric" onChange={(e) => cambiar('pesoG', e.target.value)} />
            </Field>
            {/* El legacy pide kilos; la columna guarda gramos. En vez de
                convertir en silencio, se convierte cuando se lo pide. */}
            <Field label="Desde kilos" optional help="Escribí los kilos y pasalo a gramos.">
              <div className={styles.conversor}>
                <Input value={kilos} inputMode="decimal" onChange={(e) => setKilos(e.target.value)} />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={gramosDesdeKg(kilos) === ''}
                  onClick={() => cambiar('pesoG', gramosDesdeKg(kilos))}
                >
                  A gramos
                </Button>
              </div>
            </Field>
            <Field label="Volumen (cm³)" optional error={ver('volumenCm3')}>
              <Input
                value={f.volumenCm3}
                inputMode="numeric"
                onChange={(e) => cambiar('volumenCm3', e.target.value)}
              />
            </Field>
          </div>

          <div className={styles.fila}>
            <Field label="Origen" optional help="El país, como lo declara el fabricante.">
              <Input value={f.origen} onChange={(e) => cambiar('origen', e.target.value)} />
            </Field>
            <Field label="NCM" optional help="Posición arancelaria.">
              <Input value={f.ncm} onChange={(e) => cambiar('ncm', e.target.value)} />
            </Field>
            <Field label="Código de barras" optional help="EAN, UPC o el interno.">
              <Input value={f.codigoBarras} onChange={(e) => cambiar('codigoBarras', e.target.value)} />
            </Field>
          </div>
        </fieldset>

        {/* ── 5 · lo que todavía no se puede guardar ──────────────────────── */}
        <details className={styles.pendientes}>
          <summary>Lo que el sistema anterior pide y todavía no se puede guardar acá</summary>
          <dl>
            {CAMPOS_QUE_NO_ESTAN.map((c) => (
              <div key={c.campo}>
                <dt>{c.campo}</dt>
                <dd>{c.motivo}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </Dialog>
  )
}
