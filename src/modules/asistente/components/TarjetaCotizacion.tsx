import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { crearCotizacion, FalloDeGuardado } from '@/modules/ventas/services/cotizaciones'
import { formatearImporte } from '@/modules/ventas/lib/formato'
import type { PropuestaCotizacion } from '../services/asistente'
import styles from './TarjetaCotizacion.module.css'

/**
 * El borrador de cotización que armó el asistente (Fase 36).
 *
 * ── La decisión que hace segura toda esta función ───────────────────────────
 *
 * **La IA no crea nada.** Arma el borrador —resuelve el cliente, busca los
 * productos, trae el precio— y lo muestra acá. La cotización la crea la
 * PERSONA con este botón, por el mismo camino que la pantalla de siempre:
 * `crearCotizacion`, que valida cliente, vendedor, tarifa y moneda del lado
 * del servidor y es transaccional.
 *
 * El costo del error no es simétrico: si el asistente se equivoca leyendo, uno
 * le dice «fijate bien»; si se equivocara creando, quedó una cotización mal
 * hecha con un número de serie consumido. Por eso el permiso tampoco lo es.
 *
 * Y por eso esto MUESTRA TODO antes de crear: qué cliente, qué producto cayó
 * en cada renglón, a qué precio y de dónde salió ese precio. Un botón que
 * dijera sólo «Crear cotización» obligaría a confiar.
 */
export interface TarjetaCotizacionProps {
  propuesta: PropuestaCotizacion
}

export function TarjetaCotizacion({ propuesta }: TarjetaCotizacionProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const navegar = useNavigate()
  const [creada, setCreada] = useState<{ id: string; numero: string } | null>(null)

  const crear = useMutation({
    mutationFn: () => {
      const lineas = propuesta.lineas
        .filter((l) => l.resuelto)
        .map((l, i) => ({
          line_no: i + 1,
          line_type: 'item',
          product_id: l.productId,
          sku_snapshot: l.sku,
          name_snapshot: l.nombre,
          quantity: l.cantidad,
          unit_price: l.precio ?? 0,
          discount_pct: 0,
          tax_treatment: 'vat_21',
          tax_rate_snapshot: 21,
        }))
      return crearCotizacion(
        companyId!,
        {
          customer_id: propuesta.clienteId,
          currency_code: propuesta.moneda,
          quote_date: new Date().toISOString().slice(0, 10),
          title: `Cotización para ${propuesta.clienteNombre}`,
          notes: 'Armada con el asistente.',
        },
        lineas,
      )
    },
    onSuccess: (r) => setCreada({ id: r.id, numero: r.numero }),
  })

  if (creada) {
    return (
      <div className={styles.tarjeta}>
        <Alert tone="success" role="status" title={`Se creó ${creada.numero}`}>
          <p>Revisala y completá lo que falte antes de mandarla.</p>
        </Alert>
        <Button
          icon={<Icon name="arrow-right" size={16} />}
          onClick={() => void navegar(`/ventas/cotizaciones/${creada.id}`)}
        >
          Abrir {creada.numero}
        </Button>
      </div>
    )
  }

  const error = crear.error instanceof FalloDeGuardado ? crear.error.message : null

  return (
    <div className={styles.tarjeta}>
      <header className={styles.cabecera}>
        <span className={styles.rotulo}>Borrador · todavía no está creada</span>
        <strong className={styles.cliente}>{propuesta.clienteNombre}</strong>
      </header>

      <ul className={styles.lineas}>
        {propuesta.lineas.map((l) => (
          <li key={l.n} className={l.resuelto ? styles.linea : `${styles.linea} ${styles.sinResolver}`}>
            {l.resuelto ? (
              <>
                <span className={styles.sku}>{l.sku}</span>
                <span className={styles.nombre}>{l.nombre}</span>
                <span className={styles.cantidad}>
                  {l.cantidad} × {formatearImporte(l.precio ?? 0, propuesta.moneda)}
                </span>
                {/* De dónde salió el precio. «Lista» y «último a este cliente»
                    no se revisan igual, y el que firma la cotización tiene
                    que poder distinguirlos sin abrir otra pantalla. */}
                <span className={styles.origen}>{l.origenPrecio}</span>
              </>
            ) : (
              <>
                <span className={styles.sku}>—</span>
                <span className={styles.nombre}>
                  «{l.pidio}» × {l.cantidad}
                </span>
                <span className={styles.problema}>{l.nota}</span>
              </>
            )}
          </li>
        ))}
      </ul>

      <footer className={styles.pie}>
        {/* SIN IVA, y dicho. El servidor le suma el 21 % al crear, así que
            el documento va a mostrar más que esto: verificado con
            COT-BTS00002, 595,80 acá y 720,92 en la cotización. Un total a
            secas en una pantalla de plata que después no coincide es la clase
            de detalle que hace desconfiar de todo lo demás. */}
        <span className={styles.total}>
          {formatearImporte(propuesta.total, propuesta.moneda)}
          <span className={styles.sinIva}> sin IVA</span>
        </span>
        <Button
          onClick={() => crear.mutate()}
          disabled={!propuesta.listoParaConfirmar || crear.isPending || companyId === null}
        >
          {crear.isPending ? 'Creando…' : 'Crear cotización'}
        </Button>
      </footer>

      {/* El botón se apaga y se DICE por qué. Un botón gris sin explicación
          manda a adivinar qué falta. */}
      {!propuesta.listoParaConfirmar ? (
        <p className={styles.aviso}>
          {propuesta.sinResolver === 1
            ? 'Hay un renglón sin resolver: decile cuál es el producto y lo vuelve a armar.'
            : `Hay ${propuesta.sinResolver} renglones sin resolver: decile cuáles son y los vuelve a armar.`}
        </p>
      ) : null}

      {error !== null ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
