// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { TabPanel } from '@/components/ui/Tabs'
import { leerVista } from '../lib/vista'
import { ID_PESTANAS_INFORMES, NavegacionInformes } from './NavegacionInformes'
import { Paginador } from './Paginador'

function Pagina() {
  const { search } = useLocation()
  const vista = leerVista(new URLSearchParams(search).get('vista'))
  return (
    <>
      <NavegacionInformes vista={vista} />
      <TabPanel tabsId={ID_PESTANAS_INFORMES} tabKey={vista}>
        <p>Vista {vista}</p>
      </TabPanel>
      <output data-testid="search">{search}</output>
    </>
  )
}

const montar = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/informes" element={<Pagina />} />
      </Routes>
    </MemoryRouter>,
  )

describe('Pestañas de Informes (Tabs compartido)', () => {
  it('patrón ARIA: tablist, pestaña activa y panel conectado', () => {
    montar('/informes')
    expect(screen.getByRole('tablist', { name: 'Informes' })).toBeInTheDocument()
    const comercial = screen.getByRole('tab', { name: 'Comercial' })
    expect(comercial).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Comercial')
  })

  it('con teclado cambia de vista y conserva el mes en la URL', () => {
    montar('/informes?mes=2026-08')
    const comercial = screen.getByRole('tab', { name: 'Comercial' })
    comercial.focus()
    fireEvent.keyDown(comercial, { key: 'ArrowRight' })
    expect(screen.getByTestId('search')).toHaveTextContent('?mes=2026-08&vista=stock')
    expect(screen.getByRole('tab', { name: 'Stock' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Vista stock')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Stock' }), { key: 'Home' })
    expect(screen.getByTestId('search')).toHaveTextContent('?mes=2026-08')
  })
})

describe('Paginador de Informes', () => {
  it('0-based, con singular y plural', () => {
    const { rerender } = render(<Paginador pagina={0} porPagina={50} total={1} onCambiar={() => {}} sustantivo={{ singular: 'movimiento', plural: 'movimientos' }} />)
    expect(screen.getByText('1–1 de 1 movimiento')).toBeInTheDocument()
    rerender(<Paginador pagina={1} porPagina={50} total={120} onCambiar={() => {}} sustantivo={{ singular: 'saldo', plural: 'saldos' }} />)
    expect(screen.getByText('51–100 de 120 saldos')).toBeInTheDocument()
  })
})
