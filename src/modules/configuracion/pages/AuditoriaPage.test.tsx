// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { EventoAuditoria } from '../lib/auditoria'

const estado = vi.hoisted(() => ({ rol: 'admin', movil: false, error: false, filas: [] as unknown[] }))
const llamadas = vi.hoisted(() => ({ auditoria: [] as unknown[][], refetch: vi.fn() }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'ZZ', rol: estado.rol, esInterno: true }, cargando: false }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => estado.movil, useMediaQuery: () => estado.movil }))
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: <T,>(v: T) => v }))
vi.mock('../services/auditoria', () => ({
  ErrorAuditoria: class ErrorAuditoria extends Error {
    constructor(readonly codigo: string) {
      super(codigo)
    }
  },
}))
vi.mock('../hooks/useAuditoria', () => ({
  useAuditoria: (...args: unknown[]) => {
    llamadas.auditoria.push(args)
    return estado.error
      ? { isError: true, error: new Error('desconocido'), isPending: false, isFetching: false, refetch: llamadas.refetch }
      : { isError: false, data: { filas: estado.filas, total: estado.filas.length ? 120 : 0 }, isPending: false, isFetching: false, refetch: llamadas.refetch }
  },
  useActoresAuditoria: () => ({ data: [{ id: 'a1', etiqueta: 'Jano', eventos: 3 }], isError: false }),
}))

const { AuditoriaPage } = await import('./AuditoriaPage')

const evento = (p: Partial<EventoAuditoria>): EventoAuditoria => ({
  clave: 'users_audit:1',
  origen: 'users_audit',
  id: 1,
  modulo: 'usuarios',
  evento: 'MEMBERSHIP_ROLE_CHANGED',
  fecha: '2026-09-14T15:30:00Z',
  actor: { id: 'a1', nombre: 'Jano', email: 'jano@b.test', miembro: true },
  entidadTipo: 'usuario',
  entidadId: 'u1',
  entidadNombre: 'Norberto',
  entidadExiste: true,
  detalles: { rol_anterior: 'salesperson', rol_nuevo: 'employee', email_afectado: 'n@b.test' },
  ...p,
})

beforeEach(() => {
  estado.rol = 'admin'
  estado.movil = false
  estado.error = false
  estado.filas = [
    evento({}),
    evento({ clave: 'dna:1', origen: 'document_numbering_authority_audit', modulo: 'numeracion', evento: 'NUMBERING_AUTHORITY_INSERT', actor: null, entidadTipo: 'tipo_documento', entidadNombre: 'quote', detalles: { tipo_documento: 'quote', autoridad_nueva: 'STEL', origen_tecnico: 'postgres' } }),
    evento({ clave: 'x:9', evento: 'EVENTO_FUTURO', detalles: {} }),
  ]
  llamadas.auditoria.length = 0
  llamadas.refetch.mockClear()
})

describe('Auditoría', () => {
  it('sólo admin', () => {
    estado.rol = 'employee'
    render(<AuditoriaPage />)
    expect(screen.getByText('Sólo un administrador de la empresa puede ver la auditoría.')).toBeInTheDocument()
    expect(llamadas.auditoria).toHaveLength(0)
  })

  it('tabla con evento, actor, entidad y resumen; actor nulo sin inventar; evento nuevo con fallback', () => {
    render(<AuditoriaPage />)
    const fila = within(screen.getByRole('table')).getByText('Rol cambiado').closest('tr')!
    expect(within(fila).getByText('Jano')).toBeInTheDocument()
    expect(within(fila).getByText('Usuario: Norberto')).toBeInTheDocument()
    expect(within(fila).getByText('Vendedor → Empleado')).toBeInTheDocument()
    const num = within(screen.getByRole('table')).getByText('Autoridad de numeración asignada').closest('tr')!
    expect(within(num).getByText('Proceso del sistema (sin usuario)')).toBeInTheDocument()
    expect(within(num).getByText('Cotizaciones: STEL')).toBeInTheDocument()
    expect(screen.getByText('Evento desconocido (EVENTO_FUTURO)')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|NaN|\bnull\b/)
    expect(screen.queryByRole('button', { name: /borrar|eliminar|limpiar auditoría/i })).toBeNull()
  })

  it('detalle expandible accesible, sólo campos seguros', () => {
    render(<AuditoriaPage />)
    const fila = within(screen.getByRole('table')).getByText('Rol cambiado').closest('tr')!
    const boton = within(fila).getByRole('button', { name: 'Ver detalle' })
    expect(boton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(boton)
    expect(within(fila).getByRole('button', { name: 'Ocultar detalle' })).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(boton.getAttribute('aria-controls')!)!
    expect(panel).toHaveTextContent('Email de la persona')
    expect(panel).toHaveTextContent('n@b.test')
  })

  it('filtros van al servidor y vuelven a la página 1; evento se limpia si no es del módulo', () => {
    render(<AuditoriaPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(llamadas.auditoria.at(-1)![1]).toBe(50)
    fireEvent.change(screen.getByLabelText('Evento'), { target: { value: 'MEMBERSHIP_SUSPENDED' } })
    expect(llamadas.auditoria.at(-1)).toEqual([expect.objectContaining({ evento: 'MEMBERSHIP_SUSPENDED' }), 0, 50])
    fireEvent.change(screen.getByLabelText('Módulo'), { target: { value: 'empresa' } })
    expect(llamadas.auditoria.at(-1)![0]).toMatchObject({ modulo: 'empresa', evento: '' })
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'a1' } })
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'norberto' } })
    expect(llamadas.auditoria.at(-1)![0]).toMatchObject({ actor: 'a1', texto: 'norberto' })
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(llamadas.auditoria.at(-1)![0]).toMatchObject({ modulo: '', evento: '', actor: '', texto: '' })
  })

  it('rango de fechas al revés: aviso asociado y no se envía', () => {
    render(<AuditoriaPage />)
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-14' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-01' } })
    expect(screen.getByRole('alert')).toHaveTextContent('«Hasta» no puede ser anterior a «Desde».')
    expect(screen.getByLabelText('Hasta')).toHaveAttribute('aria-invalid', 'true')
    expect(llamadas.auditoria.at(-1)![0]).toMatchObject({ desde: '', hasta: '' })
  })

  it('vacío sin error', () => {
    estado.filas = []
    render(<AuditoriaPage />)
    expect(screen.getByText('Todavía no hay cambios de Configuración registrados en esta empresa.')).toBeInTheDocument()
    expect(screen.getByText('0 eventos')).toBeInTheDocument()
  })

  it('error: alerta y reintentar (no queda cargando)', () => {
    estado.error = true
    render(<AuditoriaPage />)
    expect(screen.getByText('No se pudo leer la auditoría.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(llamadas.refetch).toHaveBeenCalled()
    expect(screen.queryByText('Cargando…')).toBeNull()
  })

  it('mobile: cards con detalle', () => {
    estado.movil = true
    render(<AuditoriaPage />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Ver detalle' }).length).toBeGreaterThan(0)
  })
})
