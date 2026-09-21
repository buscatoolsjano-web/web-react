import type { ResumenActivos } from '../types'
import styles from './KpisDelParque.module.css'

export interface KpisDelParqueProps {
  resumen: ResumenActivos | undefined
  cargando: boolean
}

/**
 * Los números del parque de equipos.
 *
 * Son los del panel de la web anterior —Activos · Modelos · Clientes ·
 * Servicios— con una diferencia que importa: **acá dicen lo que realmente
 * cuentan**.
 *
 * «Modelos» cuenta **textos de modelo distintos**, no modelos. Los 358 equipos
 * traen 102 textos para unos 60 modelos reales: el mismo aparece como
 * `ASM18-12-PC`, `ASM18-12- PC` y `ASM 18-12-PC`. Decir «102 modelos» sería
 * falso y decir «60» sería inventado, así que se dice qué se está contando.
 *
 * Y la separación que manda desde la Fase 20 · E2: **trabajo actual e historial
 * importado son dos números distintos**. Las órdenes son lo que el taller tiene
 * abierto en el ERP; el historial son los servicios que quedaron registrados en
 * STEL y se importaron. Un presupuesto que allá quedó pendiente en 2023 no es
 * trabajo pendiente de hoy, así que no se suman y el rótulo lo dice.
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
      clave: 'trabajo-actual',
      valor: resumen?.ordenes,
      etiqueta: 'Trabajo actual',
      nota: 'Órdenes de mantenimiento abiertas en el ERP. No incluye el historial importado.',
    },
    {
      clave: 'historial',
      valor: resumen?.historial,
      etiqueta: 'Historial STEL',
      nota: 'Servicios importados de STEL. Es historia cerrada, de sólo lectura.',
      detalle: resumen
        ? `sobre ${resumen.conHistorial} equipos · ${resumen.historialCerrado} entregados · ${resumen.historialPresupuesto} quedaron con presupuesto pendiente en STEL`
        : null,
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
          {'detalle' in t && t.detalle ? <p className={styles.detalle}>{t.detalle}</p> : null}
        </div>
      ))}
    </section>
  )
}
