// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProveedorListado } from '../types'

const estado = vi.hoisted(() => ({ movil: false }))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))

const { ListadoProveedores } = await import('./ListadoProveedores')

const proveedor: ProveedorListado = {
  id: 'p1',
  referencia: 'PROV00001',
  razonSocial: 'ZZ Importadora SRL',
  nombreComercial: 'Ana Pérez',
  pais: 'AR',
  telefono: '+54 11 5555-0000',
  email: 'compras@zz.test',
  formaPago: '30 días',
  estado: 'active',
  esHistorico: false,
  necesitaRevision: false,
  motivosRevision: [],
  dadoDeBaja: false,
}

function pintar() {
  return render(
    <MemoryRouter>
      <ListadoProveedores
        filas={[proveedor]}
        orden="nombre"
        direccion="asc"
        onOrdenar={() => {}}
        cargando={false}
        seleccionados={new Set()}
        onSeleccionar={() => {}}
        onSeleccionarTodos={() => {}}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  estado.movil = false
})

describe('Proveedores: prioridad de columnas sin perder datos', () => {
  it('las secundarias llevan su clase y el dato se repite bajo la razón social', () => {
    pintar()
    const cabeceras = screen.getAllByRole('columnheader')
    const clase = (texto: string) => cabeceras.find((c) => c.textContent?.startsWith(texto))!.className
    for (const t of ['Nombre comercial', 'Teléfono', 'Email']) expect(clase(t)).toMatch(/ocultaBajoXl/)
    for (const t of ['País', 'Forma de pago']) expect(clase(t)).toMatch(/ocultaBajoLg/)
    for (const t of ['Referencia', 'Razón social', 'Estado']) expect(clase(t)).not.toMatch(/oculta/)

    const fila = screen.getAllByRole('row')[1]!
    const celdaNombre = within(fila).getByRole('link', { name: 'ZZ Importadora SRL' }).closest('td')!
    expect(within(celdaNombre).getByText('Argentina · 30 días').className).toMatch(/soloAngosta/)
    expect(within(celdaNombre).getByText(/Ana Pérez/).className).toMatch(/soloCompacta/)
    expect(within(celdaNombre).getByText('+54 11 5555-0000 · compras@zz.test').className).toMatch(/soloCompacta/)
    // Las casillas conservan su nombre accesible.
    expect(screen.getByRole('checkbox', { name: 'Seleccionar ZZ Importadora SRL' })).toBeInTheDocument()
  })

  it('mobile: la tarjeta sigue mostrando todo, sin casillas ni líneas duplicadas', () => {
    estado.movil = true
    pintar()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument()
    expect(screen.getByText('compras@zz.test')).toBeInTheDocument()
    expect(screen.getByText('30 días')).toBeInTheDocument()
  })
})
