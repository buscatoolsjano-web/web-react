import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import type { CabeceraBorrador, CampoCabecera } from '../lib/borrador'
import type { OpcionContacto, OpcionVendedor } from '../services/opciones'
import type { FormaDePago } from '@/modules/configuracion/services/maestros'
import { BuscadorCliente } from './BuscadorCliente'
import { SelectorFormaDePago } from '@/features/formasDePago/SelectorFormaDePago'
import { VendedoresDelDocumento } from './VendedoresDelDocumento'
import { ContactosDelDocumento } from './ContactosDelDocumento'
import styles from './CabeceraCotizacion.module.css'

/** Una serie con su autoridad, para el desplegable de la referencia. */
export interface OpcionSerie {
  codigo: string
  autoridad: string
}

export interface EditorCabeceraProps {
  valores: CabeceraBorrador
  vendedores: readonly OpcionVendedor[]
  /**
   * Las formas de pago de la empresa (Fase 68). El campo dejó de ser texto
   * libre. Vacío es válido: el campo es opcional.
   */
  formasDePago?: readonly FormaDePago[] | undefined
  cargandoFormasDePago?: boolean | undefined
  /**
   * Guardar una forma de pago nueva sin salir de la cabecera.
   *
   * Sin esto el desplegable no ofrece agregar: no toda pantalla tiene por qué
   * poder escribir en el catálogo.
   */
  onAgregarFormaDePago?: ((nombre: string) => Promise<string>) | undefined
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
  /**
   * El equipo de contactos del documento (Fase 40 · subido acá en la 199).
   *
   * Va al lado de los agentes porque son la misma clase de dato —quiénes
   * llevan la venta por un lado, con quién se habla del otro— y el usuario los
   * quiere en una fila. Antes vivían en «Más información».
   */
  contactos: readonly OpcionContacto[]
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
  onCambiar: (campo: CampoCabecera, valor: string) => void
  /** Lo mismo para los vendedores, y por el mismo motivo (Fase 40). */
  onCambiarVendedores: (principal: string, acompanan: string[]) => void
  /**
   * Los contactos cambian de a dos —el principal y los que acompañan— por el
   * mismo motivo que los vendedores: mandarlos sueltos dejaría el documento,
   * entre una llamada y la otra, con dos principales o ninguno.
   */
  onCambiarContactos: (principal: string, secundarios: string[]) => void
  onCambiarCliente: (customerId: string) => void
}

/**
 * Cabecera del documento en modo edición (Fase 15 · E2, rehecha en 27 · E1).
 *
 * Todo lo que se escribe acá va al BORRADOR: **ni un solo control escribe en
 * la base**. El único camino de escritura es «Guardar».
 *
 * **Es la mitad de arriba**: los mismos campos que muestra la ficha cuando
 * el documento no se edita, en el mismo orden, para que apretar «Editar» no
 * reacomode la pantalla (Fase 84). El resto —moneda, tipo de cambio, tarifa,
 * domicilio, observaciones— vive en `EditorMasInformacion`, que escribe en el
 * MISMO borrador y se guarda con el mismo botón.
 *
 * La densidad también es del pedido: cada fila que se ahorra acá es una fila
 * menos de scroll antes de llegar a las líneas. Por eso la referencia y la
 * fecha comparten renglón, y los agentes y los contactos también (Fase 199).
 */
export function EditorCabecera({
  valores,
  vendedores,
  formasDePago = [],
  cargandoFormasDePago = false,
  onAgregarFormaDePago,
  series,
  serie,
  onCambiarSerie,
  numero,
  contactos,
  cargandoContactos,
  avisoContacto,
  onAbrirContactos,
  onCambiar,
  onCambiarCliente,
  onCambiarVendedores,
  onCambiarContactos,
}: EditorCabeceraProps) {
  const hayReferencia = series !== undefined || numero !== undefined

  const campoFecha = (
    <Field label="Fecha">
      <Input type="date" value={valores.fecha} onChange={(e) => onCambiar('fecha', e.target.value)} />
    </Field>
  )

  return (
    <div className={`${styles.bloques} ${styles.denso}`}>
      {/*
        Un solo grupo, no cuatro (Fase 84).

        Las cuatro secciones numeradas —«1. Datos generales», «2. Cliente»…—
        existían para que el editor y la ficha del documento guardado se
        vieran iguales (Fase 27 · E5). Lo siguen haciendo, pero ahora la que
        manda es la del sistema anterior: una tarjeta arriba con lo que
        identifica al documento, y una pestaña «Más información» con el resto.

        El rotulo del grupo va oculto a la vista por eso mismo —repetirlo
        seria decirlo dos veces— pero existe: un fieldset sin legend deja al
        grupo sin nombre para quien lo escucha.
      */}
      <fieldset className={styles.grupo}>
        <legend className="sr-only">Datos del documento</legend>
        <div className={styles.grilla}>
          {/* Referencia y Fecha en un solo renglón (Fase 199): la serie ocupa
              lo que mide su texto, el número toma el resto, y la fecha entra
              al lado. Así se gana una fila. */}
          {hayReferencia ? (
            <div className={`${styles.parRef} ${styles.ancho}`}>
              <div className={styles.campo}>
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
              {campoFecha}
            </div>
          ) : (
            campoFecha
          )}

          {/* «Válida hasta» se fue en la Fase 28 · E11: no aplica al negocio,
              y de las 307 cotizaciones de la base ninguna la tenía cargada. */}

          {/* Obligatorio desde la Fase 27 · E1: es el renglón que sale impreso
              debajo de «COTIZACIÓN DE VENTA», y un documento sin él llega al
              cliente sin decir de qué es. */}
          <Field label="Título" required className={styles.ancho}>
            <Input value={valores.titulo} onChange={(e) => onCambiar('titulo', e.target.value)} />
          </Field>
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

          <Field label="Forma de pago" optional className={styles.ancho}>
            <SelectorFormaDePago
              valor={valores.formaPago}
              opciones={formasDePago}
              cargando={cargandoFormasDePago}
              onCambiar={(v) => onCambiar('formaPago', v)}
              onAgregar={onAgregarFormaDePago}
            />
          </Field>

          {/* Agentes y Contactos en un solo renglón (Fase 199): quién lleva la
              venta y con quién se habla, alineados, como pidió el usuario. */}
          <div className={`${styles.par} ${styles.ancho}`}>
            {/* Varios agentes, con uno principal (Fase 40): pasa seguido que
                uno abra la cuenta y otro la siga, o que la parte técnica la
                lleve uno y la comercial otro. */}
            <Field label="Agentes" optional>
              <VendedoresDelDocumento
                vendedores={vendedores}
                principal={valores.vendedorId}
                acompanan={valores.vendedoresExtra}
                onCambiar={onCambiarVendedores}
              />
            </Field>

            <Field
              label="Contactos"
              optional
              help={
                avisoContacto
                  ? 'Cambió el cliente: se quitó el contacto anterior.'
                  : valores.customerId !== '' && contactos.length === 0 && !cargandoContactos
                    ? 'El cliente no tiene contactos cargados.'
                    : undefined
              }
            >
              <div className={styles.linea}>
                {/* Varios contactos, con uno principal (Fase 40): una venta la
                    siguen el de compras, el que especifica y el que paga. */}
                <ContactosDelDocumento
                  contactos={contactos}
                  principal={valores.contactoId}
                  secundarios={valores.contactosExtra}
                  disabled={valores.customerId === ''}
                  cargando={cargandoContactos}
                  onCambiar={onCambiarContactos}
                />
                {/* Crear un contacto sin abandonar el documento (Fase 28 · E14).
                    El texto es corto a propósito: el nombre largo queda en el
                    `aria-label`, que nombra la ACCIÓN y no la cosa. */}
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
          </div>
        </div>
      </fieldset>
    </div>
  )
}
