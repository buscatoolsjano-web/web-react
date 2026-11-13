import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons/Icon'
import { NOSOTROS, SERVICIOS } from '../lib/contenidos'
import { WHATSAPP_INICIO } from '../lib/inicio'
import { RUTA_CONTACTO, RUTA_MARCAS, RUTA_NOSOTROS, RUTA_SERVICIOS, rutaCatalogo } from '../lib/rutas'
import { NOMBRE_SITIO } from '../lib/seo'
import { useMeta } from '../hooks/useMeta'
import { pedirCotizacion, type DatosDelPedido } from '../services/pedirCotizacion'
import styles from './PaginaInfo.module.css'

const MAIL = 'info@buscatools.com.ar'
const TELEFONO = '+54 9 11 2169-3304'

function Migas({ aqui }: { aqui: string }) {
  return (
    <nav aria-label="Estás en">
      <ol className={styles.migas}>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        <li>{aqui}</li>
      </ol>
    </nav>
  )
}

function Cierre() {
  return (
    <div className={styles.acciones}>
      <a href={WHATSAPP_INICIO} target="_blank" rel="noopener noreferrer" className={styles.botonPrimario}>
        <Icon name="message-circle" size={20} aria-hidden="true" />
        Consultar por WhatsApp
      </a>
      <Link to={rutaCatalogo()} className={styles.botonSecundario}>
        Ver el catálogo
      </Link>
    </div>
  )
}

/** `/nosotros` */
export function NosotrosPage() {
  useMeta({
    titulo: `Quiénes somos | ${NOMBRE_SITIO}`,
    descripcion: NOSOTROS.bajada,
    canonica: RUTA_NOSOTROS,
  })
  return (
    <div className={styles.pagina}>
      <Migas aqui="Nosotros" />
      <header className={styles.cabeza}>
        <h1>{NOSOTROS.titulo}</h1>
        <p className={styles.bajada}>{NOSOTROS.bajada}</p>
      </header>
      <ul className={styles.tarjetas}>
        {NOSOTROS.secciones.map((s) => (
          <li key={s.titulo} className={styles.tarjeta}>
            <h2>{s.titulo}</h2>
            <p>{s.texto}</p>
          </li>
        ))}
      </ul>
      <p className={styles.texto}>
        Conocé las <Link to={RUTA_MARCAS}>marcas con las que trabajamos</Link> y los{' '}
        <Link to={RUTA_SERVICIOS}>servicios</Link> que acompañan cada compra.
      </p>
      <Cierre />
    </div>
  )
}

/** `/servicios` */
export function ServiciosPage() {
  useMeta({
    titulo: `Servicios: asesoramiento técnico y repuestos | ${NOMBRE_SITIO}`,
    descripcion:
      'Asesoramiento técnico para elegir la herramienta, compatibilidad de encastres y accesorios, repuestos, compras programadas y envíos a todo el país.',
    canonica: RUTA_SERVICIOS,
  })
  return (
    <div className={styles.pagina}>
      <Migas aqui="Servicios" />
      <header className={styles.cabeza}>
        <h1>Servicios para plantas industriales</h1>
        <p className={styles.bajada}>
          Además de la herramienta, te acompañamos en la elección, la compatibilidad, los repuestos y
          la entrega.
        </p>
      </header>
      <ul className={styles.tarjetas}>
        {SERVICIOS.map((s) => (
          <li key={s.titulo} className={styles.tarjeta}>
            <h2>{s.titulo}</h2>
            <p>{s.texto}</p>
          </li>
        ))}
      </ul>
      <Cierre />
    </div>
  )
}

const VACIO: DatosDelPedido = { nombre: '', email: '', empresa: '', telefono: '', mensaje: '', web: '' }

/** `/contacto`: los datos de la casa y un formulario que entra a Web → Consultas. */
export function ContactoPage() {
  const [datos, setDatos] = useState<DatosDelPedido>(VACIO)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null)

  useMeta({
    titulo: `Contacto | ${NOMBRE_SITIO}`,
    descripcion: `Consultanos por herramientas industriales: WhatsApp ${TELEFONO}, ${MAIL} o el formulario. Respondemos en el día hábil.`,
    canonica: RUTA_CONTACTO,
  })

  const cambiar = (campo: keyof DatosDelPedido) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }))

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setResultado(null)
    // Sin productos: es una consulta suelta. Entra igual a Web → Consultas.
    const r = await pedirCotizacion(datos, [])
    setEnviando(false)
    setResultado(r)
    if (r.ok) setDatos(VACIO)
  }

  return (
    <div className={styles.pagina}>
      <Migas aqui="Contacto" />
      <header className={styles.cabeza}>
        <h1>Contacto</h1>
        <p className={styles.bajada}>
          Contanos qué necesitás —el modelo, la cantidad o la aplicación— y te respondemos en el día
          hábil.
        </p>
      </header>

      <div className={styles.contacto}>
        <section aria-labelledby="titulo-datos">
          <h2 id="titulo-datos" className={styles.seccion}>
            Escribinos directo
          </h2>
          <ul className={styles.datos}>
            <li>
              <a href={WHATSAPP_INICIO} target="_blank" rel="noopener noreferrer">
                <Icon name="message-circle" size={20} aria-hidden="true" />
                WhatsApp {TELEFONO}
              </a>
            </li>
            <li>
              <a href={`tel:${TELEFONO.replace(/[^+\d]/g, '')}`}>
                <Icon name="phone" size={20} aria-hidden="true" />
                {TELEFONO}
              </a>
            </li>
            <li>
              <a href={`mailto:${MAIL}`}>
                <Icon name="mail" size={20} aria-hidden="true" />
                {MAIL}
              </a>
            </li>
            <li>
              <span>
                <Icon name="truck" size={20} aria-hidden="true" /> Envíos a todo el país · Factura A o B
              </span>
            </li>
          </ul>
          <p>
            ¿Ya sabés qué productos querés? Sumalos a tu lista desde el{' '}
            <Link to={rutaCatalogo()}>catálogo</Link> y enviala: te cotizamos todo junto.
          </p>
        </section>

        <form className={styles.formulario} onSubmit={(e) => void enviar(e)} aria-labelledby="titulo-form">
          <h2 id="titulo-form" className={styles.seccion}>
            Dejanos tu consulta
          </h2>
          <div className={styles.fila}>
            <label className={styles.campo}>
              Nombre y apellido *
              <input required value={datos.nombre} onChange={cambiar('nombre')} autoComplete="name" />
            </label>
            <label className={styles.campo}>
              Empresa
              <input value={datos.empresa} onChange={cambiar('empresa')} autoComplete="organization" />
            </label>
          </div>
          <div className={styles.fila}>
            <label className={styles.campo}>
              Email *
              <input required type="email" value={datos.email} onChange={cambiar('email')} autoComplete="email" />
            </label>
            <label className={styles.campo}>
              Teléfono / WhatsApp
              <input type="tel" value={datos.telefono} onChange={cambiar('telefono')} autoComplete="tel" />
            </label>
          </div>
          <label className={styles.campo}>
            ¿Qué necesitás? *
            <textarea required value={datos.mensaje} onChange={cambiar('mensaje')} />
          </label>
          {/* La trampa para robots: una persona no la ve ni la llena. */}
          <label className={styles.trampa} aria-hidden="true">
            Web
            <input tabIndex={-1} autoComplete="off" value={datos.web} onChange={cambiar('web')} />
          </label>
          {resultado ? (
            <p className={`${styles.aviso} ${resultado.ok ? styles.avisoOk : styles.avisoError}`} role="status">
              {resultado.mensaje}
            </p>
          ) : null}
          <div className={styles.acciones}>
            <button type="submit" className={styles.botonPrimario} disabled={enviando}>
              <Icon name="mail" size={20} aria-hidden="true" />
              {enviando ? 'Enviando…' : 'Enviar consulta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
