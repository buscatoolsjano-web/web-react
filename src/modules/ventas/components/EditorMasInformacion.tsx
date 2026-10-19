import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { MONEDAS_DOCUMENTO as MONEDAS } from '../lib/moneda'
import type { CabeceraBorrador, CampoCabecera } from '../lib/borrador'
import type { OpcionContacto, OpcionDireccion } from '../services/opciones'
import { ContactosDelDocumento } from './ContactosDelDocumento'
import styles from './CabeceraCotizacion.module.css'

export interface EditorMasInformacionProps {
  valores: CabeceraBorrador
  contactos: readonly OpcionContacto[]
  cargandoContactos: boolean
  /** El cambio de cliente dejó al documento sin contacto. */
  avisoContacto: boolean
  /**
   * Los domicilios de entrega del cliente (Fase 17 · E3). Sin la prop no se
   * muestra el campo: la cotización no entrega nada, el pedido sí.
   */
  direcciones?: readonly OpcionDireccion[] | undefined
  cargandoDirecciones?: boolean | undefined
  /**
   * Abrir la agenda de contactos del cliente (Fase 28 · E14).
   *
   * Sin esto no se dibuja el botón: hay pantallas donde el documento no se
   * edita, y ahí no hay nada que agendar.
   */
  onAbrirContactos?: (() => void) | undefined
  onCambiar: (campo: CampoCabecera, valor: string) => void
  /**
   * El equipo de contactos del documento (Fase 40).
   *
   * Va aparte de `onCambiar` porque son DOS valores que cambian juntos —quién
   * es el principal y quiénes lo acompañan— y mandarlos por separado dejaría
   * al documento, entre una llamada y la otra, con dos principales o ninguno.
   */
  onCambiarContactos: (principal: string, secundarios: string[]) => void
  onCambiarMoneda: (moneda: string) => void
}

/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
const PERCEPCION_HABITUAL = '2.5'

/**
 * La otra mitad de la cabecera, la de «Más información» (Fase 84).
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * La tarjeta de arriba muestra nueve datos cuando se mira el documento, y el
 * editor mostraba dieciséis: apretar «Editar» agregaba siete filas y la
 * pantalla se reacomodaba entera. Dicho por quien lo usa: «se ponen un montón
 * de filas nuevas cuando pongo editar, y no quiero que pase eso».
 *
 * La respuesta es la del sistema anterior, que tiene el mismo problema
 * resuelto: la tarjeta de arriba lleva lo que identifica al documento —y es
 * igual mirando que editando— y todo lo demás vive en una pestaña «Más
 * información», donde también se edita.
 *
 * Así que esto NO es un formulario nuevo: son los campos que estaban en
 * `EditorCabecera` y se mudaron. Escriben en el MISMO borrador, con el mismo
 * `onCambiar`, y se guardan con el mismo botón. Ni un control escribe en la
 * base: el único camino de escritura sigue siendo «Guardar».
 *
 * ── QUÉ ENTRA ───────────────────────────────────────────────────────────────
 *
 * Lo que el sistema anterior tiene en esa pestaña y nosotros tenemos: moneda,
 * tipo de cambio, domicilio de entrega y observaciones. Más dos que allá son
 * casillas en la tarjeta —el descuento global y la percepción— y acá son
 * porcentajes: son condiciones que se fijan una vez y no se miran después.
 *
 * Y los contactos, que allá se abren con un icono al lado del cliente. Acá
 * son un campo, porque un documento puede llevar varios y hay que elegirlos.
 */
export function EditorMasInformacion({
  valores,
  contactos,
  cargandoContactos,
  avisoContacto,
  direcciones,
  cargandoDirecciones = false,
  onAbrirContactos,
  onCambiar,
  onCambiarContactos,
  onCambiarMoneda,
}: EditorMasInformacionProps) {
  const numeroInput = { type: 'number', step: 'any', min: '0' } as const
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
          <Field
            label="Contactos"
            optional
            help={
              avisoContacto
                ? 'Cambió el cliente, así que se quitó el contacto: era de otro.'
                : valores.customerId !== '' && contactos.length === 0 && !cargandoContactos
                  ? 'Este cliente todavía no tiene contactos cargados.'
                  : undefined
            }
          >
            <div className={styles.linea}>
              {/* Varios contactos, con uno principal (Fase 40): una venta la
                  siguen el de compras, el que especifica y el que paga. Antes
                  había que elegir a uno y escribir los otros en las
                  observaciones, donde no sirven para nada. */}
              <ContactosDelDocumento
                contactos={contactos}
                principal={valores.contactoId}
                secundarios={valores.contactosExtra}
                disabled={valores.customerId === ''}
                cargando={cargandoContactos}
                onCambiar={onCambiarContactos}
              />
              {/* Crear un contacto sin abandonar el documento (Fase 28 · E14).
                  El texto es corto a propósito: «Contactos del cliente…» no
                  entra en una línea de la columna. El nombre largo queda en el
                  `aria-label`, que nombra la ACCIÓN y no la cosa para que no
                  se confunda con el campo que tiene al lado. */}
              {onAbrirContactos ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={styles.botonAgenda}
                  aria-label="Abrir la agenda de contactos del cliente"
                  disabled={valores.customerId === ''}
                  onClick={onAbrirContactos}
                >
                  Contactos…
                </Button>
              ) : null}
            </div>
          </Field>

          {/* Fase 17 · E3: en el pedido es el domicilio ELEGIDO, que todavía se
              puede cambiar. Sin elegir no se usa el del cliente de hoy: se dice
              que el remito va a tomar el principal al emitirse, que es lo que
              efectivamente pasa. */}
          {direcciones ? (
            <Field
              label="Entregar en"
              optional
              help={
                valores.customerId !== '' && direccionesVisibles.length === 0 && !cargandoDirecciones
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

          <Field label="% Dto. global" optional>
            <Input
              {...numeroInput}
              max="100"
              inputMode="decimal"
              value={valores.descuentoPct}
              onChange={(e) => onCambiar('descuentoPct', e.target.value)}
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

          <Field label="Tipo de cambio" optional>
            <Input
              {...numeroInput}
              inputMode="decimal"
              value={valores.tipoCambio}
              onChange={(e) => onCambiar('tipoCambio', e.target.value)}
            />
          </Field>

          <Field label="Observaciones" optional className={styles.ancho}>
            <Textarea rows={2} value={valores.notas} onChange={(e) => onCambiar('notas', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </div>
  )
}
