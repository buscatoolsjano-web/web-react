import { describe, expect, it } from 'vitest'
import { presentarCumplimiento, presentarEstado, presentarEstadoPedido } from './estados'

/**
 * El guardián de una duplicación que no se puede evitar (Fase 74).
 *
 * La columna Estado del listado ordena por `estado_visible`, una columna
 * calculada por la base que devuelve la misma palabra que dibuja el chip. Es
 * la única forma de que «a-z» ordene por lo que se LEE: el orden lo hace la
 * base, que es la que pagina, y la palabra la elige la pantalla.
 *
 * El precio es que las etiquetas están escritas en dos lados: en `estados.ts`
 * y en la función SQL. Esto es lo que impide que se separen. Si alguien
 * renombra un estado acá y no allá, este test falla y dice dónde ir.
 *
 * La lista de abajo es, textual, la de
 * `scripts/fase74-ordenar-por-lo-que-se-lee.sql`.
 */
const SQL_COTIZACION: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Pendiente',
  accepted: 'Cerrada',
  rejected: 'Rechazada',
  expired: 'Vencida',
}

const SQL_ENTREGA: Record<string, string> = {
  draft: 'Borrador',
  shipped: 'Despachada',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
}

const SQL_PEDIDO_COMERCIAL: Record<string, string> = {
  draft: 'Borrador',
  cancelled: 'Cancelado',
}

const SQL_PEDIDO_CUMPLIMIENTO: Record<string, string> = {
  pending: 'Sin entregar',
  partially_reserved: 'Reserva parcial',
  reserved: 'Reservado',
  partially_delivered: 'Entrega parcial',
  delivered: 'Entregado',
}

describe('la base y la pantalla dicen la misma palabra', () => {
  it('cotizaciones', () => {
    for (const [codigo, palabra] of Object.entries(SQL_COTIZACION)) {
      expect(presentarEstado('cotizacion', codigo).etiqueta).toBe(palabra)
    }
  })

  it('remitos', () => {
    for (const [codigo, palabra] of Object.entries(SQL_ENTREGA)) {
      expect(presentarEstado('entrega', codigo).etiqueta).toBe(palabra)
    }
  })

  /*
   * En pedidos la regla tiene dos mitades: el comercial sólo gana cuando dice
   * algo que el avance no puede decir —borrador o cancelado—. La función SQL
   * la escribe igual, y acá se comprueban las dos.
   */
  it('pedidos: el comercial gana en borrador y cancelado', () => {
    for (const [codigo, palabra] of Object.entries(SQL_PEDIDO_COMERCIAL)) {
      // Con cualquier avance: el comercial manda igual.
      expect(presentarEstadoPedido(codigo, 'delivered').etiqueta).toBe(palabra)
      expect(presentarEstadoPedido(codigo, 'pending').etiqueta).toBe(palabra)
    }
  })

  it('pedidos: en los demás manda el avance de entrega', () => {
    for (const [codigo, palabra] of Object.entries(SQL_PEDIDO_CUMPLIMIENTO)) {
      expect(presentarCumplimiento(codigo).etiqueta).toBe(palabra)
      expect(presentarEstadoPedido('confirmed', codigo).etiqueta).toBe(palabra)
    }
  })

  /*
   * Y que la lista de la base no se quede corta: un estado nuevo en la
   * pantalla tiene que entrar también en el SQL, o los documentos que lo usen
   * se ordenarían por su código crudo y aparecerían sueltos en el medio.
   */
  it('no hay estados en la pantalla que la base no conozca', () => {
    const deLaPantalla = (tipo: 'cotizacion' | 'entrega', codigos: string[]) =>
      codigos.every((c) => presentarEstado(tipo, c).etiqueta !== c)
    expect(deLaPantalla('cotizacion', Object.keys(SQL_COTIZACION))).toBe(true)
    expect(deLaPantalla('entrega', Object.keys(SQL_ENTREGA))).toBe(true)
    // Un código que la pantalla no conoce se muestra crudo: eso es lo que
    // este test detecta del otro lado.
    expect(presentarEstado('cotizacion', 'inventado').etiqueta).toBe('inventado')
  })
})
