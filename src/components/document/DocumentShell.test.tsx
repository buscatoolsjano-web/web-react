// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ActionBar } from './ActionBar'
import { DocumentHeader } from './DocumentHeader'
import { DocumentTabs } from './DocumentTabs'
import { MoreMenu } from './MoreMenu'
import { useTabDeUrl } from './useTabDeUrl'

const PESTANAS = ['lineas', 'informacion', 'trazabilidad'] as const
type Pestana = (typeof PESTANAS)[number]

function Documento() {
  const [pestana, setPestana] = useTabDeUrl<Pestana>(PESTANAS, 'lineas')
  const ubicacion = useLocation()
  return (
    <>
      <DocumentTabs
        id="doc"
        label="Secciones"
        value={pestana}
        onChange={setPestana}
        items={[
          { key: 'lineas', label: 'Líneas', count: 3 },
          { key: 'informacion', label: 'Información' },
          { key: 'trazabilidad', label: 'Trazabilidad' },
        ]}
      >
        <p>contenido de {pestana}</p>
      </DocumentTabs>
      <span data-testid="url">{ubicacion.search}</span>
    </>
  )
}

const montarPestanas = (ruta = '/') =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Documento />
    </MemoryRouter>,
  )

describe('<DocumentHeader>', () => {
  it('el número es el único h1, y el estado, el origen y el total lo acompañan', () => {
    render(
      <MemoryRouter>
        <DocumentHeader
          back={{ to: '/ventas/cotizaciones', label: 'Cotizaciones' }}
          numero="COTI02558"
          estados={<span>Cerrada</span>}
          origen={<span>Migrado desde STEL</span>}
          cliente="Consulta MercadoLibre"
          fecha="16/09/2026"
          titulo="VENTA MERCADO LIBRE VARIOS"
          total="ARS 624.345,48"
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'COTI02558' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cotizaciones/ })).toHaveAttribute('href', '/ventas/cotizaciones')
    for (const texto of ['Cerrada', 'Migrado desde STEL', 'Consulta MercadoLibre', '16/09/2026', 'ARS 624.345,48', 'Total']) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
  })

  it('sin total no inventa un importe en cero', () => {
    render(
      <MemoryRouter>
        <DocumentHeader back={{ to: '/x', label: 'X' }} numero="RT0000001433" />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Total')).toBeNull()
  })
})

describe('Barra de acciones con «Más»', () => {
  it('lo de «Más» está oculto hasta abrirlo, y Escape lo cierra devolviendo el foco', () => {
    render(
      <ActionBar
        primary={<Button>Generar pedido</Button>}
        more={
          <MoreMenu>
            <Button variant="secondary">Duplicar</Button>
          </MoreMenu>
        }
      />,
    )

    const mas = screen.getByRole('button', { name: /Más/ })
    expect(mas).toHaveAttribute('aria-expanded', 'false')
    // La acción principal NUNCA se esconde detrás de «Más».
    expect(screen.getByRole('button', { name: 'Generar pedido' })).toBeVisible()
    // Cerrado no es sólo invisible: queda fuera del árbol de accesibilidad.
    expect(screen.queryByRole('button', { name: 'Duplicar' })).toBeNull()

    fireEvent.click(mas)
    expect(mas).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Duplicar' })).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mas).toHaveAttribute('aria-expanded', 'false')
    expect(mas).toHaveFocus()
  })

  it('un motivo de bloqueo es texto visible y el botón lo referencia, nunca un tooltip', () => {
    render(
      <ActionBar
        primary={
          <Button disabled aria-describedby="motivo">
            Generar pedido
          </Button>
        }
        note={<p id="motivo">Emisión desde el ERP bloqueada: STEL numera los pedidos.</p>}
      />,
    )
    const boton = screen.getByRole('button', { name: 'Generar pedido' })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAccessibleDescription('Emisión desde el ERP bloqueada: STEL numera los pedidos.')
  })
})

describe('<DocumentTabs>', () => {
  it('abre en la primera pestaña y sólo monta el panel activo', () => {
    montarPestanas()
    expect(screen.getByRole('tab', { name: /Líneas/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('contenido de lineas')).toBeInTheDocument()
    expect(screen.queryByText('contenido de informacion')).toBeNull()
  })

  it('la pestaña abierta queda en la URL, y la de por defecto no la ensucia', () => {
    montarPestanas()
    expect(screen.getByTestId('url')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('tab', { name: 'Trazabilidad' }))
    expect(screen.getByTestId('url').textContent).toBe('?tab=trazabilidad')
    expect(screen.getByText('contenido de trazabilidad')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Líneas/ }))
    expect(screen.getByTestId('url').textContent).toBe('')
  })

  it('un enlace directo abre su pestaña; uno inventado cae en la de por defecto', () => {
    montarPestanas('/?tab=informacion')
    expect(screen.getByText('contenido de informacion')).toBeInTheDocument()

    screen.getByRole('tab', { name: 'Información' })
    montarPestanas('/?tab=firma')
    expect(screen.getAllByText('contenido de lineas').length).toBeGreaterThan(0)
  })

  it('se recorre con las flechas y con Inicio/Fin', () => {
    montarPestanas()
    const lineas = screen.getByRole('tab', { name: /Líneas/ })
    fireEvent.keyDown(lineas, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Información' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Información' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Trazabilidad' })).toHaveAttribute('aria-selected', 'true')
  })

  it('el panel está nombrado por su pestaña', () => {
    montarPestanas()
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Líneas/)
  })
})
