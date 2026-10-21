import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useCarritoPublico } from '../hooks/useCarritoPublico'
import { pedirCotizacion, type DatosDelPedido } from '../services/pedirCotizacion'
import { rutaCatalogo, rutaProductoPublico } from '../lib/rutas'
import { useMeta } from '../hooks/useMeta'
import styles from './CotizarPage.module.css'

/**
 * El carrito y el pedido de cotización (Fase 87 · E3).
 *
 * ── POR QUÉ ES UNA PÁGINA Y NO UN PANEL QUE SE DESLIZA ──────────────────────
 *
 * Porque acá termina el recorrido, y lo que pasa al final merece una pantalla
 * entera: la lista completa a la vista, el formulario al lado y nada más
 * compitiendo. Un panel angosto encima del catálogo obliga a elegir entre ver
 * qué pediste y ver qué estás escribiendo.
 *
 * Y porque tiene URL propia: alguien puede estar armando la lista, cerrar y
 * volver mañana con el enlace.
 *
 * ── LO QUE SE PIDE, Y LO QUE NO ─────────────────────────────────────────────
 *
 * Obligatorio: nombre y correo. Nada más. Cada campo obligatorio de más es
 * una consulta menos, y la empresa y el teléfono los completa igual quien
 * quiere que lo llamen.
 */
const VACIO: DatosDelPedido = { nombre: '', email: '', empresa: '', telefono: '', mensaje: '', web: '' }

export function CotizarPage() {
  const carrito = useCarritoPublico()
  const [datos, setDatos] = useState<DatosDelPedido>(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null)

  useMeta({
    titulo: 'Pedir cotización | Buscatools',
    descripcion: 'Armá tu lista y pedinos precio y disponibilidad sin compromiso.',
    canonica: '/cotizar',
    // Es una pantalla de trámite: no tiene nada que un buscador pueda ofrecer
    // a nadie, y además cambia con cada visitante.
    sinIndexar: true,
  })

  const campo = (k: keyof DatosDelPedido) => (e: { target: { value: string } }) =>
    setDatos((d) => ({ ...d, [k]: e.target.value }))

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    setResultado(null)
    const r = await pedirCotizacion(datos, carrito.items)
    setResultado(r)
    setEnviando(false)
    // Sólo se vacía si de verdad entró: si falló, lo que escribió tiene que
    // seguir ahí para que pueda reintentar sin volver a armar la lista.
    if (r.ok) {
      carrito.vaciar()
      setDatos(VACIO)
    }
  }

  if (resultado?.ok === true) {
    return (
      <div className={styles.listo} role="status">
        <span className={styles.listoIcono} aria-hidden="true">
          <Icon name="check" size={32} />
        </span>
        <h1 className={styles.titulo}>{resultado.mensaje}</h1>
        <p className={styles.bajada}>
          Te escribimos al correo que nos dejaste. Si es urgente, llamanos.
        </p>
        <Link to={rutaCatalogo()} className={styles.boton}>
          Seguir viendo el catálogo
        </Link>
      </div>
    )
  }

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>Pedir cotización</h1>
      <p className={styles.bajada}>
        Decinos qué necesitás y te pasamos precio y disponibilidad. Sin compromiso.
      </p>

      <div className={styles.columnas}>
        {/* ── La lista ─────────────────────────────────────────────────── */}
        <section className={styles.lista} aria-labelledby="tu-lista">
          <h2 id="tu-lista" className={styles.subtitulo}>
            Tu lista
            {carrito.items.length > 0 ? (
              <button type="button" className={styles.vaciar} onClick={carrito.vaciar}>
                Vaciar
              </button>
            ) : null}
          </h2>

          {carrito.items.length === 0 ? (
            <p className={styles.vacia}>
              Todavía no agregaste nada. Podés <Link to={rutaCatalogo()}>mirar el catálogo</Link> o
              contarnos abajo qué estás buscando.
            </p>
          ) : (
            <ul className={styles.renglones}>
              {carrito.items.map((i) => (
                <li key={i.sku} className={styles.renglon}>
                  {/* La foto, que es lo que hace que el carrito se vea
                      profesional (Fase 87 · E3b). El enlace es la foto Y el
                      nombre: los dos llevan a la ficha. */}
                  <Link
                    to={rutaProductoPublico(i.categoriaSlug, i.slug)}
                    className={styles.renglonFoto}
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    {i.imagen ? (
                      <img src={i.imagen} alt="" loading="lazy" width={56} height={56} />
                    ) : (
                      <span className={styles.sinFoto}>
                        <Icon name="image" size={20} />
                      </span>
                    )}
                  </Link>

                  <div className={styles.renglonDatos}>
                    {i.slug !== '' ? (
                      <Link to={rutaProductoPublico(i.categoriaSlug, i.slug)}>{i.nombre}</Link>
                    ) : (
                      <span>{i.nombre}</span>
                    )}
                    <span className={styles.renglonSku}>{i.sku}</span>
                  </div>

                  <div className={styles.cantidad}>
                    <button
                      type="button"
                      onClick={() => carrito.sacar(i.sku)}
                      aria-label={`Quitar uno de ${i.nombre}`}
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    {/* Un número que se puede escribir: para pedir cien, nadie
                        aprieta el «+» cien veces. */}
                    <input
                      type="number"
                      min={0}
                      value={i.cantidad}
                      aria-label={`Cantidad de ${i.nombre}`}
                      onChange={(e) => carrito.poner(i, Number(e.target.value))}
                    />
                    <button
                      type="button"
                      onClick={() => carrito.agregar(i)}
                      aria-label={`Agregar uno de ${i.nombre}`}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>

                  <button
                    type="button"
                    className={styles.quitar}
                    onClick={() => carrito.quitar(i.sku)}
                    aria-label={`Sacar ${i.nombre} de la lista`}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── El formulario ────────────────────────────────────────────── */}
        <form className={styles.formulario} onSubmit={(e) => void enviar(e)} noValidate>
          <h2 className={styles.subtitulo}>Tus datos</h2>

          <label className={styles.campo}>
            <span>
              Nombre <abbr title="obligatorio">*</abbr>
            </span>
            <input value={datos.nombre} onChange={campo('nombre')} autoComplete="name" required />
          </label>

          <label className={styles.campo}>
            <span>
              Correo <abbr title="obligatorio">*</abbr>
            </span>
            <input
              type="email"
              value={datos.email}
              onChange={campo('email')}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.campo}>
            <span>Empresa</span>
            <input value={datos.empresa} onChange={campo('empresa')} autoComplete="organization" />
          </label>

          <label className={styles.campo}>
            <span>Teléfono</span>
            <input value={datos.telefono} onChange={campo('telefono')} autoComplete="tel" />
          </label>

          <label className={styles.campo}>
            <span>Qué necesitás</span>
            <textarea
              rows={4}
              value={datos.mensaje}
              onChange={campo('mensaje')}
              placeholder="Cantidades, plazos, o contanos qué estás armando y te ayudamos a elegir."
            />
          </label>

          {/*
            La trampa para robots.
            Una persona no la ve ni la puede enfocar con el teclado; un
            programa que rellena todo lo que encuentra, sí. `aria-hidden` y
            `tabIndex={-1}` son lo que la hacen invisible para quien usa un
            lector de pantalla, que si no se encontraría con un campo
            fantasma.
          */}
          <div className={styles.trampa} aria-hidden="true">
            <label>
              No completar
              <input
                tabIndex={-1}
                autoComplete="off"
                value={datos.web}
                onChange={campo('web')}
              />
            </label>
          </div>

          {resultado?.ok === false ? (
            <p className={styles.error} role="alert">
              {resultado.mensaje}
            </p>
          ) : null}

          <button type="submit" className={styles.boton} disabled={enviando}>
            {enviando ? <Spinner size={16} /> : null}
            {enviando ? 'Enviando…' : 'Enviar consulta'}
          </button>

          <p className={styles.legal}>
            Usamos tus datos sólo para contestarte esta consulta.
          </p>
        </form>
      </div>
    </div>
  )
}
