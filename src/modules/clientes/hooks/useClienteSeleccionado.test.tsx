// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useClienteSeleccionado } from './useClienteSeleccionado'
import { useFiltrosClientes } from './useFiltrosClientes'

/**
 * Los dos hooks comparten la MISMA query string, así que se prueban juntos:
 * el invariante que importa no es lo que hace cada uno, es que ninguno pise al
 * otro. Abrir la ficha con un filtro puesto y perder el filtro sería
 * exactamente el tipo de error que sólo se ve usando la pantalla.
 */

/** Una pantallita de mentira: expone cada acción como un botón. */
function Sonda() {
  const { seleccionado, seleccionar, cerrar } = useClienteSeleccionado()
  const { aplicar, limpiar } = useFiltrosClientes()
  const location = useLocation()

  return (
    <>
      <span data-testid="url">{`${location.pathname}${location.search}`}</span>
      <span data-testid="seleccionado">{seleccionado ?? '(ninguno)'}</span>
      <button type="button" onClick={() => seleccionar('cli-1')}>
        elegir 1
      </button>
      <button type="button" onClick={() => seleccionar('cli-2')}>
        elegir 2
      </button>
      <button type="button" onClick={cerrar}>
        cerrar
      </button>
      <button type="button" onClick={() => aplicar({ q: 'acme' })}>
        buscar acme
      </button>
      <button type="button" onClick={() => aplicar({ pagina: 4 })}>
        ir a la página 4
      </button>
      <button type="button" onClick={limpiar}>
        limpiar filtros
      </button>
    </>
  )
}

const montar = (inicial = '/clientes') =>
  render(
    <MemoryRouter initialEntries={[inicial]}>
      <Sonda />
    </MemoryRouter>,
  )

const url = () => screen.getByTestId('url').textContent ?? ''
const query = () => new URLSearchParams(url().split('?')[1] ?? '')
const seleccionado = () => screen.getByTestId('seleccionado').textContent
const tocar = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))

describe('La ficha rápida vive en la URL', () => {
  it('sin parámetro no hay nadie seleccionado', () => {
    montar()
    expect(seleccionado()).toBe('(ninguno)')
  })

  it('elegir un cliente lo escribe en la URL', () => {
    montar()
    tocar('elegir 1')
    expect(url()).toBe('/clientes?cliente=cli-1')
    expect(seleccionado()).toBe('cli-1')
  })

  it('un link directo abre la ficha: refrescar no la pierde', () => {
    montar('/clientes?cliente=cli-9')
    expect(seleccionado()).toBe('cli-9')
  })

  it('cambiar de cliente reemplaza, no apila', () => {
    montar()
    tocar('elegir 1')
    tocar('elegir 2')
    expect(seleccionado()).toBe('cli-2')
    expect(url()).toBe('/clientes?cliente=cli-2')
  })

  it('cerrar saca sólo el cliente', () => {
    montar('/clientes?q=mirgor&cliente=cli-1')
    tocar('cerrar')
    expect(url()).toBe('/clientes?q=mirgor')
  })

  it('cerrar dos veces no hace nada raro', () => {
    montar('/clientes?cliente=cli-1')
    tocar('cerrar')
    tocar('cerrar')
    expect(url()).toBe('/clientes')
  })
})

describe('Abrir la ficha no pierde el trabajo hecho en el listado', () => {
  const CON_FILTROS = '/clientes?q=mirgor&rubro=Metal&page=3&per=50&orden=cuit&dir=desc&revision=1'

  it('elegir un cliente conserva búsqueda, rubro, página, tamaño, orden y revisión', () => {
    montar(CON_FILTROS)
    tocar('elegir 1')
    const p = query()
    expect(p.get('q')).toBe('mirgor')
    expect(p.get('rubro')).toBe('Metal')
    expect(p.get('page')).toBe('3')
    expect(p.get('per')).toBe('50')
    expect(p.get('orden')).toBe('cuit')
    expect(p.get('dir')).toBe('desc')
    expect(p.get('revision')).toBe('1')
    expect(p.get('cliente')).toBe('cli-1')
  })

  it('cerrar los deja igual que estaban', () => {
    montar(`${CON_FILTROS}&cliente=cli-1`)
    tocar('cerrar')
    const p = query()
    expect(p.get('cliente')).toBeNull()
    expect(p.get('q')).toBe('mirgor')
    expect(p.get('page')).toBe('3')
    expect(p.get('orden')).toBe('cuit')
  })
})

describe('Filtrar con la ficha abierta no la cierra', () => {
  it('cambiar la búsqueda conserva el cliente abierto', () => {
    montar('/clientes?cliente=cli-1')
    tocar('buscar acme')
    const p = query()
    expect(p.get('q')).toBe('acme')
    expect(p.get('cliente')).toBe('cli-1')
  })

  it('cambiar de página tampoco', () => {
    montar('/clientes?q=acme&cliente=cli-1')
    tocar('ir a la página 4')
    const p = query()
    expect(p.get('page')).toBe('4')
    expect(p.get('cliente')).toBe('cli-1')
  })

  it('«Limpiar filtros» limpia los FILTROS, no la ficha', () => {
    montar('/clientes?q=acme&rubro=Metal&cliente=cli-1')
    tocar('limpiar filtros')
    expect(url()).toBe('/clientes?cliente=cli-1')
  })
})
