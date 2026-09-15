// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Apariencia } from './opciones'

interface EstadoDialogo {
  apariencia: Apariencia
  guardando: boolean
  error: string | null
  cambiar: ReturnType<typeof vi.fn>
  restaurar: ReturnType<typeof vi.fn>
}
const estado = vi.hoisted<EstadoDialogo>(() => ({
  apariencia: { version: 1, preset: 'claro-naranja', acento: 'tema', tamano: 'normal', fuente: 'sistema' },
  guardando: false,
  error: null,
  cambiar: vi.fn(),
  restaurar: vi.fn(),
}))
vi.mock('./useApariencia', () => ({ useApariencia: () => ({ ...estado, disponible: true }) }))

const { DialogoApariencia } = await import('./DialogoApariencia')

const montar = (onClose = vi.fn()) => {
  const r = render(<DialogoApariencia open onClose={onClose} />)
  return Object.assign(screen.getByRole('dialog', { name: 'Apariencia' }), { desmontar: r.unmount })
}

beforeEach(() => {
  estado.apariencia = { version: 1, preset: 'claro-naranja', acento: 'tema', tamano: 'normal', fuente: 'sistema' }
  estado.guardando = false
  estado.error = null
  estado.cambiar.mockClear()
  estado.restaurar.mockClear()
})

describe('Diálogo de apariencia', () => {
  it('cuatro grupos con nombre; 17 temas, 8 acentos, 3 tamaños y 3 tipografías como radios', () => {
    const d = montar()
    const grupo = (n: string) => within(d).getByRole('group', { name: n })
    expect(within(grupo('Tema')).getAllByRole('radio')).toHaveLength(17)
    expect(within(grupo('Color de acento')).getAllByRole('radio')).toHaveLength(8)
    expect(within(grupo('Tamaño del texto')).getAllByRole('radio')).toHaveLength(3)
    expect(within(grupo('Tipografía')).getAllByRole('radio')).toHaveLength(3)
    // La ayuda del grupo está asociada.
    expect(grupo('Tema')).toHaveAccessibleDescription(/temas oscuros/)
  })

  it('estado elegido: radio marcado (no sólo color) y nombre completo para el lector', () => {
    estado.apariencia = { version: 1, preset: 'verde-industrial', acento: 'rosa', tamano: 'grande', fuente: 'serif' }
    const d = montar()
    expect(within(d).getByRole('radio', { name: 'Verde industrial, tema oscuro' })).toBeChecked()
    expect(within(d).getByRole('radio', { name: 'Acento rosa' })).toBeChecked()
    expect(within(d).getByRole('radio', { name: 'Grande: texto y controles más grandes' })).toBeChecked()
    expect(within(d).getByRole('radio', { name: 'Serif: Georgia' })).toBeChecked()
    expect(within(d).getAllByRole('radio', { checked: true })).toHaveLength(4)
    // Cada tarjeta elegida muestra la tilde.
    expect(d.querySelectorAll('label[class*="elegida"]')).toHaveLength(4)
  })

  it('elegir con el teclado (flechas en el grupo nativo) o con clic cambia la preferencia', () => {
    const d = montar()
    fireEvent.click(within(d).getByRole('radio', { name: 'Azul noche, tema oscuro' }))
    expect(estado.cambiar).toHaveBeenLastCalledWith({ preset: 'azul-noche' })
    fireEvent.click(within(d).getByRole('radio', { name: 'Acento turquesa' }))
    expect(estado.cambiar).toHaveBeenLastCalledWith({ acento: 'turquesa' })
    fireEvent.click(within(d).getByRole('radio', { name: 'Compacto: más información por pantalla' }))
    expect(estado.cambiar).toHaveBeenLastCalledWith({ tamano: 'compacto' })
    fireEvent.click(within(d).getByRole('radio', { name: 'Clásica: Arial / Helvetica' }))
    expect(estado.cambiar).toHaveBeenLastCalledWith({ fuente: 'clasica' })
    // Mismo name por grupo: el navegador mueve la selección con las flechas.
    const nombres = new Set(within(within(d).getByRole('group', { name: 'Tema' })).getAllByRole('radio').map((r) => r.getAttribute('name')))
    expect(nombres.size).toBe(1)
  })

  it('las muestras toman los tokens de su propio tema (data-theme + data-apariencia)', () => {
    const d = montar()
    const muestra = within(d).getByRole('radio', { name: 'Grafito, tema oscuro' }).parentElement!.querySelector('[data-apariencia]')!
    expect([muestra.getAttribute('data-theme'), muestra.getAttribute('data-apariencia'), muestra.getAttribute('aria-hidden')]).toEqual(['dark', 'grafito', 'true'])
  })

  it('restaurar original: deshabilitado si ya es el original; habilitado y llama si no', () => {
    let d = montar()
    expect(within(d).getByRole('button', { name: 'Restaurar original' })).toBeDisabled()
    d.desmontar()
    estado.apariencia = { ...estado.apariencia, preset: 'grafito' }
    d = montar()
    fireEvent.click(within(d).getByRole('button', { name: 'Restaurar original' }))
    expect(estado.restaurar).toHaveBeenCalled()
  })

  it('guardando se anuncia; un error se muestra como alerta y explica que se revirtió', () => {
    estado.guardando = true
    estado.error = 'No se pudo guardar la apariencia: sin conexión.'
    const d = montar()
    expect(within(d).getByRole('status')).toHaveTextContent('Guardando…')
    expect(within(d).getByRole('alert')).toHaveTextContent(/sin conexión.*Se volvió a la apariencia anterior/)
  })

  it('«Listo» cierra', () => {
    const onClose = vi.fn()
    const d = montar(onClose)
    fireEvent.click(within(d).getByRole('button', { name: 'Listo' }))
    expect(onClose).toHaveBeenCalled()
  })
})
