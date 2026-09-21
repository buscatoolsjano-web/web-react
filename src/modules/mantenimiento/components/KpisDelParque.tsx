import type { ResumenActivos } from '../types'
import styles from './KpisDelParque.module.css'

export interface KpisDelParqueProps {
  resumen: ResumenActivos | undefined
  cargando: boolean
}

/**
 * Los cuatro números del parque de equipos.
 *
 * Son los mismos cuatro del panel de la web anterior —Activos · Modelos ·
 * Clientes · Servicios— con una diferencia que importa: **acá dicen lo que
 * realmente cuentan**.
 *
 * «Modelos» cuenta **textos de modelo distintos**, no modelos. Los 358
 * equipos traen 102 textos para unos 60 modelos reales: el mismo aparece como
 * `ASM18-12-PC`, `ASM18-12- PC` y `ASM 18-12-PC`. Decir «102 modelos» sería
 * falso y decir «60» sería inventado, así que se dice qué se está contando y
 * se deja la normalización para cuando se audite en serio.
 *
 * «Servicios» son las órdenes de mantenimiento cargadas. Hoy son 0 y se
 * muestra 0: los 82 documentos de servicio de STEL no se importaron todavía.
 */
export function KpisDelParque({ resumen, cargando }: KpisDelParqueProps) {
  const tarjetas = [
    { clave: 'activos', valor: resumen?.total, etiqueta: 'Equipos', nota: null },
    {
      clave: 'modelos',
      valor: resumen?.modelos.length,
      etiqueta: 'Textos de modelo',
      nota: 'Sin normalizar: el mismo modelo puede estar escrito de varias formas',
    },
    { clave: 'clientes', valor: resumen?.clientes.length, etiqueta: 'Clientes', nota: null },
    {
      clave: 'servicios',
      valor: resumen?.ordenes,
      etiqueta: 'Servicios',
      nota: 'Órdenes de mantenimiento registradas en el ERP',
    },
  ]

  return (
    <section className={styles.barra} aria-label="Resumen del parque de equipos">
      {tarjetas.map((t) => (
        <div key={t.clave} className={styles.tarjeta} data-kpi={t.clave}>
          <p className={styles.valor}>
            {cargando || t.valor === undefined ? <span className={styles.hueso} /> : t.valor}
          </p>
          <p className={styles.etiqueta} title={t.nota ?? undefined}>
            {t.etiqueta}
            {t.nota ? <span className="sr-only">. {t.nota}</span> : null}
          </p>
        </div>
      ))}
    </section>
  )
}
