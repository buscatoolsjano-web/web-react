import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cruzaDeLado, leerParaCopiar, leerParametroCopia, type TipoCopiable } from '@/services/copiarDocumento'
import { agregarLinea, cambiarCampo, type Borrador } from '../lib/borrador'
import { productosPorId } from '../services/productosParaLinea'

export interface AvisoCopia {
  tono: 'info' | 'warning' | 'danger'
  texto: string
}

/**
 * «Duplicar como…» en el alta de una venta (Fase 233).
 *
 * Si la URL trae `?copiar=<tipo>:<id>`, carga UNA vez las líneas de ese
 * documento en el borrador, con su título, observaciones y moneda. El cliente
 * no se copia: si el origen es una compra no hay cliente que copiar, y si es
 * otra venta la persona elige o confirma a quién va.
 *
 * El precio: desde otra venta, el mismo. Desde una compra, el de la tarifa del
 * documento (como el carrito del catálogo); lo que no tenga precio en la
 * tarifa entra en 0 y se avisa.
 */
export function useCopiaEnBorrador(
  companyId: string | null,
  destino: Exclude<TipoCopiable, 'pedido_compra'>,
  listaPrecioId: string,
  setB: Dispatch<SetStateAction<Borrador>>,
): AvisoCopia | null {
  const [parametros] = useSearchParams()
  const copia = leerParametroCopia(parametros.get('copiar'))
  const cargada = useRef(false)
  const [aviso, setAviso] = useState<AvisoCopia | null>(null)

  useEffect(() => {
    if (!copia || !companyId || cargada.current) return
    cargada.current = true
    void (async () => {
      try {
        const d = await leerParaCopiar(companyId, copia.tipo, copia.id)
        const desdeCompra = cruzaDeLado(d.origen, destino)
        const precios = new Map<string, number | null>()
        if (desdeCompra) {
          const ids = d.lineas.map((l) => l.productId).filter((x): x is string => x !== null)
          if (ids.length > 0) {
            const resueltos = await productosPorId(companyId, ids, { listaPrecioId: listaPrecioId || null })
            for (const p of resueltos) precios.set(p.id, typeof p.precio === 'number' ? p.precio : null)
          }
        }
        // Las líneas se arman ANTES de tocar el borrador: el conteo de las que
        // quedaron sin precio no puede depender de cuándo corre el `setB`.
        let sinPrecio = 0
        const nuevas = d.lineas.map((l) => {
          let precio = l.precioUnitario ?? 0
          if (desdeCompra && !l.esNota) {
            const p = l.productId ? (precios.get(l.productId) ?? null) : null
            if (p === null) sinPrecio += 1
            precio = p ?? 0
          }
          return {
            tipoLinea: l.esNota ? ('chapter' as const) : ('item' as const),
            productId: l.productId,
            sku: l.sku,
            nombre: l.nombre,
            descripcion: l.descripcion,
            cantidad: l.esNota ? 0 : l.cantidad,
            precioUnitario: l.esNota ? 0 : precio,
            descuentoPct: desdeCompra ? 0 : l.descuentoPct,
            tratamientoImpuesto: l.tratamientoImpuesto,
            tasaImpuesto: l.tasaImpuesto ?? 0,
          }
        })
        setB((x) => {
          let b = x
          if (d.titulo && b.cabecera.titulo === '') b = cambiarCampo(b, 'titulo', d.titulo)
          if (d.notas && b.cabecera.notas === '') b = cambiarCampo(b, 'notas', d.notas)
          if (d.moneda) b = cambiarCampo(b, 'moneda', d.moneda)
          return nuevas.reduce((acc, l) => agregarLinea(acc, l), b)
        })
        const de = d.numero ?? 'otro documento'
        setAviso(
          desdeCompra && sinPrecio > 0
            ? {
                tono: 'warning',
                texto: `Copia de ${de}: ${sinPrecio === 1 ? 'una línea no tiene' : `${sinPrecio} líneas no tienen`} precio en la tarifa y quedó en 0. Elegí el cliente y revisá los precios antes de crear.`,
              }
            : {
                tono: 'info',
                texto: desdeCompra
                  ? `Copia de ${de}: los precios salen de la tarifa (no los de compra). Elegí el cliente y revisá antes de crear.`
                  : `Copia de ${de}: mismas líneas y precios. Elegí o confirmá el cliente y revisá antes de crear.`,
              },
        )
      } catch (e) {
        cargada.current = false
        setAviso({ tono: 'danger', texto: e instanceof Error ? e.message : String(e) })
      }
    })()
    // Una sola vez por documento abierto: la tarifa puede cambiar después y
    // eso no vuelve a cargar las líneas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copia?.tipo, copia?.id, companyId])

  return aviso
}
