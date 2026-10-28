import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { MONEDAS_DOCUMENTO as MONEDAS } from '../lib/moneda'
import type { CabeceraBorrador, CampoCabecera } from '../lib/borrador'
import type { OpcionDireccion, OpcionTarifa } from '../services/opciones'
import styles from './CabeceraCotizacion.module.css'

export interface EditorMasInformacionProps {
  valores: CabeceraBorrador
  /** Las tarifas de la empresa (Fase 199: bajó acá desde la cabecera). */
  tarifas: readonly OpcionTarifa[]
  /** El cambio de moneda dejó la tarifa incompatible. */
  avisoTarifa: boolean
  /**
   * Los domicilios de entrega del cliente (Fase 17 · E3). Sin la prop no se
   * muestra el campo: la cotización no entrega nada, el pedido sí.
   */
  direcciones?: readonly OpcionDireccion[] | undefined
  cargandoDirecciones?: boolean | undefined
  onCambiar: (campo: CampoCabecera, valor: string) => void
  onCambiarMoneda: (moneda: string) => void
}

/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
const PERCEPCION_HABITUAL = '2.5'

/**
 * La otra mitad de la cabecera, la de «Más información» (Fase 84).
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * La tarjeta de arriba muestra lo que identifica al documento y es igual
 * mirando que editando; todo lo demás vive acá, donde también se edita. Así
 * apretar «Editar» no agrega filas ni reacomoda la pantalla.
 *
 * NO es un formulario nuevo: son campos que escriben en el MISMO borrador, con
 * el mismo `onCambiar`, y se guardan con el mismo botón. Ni un control escribe
 * en la base: el único camino de escritura sigue siendo «Guardar».
 *
 * ── QUÉ ENTRA (Fase 199) ─────────────────────────────────────────────────────
 *
 * Moneda, tipo de cambio, la percepción (que allá es una casilla de la tarjeta
 * y acá un porcentaje), la tarifa —que bajó de la cabecera porque se mira una
 * vez y no se vuelve a tocar—, el domicilio de entrega del pedido, y las
 * observaciones. Los contactos subieron a la cabecera, al lado de los agentes,
 * y el descuento global se sacó: nadie lo usaba.
 */
export function EditorMasInformacion({
  valores,
  tarifas,
  avisoTarifa,
  direcciones,
  cargandoDirecciones = false,
  onCambiar,
  onCambiarMoneda,
}: EditorMasInformacionProps) {
  const numeroInput = { type: 'number', step: 'any', min: '0' } as const
  // Sólo se ofrecen las tarifas de la moneda del documento: una de otra moneda
  // exigiría un tipo de cambio que nadie definió, y la base la rechaza.
  const compatibles = tarifas.filter((t) => t.moneda === valores.moneda)
  const ocultas = tarifas.length - compatibles.length
  // Una dirección desactivada no se ofrece… salvo que el documento ya la
  // nombre. En ese caso se muestra, marcada: esconderla haría que el
  // desplegable quedara en blanco y que guardar borrara el dato sin que nadie
  // lo pidiera. (La misma regla para los contactos vive en lib/contactos.)
  const direccionesVisibles = (direcciones ?? []).filter(
    (d) => d.activa || d.id === valores.direccionEntregaId,
  )

  return (
    <div className={`${styles.bloques} ${styles.denso}`}>
      {/* El rótulo del grupo va oculto: la sección que lo contiene ya dice
          «Más información». Pero existe, porque un fieldset sin legend deja al
          grupo sin nombre para quien lo escucha. */}
      <fieldset className={styles.grupo}>
        <legend className="sr-only">Más información</legend>
        <div className={styles.grilla}>
          {/* Sin ayuda fija (Fase 84): «si no hace falta aclarar nada, no
              pongas nada, así todo queda alineado». */}
          <Field label="Moneda">
            <Select value={valores.moneda} required onChange={(e) => onCambiarMoneda(e.target.value)}>
              {/* Fase 14 · E3: sin moneda por defecto. En un documento que ya la
                  tiene esta opción no aparece; en el alta es lo primero que hay
                  que elegir y se dice así. */}
              {valores.moneda === '' ? <option value="">Elegí la moneda</option> : null}
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tipo de cambio" optional>
            <Input
              {...numeroInput}
              inputMode="decimal"
              value={valores.tipoCambio}
              onChange={(e) => onCambiar('tipoCambio', e.target.value)}
            />
          </Field>

          <Field label="% Percep. IIBB" optional>
            <div className={styles.linea}>
              <Input
                {...numeroInput}
                max="100"
                inputMode="decimal"
                value={valores.percepcionPct}
                onChange={(e) => onCambiar('percepcionPct', e.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCambiar('percepcionPct', PERCEPCION_HABITUAL)}
              >
                {PERCEPCION_HABITUAL} %
              </Button>
            </div>
          </Field>

          {/* La tarifa, bajada de la cabecera (Fase 199): se elige una vez, con
              la moneda ya puesta, y no se vuelve a mirar. */}
          <Field
            label="Tarifa"
            optional
            help={
              avisoTarifa
                ? 'Cambió la moneda y la tarifa anterior estaba en otra: se quitó.'
                : valores.moneda === ''
                  ? 'Elegí primero la moneda.'
                  : ocultas > 0
                    ? `Sólo las tarifas en ${valores.moneda}.`
                    : undefined
            }
          >
            <Select value={valores.listaPrecioId} onChange={(e) => onCambiar('listaPrecioId', e.target.value)}>
              <option value="">Sin tarifa</option>
              {compatibles.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          </Field>

          {/* Fase 17 · E3: en el pedido es el domicilio ELEGIDO, que todavía se
              puede cambiar. Sin elegir no se usa el del cliente de hoy: se dice
              que el remito va a tomar el principal al emitirse. */}
          {direcciones ? (
            <Field
              label="Entregar en"
              optional
              className={styles.ancho}
              help={
                valores.customerId !== '' && direccionesVisibles.length === 0 && !cargandoDirecciones
                  ? 'El cliente no tiene domicilios cargados.'
                  : valores.direccionEntregaId === '' && direccionesVisibles.length > 0
                    ? 'Sin elegir, usa el principal del cliente.'
                    : undefined
              }
            >
              <Select
                value={valores.direccionEntregaId}
                disabled={valores.customerId === '' || cargandoDirecciones}
                onChange={(e) => onCambiar('direccionEntregaId', e.target.value)}
              >
                <option value="">Domicilio principal del cliente</option>
                {direccionesVisibles.map((d) => (
                  <option key={d.id} value={d.id}>
                    {`${d.texto}${d.activa ? '' : ' (desactivada)'}`}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Observaciones" optional className={styles.ancho}>
            <Textarea rows={2} value={valores.notas} onChange={(e) => onCambiar('notas', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </div>
  )
}
