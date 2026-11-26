import { describe, expect, it } from 'vitest'
import type { ProductoListado } from '@/modules/catalogo/types'
import { filtrarAlInstante } from './filtroInstantaneo'

const p = (sku: string, nombre: string) => ({ id: sku, sku, nombre }) as unknown as ProductoListado

describe('filtro al instante de la línea nueva', () => {
  const lista = [p('SP.VPPH0/50', 'SPEEDRILL VPPH0/50 PHILLIPS'), p('SP.VPPH2/50', 'SPEEDRILL VPPH2/50'), p('PRO12600', 'Linterna de Inspección LED')]

  it('afina lo que ya está con lo que se sigue escribiendo', () => {
    expect(filtrarAlInstante(lista, 'vpph2').map((x) => x.sku)).toEqual(['SP.VPPH2/50'])
  })

  it('no distingue mayúsculas ni tildes, y exige todas las palabras', () => {
    expect(filtrarAlInstante(lista, 'inspeccion led').map((x) => x.sku)).toEqual(['PRO12600'])
    expect(filtrarAlInstante(lista, 'speedrill phillips').map((x) => x.sku)).toEqual(['SP.VPPH0/50'])
  })
})
