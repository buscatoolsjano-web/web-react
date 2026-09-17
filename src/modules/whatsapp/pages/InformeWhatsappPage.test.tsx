// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { InformeWhatsapp } from '../lib/ia'

/**
 * El informe de WhatsApp. Se mockean los hooks de datos, no la presentación:
 * los períodos, agrupaciones y textos son los de producción.
 */
const estado = vi.hoisted((): {
  rol: string
  informe: { data?: unknown; isPending: boolean; error: Error | null }
  pedidos: { desde: string; hasta: string; habilitado: boolean }[]
  guardado: unknown
  pedidosGuardado: { tipo: string; desde: string; hasta: string; habilitado: boolean }[]
} => ({ rol: 'admin', informe: { isPending: false, error: null }, pedidos: [], guardado: null, pedidosGuardado: [] }))

vi.mock('@/services/supabase/client', () => ({ supabase: {} }))
vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true, customerId: null } }),
}))
vi.mock('../hooks/useWhatsapp', () => ({
  useInformeWhatsapp: (desde: string, hasta: string, habilitado = true) => {
    estado.pedidos.push({ desde, hasta, habilitado })
    return { ...estado.informe, refetch: vi.fn() }
  },
  useInformeGuardado: (tipo: string, desde: string, hasta: string, habilitado: boolean) => {
    estado.pedidosGuardado.push({ tipo, desde, hasta, habilitado })
    return habilitado
      ? { data: estado.guardado, isPending: false, isSuccess: true, isError: false, refetch: vi.fn() }
      : { data: undefined, isPending: true, isSuccess: false, isError: false, refetch: vi.fn() }
  },
}))

const { InformeWhatsappPage } = await import('./InformeWhatsappPage')

const informe = (p: Partial<InformeWhatsapp> = {}): InformeWhatsapp => ({
  desde: '2026-09-16T03:00:00Z',
  hasta: '2026-09-17T03:00:00Z',
  totales: {
    conversacionesActivas: 3, conversacionesNuevas: 1, mensajesEntrantes: 9, mensajesSalientes: 4,
    erroresEnvio: 1, sinRespuesta: 2, sinAsignar: 1, pendientesAbiertos: 2, pendientesResueltos: 1,
    compromisos: 1, compromisosVencidos: 1, decisiones: 1,
  },
  conversaciones: [
    { id: 'cv1', contacto: 'ZZ Ana', clienteId: 'k1', cliente: 'ZZ Acme', asignadoId: 'u1', asignado: 'ZZ Juan', nueva: true,
      ultimoMensajeEn: '2026-09-16T15:00:00Z', motivos: ['pregunta', 'sin_respuesta'], resumen: 'ZZ Pidió precio.', estadoIA: 'esperando_empresa' },
    { id: 'cv2', contacto: 'ZZ Beto', clienteId: null, cliente: null, asignadoId: null, asignado: null, nueva: false,
      ultimoMensajeEn: '2026-09-16T12:00:00Z', motivos: ['error_envio'], resumen: null, estadoIA: null },
  ],
  items: [
    { id: 'i1', conversacionId: 'cv1', tipo: 'commitment', actor: 'company', descripcion: 'ZZ Enviar cotización', fuentes: ['m1'],
      confianza: 0.9, venceEn: '2026-09-10', estado: 'open', generadoEn: '2026-09-16T15:00:00Z', resueltoEn: null },
    { id: 'i2', conversacionId: 'cv1', tipo: 'decision', actor: 'contact', descripcion: 'ZZ Pedido confirmado', fuentes: ['m2'],
      confianza: 0.95, venceEn: null, estado: 'open', generadoEn: '2026-09-16T15:00:00Z', resueltoEn: null },
  ],
  temas: [{ tema: 'Precio', veces: 2 }],
  porAsignado: [{ asignadoId: 'u1', asignado: 'ZZ Juan', conversaciones: 2 }, { asignadoId: null, asignado: null, conversaciones: 1 }],
  ...p,
})

const montar = () =>
  render(
    <MemoryRouter>
      <InformeWhatsappPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  estado.rol = 'admin'
  estado.informe = { data: informe(), isPending: false, error: null }
  estado.pedidos = []
  estado.guardado = null
  estado.pedidosGuardado = []
})

describe('Informe de WhatsApp', () => {
  it('el diario muestra los totales del día, como hechos y con lo que hay que revisar marcado en palabras', () => {
    montar()
    const totales = screen.getByRole('list', { name: 'Totales del período' })
    expect(within(totales).getByText('Sin respuesta').parentElement).toHaveTextContent('2')
    expect(within(totales).getByText('Errores de envío').parentElement).toHaveTextContent('Revisar')
    expect(screen.getByText(/del análisis de IA sobre las conversaciones/)).toHaveTextContent('son sugerencias')
  })

  it('pide el día argentino de 00:00 a 00:00', () => {
    montar()
    const p = estado.pedidos.at(-1)!
    expect(p.desde.endsWith('T03:00:00.000Z')).toBe(true)
    expect(new Date(p.hasta).getTime() - new Date(p.desde).getTime()).toBe(24 * 3600_000)
  })

  it('las conversaciones relevantes dicen por qué y enlazan a la bandeja', () => {
    montar()
    expect(screen.getByRole('link', { name: 'ZZ Ana' })).toHaveAttribute('href', '/whatsapp?conversacion=cv1')
    expect(screen.getByText('Pregunta sin responder')).toBeInTheDocument()
    expect(screen.getAllByText('Falló un envío').length).toBeGreaterThan(0)
  })

  it('cada sugerencia enlaza al mensaje de donde salió', () => {
    montar()
    const compromisos = screen.getByRole('region', { name: /Compromisos/ })
    expect(within(compromisos).getByRole('link', { name: /Ver mensaje/ })).toHaveAttribute('href', '/whatsapp?conversacion=cv1&mensaje=m1')
    expect(within(compromisos).getByText(/Vencido/)).toBeInTheDocument()
  })

  it('agrupar por cliente deja «sin cliente» como grupo propio', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Cliente' }))
    expect(screen.getByRole('heading', { name: 'ZZ Acme' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sin cliente vinculado' })).toBeInTheDocument()
  })

  it('el semanal pide siete días y muestra temas y conteo por asignado, sin puntajes', () => {
    montar()
    fireEvent.click(screen.getByRole('tab', { name: 'Semanal' }))
    const p = estado.pedidos.at(-1)!
    expect(new Date(p.hasta).getTime() - new Date(p.desde).getTime()).toBe(7 * 24 * 3600_000)
    expect(screen.getByRole('heading', { name: 'Temas frecuentes' })).toBeInTheDocument()
    expect(screen.getByText(/No mide desempeño/)).toBeInTheDocument()
    const asignados = screen.getByRole('region', { name: 'Conversaciones por asignado' })
    expect(within(asignados).getByText('Sin asignar')).toBeInTheDocument()
    expect(within(asignados).getByText('ZZ Juan').nextElementSibling).toHaveTextContent('2')
  })

  it('sin actividad lo dice', () => {
    estado.informe = {
      data: informe({ totales: { ...informe().totales, conversacionesActivas: 0 }, conversaciones: [], items: [] }),
      isPending: false,
      error: null,
    }
    montar()
    expect(screen.getByText('Sin actividad en el período')).toBeInTheDocument()
  })

  it('cargando y error', () => {
    estado.informe = { isPending: true, error: null }
    const { unmount } = montar()
    expect(screen.queryByRole('list', { name: 'Totales del período' })).toBeNull()
    unmount()
    estado.informe = { isPending: false, error: new Error('Tu rol no tiene acceso a los informes de WhatsApp.') }
    montar()
    expect(screen.getByText('No se pudo armar el informe.')).toBeInTheDocument()
  })

  it('atajos: hoy, ayer, semana actual y semana anterior', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-17T15:00:00Z')) // jueves 17/09, 12:00 en Argentina
    try {
      montar()
      fireEvent.click(screen.getByRole('button', { name: 'Ayer' }))
      expect(estado.pedidos.at(-1)!.desde).toBe('2026-09-16T03:00:00.000Z')
      expect(screen.getByRole('button', { name: 'Ayer' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
      expect(estado.pedidos.at(-1)!.desde).toBe('2026-09-07T03:00:00.000Z')
      expect(estado.pedidos.at(-1)!.hasta).toBe('2026-09-14T03:00:00.000Z')
      fireEvent.click(screen.getByRole('button', { name: 'Semana actual' }))
      expect(estado.pedidos.at(-1)!.desde).toBe('2026-09-14T03:00:00.000Z')
      fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
      expect(estado.pedidos.at(-1)!.desde).toBe('2026-09-17T03:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('administración: si hay informe guardado usa ESE, dice cuándo se generó y no calcula en vivo', () => {
    estado.informe = { isPending: true, error: null }
    estado.guardado = { informe: informe(), generadoEn: '2026-09-17T11:00:00Z', corte: '2026-09-17T11:00:00Z' }
    montar()
    expect(screen.getByText('Informe guardado')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Totales del período' })).toBeInTheDocument()
    expect(estado.pedidos.at(-1)!.habilitado).toBe(false)
    expect(estado.pedidosGuardado.at(-1)!.tipo).toBe('daily')
  })

  it('administración sin informe guardado: calcula en vivo y lo dice', () => {
    montar()
    expect(screen.getByText('En vivo')).toBeInTheDocument()
    expect(estado.pedidos.at(-1)!.habilitado).toBe(true)
  })

  it('un vendedor no pide informes guardados (son de toda la empresa): siempre en vivo', () => {
    estado.rol = 'salesperson'
    estado.guardado = { informe: informe(), generadoEn: '2026-09-17T11:00:00Z', corte: '2026-09-17T11:00:00Z' }
    montar()
    expect(estado.pedidosGuardado.every((x) => !x.habilitado)).toBe(true)
    expect(screen.getByText('En vivo')).toBeInTheDocument()
    expect(screen.queryByText('Informe guardado')).toBeNull()
  })

  it('un técnico no ve el informe', () => {
    estado.rol = 'technician'
    montar()
    expect(screen.getByRole('heading', { level: 1, name: /no están disponibles para tu rol/ })).toBeInTheDocument()
  })
})
