// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const estado = vi.hoisted(() => ({
  creando: false,
  error: null as Error | null,
}))
const espias = vi.hoisted(() => ({
  crear: vi.fn((_v: unknown, _o: unknown) => undefined),
  cerrar: vi.fn(),
  creado: vi.fn(),
}))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true } }),
}))
vi.mock('../hooks/useCatalogoFacetas', () => ({
  useMarcas: () => ({ data: [{ id: 'm1', nombre: '3M Argentina' }], isPending: false }),
  useCategorias: () => ({
    data: [
      { id: 'c-punta', nombre: 'Puntas y tubos', slug: 'punta', necesitaRevision: false },
      { id: 'c-bal', nombre: 'Balanceadores', slug: 'balanceador', necesitaRevision: false },
    ],
    isPending: false,
  }),
  useDefinicionesDeAtributos: () => ({
    data: [
      { key: 'encastre', label: 'Encastre', unidad: null, tipo: 'text', filtrable: true, posicion: 1 },
      { key: 'largo', label: 'Largo', unidad: 'mm', tipo: 'number', filtrable: true, posicion: 2 },
    ],
  }),
  useAtributosPorCategoria: () => ({ data: new Map([['c-punta', new Set(['encastre', 'largo'])]]) }),
}))
vi.mock('../hooks/useCrearProducto', () => ({
  useCrearProducto: () => ({
    mutate: espias.crear,
    isPending: estado.creando,
    error: estado.error,
    reset: vi.fn(),
  }),
}))

const { ModalNuevoProducto } = await import('./ModalNuevoProducto')

/**
 * Alta de producto (Fase 26 · E3).
 *
 * Lo que se prueba es lo que el formulario DECIDE: qué exige antes de mandar,
 * qué atributos ofrece según la categoría, y que lo que manda sea la fila que
 * la base espera. El mapeo campo por campo está en `nuevoProducto.test.ts`.
 */
beforeEach(() => {
  estado.creando = false
  estado.error = null
  espias.crear.mockClear()
  espias.cerrar.mockClear()
  espias.creado.mockClear()
})

const montar = () =>
  render(<ModalNuevoProducto onCerrar={espias.cerrar} onCreado={espias.creado} />)

const escribir = (etiqueta: RegExp | string, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } })

const crear = () => fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }))

describe('Qué exige antes de mandar', () => {
  it('sin referencia, sin nombre y sin categoría no manda nada, y lo dice', () => {
    montar()
    crear()
    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByText('Escribí una referencia.')).toBeInTheDocument()
    expect(screen.getByText('Escribí un nombre.')).toBeInTheDocument()
    expect(screen.getByText('Elegí una categoría: la base la exige.')).toBeInTheDocument()
  })

  /** La categoría es obligatoria porque `products.category_id` es NOT NULL. */
  it('con referencia y nombre pero sin categoría, sigue sin mandar', () => {
    montar()
    escribir(/Referencia/, 'SP.1')
    escribir(/^Nombre/, 'Adaptador')
    crear()
    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByText('Elegí una categoría: la base la exige.')).toBeInTheDocument()
  })

  it('los errores no aparecen antes de intentar guardar', () => {
    montar()
    expect(screen.queryByText('Escribí una referencia.')).toBeNull()
  })
})

describe('Lo que manda', () => {
  const completar = () => {
    escribir(/Referencia/, '  SP.2520/8B ')
    escribir(/^Nombre/, '  Adaptador   de prueba ')
    fireEvent.change(screen.getByLabelText(/Categoría/), { target: { value: 'c-punta' } })
  }

  it('la fila va limpia, con la categoría elegida y sin imagen', () => {
    montar()
    completar()
    crear()
    expect(espias.crear).toHaveBeenCalledTimes(1)
    const [payload] = espias.crear.mock.calls[0]! as unknown as [{ fila: Record<string, unknown>; imagenUrl: string | null }]
    expect(payload.fila.sku).toBe('SP.2520/8B')
    expect(payload.fila.name).toBe('Adaptador de prueba')
    expect(payload.fila.category_id).toBe('c-punta')
    expect(payload.fila.brand_id).toBeNull()
    expect(payload.imagenUrl).toBeNull()
  })

  it('los atributos escritos viajan en el jsonb, y el número como número', () => {
    montar()
    completar()
    escribir(/Encastre/, '1/4 HEX')
    escribir(/Largo/, '200')
    crear()
    const [payload] = espias.crear.mock.calls[0]! as unknown as [{ fila: { attributes: Record<string, unknown> } }]
    expect(payload.fila.attributes).toEqual({ encastre: '1/4 HEX', largo: 200 })
  })

  it('el código de barras entra a los atributos, como en el legacy', () => {
    montar()
    completar()
    escribir(/Código de barras/, '7791234567890')
    crear()
    const [payload] = espias.crear.mock.calls[0]! as unknown as [{ fila: { attributes: Record<string, unknown> } }]
    expect(payload.fila.attributes).toEqual({ barcode: '7791234567890' })
  })

  it('una imagen mal escrita no se manda, y se explica', () => {
    montar()
    completar()
    escribir(/Dirección de la imagen/, 'foto.jpg')
    crear()
    expect(espias.crear).not.toHaveBeenCalled()
    expect(screen.getByText(/http/)).toBeInTheDocument()
  })
})

describe('Los atributos dependen de la categoría', () => {
  it('sin categoría elegida no hay campos de atributos, y se dice por qué', () => {
    montar()
    expect(screen.getByText('Elegí una categoría para ver sus atributos técnicos.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Encastre/)).toBeNull()
  })

  it('con la categoría elegida aparecen los suyos, con la unidad en la etiqueta', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/Categoría/), { target: { value: 'c-punta' } })
    expect(screen.getByLabelText(/Encastre/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Largo \(mm\)/)).toBeInTheDocument()
  })

  it('una categoría sin atributos definidos lo dice en vez de no mostrar nada', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/Categoría/), { target: { value: 'c-bal' } })
    expect(screen.getByText('Esta categoría todavía no tiene atributos definidos.')).toBeInTheDocument()
  })
})

describe('La referencia sugerida', () => {
  /** Dos LETRAS de la marca + punto + modelo (app.js:13653). */
  it('sale de la marca y el modelo elegidos', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: 'm1' } })
    escribir(/Modelo/, 'x1')
    fireEvent.click(screen.getByRole('button', { name: 'Sugerir referencia' }))
    expect(screen.getByLabelText(/Referencia/)).toHaveValue('MA.X1')
  })
})

describe('El peso', () => {
  it('se pide en gramos, y hay un conversor desde kilos', () => {
    montar()
    escribir(/Desde kilos/, '1,5')
    fireEvent.click(screen.getByRole('button', { name: 'A gramos' }))
    expect(screen.getByLabelText(/Peso \(g\)/)).toHaveValue('1500')
  })
})

describe('Lo que todavía no se puede guardar', () => {
  /**
   * Está a la vista a propósito: si el formulario pidiera un precio que
   * `product_prices` no acepta escribir, el dato se perdería en silencio.
   */
  it('se listan los campos que faltan, con su motivo', () => {
    montar()
    expect(screen.getByText(/Lo que el sistema anterior pide/)).toBeInTheDocument()
    expect(screen.getByText('Precio de venta y tarifa')).toBeInTheDocument()
    expect(screen.getByText('Stock inicial, mínimo y máximo')).toBeInTheDocument()
  })

  it('no hay ningún campo de precio ni de stock que se pueda escribir', () => {
    montar()
    expect(screen.queryByLabelText(/Precio de venta/)).toBeNull()
    expect(screen.queryByLabelText(/Stock/)).toBeNull()
  })
})

describe('Mientras crea', () => {
  it('el botón dice que está creando y no se puede cerrar', () => {
    estado.creando = true
    montar()
    expect(screen.getByRole('button', { name: /Creando/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(espias.cerrar).not.toHaveBeenCalled()
  })

  it('un error de la base se muestra tal cual', () => {
    estado.error = new Error('Ya existe un producto con esa referencia.')
    montar()
    expect(screen.getByRole('alert')).toHaveTextContent('Ya existe un producto con esa referencia.')
  })
})
