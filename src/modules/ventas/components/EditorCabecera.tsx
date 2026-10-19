import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import type { CabeceraBorrador, CampoCabecera } from '../lib/borrador'
import type { OpcionTarifa, OpcionVendedor } from '../services/opciones'
import type { FormaDePago } from '@/modules/configuracion/services/maestros'
import { BuscadorCliente } from './BuscadorCliente'
import { SelectorFormaDePago } from '@/features/formasDePago/SelectorFormaDePago'
import { VendedoresDelDocumento } from './VendedoresDelDocumento'
import styles from './CabeceraCotizacion.module.css'

/** Una serie con su autoridad, para el desplegable de la referencia. */
export interface OpcionSerie {
  codigo: string
  autoridad: string
}

export interface EditorCabeceraProps {
  valores: CabeceraBorrador
  tarifas: readonly OpcionTarifa[]
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
  /** Lo mismo para los vendedores, y por el mismo motivo (Fase 40). */
  onCambiarVendedores: (principal: string, acompanan: string[]) => void
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
 * reacomode la pantalla (Fase 84). El resto —moneda, tipo de cambio,
 * domicilio, observaciones, contactos— vive en `EditorMasInformacion`, que
 * escribe en el MISMO borrador y se guarda con el mismo botón.
 *
 * La densidad también es del pedido: cada fila que se ahorra acá es una fila
 * menos de scroll antes de llegar a las líneas.
 */
export function EditorCabecera({
  valores,
  tarifas,
  vendedores,
  formasDePago = [],
  cargandoFormasDePago = false,
  onAgregarFormaDePago,
  avisoTarifa,
  series,
  serie,
  onCambiarSerie,
  numero,
  onCambiar,
  onCambiarCliente,
  onCambiarVendedores,
}: EditorCabeceraProps) {
  // Sólo se ofrecen las tarifas de la moneda del documento: una de otra moneda
  // exigiría un tipo de cambio que nadie definió, y la base la rechaza.
  const compatibles = tarifas.filter((t) => t.moneda === valores.moneda)
  const ocultas = tarifas.length - compatibles.length
  const hayReferencia = series !== undefined || numero !== undefined

  return (
    <div className={`${styles.bloques} ${styles.denso}`}>
      {/*
        Un solo grupo, no cuatro (Fase 84).

        Las cuatro secciones numeradas —«1. Datos generales», «2. Cliente»…—
        existían para que el editor y la ficha del documento guardado se
        vieran iguales (Fase 27 · E5). Lo siguen haciendo, pero ahora la que
        manda es la del sistema anterior: una tarjeta arriba con lo que
        identifica al documento, y una pestaña «Más información» con el resto.
        Son dos grupos, uno por pestaña, y cada uno ya tiene su título en la
        sección que lo contiene.

        El rotulo del grupo va oculto a la vista por eso mismo —repetirlo
        seria decirlo dos veces— pero existe: un fieldset sin legend deja al
        grupo sin nombre para quien lo escucha.
      */}
      <fieldset className={styles.grupo}>
        <legend className="sr-only">Datos del documento</legend>
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


          {/* Varios agentes, con uno principal (Fase 40): pasa seguido que
              uno abra la cuenta y otro la siga, o que la parte técnica la
              lleve uno y la comercial otro. Antes el segundo no figuraba en
              ningún lado: ni en los rankings, ni para filtrar, ni para
              repartir. */}
          <Field label="Agentes" optional>
            <VendedoresDelDocumento
              vendedores={vendedores}
              principal={valores.vendedorId}
              acompanan={valores.vendedoresExtra}
              onCambiar={onCambiarVendedores}
            />
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



        </div>
      </fieldset>
    </div>
  )
}
