// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { PanelIA, type PanelIAProps } from './PanelIA'
import type { ItemIA, ResumenIA } from '../lib/ia'

/**
 * El panel «Resumen IA». Lo que importa probar no es el estilo sino las
 * garantías: nada se muestra como hecho, todo tiene fuente, y un fallo no
 * borra el resumen anterior.
 */

const resumen = (p: Partial<ResumenIA> = {}): ResumenIA => ({
  conversacionId: 'c1',
  resumen: 'ZZ El contacto pidió precio del torquímetro.',
  temas: ['Precio', 'Stock'],
  estadoConversacion: 'esperando_empresa',
  requiereAtencion: true,
  ultimoMensajeAnalizadoId: 'm9',
  ultimoMensajeAnalizadoEn: '2026-09-16T13:00:00Z',
  estado: 'ok',
  ultimoError: null,
  modelo: 'falso-reglas-v1',
  analisis: 1,
  generadoEn: '2026-09-16T13:05:00Z',
  ...p,
})

const item = (p: Partial<ItemIA> = {}): ItemIA => ({
  id: 'i1',
  conversacionId: 'c1',
  tipo: 'commitment',
  actor: 'company',
  descripcion: 'ZZ Enviar la cotización',
  fuentes: ['m7'],
  confianza: 0.9,
  venceEn: '2026-09-17',
  estado: 'open',
  generadoEn: '2026-09-16T13:05:00Z',
  resueltoEn: null,
  ...p,
})

const montar = (p: Partial<PanelIAProps> = {}) => {
  const props: PanelIAProps = {
    resumen: resumen(),
    items: [item()],
    cargando: false,
    errorLectura: null,
    errorAnalisis: null,
    aviso: null,
    analizando: false,
    resolviendo: null,
    onActualizar: vi.fn(),
    onResolver: vi.fn(),
    onIrAFuente: vi.fn(),
    ...p,
  }
  render(<PanelIA {...props} />)
  return props
}

describe('PanelIA', () => {
  it('muestra el resumen, los temas, el estado y cuándo se analizó', () => {
    montar()
    expect(screen.getByText('ZZ El contacto pidió precio del torquímetro.')).toBeInTheDocument()
    expect(screen.getByText('Precio')).toBeInTheDocument()
    expect(screen.getByText('Espera respuesta nuestra')).toBeInTheDocument()
    expect(screen.getByText(/Último análisis: 16\/09\/2026,? 10:05/)).toBeInTheDocument()
  })

  it('dice que son sugerencias, no hechos', () => {
    montar()
    expect(screen.getByText(/Sugerencias generadas a partir de los mensajes/)).toBeInTheDocument()
  })

  it('cada sugerencia lleva al mensaje de donde salió', () => {
    const props = montar()
    fireEvent.click(screen.getByRole('button', { name: /^Ver mensaje de origen: ZZ Enviar la cotización/ }))
    expect(props.onIrAFuente).toHaveBeenCalledWith('m7')
  })

  it('el compromiso de la empresa va en su sección, con su fecha y su confianza', () => {
    montar()
    const seccion = screen.getByRole('region', { name: /Compromisos de Buscatools/ })
    expect(within(seccion).getByText('ZZ Enviar la cotización')).toBeInTheDocument()
    expect(within(seccion).getByText(/jue.*17\/09/)).toBeInTheDocument()
    expect(within(seccion).getByText('Confianza alta')).toBeInTheDocument()
  })

  it('resolver y descartar avisan con el estado correcto', () => {
    const props = montar()
    fireEvent.click(screen.getByRole('button', { name: /^Resolver:/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Descartar:/ }))
    expect(props.onResolver).toHaveBeenNthCalledWith(1, 'i1', 'resolved')
    expect(props.onResolver).toHaveBeenNthCalledWith(2, 'i1', 'dismissed')
  })

  it('mientras se resuelve una sugerencia, sus botones no aceptan otro clic', () => {
    montar({ resolviendo: 'i1' })
    expect(screen.getByRole('button', { name: /^Resolver:/ })).toBeDisabled()
  })

  it('un análisis que falla avisa y deja el resumen anterior en pantalla', () => {
    montar({ errorAnalisis: 'El servicio de IA no respondió.' })
    expect(screen.getByRole('alert')).toHaveTextContent('El servicio de IA no respondió.')
    expect(screen.getByText('ZZ El contacto pidió precio del torquímetro.')).toBeInTheDocument()
    expect(screen.getByText('ZZ Enviar la cotización')).toBeInTheDocument()
  })

  it('si el último análisis guardado falló, lo dice sin esconder el resumen válido', () => {
    montar({ resumen: resumen({ estado: 'error', ultimoError: 'proveedor_caido' }) })
    expect(screen.getByText(/Se muestra el último resumen válido/)).toBeInTheDocument()
    expect(screen.getByText('ZZ El contacto pidió precio del torquímetro.')).toBeInTheDocument()
  })

  it('sin análisis previo ofrece generarlo, a pedido', () => {
    const props = montar({ resumen: null, items: [] })
    expect(screen.getByText(/todavía no se analizó/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generar resumen' }))
    expect(props.onActualizar).toHaveBeenCalledTimes(1)
  })

  it('analizada y sin nada abierto, lo dice en vez de mostrar secciones vacías', () => {
    montar({ items: [item({ estado: 'resolved', resueltoEn: 'x' })] })
    expect(screen.getByText(/No se detectaron pendientes/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Compromisos/ })).toBeNull()
  })

  it('mientras carga no muestra datos a medias', () => {
    montar({ cargando: true })
    expect(screen.queryByText('ZZ El contacto pidió precio del torquímetro.')).toBeNull()
  })

  it('un error de lectura se informa', () => {
    montar({ errorLectura: 'sin permiso' })
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo leer el resumen')
  })

  it('una sugerencia sin fecha no muestra ninguna', () => {
    montar({ items: [item({ venceEn: null })] })
    expect(screen.queryByText(/17\/09/)).toBeNull()
  })
})
