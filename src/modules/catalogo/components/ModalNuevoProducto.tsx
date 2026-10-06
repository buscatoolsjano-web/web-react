import { useId, useMemo, useState } from 'react'
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
import { normalizarFoto } from '../lib/fotoProducto'
import type { ProductoCreado } from '../services/altaProducto'
import {
  atributosDeLaCategoria,
  CAMPOS_QUE_NO_ESTAN,
  ESTADOS_PRODUCTO,
  filaDesdeFormulario,
  FORMULARIO_VACIO,
  gramosDesdeKg,
  hayErrores,
  referenciaDerivada,
  validarNuevoProducto,
  type EstadoProducto,
  type FormularioNuevoProducto,
} from '../lib/nuevoProducto'
import { ComponentesDelKit } from './ComponentesDelKit'
import { componentesUtiles, filaVacia, type ComponenteElegido } from '../lib/kit'
import styles from './ModalNuevoProducto.module.css'

/** Lo mismo que acepta el bucket `productos`. */
const TIPOS_DE_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/avif']
const MAXIMO_IMAGEN = 5 * 1024 * 1024

export interface ModalNuevoProductoProps {
  onCerrar: () => void
  /**
   * Qué hacer con el producto recién creado.
   *
   * Llega el producto ENTERO y no sólo el id (Fase 40): desde el Catálogo lo
   * único que hace falta es abrirlo, pero desde una cotización hay que
   * encontrarlo en la lista para agregarlo, y para eso se necesita el SKU.
   * Devolver el id y obligar a releerlo sería pedir una consulta por un dato
   * que el alta ya tiene en la mano.
   */
  onCreado: (producto: ProductoCreado) => void
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
  /** La referencia es derivada salvo que alguien decida escribirla. */
  const [refManual, setRefManual] = useState(false)
  const [imagen, setImagen] = useState<File | null>(null)
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null)
  const [errorImagen, setErrorImagen] = useState<string | null>(null)
  /*
   * La foto, normalizada antes de subir (Fase 40).
   *
   * Se guarda el archivo ORIGINAL además del procesado: tildar y destildar
   * «quitar el fondo» vuelve a procesar desde el original. Procesar sobre lo
   * ya procesado degradaría la foto un poco más en cada vuelta.
   */
  const [original, setOriginal] = useState<File | null>(null)
  const [quitarFondo, setQuitarFondo] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null)
  const [componentes, setComponentes] = useState<ComponenteElegido[]>([])
  const idImagen = useId()

  /**
   * El archivo elegido, validado ANTES de subirlo.
   *
   * El bucket ya limita tipo y tamaño —una validación que vive sólo acá no es
   * una validación—, pero rebotar en el navegador evita subir 20 MB para que
   * el servidor los rechace.
   */
  const elegirImagen = (archivo: File | null) => {
    if (vistaPrevia !== null) URL.revokeObjectURL(vistaPrevia)
    if (archivo === null) {
      setImagen(null)
      setVistaPrevia(null)
      setErrorImagen(null)
      setOriginal(null)
      setAvisoFoto(null)
      return
    }
    if (!TIPOS_DE_IMAGEN.includes(archivo.type)) {
      setImagen(null)
      setVistaPrevia(null)
      setErrorImagen('Tiene que ser PNG, JPG, WEBP o AVIF.')
      return
    }
    if (archivo.size > MAXIMO_IMAGEN) {
      setImagen(null)
      setVistaPrevia(null)
      setErrorImagen('El archivo pasa de 5 MB.')
      return
    }
    setOriginal(archivo)
    void procesarFoto(archivo, quitarFondo)
  }

  /**
   * Deja la foto en 500 × 500 y, si se pidió, sin fondo.
   *
   * Todo pasa en el navegador y antes de subir nada: lo que se ve en la vista
   * previa es exactamente el archivo que se va a guardar, no una aproximación.
   * Si el navegador no puede procesarla —un formato raro, un canvas
   * bloqueado—, se sube la original: es peor no poder cargar la foto que
   * cargarla sin normalizar.
   */
  const procesarFoto = async (archivo: File, sinFondo: boolean) => {
    setProcesando(true)
    setAvisoFoto(null)
    try {
      const r = await normalizarFoto(archivo, { quitarFondo: sinFondo })
      if (vistaPrevia !== null) URL.revokeObjectURL(vistaPrevia)
      setImagen(r.archivo)
      setVistaPrevia(URL.createObjectURL(r.archivo))
      setErrorImagen(null)
      if (r.casiVacia) {
        setAvisoFoto(
          'Esta foto no tiene un fondo liso: quitarlo se llevaría casi todo. Se guarda sin tocar el fondo.',
        )
        setQuitarFondo(false)
      }
    } catch {
      if (vistaPrevia !== null) URL.revokeObjectURL(vistaPrevia)
      setImagen(archivo)
      setVistaPrevia(URL.createObjectURL(archivo))
      setErrorImagen(null)
      setAvisoFoto('No se pudo ajustar la foto en este navegador: se sube tal como está.')
    } finally {
      setProcesando(false)
    }
  }

  const cambiarFondo = (valor: boolean) => {
    setQuitarFondo(valor)
    if (original) void procesarFoto(original, valor)
  }

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
  const nombreDe = (id: string) => (marcas.data ?? []).find((m) => m.id === id)?.nombre ?? null

  /**
   * La referencia se rearma en el mismo `setState` que cambia la marca o el
   * modelo, y no en un efecto: un efecto que escribe estado deja un render
   * intermedio con la referencia vieja al lado del modelo nuevo, y además es
   * exactamente lo que prohíbe `react-hooks/set-state-in-effect`.
   */
  const elegirMarca = (id: string) =>
    setF((x) => ({ ...x, marcaId: id, sku: refManual ? x.sku : referenciaDerivada(nombreDe(id), x.modelo) }))

  const escribirModelo = (v: string) =>
    setF((x) => ({ ...x, modelo: v, sku: refManual ? x.sku : referenciaDerivada(nombreDeMarca, v) }))

  // Un kit sin receta no se puede despachar (lo rechaza `confirmar_entrega`),
  // así que tampoco se deja crear: mejor el error acá que al querer entregarlo.
  const kitSinReceta = f.esKit && componentesUtiles(componentes).length === 0

  const guardar = () => {
    setMostrarErrores(true)
    if (invalido || kitSinReceta) return
    crear.mutate(
      {
        fila: filaDesdeFormulario(f),
        imagen,
        componentes: componentesUtiles(componentes),
      },
      {
        onSuccess: (r) => {
          setF(FORMULARIO_VACIO)
          setKilos('')
          setMostrarErrores(false)
          elegirImagen(null)
          setComponentes([])
          onCreado(r)
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

      {mostrarErrores && (invalido || kitSinReceta) ? (
        <Alert tone="warning" role="status" title="Faltan datos">
          {invalido ? <p>Lo que falta está marcado abajo.</p> : null}
          {/* Un kit sin receta no se puede despachar —`confirmar_entrega` lo
              rechaza—, así que tampoco se deja crear. */}
          {kitSinReceta ? <p>Un kit necesita al menos un componente con su cantidad.</p> : null}
        </Alert>
      ) : null}

      <div className={styles.cuerpo}>
        {/* ── 1 · información general ─────────────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Información general</legend>

          {/* Marca, modelo y referencia van juntos porque la referencia SALE de
              los otros dos. Tenerla acá arriba y la marca tres secciones más
              abajo obligaba a bajar, elegir y volver para poder armarla. */}
          <div className={styles.fila}>
            <Field label="Marca" required error={ver('marcaId')} help={marcas.isPending ? 'Cargando…' : undefined}>
              <Select value={f.marcaId} onChange={(e) => elegirMarca(e.target.value)}>
                <option value="">Elegí una marca…</option>
                {(marcas.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Modelo" required error={ver('modelo')}>
              <Input value={f.modelo} onChange={(e) => escribirModelo(e.target.value)} autoComplete="off" />
            </Field>

            <Field label="Referencia" required error={ver('sku')}>
              <Input value={f.sku} readOnly={!refManual} onChange={(e) => cambiar('sku', e.target.value)} autoComplete="off" />
            </Field>
          </div>

          <div className={styles.pieDeReferencia}>
            <p className={styles.nota}>
              {refManual
                ? 'Referencia escrita a mano. Si volvés a la automática se rearma con la marca y el modelo.'
                : 'La referencia se arma sola: las dos primeras letras de la marca, un punto y el modelo.'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const manual = !refManual
                setRefManual(manual)
                if (!manual) cambiar('sku', referenciaDerivada(nombreDeMarca, f.modelo))
              }}
            >
              {refManual ? 'Volver a la automática' : 'Escribirla a mano'}
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
          <legend className={styles.leyenda}>Categoría y atributos</legend>

          <div className={styles.fila}>
            {/* La marca subió a «Información general»: es de donde sale la
                referencia, y estaba tres secciones más abajo que el campo que
                la usa. */}
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
            help="El stock sale de los componentes: no se lleva por separado."
            checked={f.esKit}
            onChange={(e) => {
              cambiar('esKit', e.target.checked)
              // Al marcarlo se abre la primera línea sola: si no, la sección
              // aparece vacía y no se ve que hay algo que cargar.
              if (e.target.checked && componentes.length === 0) setComponentes([filaVacia()])
            }}
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
                <Field
                  key={d.key}
                  label={d.unidad ? `${d.label} (${d.unidad})` : d.label}
                  optional
                  help={d.enumerada ? `${d.opciones.length} opciones` : undefined}
                >
                  {/* Con lista se ELIGE; sin lista se escribe. Escribir un
                      atributo que es una enumeración es lo que metió «1/4 Hex»
                      al lado de «1/4 HEX» en 1.176 productos: dos filtros en el
                      catálogo para la misma cosa. */}
                  {d.enumerada ? (
                    <Select
                      value={f.atributos[d.key] ?? ''}
                      onChange={(e) =>
                        setF((x) => ({ ...x, atributos: { ...x.atributos, [d.key]: e.target.value } }))
                      }
                    >
                      <option value="">Sin especificar</option>
                      {d.opciones.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      value={f.atributos[d.key] ?? ''}
                      inputMode={d.tipo === 'number' ? 'decimal' : undefined}
                      onChange={(e) =>
                        setF((x) => ({ ...x, atributos: { ...x.atributos, [d.key]: e.target.value } }))
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
        </fieldset>

        {/* ── 3 · imagen ──────────────────────────────────────────────────── */}
        <fieldset className={styles.grupo}>
          <legend className={styles.leyenda}>Imagen</legend>
          {/* `Field` conecta la etiqueta con su control por contexto, y eso lo
              consumen los controles del sistema de formularios. Un `input` de
              archivo crudo no puede: no tiene `value` y necesita su propio
              manejo. Por eso el id va explícito en los dos lados. */}
          <Field
            id={idImagen}
            label="Foto del producto"
            optional
            error={errorImagen ?? undefined}
            help="PNG, JPG, WEBP o AVIF, hasta 5 MB. Se guarda en 500 × 500 para que todas se vean iguales en el catálogo."
          >
            <input
              id={idImagen}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              onChange={(e) => elegirImagen(e.target.files?.[0] ?? null)}
            />
          </Field>

          {/* La miniatura es el archivo YA procesado, sin subir nada: lo que se
              ve es exactamente lo que se va a guardar, no una aproximación. */}
          {vistaPrevia !== null ? (
            <>
              <Checkbox
                label="Quitar el fondo"
                checked={quitarFondo}
                disabled={procesando}
                onChange={(e) => cambiarFondo(e.target.checked)}
                help="Sirve con fotos de fondo liso, que son las de catálogo. Con una foto sacada en el taller no hace nada bueno: mirá la vista previa antes de guardar."
              />
              {avisoFoto ? (
                <Alert tone="warning" role="status" title="Sobre la foto">
                  <p>{avisoFoto}</p>
                </Alert>
              ) : null}
              <div className={styles.pieDeReferencia}>
                {/* El damero detrás: sin él, un fondo transparente se vería
                    blanco sobre el modal y nadie sabría si se quitó o no. */}
                <span className={styles.lienzo}>
                  <img src={vistaPrevia} alt="" className={styles.miniatura} />
                </span>
                <span className={styles.notaFoto}>
                  {procesando ? 'Ajustando…' : `500 × 500 · ${Math.round((imagen?.size ?? 0) / 1024)} kB`}
                </span>
                <Button variant="ghost" size="sm" onClick={() => elegirImagen(null)}>
                  Quitar la imagen
                </Button>
              </div>
            </>
          ) : null}
        </fieldset>

        {/* ── 4 · receta del kit ──────────────────────────────────────────── */}
        {f.esKit ? (
          <fieldset className={styles.grupo}>
            <legend className={styles.leyenda}>Qué lleva el kit</legend>
            <ComponentesDelKit componentes={componentes} onCambiar={setComponentes} />
          </fieldset>
        ) : null}

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
