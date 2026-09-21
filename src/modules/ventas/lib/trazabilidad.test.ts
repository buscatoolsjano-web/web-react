import { describe, expect, it } from 'vitest'
import { presentarEvento, type EventoAuditoria } from './trazabilidad'

const evento = (p: Partial<EventoAuditoria> = {}): EventoAuditoria => ({
  id: 1,
  accion: 'updated_sensitive_fields',
  desde: null,
  hasta: null,
  diff: null,
  actor: 'Lisandro',
  fecha: '2026-09-16T14:32:10.000Z',
  ...p,
})

describe('presentarEvento', () => {
  it('traduce la acción y firma con quién y cuándo', () => {
    const e = presentarEvento(evento({ accion: 'sent', desde: 'draft', hasta: 'sent' }), 'cotizacion')
    expect(e.titulo).toBe('Marcado como enviado')
    expect(e.quien).toBe('Lisandro')
    expect(e.cuando).toMatch(/16\/09\/2026/)
  })

  it('el cambio de estado se cuenta con las etiquetas del documento, no con el código', () => {
    const e = presentarEvento(evento({ accion: 'approved', desde: 'sent', hasta: 'accepted' }), 'cotizacion')
    expect(e.detalle).toEqual(['Estado: Pendiente → Cerrada'])
  })

  it('el diff se lee como una frase, con el nombre que usa la gente', () => {
    const e = presentarEvento(
      evento({ diff: { unit_price: { from: 100, to: 90 }, discount_pct: { from: null, to: 10 } } }),
      'cotizacion',
    )
    expect(e.detalle).toEqual(['Precio unitario: 100 → 90', 'Descuento: sin valor → 10'])
  })

  it('un valor que no es un número ni un texto no se vuelca crudo a la pantalla', () => {
    const e = presentarEvento(evento({ diff: { unit_price: { from: { a: 1 }, to: [1, 2] } } }), 'cotizacion')
    expect(e.detalle).toEqual(['Precio unitario: sin detalle → sin detalle'])
  })

  it('sin actor el evento lo escribió un proceso, y se dice así', () => {
    expect(presentarEvento(evento({ actor: null }), 'cotizacion').quien).toBe('Proceso del sistema')
  })

  it('los cambios de líneas se leen como frases, no como JSON (Fase 15 E2)', () => {
    const e = presentarEvento(
      evento({
        diff: {
          title: { from: 'Viejo', to: 'Nuevo' },
          lineas: [
            { accion: 'modificada', linea: 1, producto: 'ZZ-100', cambios: { quantity: { from: 4, to: 6 } } },
            { accion: 'eliminada', linea: 2, producto: 'ZZ-200', cantidad: 1, precio: 450 },
            { accion: 'agregada', linea: 3, producto: 'ZZ-300', cantidad: 2, precio: 80 },
          ],
        },
      }),
      'cotizacion',
    )
    expect(e.detalle).toEqual([
      'Título: Viejo → Nuevo',
      'Línea 1 (ZZ-100): cantidad 4 → 6',
      'Línea 2 (ZZ-200): eliminada (era 1 × 450)',
      'Línea 3 (ZZ-300): agregada, 2 × 80',
    ])
  })

  /** Fase 19 · E4: la conversión copia líneas; copiar no es modificar. */
  it('una línea copiada de la cotización se cuenta como copiada', () => {
    const e = presentarEvento(
      evento({
        accion: 'created',
        hasta: 'draft',
        diff: {
          lineas: [{ linea: 1, producto: '4134200', accion: 'copiada', cantidad: 1, precio: 130.5 }],
        },
      }),
      'pedido',
    )
    expect(e.detalle).toContain('Línea 1 (4134200): copiada de la cotización, 1 × 130,5')
    expect(e.detalle.join(' ')).not.toContain('modificada')
  })

  it('un campo que guarda una referencia NO muestra el uuid', () => {
    const e = presentarEvento(
      evento({
        diff: {
          contact_id: { from: null, to: '4684d90d-d2a4-40b0-9236-dcb42dbd6fc6' },
          price_list_id: { from: 'f1bbcd24-cf8b-4814-b0d5-99d6ee4abd03', to: null },
          salesperson_id: { from: 'a', to: 'b' },
        },
      }),
      'cotizacion',
    )
    expect(e.detalle).toEqual(['Contacto: se asignó', 'Tarifa: se quitó', 'Vendedor: cambió'])
    expect(e.detalle.join(' ')).not.toContain('4684d90d')
  })

  /**
   * Fase 19 · E3, visto en el piloto: el servidor guarda toda la edición con
   * la misma acción, así que el título lo decide el diff.
   */
  describe('el título de una edición dice lo que cambió', () => {
    it('una edición que no toca importes no se anuncia como de precios', () => {
      const e = presentarEvento(
        evento({ diff: { notes: { from: null, to: 'Retira el lunes' } } }),
        'cotizacion',
      )
      expect(e.titulo).toBe('Cambio en el documento')
      expect(e.detalle).toEqual(['Observaciones: sin valor → Retira el lunes'])
    })

    it('un precio, una cantidad o una línea nueva sí', () => {
      const precio = evento({ diff: { lineas: [{ linea: 1, producto: 'ZZ-100', cambios: { unit_price: { from: 100, to: 120 } } }] } })
      const linea = evento({ diff: { lineas: [{ linea: 2, producto: 'ZZ-200', accion: 'agregada', cantidad: 1, precio: 50 }] } })
      const global = evento({ diff: { discount_pct: { from: 0, to: 5 } } })
      for (const e of [precio, linea, global]) {
        expect(presentarEvento(e, 'cotizacion').titulo).toBe('Cambio en precios o cantidades')
      }
    })

    it('mover sólo la descripción de una línea tampoco es un cambio de importes', () => {
      const e = presentarEvento(
        evento({
          diff: {
            lineas: [{ linea: 1, producto: 'ZZ-100', cambios: { description_snapshot: { from: 'a', to: 'b' } } }],
          },
        }),
        'cotizacion',
      )
      expect(e.titulo).toBe('Cambio en el documento')
    })
  })

  it('una acción todavía sin traducción se muestra legible, no en crudo', () => {
    expect(presentarEvento(evento({ accion: 'stock_reserved' }), 'pedido').titulo).toBe('Stock reserved')
  })
})
