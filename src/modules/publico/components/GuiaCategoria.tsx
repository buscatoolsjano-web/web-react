import { GUIAS } from '../lib/contenidos'
import styles from '../pages/PaginaInfo.module.css'

/**
 * La guía «cómo elegir» al pie de una categoría.
 *
 * Es texto para la persona que todavía no sabe qué modelo necesita, y es lo
 * que le da al buscador de qué se trata la página más allá de una tabla de
 * códigos. Va al pie, después de los productos: quien vino a buscar un
 * modelo lo encuentra primero.
 */
export function GuiaCategoria({ slug }: { slug: string }) {
  const g = GUIAS[slug]
  if (!g) return null
  return (
    <section className={styles.guia} aria-labelledby={`guia-${slug}`}>
      <h2 id={`guia-${slug}`}>{g.titulo}</h2>
      <p>{g.intro}</p>
      <ul className={styles.tarjetas}>
        {g.criterios.map((c) => (
          <li key={c.titulo} className={styles.tarjeta}>
            <h3>{c.titulo}</h3>
            <p>{c.texto}</p>
          </li>
        ))}
      </ul>
      {g.preguntas.length > 0 ? (
        <div className={styles.preguntas}>
          <h3>Preguntas frecuentes</h3>
          {g.preguntas.map((p) => (
            <details key={p.pregunta} className={styles.pregunta}>
              <summary>{p.pregunta}</summary>
              <p>{p.respuesta}</p>
            </details>
          ))}
        </div>
      ) : null}
    </section>
  )
}
