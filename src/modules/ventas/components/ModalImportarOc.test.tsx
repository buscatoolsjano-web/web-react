// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LineaEmparejada } from '../lib/importarOc'

/**
 * La pantalla de revisar la OC (Fase 30 · E8).
 *
 * Se prueba la TABLA, que es donde se decide si el producto que pidió el
 * cliente es el nuestro. Las tres marcas —tilde, triángulo, cruz— no son
 * decoración: distinguen «esto está resuelto» de «esto es una adivinanza» y de
 * «esto no se encontró», y confundirlas mete en una cotización un producto que
 * nadie pidió.
 *
 * El PDF se saltea entero: la lectura vive en una Edge Function y acá se
 * devuelve lo que habría devuelto, que es lo que la pantalla tiene que pintar.
 */
const leida = {
  cliente: { nombre: 'NEWSAN SA', cuit: '30-64261755-5' },
  numero: 'PDV01239',
  fecha: '2026-05-27',
  moneda: 'USD',
  textoCrudo: 'PEDIDO DE VENTA',
  lineas: [
    { n: 1, codigo: 'SP.2008VP/100', descripcion: 'SPEEDRILL 2008/100VP 8MM SIN IMAN', cantidad: 10, precio: 55 },
    { n: 2, codigo: 'SP.2010VPCM', descripcion: 'SPEEDRILL 2010VPCM EMBOCADURA', cantidad: 8, precio: 55 },
    { n: 3, codigo: null, descripcion: 'MAVE ALGO QUE NO ESTA', cantidad: 1, precio: null },
  ],
}

const emparejadas: LineaEmparejada[] = [
  // Resuelta en firme: el código del cliente ES nuestra referencia.
  { ...leida.lineas[0]!, productId: 'p1', sku: 'SP.2008VP/100', nombre: 'SPEEDRILL 2008VP/100 POWER DRIVE', metodo: 'sku', confianza: 1 },
  // Un parecido. Tiene producto propuesto, pero NO está confirmado.
  { ...leida.lineas[1]!, productId: 'p2', sku: 'SP.2010VPCM', nombre: 'SPEEDRILL 2010VPCM POWER DRIVE', metodo: 'parecido', confianza: 0.62 },
  // Sin nada.
  { ...leida.lineas[2]!, productId: null, sku: null, nombre: null, metodo: 'sin_match', confianza: 0 },
]

/** Lo que la pantalla le manda a `importarOc`, para poder mirarlo. */
const enviado = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: 'admin', esInterno: true, customerId: null } }),
}))
vi.mock('../services/importarOc', () => ({
  FalloDeImportacion: class extends Error {},
  leerOcDesdePdf: () => Promise.resolve(leida),
  emparejarCliente: () =>
    Promise.resolve([{ customerId: 'cli1', nombre: 'NEWSAN SA', cuit: '30642617555', metodo: 'cuit', confianza: 1 }]),
  emparejarLineas: () => Promise.resolve(emparejadas),
  cotizacionesPara: () => Promise.resolve([]),
  estadoDeLectura: () => Promise.resolve({ proveedor: 'openai', listo: true }),
  importarOc: (p: Record<string, unknown>) => { enviado.push(p); return Promise.resolve({}) },
  lineasDeCotizacion: () => Promise.resolve([]),
}))
vi.mock('./BuscadorCliente', () => ({ BuscadorCliente: () => <div>buscador de cliente</div> }))
vi.mock('./BuscadorProducto', () => ({
  BuscadorProducto: ({ onElegir }: { onElegir: (p: { id: string; sku: string; nombre: string }) => void }) => (
    <div>
      buscador de producto
      <button type="button" onClick={() => onElegir({ id: 'p-elegido', sku: 'SP.ELEGIDO', nombre: 'El que elegi a mano' })}>
        elegir este
      </button>
    </div>
  ),
}))

const { ModalImportarOc } = await import('./ModalImportarOc')

/** Llega hasta el paso 3 soltando un PDF en la zona de arrastre. */
async function abrirLaRevision() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ModalImportarOc onCerrar={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  const archivo = new File(['%PDF-1.4'], 'oc-newsan.pdf', { type: 'application/pdf' })
  const entrada = document.querySelector('input[type="file"]')
  expect(entrada).not.toBeNull()
  fireEvent.change(entrada as HTMLInputElement, { target: { files: [archivo] } })

  fireEvent.click(await screen.findByRole('button', { name: /procesar con ia/i }))
  await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
}

describe('Revisar la OC · la tabla de productos', () => {
  it('pinta UNA fila por producto, con las dos referencias enfrentadas', async () => {
    await abrirLaRevision()

    const filas = within(screen.getByRole('table')).getAllByRole('row')
    // Tres productos más el encabezado.
    expect(filas).toHaveLength(4)

    const primera = within(filas[1]!).getAllByRole('cell')
    expect(primera[0]).toHaveTextContent('SP.2008VP/100')
    expect(primera[1]).toHaveTextContent('SP.2008VP/100')
    expect(primera[2]).toHaveTextContent('10')

    // Sin código, la descripción del cliente ES la referencia: es lo único que
    // hay para buscarlo, y dejarlo en «—» obligaría a volver al PDF.
    expect(within(filas[3]!).getAllByRole('cell')[0]).toHaveTextContent('MAVE ALGO QUE NO ESTA')
    // «Elegir producto» y no «Sin machear»: el texto dice QUÉ HACER con la
    // línea, porque esa celda es el botón que abre el buscador.
    expect(within(filas[3]!).getAllByRole('cell')[1]).toHaveTextContent(/elegir producto/i)
  })

  /**
   * Lo central. Un parecido NO puede verse igual que un emparejado en firme:
   * los trigramas devuelven el más parecido que encontraron, no el correcto.
   * El motivo viaja en el rótulo accesible porque el icono solo no lo dice.
   */
  it('distingue el emparejado en firme del parecido y del que no se encontró', async () => {
    await abrirLaRevision()
    const filas = within(screen.getByRole('table')).getAllByRole('row')

    // El de la MARCA es el segundo botón de la fila: el primero es la celda
    // del producto, que desde ahora también abre el buscador.
    const marca = (n: number) => within(filas[n]!).getAllByRole('button')[1]!
    expect(marca(1)).toHaveAccessibleName(/nuestra referencia/i)
    expect(marca(2)).toHaveAccessibleName(/se parece al nombre/i)
    expect(marca(3)).toHaveAccessibleName(/no se encontró/i)
  })

  it('tocar la marca abre el buscador para elegir otro producto, y se cierra', async () => {
    await abrirLaRevision()
    const marca = within(within(screen.getByRole('table')).getAllByRole('row')[3]!).getAllByRole('button')[1]!

    expect(marca).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(marca)
    expect(await screen.findByText('buscador de producto')).toBeInTheDocument()
    expect(marca).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(marca)
    expect(screen.queryByText('buscador de producto')).not.toBeInTheDocument()
  })
})

/*
 * Elegir el producto a mano, que es lo que pasa con casi todas las OC nuevas:
 * el catálogo del cliente no coincide con el nuestro hasta que alguien los
 * empareja una primera vez.
 *
 * Lo que importa probar es que la línea viaje con `metodo: 'manual'`. No es un
 * detalle cosmético: `app.recordar_alias_de_oc` FILTRA por ese campo y nunca
 * aprende de un «parecido» —cementar una adivinanza es peor que no aprender—.
 * Si la pantalla mandara otro método, el macheo funcionaría esta vez y la
 * próxima OC del mismo cliente volvería a salir sin machear.
 */
describe('Revisar la OC · elegir el producto a mano', () => {
  it('la línea queda con el producto elegido y método «manual»', async () => {
    enviado.length = 0
    await abrirLaRevision()

    const sinMachear = within(screen.getByRole('table')).getAllByRole('row')[3]!
    // La celda del producto abre el buscador: es la acción principal.
    fireEvent.click(within(sinMachear).getAllByRole('button')[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'elegir este' }))

    // Ya no dice «Elegir producto»: ahora muestra el SKU que se eligió.
    expect(within(sinMachear).getAllByRole('cell')[1]).toHaveTextContent('SP.ELEGIDO')

    fireEvent.click(screen.getByRole('button', { name: /Importar la orden/i }))
    await waitFor(() => expect(enviado).toHaveLength(1))

    const lineas = enviado[0]!['lineas'] as { productId: string | null; metodo: string }[]
    const elegida = lineas.find((l) => l.productId === 'p-elegido')
    expect(elegida).toBeDefined()
    expect(elegida!.metodo).toBe('manual')
  })
})
