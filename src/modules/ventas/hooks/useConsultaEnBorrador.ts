import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useSearchParams } from 'react-router-dom'
import { agregarLinea, cambiarCampo, cambiarCliente, type Borrador } from '../lib/borrador'
import { formatearFecha } from '../lib/formato'
import { productosPorId } from '../services/productosParaLinea'
import { clienteDeConsulta, idsPorSku, obtenerConsulta, type Consulta } from '../services/consultas'

export interface AvisoConsulta {
  tono: 'info' | 'warning' | 'danger'
  texto: string
}

export interface ConsultaEnBorrador {
  aviso: AvisoConsulta | null
  /** La consulta de origen, para vincularla al crear la cotización. */
  consulta: Consulta | null
}

/** Las observaciones (internas, no salen en la hoja) con todo lo que dejó la persona. */
function notasDe(c: Consulta): string {
  const quien = [c.nombre, c.empresa ? `(${c.empresa})` : null].filter(Boolean).join(' ')
  const contacto = [c.email, c.telefono].filter(Boolean).join(' · ')
  return [`Consulta del sitio del ${formatearFecha(c.cuando)}: ${quien}`, contacto, c.mensaje ?? ''].filter(Boolean).join('\n')
}

/**
 * «Convertir una consulta del sitio en cotización con un clic» (2026-11).
 *
 * Si la URL trae `?consulta=<id>`, carga UNA vez en el borrador lo que pidió
 * la persona: el cliente si ya existe (ver `clienteDeConsulta`), cada producto
 * con el precio de la tarifa del cliente —o de la empresa—, y el mensaje y los
 * datos de contacto en las observaciones. No crea nada: crear sigue siendo el
 * botón de esta pantalla, que es la única que crea documentos de venta.
 */
export function useConsultaEnBorrador(
  companyId: string | null,
  listaPrecioId: string,
  setB: Dispatch<SetStateAction<Borrador>>,
): ConsultaEnBorrador {
  const [parametros] = useSearchParams()
  const consultaId = parametros.get('consulta')
  const cargada = useRef(false)
  const [estado, setEstado] = useState<ConsultaEnBorrador>({ aviso: null, consulta: null })

  useEffect(() => {
    if (!consultaId || !companyId || cargada.current) return
    cargada.current = true
    void (async () => {
      try {
        const c = await obtenerConsulta(consultaId)
        if (!c) {
          setEstado({ aviso: { tono: 'danger', texto: 'No se encontró la consulta del sitio.' }, consulta: null })
          return
        }
        const [cliente, ids] = await Promise.all([
          clienteDeConsulta(companyId, c.email, c.empresa),
          idsPorSku(
            companyId,
            c.items.map((i) => i.sku),
          ),
        ])
        const lista = cliente?.listaPrecioId || listaPrecioId || null
        const productos = await productosPorId(companyId, [...new Set(ids.values())], { listaPrecioId: lista })
        const porId = new Map(productos.map((p) => [p.id, p]))

        let sinPrecio = 0
        let sinProducto = 0
        const lineas = c.items.map((i) => {
          const id = ids.get(i.sku) ?? null
          const p = id ? porId.get(id) : undefined
          if (!id) sinProducto += 1
          else if (typeof p?.precio !== 'number') sinPrecio += 1
          return {
            tipoLinea: 'item' as const,
            productId: id,
            sku: p?.sku ?? i.sku,
            nombre: p?.nombre ?? i.nombre,
            descripcion: null,
            cantidad: i.cantidad > 0 ? i.cantidad : 1,
            precioUnitario: typeof p?.precio === 'number' ? p.precio : 0,
            descuentoPct: 0,
            tratamientoImpuesto: 'vat_21' as const,
            tasaImpuesto: 21,
          }
        })

        setB((x) => {
          let b = cliente ? cambiarCliente(x, cliente.id).borrador : x
          if (b.cabecera.notas === '') b = cambiarCampo(b, 'notas', notasDe(c))
          return lineas.reduce((acc, l) => agregarLinea(acc, l), b)
        })

        const partes = [
          cliente
            ? `Cliente: ${cliente.nombre} (reconocido por ${cliente.por === 'email' ? 'el email' : cliente.por === 'dominio' ? 'el dominio del correo' : 'la razón social'}; confirmalo).`
            : `${c.empresa ?? c.nombre} no está cargado como cliente: elegilo o dalo de alta (${c.email}${c.telefono ? ` · ${c.telefono}` : ''}).`,
          sinProducto > 0
            ? `${sinProducto === 1 ? 'Un producto no está' : `${sinProducto} productos no están`} en el catálogo: ${sinProducto === 1 ? 'quedó' : 'quedaron'} como línea libre en 0.`
            : null,
          sinPrecio > 0
            ? `${sinPrecio === 1 ? 'Un producto no tiene' : `${sinPrecio} productos no tienen`} precio en la tarifa: ${sinPrecio === 1 ? 'quedó' : 'quedaron'} en 0.`
            : null,
          'El mensaje y los datos de contacto quedaron en las observaciones.',
        ].filter(Boolean)

        setEstado({
          aviso: { tono: !cliente || sinPrecio + sinProducto > 0 ? 'warning' : 'info', texto: partes.join(' ') },
          consulta: c,
        })
      } catch (e) {
        cargada.current = false
        setEstado({ aviso: { tono: 'danger', texto: e instanceof Error ? e.message : String(e) }, consulta: null })
      }
    })()
    // Una sola vez por consulta: cambiar la tarifa después no recarga nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultaId, companyId])

  return estado
}
