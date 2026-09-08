import type { Column } from '@/components/tables/types'
import { DisponibilidadBadge, PrecioCelda, StockCelda } from './Celdas'
import type { ProductoListado } from '../types'

export interface OpcionesColumnas {
  esInterno: boolean
  moneda: string | null
  disponibilidad: Map<string, boolean> | undefined
}

/**
 * Columnas del catálogo, según el rol.
 *
 * IMPORTANTE: esto decide QUÉ SE MUESTRA, no qué se puede ver. Para un rol
 * externo la columna de stock ni siquiera existe porque el dato NO LLEGÓ —
 * RLS lo denegó en el servidor. En el legacy pasaba al revés: el dato
 * llegaba entero al navegador y se escondía el <td>, así que bastaba un
 * console.log para leer costos y stock de los 21.772 productos.
 */
export function construirColumnas({
  esInterno,
  moneda,
  disponibilidad,
}: OpcionesColumnas): Column<ProductoListado>[] {
  const columnas: Column<ProductoListado>[] = [
    {
      key: 'sku',
      header: 'SKU',
      width: '140px',
      mobile: 'title',
      render: (p) => <code>{p.sku}</code>,
    },
    {
      key: 'marca',
      header: 'Marca',
      width: '130px',
      render: (p) => p.marca?.nombre ?? '—',
    },
    {
      key: 'nombre',
      header: 'Producto',
      render: (p) => p.nombre,
    },
    {
      key: 'categoria',
      header: 'Categoría',
      width: '150px',
      mobile: 'hide',
      render: (p) => p.categoria?.nombre ?? '—',
    },
    {
      key: 'serie',
      header: 'Serie',
      width: '110px',
      mobile: 'hide',
      render: (p) => p.serie ?? '—',
    },
  ]

  if (esInterno) {
    columnas.push({
      key: 'stock',
      header: 'Stock (real / virt.)',
      width: '140px',
      align: 'right',
      render: (p) => <StockCelda stock={p.stock} />,
    })
  } else {
    columnas.push({
      key: 'disponibilidad',
      header: 'Disponibilidad',
      width: '130px',
      align: 'center',
      render: (p) => <DisponibilidadBadge disponible={disponibilidad?.get(p.id) ?? false} />,
    })
  }

  columnas.push({
    key: 'precio',
    header: 'Precio',
    width: '130px',
    align: 'right',
    render: (p) => <PrecioCelda monto={p.precio} moneda={moneda} />,
  })

  return columnas
}
