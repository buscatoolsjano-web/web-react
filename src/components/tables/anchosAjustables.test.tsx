// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import { useAnchosAjustables, type ColumnaMedible } from './anchosAjustables'
import { MIN_PX, olvidarAnchos } from './anchoDeColumnas'

/**
 * Que la tabla ENTRE en su caja (Fase 86).
 *
 * «Necesito poder ver todas las columnas de una, no tener que ir achicando.
 * Que sí o sí, en cada categoría, siempre pueda ver hasta el carrito.»
 *
 * La repartija en sí se prueba pura en `anchoDeColumnas.test.ts`. Acá se
 * prueba el CABLE, que es donde estaba lo difícil: de dónde sale el
 * presupuesto. jsdom no hace layout, así que la geometría se finge leyendo un
 * atributo —es lo único que se puede fingir sin mentir sobre la lógica—.
 */

const geometria = () => {
  const pedir = (el: Element, attr: string) => Number(el.getAttribute(attr) ?? '0')
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return pedir(this, 'data-ancho')
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return pedir(this, 'data-caja')
    },
  })
}

const sinGeometria = () => {
  for (const prop of ['offsetWidth', 'clientWidth']) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 0 })
  }
}

beforeEach(() => {
  olvidarAnchos('prueba')
  geometria()
})
afterEach(() => {
  sinGeometria()
  olvidarAnchos('prueba')
})

const COLUMNAS: ColumnaMedible[] = [
  { key: 'modelo', header: 'Modelo', tipo: 'texto' },
  { key: 'marca', header: 'Marca', tipo: 'texto' },
]

/**
 * Una tabla con dos columnas ajustables y una fija.
 *
 * La fija declara su ancho por fuera del hook —en la app es CSS— y por eso no
 * lleva `style`: es exactamente la seña por la que el hook la reconoce.
 */
function TablaDePrueba({ caja, anchoFija }: { caja: number; anchoFija: number }) {
  const refTabla = useRef<HTMLTableElement | null>(null)
  const anchos = useAnchosAjustables('prueba', COLUMNAS, refTabla)
  return (
    <div data-caja={caja}>
      <table ref={refTabla} data-ancho={caja}>
        <thead>
          <tr>
            <th data-ancho={anchoFija}>Precio</th>
            <th data-testid="th-modelo" data-ancho={0} style={anchos?.estilo('modelo')}>
              Modelo
            </th>
            <th data-testid="th-marca" data-ancho={0} style={anchos?.estilo('marca')}>
              Marca
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>2</td>
            <td>3</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const anchoDe = (testId: string) =>
  Number.parseInt(screen.getByTestId(testId).style.width.replace('px', ''), 10)

describe('el presupuesto', () => {
  it('descuenta las columnas que el hook no controla', () => {
    // 500 de caja menos 100 de la fija dejan 400 para dos columnas que piden
    // 220 cada una. 440 no entra: se reparte 400.
    render(<TablaDePrueba caja={500} anchoFija={100} />)

    expect(anchoDe('th-modelo') + anchoDe('th-marca')).toBe(400)
  })

  it('cuanto más grande la columna fija, menos queda para las demás', () => {
    render(<TablaDePrueba caja={500} anchoFija={300} />)
    expect(anchoDe('th-modelo') + anchoDe('th-marca')).toBe(200)
  })

  it('si entra, no encoge nada: el ancho medido se respeta', () => {
    render(<TablaDePrueba caja={900} anchoFija={100} />)

    // Las dos piden 220 y sobra lugar: quedan en 220.
    expect(anchoDe('th-modelo')).toBe(220)
    expect(anchoDe('th-marca')).toBe(220)
  })

  it('ninguna baja del mínimo legible, aunque la caja sea ridícula', () => {
    render(<TablaDePrueba caja={200} anchoFija={150} />)

    expect(anchoDe('th-modelo')).toBe(MIN_PX)
    expect(anchoDe('th-marca')).toBe(MIN_PX)
  })

  /*
   * El bug que se muerde la cola.
   *
   * La primera versión calculaba las fijas restando: «lo que ocupa la tabla
   * menos lo que pedimos». En cuanto el encogido se aplica, la tabla ya no
   * ocupa lo pedido sino lo encogido, así que la resta da de menos, el
   * presupuesto sube, las columnas se estiran y vuelven a no entrar.
   *
   * Acá se comprueba lo que lo evita: el presupuesto NO depende de nuestros
   * anchos. Dos tablas con la misma caja y la misma fija dan lo mismo, pida
   * lo que pida el contenido.
   */
  it('el presupuesto no depende de lo que piden nuestras columnas', () => {
    const { unmount } = render(<TablaDePrueba caja={500} anchoFija={100} />)
    const primera = anchoDe('th-modelo') + anchoDe('th-marca')
    unmount()

    render(<TablaDePrueba caja={500} anchoFija={100} />)
    expect(anchoDe('th-modelo') + anchoDe('th-marca')).toBe(primera)
  })

  it('sin geometría todavía, deja los anchos pedidos y no los aplasta', () => {
    // Antes de la primera medición la caja vale cero. Encoger contra cero
    // dejaría todo en el mínimo por un instante y la tabla pegaría un salto.
    render(<TablaDePrueba caja={0} anchoFija={0} />)

    expect(anchoDe('th-modelo')).toBe(220)
  })
})
