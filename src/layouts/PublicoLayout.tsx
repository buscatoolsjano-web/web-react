import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/icons/Icon'
import { useAuth } from '@/features/auth/useAuth'
import { categorias } from '@/modules/publico/services/catalogoPublico'
import { rutaCatalogo, rutaCategoria } from '@/modules/publico/lib/rutas'
import { useCarritoPublico } from '@/modules/publico/hooks/useCarritoPublico'
import { BarraPedido } from '@/modules/publico/components/BarraPedido'
import styles from './PublicoLayout.module.css'

/**
 * La cáscara del sitio público (Fase 87 · E2).
 *
 * ── POR QUÉ ES OTRA CÁSCARA Y NO EL ERP SIN LA BARRA ────────────────────────
 *
 * Porque son dos productos distintos. El ERP está hecho para alguien que pasa
 * ocho horas adentro: barra lateral con veinte secciones, densidad alta,
 * atajos. Esto es para alguien que llegó de un buscador, nunca estuvo acá y
 * se va en treinta segundos si no encuentra lo que vino a buscar.
 *
 * Lo que necesita esa persona es: qué venden, dónde está el buscador y cómo
 * se pide. Nada más. Y arriba a la derecha, para los de la casa, la puerta
 * de entrada al ERP.
 *
 * ── LAS CATEGORÍAS EN EL ENCABEZADO NO SON DECORACIÓN ───────────────────────
 *
 * Son el esqueleto de enlaces del sitio. Un buscador entiende de qué se trata
 * una página por lo que la enlaza, y que TODAS las páginas enlacen a las
 * ocho categorías es lo que hace que las ocho se descubran y se entiendan
 * como las secciones principales. En un sitio de nueve mil fichas, ese
 * esqueleto es la mitad del posicionamiento.
 */
export function PublicoLayout() {
  const { session } = useAuth()
  const navegar = useNavigate()
  const [params] = useSearchParams()
  const [texto, setTexto] = useState(params.get('q') ?? '')
  const carrito = useCarritoPublico()

  /*
   * Las categorías viven en el layout y no en cada página: se piden UNA vez
   * y quedan cacheadas para toda la visita. `staleTime` largo porque son
   * ocho filas que cambian cuando alguien crea una categoría, o sea nunca.
   */
  const q = useQuery({
    queryKey: ['catalogo-publico', 'categorias'],
    queryFn: categorias,
    staleTime: 60 * 60_000,
    retry: 1,
  })

  const buscar = (e: React.FormEvent) => {
    e.preventDefault()
    const limpio = texto.trim()
    // `void`: en React Router 7 `navigate` devuelve una promesa y no hay nada
    // que esperar ni que reintentar si falla.
    void navegar(
      limpio === '' ? rutaCatalogo() : `${rutaCatalogo()}?q=${encodeURIComponent(limpio)}`,
    )
  }

  return (
    <div className={styles.sitio}>
      {/* Saltar al contenido: quien navega con teclado no tiene por qué pasar
          por las ocho categorías en cada página. */}
      <a href="#contenido" className={styles.saltar}>
        Saltar al contenido
      </a>

      <header className={styles.cabecera}>
        <div className={styles.barra}>
          <Link to="/" className={styles.marca} aria-label="Buscatools, inicio">
            <img src="/brand/buscatools-logo.png" alt="Buscatools" width={132} height={28} />
          </Link>

          <form className={styles.buscador} onSubmit={buscar} role="search">
            <Icon name="search" size={16} aria-hidden="true" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar por producto, marca o código…"
              aria-label="Buscar en el catálogo"
            />
          </form>

          {/*
            La puerta del ERP. Es lo único que distingue a alguien de la casa
            de un visitante, y por eso está donde se espera: arriba a la
            derecha. Con sesión abierta deja de ser «iniciar sesión» y pasa a
            ser «ir al ERP», que es lo que esa persona quiere.
          */}
          {/*
            La lista de consulta. Sólo aparece cuando hay algo adentro: un
            carrito vacío permanente en el encabezado es una promesa de tienda
            que este sitio no cumple —no hay precios ni se compra—, y además
            ocupa el lugar del botón que sí importa.
          */}
          {carrito.unidades > 0 ? (
            <Link
              to="/cotizar"
              className={styles.carrito}
              aria-label={`Tu consulta: ${carrito.unidades} ${carrito.unidades === 1 ? 'producto' : 'productos'}`}
            >
              <Icon name="cart" size={20} aria-hidden="true" />
              <span className={styles.carritoGlobo}>{carrito.unidades}</span>
            </Link>
          ) : null}

          {session ? (
            <Link to="/inicio" className={styles.entrar}>
              <Icon name="home" size={16} aria-hidden="true" />
              <span>Ir al ERP</span>
            </Link>
          ) : (
            <Link to="/auth/login" className={styles.entrar}>
              <Icon name="users" size={16} aria-hidden="true" />
              <span>Iniciar sesión</span>
            </Link>
          )}
        </div>

        <nav className={styles.categorias} aria-label="Categorías">
          <NavLink
            to={rutaCatalogo()}
            end
            className={({ isActive }) => (isActive ? styles.catActiva : styles.cat)}
          >
            Todo el catálogo
          </NavLink>
          {(q.data ?? []).map((c) => (
            <NavLink
              key={c.slug}
              to={rutaCategoria(c.slug)}
              className={({ isActive }) => (isActive ? styles.catActiva : styles.cat)}
            >
              {c.nombre}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="contenido" className={styles.contenido}>
        <Outlet />
      </main>

      <footer className={styles.pie}>
        <div className={styles.pieColumnas}>
          <div>
            <p className={styles.pieTitulo}>Buscatools</p>
            <p className={styles.pieTexto}>
              Importación y venta de herramientas industriales para montaje, torque y ensamblaje.
              Puntas, tubos, embocaduras, balanceadores, atornilladores y llaves de impacto de las
              marcas que usa la industria.
            </p>
          </div>
          <div>
            <p className={styles.pieTitulo}>Catálogo</p>
            {/* Repetidas en el pie a propósito: es el segundo lugar donde un
                buscador —y una persona que llegó al final de la página—
                busca por dónde seguir. */}
            <ul className={styles.pieLista}>
              {(q.data ?? []).map((c) => (
                <li key={c.slug}>
                  <Link to={rutaCategoria(c.slug)}>
                    {c.nombre} <span className={styles.pieCuantos}>({c.productos})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className={styles.pieLegal}>
          © {new Date().getFullYear()} Buscatools · Los precios y la disponibilidad se informan a
          pedido.
        </p>
      </footer>

      {/* La barra flotante del pedido. Se dibuja sola cuando hay algo adentro
          y no está en la página del pedido. Comparte el mismo carrito que el
          globito del encabezado. */}
      <BarraPedido carrito={carrito} />
    </div>
  )
}
