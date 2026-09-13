import { useId } from 'react'
import { useCatalogoStock } from '../hooks/useStock'
import { ETIQUETA_TRAMO } from '../lib/stock'
import type { ResumenStock, TramoUltimoMovimiento } from '../types'
import styles from './Informes.module.css'

const n = (v: number) => new Intl.NumberFormat('es-AR').format(v)

const KPIS = [
  { clave: 'con_stock', titulo: 'Con stock', detalle: 'en stock mayor que 0' },
  { clave: 'en_cero', titulo: 'En cero', detalle: 'saldo existente en 0' },
  { clave: 'negativo', titulo: 'Stock negativo', detalle: 'en stock menor que 0' },
  { clave: 'disponible_negativo', titulo: 'Disponible negativo', detalle: 'reservado mayor que el stock' },
  { clave: 'con_reservas', titulo: 'Con reservas', detalle: 'reservado mayor que 0' },
] as const

/**
 * Tarjetas de estado sobre los saldos existentes, desglose por depósito,
 * productos sin movimientos registrados y días desde el último movimiento.
 */
export function ResumenStockSeccion({ resumen }: { resumen: ResumenStock }) {
  const idTitulo = useId()
  const catalogo = useCatalogoStock()
  const tramos = Object.keys(ETIQUETA_TRAMO) as TramoUltimoMovimiento[]
  const t = resumen.total

  return (
    <section className={styles.bloque} aria-labelledby={idTitulo}>
      <header className={styles.bloqueCabecera}>
        <h2 id={idTitulo} className={styles.bloqueTitulo}>Stock actual</h2>
        <p className={styles.nota}>
          Sobre los <b>{n(t.balances)} saldos producto·depósito existentes</b>, no sobre el catálogo completo.
        </p>
      </header>

      <ul className={styles.kpis}>
        {KPIS.map((k) => {
          const valor = t[k.clave]
          const alerta = (k.clave === 'negativo' || k.clave === 'disponible_negativo') && valor > 0
          return (
            <li key={k.clave} className={alerta ? styles.kpiAlerta : styles.kpi}>
              <span className={styles.kpiValor}>{n(valor)}</span>
              <span className={styles.kpiTitulo}>{k.titulo}</span>
              <span className={styles.docs}>{k.detalle}{alerta ? ' · revisar' : ''}</span>
            </li>
          )
        })}
      </ul>

      <div className={`${styles.tarjeta} ${styles.tarjetaPeriodos}`}>
        <h3 className={styles.tarjetaTitulo}>Por depósito</h3>
        {resumen.depositos.length === 0 ? (
          <p className={styles.vacio}>La empresa no tiene depósitos.</p>
        ) : (
          <div className={styles.tablaScroll}>
            <table className={`${styles.tablaKpi} ${styles.tablaPeriodos}`}>
              <caption className={styles.oculto}>Saldos por depósito y estado</caption>
              <thead>
                <tr>
                  <th scope="col">Depósito</th>
                  <th scope="col" className={styles.num}>Saldos</th>
                  {KPIS.map((k) => <th key={k.clave} scope="col" className={styles.num}>{k.titulo}</th>)}
                </tr>
              </thead>
              <tbody>
                {resumen.depositos.map((d) => (
                  <tr key={d.id}>
                    <th scope="row" className={styles.categoria}>
                      {d.codigo} · {d.nombre}
                      {!d.activo ? <span className={styles.marca}>Inactivo</span> : null}
                    </th>
                    <td className={styles.num} data-etiqueta="Saldos"><span className={styles.importe}>{n(d.estados.balances)}</span></td>
                    {KPIS.map((k) => (
                      <td key={k.clave} className={styles.num} data-etiqueta={k.titulo}><span className={styles.conteo}>{n(d.estados[k.clave])}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={styles.tarjetas}>
        <article className={styles.tarjeta}>
          <h3 className={styles.tarjetaTitulo}>Productos</h3>
          <dl className={styles.lista2}>
            <div className={styles.parLista}><dt>Con saldo registrado</dt><dd>{n(resumen.productos.conBalance)}</dd></div>
            <div className={styles.parLista}><dt>Con movimientos</dt><dd>{n(resumen.productos.conMovimientos)}</dd></div>
            <div className={styles.parLista}><dt>Movidos y hoy en cero</dt><dd>{n(resumen.productos.movidoHoyEnCero)}</dd></div>
            <div className={styles.parLista}>
              <dt>Sin movimientos registrados</dt>
              <dd>{catalogo.data ? `${n(catalogo.data.sinMovimientos)} de ${n(catalogo.data.catalogo)} del catálogo` : catalogo.error ? 'no disponible' : 'contando…'}</dd>
            </div>
          </dl>
          <p className={styles.nota}>Un producto sin movimientos no tiene saldo: no es «stock 0», es que nunca se registró stock.</p>
        </article>

        <article className={styles.tarjeta}>
          <h3 className={styles.tarjetaTitulo}>Último movimiento</h3>
          <p className={styles.tarjetaSub}>Productos con movimientos, por días desde el último.</p>
          <dl className={styles.lista2}>
            {tramos.map((tr) => (
              <div key={tr} className={styles.parLista}>
                <dt>{ETIQUETA_TRAMO[tr]}</dt><dd>{n(resumen.ultimoMovimiento[tr])}</dd>
              </div>
            ))}
            <div className={styles.parLista}>
              <dt>Sin movimientos registrados</dt><dd>{catalogo.data ? n(catalogo.data.sinMovimientos) : '…'}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  )
}
