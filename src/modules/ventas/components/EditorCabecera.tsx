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

/** Una serie con su autoridad, para el desplegable de la referencia. */
export interface OpcionSerie {
  codigo: string
  autoridad: string
}

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
  /**
   * Abrir la agenda de contactos del cliente (Fase 28 · E14).
   *
   * Sin esto no se dibuja el botón: hay pantallas donde el documento no se
   * edita, y ahí no hay nada que agendar.
   */
  onAbrirContactos?: (() => void) | undefined
  /** El cambio de moneda dejó la tarifa incompatible. */
  avisoTarifa: boolean
  /**
   * La referencia (Fase 27 · E1). Sólo en el alta: un documento que ya existe
   * tiene su número y su serie, y no se cambian.
   *
   * `series` con una sola opción muestra el código sin desplegable: no hay
   * nada que elegir.
   */
  series?: readonly OpcionSerie[] | undefined
  serie?: string | undefined
  onCambiarSerie?: ((codigo: string) => void) | undefined
  /** El número, cuando el documento ya lo tiene. En el alta lo pone el servidor. */
  numero?: string | undefined
  onCambiar: (campo: CampoCabecera, valor: string) => void
  onCambiarCliente: (customerId: string) => void
  onCambiarMoneda: (moneda: string) => void
}

/** La percepción del legacy es 2,5 %, pero la alícuota se guarda, no se fija. */
const PERCEPCION_HABITUAL = '2.5'

/**
 * Cabecera del documento en modo edición (Fase 15 · E2, rehecha en 27 · E1).
 *
 * Todo lo que se escribe acá va al BORRADOR: **ni un solo control escribe en
 * la base**. El único camino de escritura es «Guardar».
 *
 * **Cuatro secciones numeradas**, las del sistema anterior y en su orden:
 * datos generales, cliente, condiciones y otros datos. No es decoración: el
 * orden es el de la conversación con el cliente —qué documento es, para quién,
 * en qué condiciones, y recién después el resto— y numerarlas deja nombrarlas
 * sin describirlas.
 *
 * La densidad también es del pedido: cada fila que se ahorra acá es una fila
 * menos de scroll antes de llegar a las líneas.
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
  onAbrirContactos,
  avisoTarifa,
  series,
  serie,
  onCambiarSerie,
  numero,
  onCambiar,
  onCambiarCliente,
  onCambiarMoneda,
}: EditorCabeceraProps) {
  const numeroInput = { type: 'number', step: 'any', min: '0' } as const
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
  const hayReferencia = series !== undefined || numero !== undefined

  return (
    <div className={styles.bloques}>
      {/* ── 1 · datos generales ─────────────────────────────────────── */}
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>1. Datos generales</legend>
        <div className={styles.grilla}>
          {hayReferencia ? (
            <div className={`${styles.campo} ${styles.ancho}`}>
              <span className={styles.etiqueta}>Referencia</span>
              <div className={styles.referencia}>
                {series && series.length > 1 && onCambiarSerie ? (
                  <Select
                    aria-label="Serie del documento"
                    value={serie ?? ''}
                    onChange={(e) => onCambiarSerie(e.target.value)}
                  >
                    {series.map((s) => (
                      <option key={s.codigo} value={s.codigo}>
                        {s.codigo} — {s.autoridad === 'ERP' ? 'se emite desde el ERP' : 'la numera STEL'}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className={styles.numeroPendiente}>{serie ?? '—'}</span>
                )}
                {/* El número lo asigna el servidor al crear: decirlo es mejor
                    que un campo vacío que parece que falta completar. */}
                <span className={styles.numeroPendiente}>{numero ?? 'lo asigna el servidor'}</span>
              </div>
            </div>
          ) : null}

          <Field label="Fecha">
            <Input type="date" value={valores.fecha} onChange={(e) => onCambiar('fecha', e.target.value)} />
          </Field>

          {/* «Válida hasta» se fue en la Fase 28 · E11: no aplica al negocio,
              y de las 307 cotizaciones de la base ninguna la tenía cargada. */}

          {/* Obligatorio desde la Fase 27 · E1: es el renglón que sale impreso
              debajo de «COTIZACIÓN DE VENTA», y un documento sin él llega al
              cliente sin decir de qué es. */}
          <Field label="Título" required className={styles.ancho}>
            <Input value={valores.titulo} onChange={(e) => onCambiar('titulo', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      {/* ── 2 · cliente ─────────────────────────────────────────────── */}
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>2. Cliente</legend>
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
          {/* Fase 28 · E14: crear un contacto sin abandonar el documento. Antes
              había que irse a la ficha del cliente y volver a empezar. */}
          {onAbrirContactos ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.botonAgenda}
              disabled={valores.customerId === ''}
              onClick={onAbrirContactos}
            >
              Contactos del cliente…
            </Button>
          ) : null}

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
        </div>
      </fieldset>

      {/* ── 3 · condiciones ─────────────────────────────────────────── */}
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>3. Condiciones</legend>
        <div className={styles.grilla}>
          <Field label="Forma de pago" optional className={styles.ancho}>
            <Input value={valores.formaPago} onChange={(e) => onCambiar('formaPago', e.target.value)} />
          </Field>

          <Field label="% Dto. global" optional>
            <Input {...numeroInput} max="100" inputMode="decimal" value={valores.descuentoPct} onChange={(e) => onCambiar('descuentoPct', e.target.value)} />
          </Field>

          <Field label="% Percep. IIBB" optional>
            <div className={styles.linea}>
              <Input {...numeroInput} max="100" inputMode="decimal" value={valores.percepcionPct} onChange={(e) => onCambiar('percepcionPct', e.target.value)} />
              <Button variant="ghost" size="sm" onClick={() => onCambiar('percepcionPct', PERCEPCION_HABITUAL)}>
                {PERCEPCION_HABITUAL} %
              </Button>
            </div>
          </Field>
        </div>
      </fieldset>

      {/* ── 4 · otros datos ─────────────────────────────────────────── */}
      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>4. Otros datos</legend>
        <div className={styles.grilla}>
          <Field label="Agente" optional>
            <Select value={valores.vendedorId} onChange={(e) => onCambiar('vendedorId', e.target.value)}>
              <option value="">Sin asignar</option>
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
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
            <Input {...numeroInput} inputMode="decimal" value={valores.tipoCambio} onChange={(e) => onCambiar('tipoCambio', e.target.value)} />
          </Field>

          <Field label="Observaciones" optional className={styles.ancho}>
            <Textarea rows={2} value={valores.notas} onChange={(e) => onCambiar('notas', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </div>
  )
}
