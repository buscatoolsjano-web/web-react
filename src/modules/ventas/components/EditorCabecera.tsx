import { useId } from 'react'
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
  const idDoc = useId()
  const idCli = useId()

  const campoFecha = (
    <Field label="Fecha">
      <Input type="date" value={valores.fecha} onChange={(e) => onCambiar('fecha', e.target.value)} />
    </Field>
  )

  return (
    <div className={styles.bloques}>
      {/*
        Dos paneles, cada uno con su color (Fase 231).

        «Optimizá para que se vea bien, jugá con lo visual y con los colores
        así es más fácil de ver.» Antes era una sola grilla de rótulos a la
        izquierda donde todo pesaba igual: la referencia quedaba corrida a la
        derecha, el rótulo «Cliente» flotaba a media altura de su buscador y
        agentes/contactos iban con otra alineación. Ahora:
          · «Documento» (color del módulo): referencia, fecha, título y forma
            de pago —lo que identifica y condiciona al papel—.
          · «Cliente» (azul): a quién va, con quién se habla y quién lo lleva.
        Cada dato es un renglón con el rótulo en la misma columna, alineado con
        el PRIMER renglón de su control aunque el control sea alto.

        El fieldset sigue teniendo su legend (oculto) para quien lo escucha.
      */}
      <fieldset className={styles.grupo}>
        <legend className="sr-only">Datos del documento</legend>
        <div className={styles.paneles}>
          <div role="group" className={`${styles.panel} ${styles.panelDocumento}`} aria-labelledby={idDoc}>
            <p className={styles.panelTitulo} id={idDoc}>
              Documento
            </p>
            <div className={styles.campos}>
              {hayReferencia ? (
                <div className={styles.campo}>
                  <span className={styles.etiqueta}>Referencia</span>
                  {series && series.length > 1 && onCambiarSerie ? (
                    <div className={styles.referencia}>
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
                      <span className={styles.refNumero}>{numero ?? 'número al guardar'}</span>
                    </div>
                  ) : (
                    // Serie + número son UN dato («COT-BTS 00008»): una sola
                    // etiqueta destacada, no dos cajas punteadas sueltas. El
                    // número lo pone el servidor al crear, y se dice.
                    <span className={styles.refEtiqueta}>
                      <span className={styles.refSerie}>{serie ?? '—'}</span>
                      <span className={styles.refNumero}>{numero ?? 'número al guardar'}</span>
                    </span>
                  )}
                </div>
              ) : null}
              {campoFecha}

              {/* Obligatorio desde la Fase 27 · E1: es el renglón que sale
                  impreso debajo de «COTIZACIÓN DE VENTA». */}
              <Field label="Título" required className={styles.ancho}>
                <Input value={valores.titulo} onChange={(e) => onCambiar('titulo', e.target.value)} />
              </Field>

              <Field label="Forma de pago" optional className={styles.ancho}>
                <SelectorFormaDePago
                  valor={valores.formaPago}
                  opciones={formasDePago}
                  cargando={cargandoFormasDePago}
                  onCambiar={(v) => onCambiar('formaPago', v)}
                  onAgregar={onAgregarFormaDePago}
                />
              </Field>
            </div>
          </div>

          <div role="group" className={`${styles.panel} ${styles.panelCliente}`} aria-labelledby={idCli}>
            <p className={styles.panelTitulo} id={idCli}>
              Cliente
            </p>
            <div className={styles.campos}>
              <div className={`${styles.campo} ${styles.ancho}`}>
                {/* El buscador tiene su propio input con su `aria-label`, así
                    que acá va un rótulo y no un `<label for>`. */}
                <span className={styles.etiqueta}>Cliente</span>
                <BuscadorCliente
                  valor={valores.customerId || null}
                  editable
                  onElegir={(elegido) => onCambiarCliente(elegido ?? '')}
                />
              </div>

            <Field
              className={styles.ancho}
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

              {/* Varios agentes, con uno principal (Fase 40): pasa seguido que
                  uno abra la cuenta y otro la siga. Va con el cliente: es
                  quién lleva la relación. */}
              <Field label="Agentes" optional className={styles.ancho}>
                <VendedoresDelDocumento
                  vendedores={vendedores}
                  principal={valores.vendedorId}
                  acompanan={valores.vendedoresExtra}
                  onCambiar={onCambiarVendedores}
                />
              </Field>
            </div>
          </div>
        </div>
      </fieldset>
    </div>
  )
}
