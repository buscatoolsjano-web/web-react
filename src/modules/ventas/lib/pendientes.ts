/**
 * Pedido / entregado / pendiente por línea — y cuándo NO hay que calcularlo.
 *
 * Este archivo es el único lugar de la migración donde la interfaz puede
 * mentir sobre el histórico, así que hace una sola cosa y no adivina nada.
 *
 * El contexto, medido en Stage 2.5 sobre los 166 pedidos migrados:
 *
 *   126  todas sus líneas de entrega enlazadas       → pendiente real
 *     5  sin entrega y sin remito huérfano del cliente → entregado = 0, confiable
 *    21  sin entrega PERO con un remito huérfano del mismo cliente
 *    14  con entrega y alguna línea sin enlazar
 *
 * Los 21 son el caso importante: hay 42 remitos que el legacy nunca enlazó a
 * un pedido, y 28 de ellos son de un cliente que además tiene un pedido sin
 * entregas. Decir "pendiente = todo lo pedido" ahí sería afirmar que no se
 * entregó, y eso NO está demostrado.
 *
 *   NO CONSTA ENTREGA  ≠  NO ENTREGADO
 */

export type EstadoDeEntrega =
  /** Hay evidencia por línea: se puede mostrar pedido / entregado / pendiente. */
  | 'RECONSTRUIDO'
  /** No consta ninguna entrega, y podría haberla. No se calcula pendiente. */
  | 'NO_CONSTA_ENTREGA'
  /** Hay entregas, pero no se sabe a qué líneas corresponden. */
  | 'DETALLE_NO_RECONSTRUIDO'

/** Lo mínimo que hace falta de una línea de pedido. */
export interface LineaPedidoParaCalculo {
  id: string
  cantidadPedida: number
}

/** Lo mínimo que hace falta de una línea de entrega. */
export interface LineaEntregaParaCalculo {
  ordenLineaId: string | null
  cantidad: number
}

export interface PendientePorLinea {
  lineaId: string
  pedido: number
  entregado: number
  /** Nunca negativo. El exceso se informa aparte. */
  pendiente: number
  /** Cuánto se entregó DE MÁS. 0 en el caso normal. */
  exceso: number
}

export interface ResultadoPendientes {
  estado: EstadoDeEntrega
  /** Vacío salvo en `RECONSTRUIDO`: sin evidencia no se devuelve ningún número. */
  porLinea: PendientePorLinea[]
  /** Cuántas líneas de entrega no se pudieron enlazar. */
  lineasSinEnlazar: number
  /** `true` si alguna línea recibió más de lo pedido. */
  hayExceso: boolean
}

export interface EntradaPendientes {
  lineasPedido: readonly LineaPedidoParaCalculo[]
  /** Líneas de TODAS las entregas enlazadas a este pedido. */
  lineasEntrega: readonly LineaEntregaParaCalculo[]
  /** ¿Hay entregas enlazadas a este pedido? */
  hayEntregasEnlazadas: boolean
  /**
   * ¿El cliente tiene algún remito sin pedido?
   *
   * Si lo tiene, la ausencia de entregas no prueba nada: puede ser una de
   * esas. Es la diferencia entre los 5 pedidos limpios y los 21 dudosos.
   */
  hayRemitosHuerfanosDelCliente: boolean
}

export function calcularPendientes({
  lineasPedido,
  lineasEntrega,
  hayEntregasEnlazadas,
  hayRemitosHuerfanosDelCliente,
}: EntradaPendientes): ResultadoPendientes {
  const sinEnlazar = lineasEntrega.filter((l) => l.ordenLineaId === null).length

  if (!hayEntregasEnlazadas) {
    if (hayRemitosHuerfanosDelCliente) {
      return {
        estado: 'NO_CONSTA_ENTREGA',
        porLinea: [],
        lineasSinEnlazar: 0,
        hayExceso: false,
      }
    }
    // Sin entregas y sin ningún remito suelto del cliente: entregado = 0 es
    // una afirmación que el dato sí respalda.
    return {
      estado: 'RECONSTRUIDO',
      porLinea: lineasPedido.map((l) => ({
        lineaId: l.id,
        pedido: l.cantidadPedida,
        entregado: 0,
        pendiente: l.cantidadPedida,
        exceso: 0,
      })),
      lineasSinEnlazar: 0,
      hayExceso: false,
    }
  }

  // Hay entregas. Si una sola de sus líneas no se pudo enlazar, el reparto por
  // línea deja de ser confiable para TODO el pedido: esa cantidad podría
  // pertenecer a cualquiera de ellas.
  if (sinEnlazar > 0) {
    return {
      estado: 'DETALLE_NO_RECONSTRUIDO',
      porLinea: [],
      lineasSinEnlazar: sinEnlazar,
      hayExceso: false,
    }
  }

  const entregadoPorLinea = new Map<string, number>()
  for (const l of lineasEntrega) {
    if (l.ordenLineaId === null) continue
    entregadoPorLinea.set(l.ordenLineaId, (entregadoPorLinea.get(l.ordenLineaId) ?? 0) + l.cantidad)
  }

  const porLinea = lineasPedido.map((l) => {
    const entregado = entregadoPorLinea.get(l.id) ?? 0
    const diferencia = l.cantidadPedida - entregado
    return {
      lineaId: l.id,
      pedido: l.cantidadPedida,
      entregado,
      pendiente: diferencia > 0 ? diferencia : 0,
      exceso: diferencia < 0 ? -diferencia : 0,
    }
  })

  return {
    estado: 'RECONSTRUIDO',
    porLinea,
    lineasSinEnlazar: 0,
    hayExceso: porLinea.some((l) => l.exceso > 0),
  }
}
