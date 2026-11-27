import { describe, expect, it, vi } from 'vitest'

// El CI no tiene variables de entorno: el cliente real no se puede crear.
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

const { comoProductoListado } = await import('./compartido')

const item = {
  id: 'p1',
  sku: 'AP.7134',
  nombre: 'Embocadura',
  modelo: '7134',
  marca: { id: 'm1', nombre: 'APEX' },
  categoria: { id: 'c1', nombre: 'Puntas' },
  imagen: 'https://x/foto.jpg',
  precio: 100,
}

describe('comoProductoListado', () => {
  it('lo deja con la forma del listado y su precio', () => {
    const p = comoProductoListado(item, 'USD', 'USD')
    expect(p).toMatchObject({ id: 'p1', sku: 'AP.7134', precio: 100, precioOrigen: 'tarifa', enCatalogo: true })
    expect(p.marca?.nombre).toBe('APEX')
    expect(p.imagen?.url).toBe('https://x/foto.jpg')
  })

  it('no propone un precio en otra moneda que la del documento', () => {
    const p = comoProductoListado(item, 'USD', 'ARS')
    expect(p.precio).toBeNull()
    expect(p.precioOrigen).toBe('ninguno')
  })
})
