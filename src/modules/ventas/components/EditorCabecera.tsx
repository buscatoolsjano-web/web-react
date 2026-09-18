import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { MONEDAS_DOCUMENTO as MONEDAS } from '../lib/moneda'
import type { CabeceraBorrador, CampoCabecera } from '../lib/borrador'
import type {
  OpcionContacto,
  OpcionDireccion,
  OpcionTarifa,
  OpcionVendedor,
} from '../services/opciones'
import { BuscadorCliente } from './BuscadorCliente'
import styles from './CabeceraCotizacion.module.css'

export interface EditorCabeceraProps {
  valores: CabeceraBorrador
  contactos: readonly OpcionContacto[]
  /**
   * Los domicilios de entrega del cliente (Fase 17 · E3). Sin la prop no se
   * muestra el campo: la cotización no entrega nada, el pedido sí.
   */
  direcciones?: readonly OpcionDireccion[] | undefined
  cargandoDirecciones?: boolean | undefined
  tarifas: readonly OpcionTarifa[]
  vendedores: readonly OpcionVendedor[]
  cargandoContactos: boolean
  /** El cambio de cliente dejó al documento sin contacto. */
  avisoContacto: boolean
  /** El cambio de moneda dejó la tarifa incompatible. */
  avisoTarifa: boolean
  /** El pedido no tiene fecha de validez; la cotización sí. */
  mostrarValidez?: boolean | undefined
  onCambiar: (campo: CampoCabecera, valor: string) => void
  onCambiarCliente: (customerId: string) => void
  onCambiarMoneda: (moneda: string) => void
}

/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
const PERCEPCION_HABITUAL = '2.5'

/**
 * Cabecera de la cotización en modo edición (Fase 15 · E2).
 *
 * Todo lo que se escribe acá va al BORRADOR: **ni un solo control escribe en
 * la base**. El único camino de escritura es «Guardar cambios».
 *
 * Tres campos que el modelo ya tenía y no tenían control —contacto, vendedor y
 * tarifa—. La tarifa además necesitó una columna nueva: hasta E2 la lista de
 * precios vivía sólo en el cliente y no decía con cuál se había cotizado.
 */
export function EditorCabecera({
  direcciones,
  cargandoDirecciones = false,
  valores,
  contactos,
  tarifas,
  vendedores,
  cargandoContactos,
  avisoContacto,
  avisoTarifa,
  mostrarValidez = true,
  onCambiar,
  onCambiarCliente,
  onCambiarMoneda,
}: EditorCabeceraProps) {
  const numero = { type: 'number', step: 'any', min: '0' } as const
  // Sólo se ofrecen las tarifas de la moneda del documento: una de otra moneda
  // exigiría un tipo de cambio que nadie definió, y la base la rechaza.
  const compatibles = tarifas.filter((t) => t.moneda === valores.moneda)
  const ocultas = tarifas.length - compatibles.length
  // Un contacto o una dirección desactivados no se ofrecen… salvo que el
  // documento ya los nombre. En ese caso se muestran, marcados: esconderlos
  // haría que el desplegable quedara en blanco y que guardar borrara el dato
  // sin que nadie lo pidiera.
  const contactosVisibles = contactos.filter((c) => c.activo || c.id === valores.contactoId)
  const direccionesVisibles = (direcciones ?? []).filter(
    (d) => d.activa || d.id === valores.direccionEntregaId,
  )

  return (
    <div className={styles.bloques}>
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Cliente y referencia</legend>
        <div className={styles.grilla}>
          <div className={`${styles.campo} ${styles.ancho}`}>
            {/* El buscador tiene su propio input con su `aria-label`, así que
                acá va un rótulo y no un `<label for>` que apuntaría a nada. */}
            <span className={styles.etiqueta}>Cliente</span>
            <BuscadorCliente
              valor={valores.customerId || null}
              editable
              onElegir={(elegido) => onCambiarCliente(elegido ?? '')}
            />
          </div>

          <Field
            label="Contacto"
            optional
            help={
              avisoContacto
                ? 'Cambió el cliente, así que se quitó el contacto: era de otro.'
                : valores.customerId !== '' && contactos.length === 0 && !cargandoContactos
                  ? 'Este cliente todavía no tiene contactos cargados.'
                  : undefined
            }
          >
            <Select
              value={valores.contactoId}
              disabled={valores.customerId === '' || cargandoContactos}
              onChange={(e) => onCambiar('contactoId', e.target.value)}
            >
              <option value="">Sin contacto</option>
              {contactosVisibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.rol ? `${c.nombre} · ${c.rol}` : c.nombre}${c.activo ? '' : ' (desactivado)'}`}
                </option>
              ))}
            </Select>
          </Field>

          {direcciones ? (
            <Field
              label="Entregar en"
              optional
              className={styles.ancho}
              help={
                valores.customerId !== '' &&
                direccionesVisibles.length === 0 &&
                !cargandoDirecciones
                  ? 'Este cliente no tiene domicilios de entrega cargados. Se cargan en su ficha.'
                  : valores.direccionEntregaId === '' && direccionesVisibles.length > 0
                    ? 'Sin elegir, el remito usa el domicilio principal del cliente en el momento de emitirlo.'
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

          <Field label="Título" optional className={styles.ancho}>
            <Input value={valores.titulo} onChange={(e) => onCambiar('titulo', e.target.value)} />
          </Field>

          <Field label="Vendedor" optional>
            <Select value={valores.vendedorId} onChange={(e) => onCambiar('vendedorId', e.target.value)}>
              <option value="">Sin asignar</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Fechas y condiciones</legend>
        <div className={styles.grilla}>
          <Field label="Fecha">
            <Input type="date" value={valores.fecha} onChange={(e) => onCambiar('fecha', e.target.value)} />
          </Field>

          {mostrarValidez ? (
            <Field label="Válida hasta" optional>
              <Input type="date" value={valores.validaHasta} onChange={(e) => onCambiar('validaHasta', e.target.value)} />
            </Field>
          ) : null}

          <Field label="Moneda" help="Cambiarla puede dejar la tarifa incompatible.">
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

          <Field
            label="Tarifa"
            optional
            help={
              avisoTarifa
                ? 'Cambió la moneda y la tarifa anterior estaba en otra: se quitó.'
                : valores.moneda === ''
                  ? 'Elegí primero la moneda: sólo se ofrecen las tarifas de esa moneda.'
                  : ocultas > 0
                  ? `Sólo las tarifas en ${valores.moneda}. Es la que sugiere el precio de las líneas nuevas.`
                  : 'Sugiere el precio de cada línea nueva. Las líneas ya cargadas no cambian, ni siquiera si después se cambia la tarifa.'
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

          <Field label="Tipo de cambio" optional>
            <Input {...numero} inputMode="decimal" value={valores.tipoCambio} onChange={(e) => onCambiar('tipoCambio', e.target.value)} />
          </Field>

          <Field label="Forma de pago" optional>
            <Input value={valores.formaPago} onChange={(e) => onCambiar('formaPago', e.target.value)} />
          </Field>

          <Field label="% Dto. global" optional>
            <Input {...numero} max="100" inputMode="decimal" value={valores.descuentoPct} onChange={(e) => onCambiar('descuentoPct', e.target.value)} />
          </Field>

          <Field label="% Percepción IIBB" optional>
            <div className={styles.linea}>
              <Input {...numero} max="100" inputMode="decimal" value={valores.percepcionPct} onChange={(e) => onCambiar('percepcionPct', e.target.value)} />
              <Button variant="ghost" size="sm" onClick={() => onCambiar('percepcionPct', PERCEPCION_HABITUAL)}>
                {PERCEPCION_HABITUAL} %
              </Button>
            </div>
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Observaciones</legend>
        <div className={styles.grilla}>
          <Field label="Observaciones" optional className={styles.ancho}>
            <Textarea rows={3} value={valores.notas} onChange={(e) => onCambiar('notas', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </div>
  )
}
