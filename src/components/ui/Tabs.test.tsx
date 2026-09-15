// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TabPanel, Tabs } from './Tabs'

type K = 'datos' | 'contactos' | 'historial'

function Demo() {
  const [v, setV] = useState<K>('datos')
  return (
    <>
      <Tabs
        id="ficha"
        label="Secciones de la ficha"
        value={v}
        onChange={setV}
        items={[
          { key: 'datos', label: 'Datos comerciales' },
          { key: 'contactos', label: 'Contactos', count: 2 },
          { key: 'historial', label: 'Historial', count: 0 },
        ]}
      />
      <TabPanel tabsId="ficha" tabKey={v}>
        panel {v}
      </TabPanel>
    </>
  )
}

describe('Tabs (Fase 13 · E4)', () => {
  it('tablist con nombre, una sola pestaña en el orden de Tab y panel nombrado por su pestaña', () => {
    render(<Demo />)
    expect(screen.getByRole('tablist', { name: 'Secciones de la ficha' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // La cantidad se muestra sólo si hay algo.
    expect(tabs[1]).toHaveTextContent('Contactos2')
    expect(tabs[2]).toHaveTextContent(/^Historial$/)
    const panel = screen.getByRole('tabpanel', { name: 'Datos comerciales' })
    expect(panel).toHaveTextContent('panel datos')
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
  })

  it('flechas, Inicio y Fin mueven la selección y el foco (con vuelta)', () => {
    render(<Demo />)
    const [datos, contactos, historial] = screen.getAllByRole('tab') as [HTMLElement, HTMLElement, HTMLElement]
    datos.focus()
    fireEvent.keyDown(datos, { key: 'ArrowRight' })
    expect(contactos).toHaveFocus()
    expect(contactos).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel contactos')
    fireEvent.keyDown(contactos, { key: 'End' })
    expect(historial).toHaveFocus()
    fireEvent.keyDown(historial, { key: 'ArrowRight' })
    expect(datos).toHaveFocus()
    fireEvent.keyDown(datos, { key: 'ArrowLeft' })
    expect(historial).toHaveFocus()
    fireEvent.keyDown(historial, { key: 'Home' })
    expect(datos).toHaveAttribute('aria-selected', 'true')
  })

  it('click selecciona', () => {
    render(<Demo />)
    fireEvent.click(screen.getByRole('tab', { name: /Historial/ }))
    expect(screen.getByRole('tabpanel', { name: 'Historial' })).toHaveTextContent('panel historial')
  })
})
