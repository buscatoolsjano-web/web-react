// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ImagenProducto } from './ImagenProducto'
import type { ImagenProducto as Imagen } from '../types'

const foto: Imagen = { url: 'https://img.test/a.png', thumbUrl: 'https://img.test/a-thumb.png', kind: 'product_image', posicion: 0, esPrincipal: true }

describe('Imagen faltante del catálogo (Fase 13 · E4)', () => {
  it('sin imagen: ícono decorativo propio y «Sin imagen» para lectores, sin el glifo ▣', () => {
    const { container } = render(<ImagenProducto imagen={null} alt="" />)
    expect(container).not.toHaveTextContent('▣')
    expect(screen.getByText('Sin imagen')).toHaveClass('sr-only')
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('img')).toBeNull()
  })

  it('miniatura rota → original; original roto → placeholder (misma degradación de siempre)', () => {
    const { container } = render(<ImagenProducto imagen={foto} alt="Llave" tamano="thumb" />)
    const img = screen.getByRole('img', { name: 'Llave' })
    expect(img).toHaveAttribute('src', foto.thumbUrl)
    fireEvent.error(img)
    expect(screen.getByRole('img', { name: 'Llave' })).toHaveAttribute('src', foto.url)
    fireEvent.error(screen.getByRole('img', { name: 'Llave' }))
    expect(screen.queryByRole('img', { name: 'Llave' })).toBeNull()
    expect(screen.getByText('Sin imagen')).toBeInTheDocument()
    expect(container).not.toHaveTextContent('▣')
  })
})
