import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const insertAudit = vi.fn()
const updateAudit = vi.fn()
const from = vi.fn((tabla: string) => {
  if (tabla === 'product_creation_attempts') {
    return {
      insert: insertAudit,
      update: updateAudit,
    }
  }
  throw new Error(`tabla inesperada: ${tabla}`)
})

vi.mock('@/services/supabase/client', () => ({ supabase: { rpc, from } }))

const SIN_COMERCIAL = { costAmount: null, costCurrency: null, priceAmount: null, stockInicial: null }

describe('crearProducto', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    insertAudit.mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'audit-1' }, error: null }) }) })
    updateAudit.mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
  })

  it('crea producto y receta en una única RPC y cierra la auditoría', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'product-1', sku: 'AC.1', name: 'Producto' }], error: null })
    const { crearProducto } = await import('./altaProducto')
    const resultado = await crearProducto('company-1', {
      fila: { sku: 'AC.1', name: 'Producto', status: 'active' } as never,
      imagen: null,
      comercial: SIN_COMERCIAL,
      componentes: [{ productoId: 'component-1', cantidad: 2 }],
    })

    expect(resultado).toMatchObject({ id: 'product-1', sku: 'AC.1', componentesGuardados: true })
    expect(rpc).toHaveBeenCalledWith('create_product_with_components', expect.objectContaining({
      p_company: 'company-1',
      p_components: [{ productoId: 'component-1', cantidad: 2 }],
    }))
    expect(updateAudit).toHaveBeenCalled()
  })

  it('registra el fallo y no simula un producto creado', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })
    const { crearProducto, ErrorAltaProducto } = await import('./altaProducto')
    await expect(crearProducto('company-1', {
      fila: { sku: 'AC.1', name: 'Producto', status: 'active' } as never,
      imagen: null,
      comercial: SIN_COMERCIAL,
      componentes: [],
    })).rejects.toBeInstanceOf(ErrorAltaProducto)
    expect(updateAudit).toHaveBeenCalled()
  })
})
