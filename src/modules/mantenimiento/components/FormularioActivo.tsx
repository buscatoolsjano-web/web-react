import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDuplicadosDeSerial } from '../hooks/useActivos'
import { errorDe, validarActivo, type ErrorDeCampo } from '../lib/validacion'
import { formatearFecha } from '../lib/formato'
import { BuscadorCliente } from './BuscadorCliente'
import { SelectorProducto } from './SelectorProducto'
import type { DatosActivo } from '../services/activos'
import type { ClienteBuscado, ProductoBuscado } from '../services/catalogo'
import styles from './Formulario.module.css'

export interface FormularioActivoProps {
  valores: DatosActivo
  /** El cliente y el producto ya elegidos, para mostrarlos sin re-buscarlos. */
  clienteInicial: ClienteBuscado | null
  productoInicial: ProductoBuscado | null
  /** En la edición, el propio equipo no cuenta como duplicado de sí mismo. */
  excluirId?: string | null
  /** La referencia `EQ00001`. En el alta la da el servidor y acá se avisa. */
  referencia?: string | null
  guardando: boolean
  errorAlGuardar?: string | null
  etiquetaGuardar: string
  onGuardar: (datos: DatosActivo) => void
  onCancelar: () => void
}

/**
 * Alta y edición de un equipo.
 *
 * Tres decisiones que se ven acá y que vienen del schema, no de esta pantalla:
 *
 *   · **El serial no es obligatorio ni único.** Se busca duplicados mientras
 *     se escribe y se avisa con nombre y apellido de cada coincidencia, pero
 *     no bloquea nada. El legacy nunca garantizó el serial; convertirlo en
 *     regla ahora inventaría una que no existía y dejaría afuera casos reales.
 *   · **El dueño puede faltar y puede cambiar.** Cambiarlo NO toca ninguna
 *     orden vieja: `maintenance_orders.customer_id` es un snapshot congelado
 *     por trigger. Se dice en pantalla para que nadie lo dude.
 *   · **El producto es opcional.** Sirve para decir qué herramienta es, no
 *     cuánto vale. Hay equipos que no están en el catálogo.
 */
export function FormularioActivo({
  valores,
  clienteInicial,
  productoInicial,
  excluirId = null,
  referencia = null,
  guardando,
  errorAlGuardar = null,
  etiquetaGuardar,
  onGuardar,
  onCancelar,
}: FormularioActivoProps) {
  const id = useId()
  const [datos, setDatos] = useState<DatosActivo>(valores)
  const [cliente, setCliente] = useState<ClienteBuscado | null>(clienteInicial)
  const [producto, setProducto] = useState<ProductoBuscado | null>(productoInicial)
  const [buscandoProducto, setBuscandoProducto] = useState(false)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [intentado, setIntentado] = useState(false)

  // El serial se consulta con retardo: se escribe letra por letra y no hace
  // falta una consulta por tecla.
  const [serialConsulta, setSerialConsulta] = useState(valores.serie)
  useEffect(() => {
    const t = setTimeout(() => setSerialConsulta(datos.serie), 400)
    return () => clearTimeout(t)
  }, [datos.serie])

  const duplicados = useDuplicadosDeSerial(serialConsulta, excluirId)

  const cambiar = <K extends keyof DatosActivo>(campo: K, valor: DatosActivo[K]) => {
    const siguiente = { ...datos, [campo]: valor }
    setDatos(siguiente)
    // Después del primer intento fallido, la validación acompaña mientras se
    // escribe: si no, hay que apretar Guardar de nuevo para ver si se arregló.
    if (intentado) setErrores(validarActivo(siguiente))
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    setIntentado(true)
    const encontrados = validarActivo(datos)
    setErrores(encontrados)
    if (encontrados.length === 0) onGuardar(datos)
  }

  const repetidos = duplicados.data ?? []

  return (
    <form className={styles.form} onSubmit={enviar} noValidate>
      {errorAlGuardar ? (
        <p className={styles.errorCaja} role="alert">
          {errorAlGuardar}
        </p>
      ) : null}

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Identificación</h2>

        <div className={styles.grilla}>
          <div className={styles.campo}>
            <span className={styles.etiqueta}>Referencia</span>
            {referencia ? (
              <span className={styles.soloLectura}>{referencia}</span>
            ) : (
              <span className={styles.soloLectura}>
                La asigna el sistema al guardar (EQ00001, EQ00002…)
              </span>
            )}
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-serie`}>
              Número de serie
            </label>
            <input
              id={`${id}-serie`}
              type="text"
              className={styles.control}
              value={datos.serie}
              disabled={guardando}
              onChange={(e) => cambiar('serie', e.target.value)}
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-identificador`}>
              Etiqueta interna
            </label>
            <input
              id={`${id}-identificador`}
              type="text"
              className={styles.control}
              value={datos.identificador}
              disabled={guardando}
              onChange={(e) => cambiar('identificador', e.target.value)}
            />
          </div>
        </div>

        <p className={styles.ayuda}>
          El equipo se identifica internamente por su referencia, no por el serial: el serial puede
          faltar, repetirse o venir mal cargado. Los dos campos son opcionales.
        </p>

        {repetidos.length > 0 ? (
          <div className={styles.aviso} role="status">
            <strong>
              Ya hay {repetidos.length} {repetidos.length === 1 ? 'equipo' : 'equipos'} con este
              número de serie.
            </strong>
            <ul className={styles.avisoLista}>
              {repetidos.map((d) => (
                <li key={d.id} className={styles.avisoItem}>
                  <Link to={`/mantenimiento/activos/${d.id}`}>{d.referencia}</Link>
                  {d.modelo ? ` · ${d.modelo}` : ''} · alta {formatearFecha(d.creadoEn)}
                </li>
              ))}
            </ul>
            <span className={styles.avisoItem}>
              Es un aviso, no un impedimento: se puede guardar igual. El sistema anterior nunca
              exigió que el serial fuera único y hay equipos que legítimamente lo comparten.
            </span>
          </div>
        ) : null}
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Qué herramienta es</h2>

        <div className={styles.campo}>
          <span className={styles.etiqueta}>Producto del catálogo</span>
          {buscandoProducto ? (
            <SelectorProducto
              onElegir={(p) => {
                setProducto(p)
                setDatos((d) => ({ ...d, productoId: p.id }))
                setBuscandoProducto(false)
              }}
              onCerrar={() => setBuscandoProducto(false)}
            />
          ) : producto ? (
            <div className={styles.elegido}>
              <span className={styles.elegidoSku}>{producto.sku}</span>
              <span>{producto.nombre}</span>
              <button
                type="button"
                className={styles.cambiar}
                disabled={guardando}
                onClick={() => setBuscandoProducto(true)}
              >
                Cambiar
              </button>
              <button
                type="button"
                className={styles.cambiar}
                disabled={guardando}
                onClick={() => {
                  setProducto(null)
                  setDatos((d) => ({ ...d, productoId: null }))
                }}
              >
                Quitar
              </button>
            </div>
          ) : (
            <div className={styles.elegido}>
              <span className={styles.soloLectura}>Sin producto asociado</span>
              <button
                type="button"
                className={styles.cambiar}
                disabled={guardando}
                onClick={() => setBuscandoProducto(true)}
              >
                Elegir del catálogo
              </button>
            </div>
          )}
        </div>

        <div className={styles.grilla}>
          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-marca`}>
              Marca
            </label>
            <input
              id={`${id}-marca`}
              type="text"
              className={styles.control}
              value={datos.marca}
              disabled={guardando}
              onChange={(e) => cambiar('marca', e.target.value)}
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-modelo`}>
              Modelo
            </label>
            <input
              id={`${id}-modelo`}
              type="text"
              className={styles.control}
              value={datos.modelo}
              disabled={guardando}
              onChange={(e) => cambiar('modelo', e.target.value)}
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-tipo`}>
              Tipo de equipo
            </label>
            <input
              id={`${id}-tipo`}
              type="text"
              className={styles.control}
              value={datos.tipo}
              disabled={guardando}
              onChange={(e) => cambiar('tipo', e.target.value)}
              placeholder="Atornillador, llave de impacto…"
            />
          </div>
        </div>

        <p className={styles.ayuda}>
          Marca, modelo y tipo se escriben a mano aunque haya producto: en el sistema anterior son
          texto libre y se migran tal cual. No se completan solos desde el catálogo para no pisar
          lo que dice la chapa del equipo.
        </p>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>De quién es y dónde está</h2>

        <BuscadorCliente
          elegido={cliente}
          etiqueta="Dueño actual"
          deshabilitado={guardando}
          onElegir={(c) => {
            setCliente(c)
            setDatos((d) => ({ ...d, duenoId: c.id }))
          }}
          onLimpiar={() => {
            setCliente(null)
            setDatos((d) => ({ ...d, duenoId: null }))
          }}
        />

        <p className={styles.ayuda}>
          El dueño puede faltar y puede cambiar. Cambiarlo <strong>no modifica</strong> ninguna
          orden ya creada: cada orden guarda su propio cliente, congelado en el momento del
          ingreso.
        </p>

        <div className={styles.grilla}>
          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-ciudad`}>
              Ciudad
            </label>
            <input
              id={`${id}-ciudad`}
              type="text"
              className={styles.control}
              value={datos.ciudad}
              disabled={guardando}
              onChange={(e) => cambiar('ciudad', e.target.value)}
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-provincia`}>
              Provincia
            </label>
            <input
              id={`${id}-provincia`}
              type="text"
              className={styles.control}
              value={datos.provincia}
              disabled={guardando}
              onChange={(e) => cambiar('provincia', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Garantía y contrato</h2>

        <div className={styles.grilla}>
          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-desde`}>
              Garantía desde
            </label>
            <input
              id={`${id}-desde`}
              type="date"
              className={styles.control}
              value={datos.garantiaDesde}
              disabled={guardando}
              aria-invalid={errorDe(errores, 'garantiaDesde') ? true : undefined}
              onChange={(e) => cambiar('garantiaDesde', e.target.value)}
            />
            {errorDe(errores, 'garantiaDesde') ? (
              <span className={styles.error}>{errorDe(errores, 'garantiaDesde')}</span>
            ) : null}
          </div>

          <div className={styles.campo}>
            <label className={styles.etiqueta} htmlFor={`${id}-hasta`}>
              Garantía hasta
            </label>
            <input
              id={`${id}-hasta`}
              type="date"
              className={styles.control}
              value={datos.garantiaHasta}
              disabled={guardando}
              aria-invalid={errorDe(errores, 'garantiaHasta') ? true : undefined}
              onChange={(e) => cambiar('garantiaHasta', e.target.value)}
            />
            {errorDe(errores, 'garantiaHasta') ? (
              <span className={styles.error}>{errorDe(errores, 'garantiaHasta')}</span>
            ) : null}
          </div>

          <label className={styles.check}>
            <input
              type="checkbox"
              checked={datos.bajoContrato}
              disabled={guardando}
              onChange={(e) => cambiar('bajoContrato', e.target.checked)}
            />
            Bajo contrato de mantenimiento
          </label>
        </div>
      </section>

      <div className={styles.campo}>
        <label className={styles.etiqueta} htmlFor={`${id}-notas`}>
          Notas
        </label>
        <textarea
          id={`${id}-notas`}
          className={styles.area}
          value={datos.notas}
          disabled={guardando}
          onChange={(e) => cambiar('notas', e.target.value)}
        />
      </div>

      <div className={styles.acciones}>
        <button type="submit" className={styles.primario} disabled={guardando}>
          {guardando ? 'Guardando…' : etiquetaGuardar}
        </button>
        <button
          type="button"
          className={styles.secundario}
          disabled={guardando}
          onClick={onCancelar}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
