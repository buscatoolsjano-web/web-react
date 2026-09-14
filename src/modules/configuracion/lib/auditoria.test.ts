import { describe, expect, it } from 'vitest'
import {
  EVENTOS,
  detallesSeguros,
  errorFechas,
  etiquetaActor,
  etiquetaEntidad,
  etiquetaEvento,
  eventosDeModulo,
  formatearFechaHora,
  hayFiltros,
  resumenEvento,
  FILTROS_VACIOS,
  type EventoAuditoria,
} from './auditoria'

const ev = (p: Partial<EventoAuditoria>): EventoAuditoria => ({
  clave: 'x',
  origen: 'users_audit',
  id: 1,
  modulo: 'usuarios',
  evento: 'MEMBERSHIP_ROLE_CHANGED',
  fecha: '2026-09-14T15:30:00Z',
  actor: { id: 'a', nombre: 'Jano', email: 'jano@buscatools.test', miembro: true },
  entidadTipo: 'usuario',
  entidadId: 'u1',
  entidadNombre: 'Norberto',
  entidadExiste: true,
  detalles: {},
  ...p,
})

describe('etiquetas', () => {
  it('todos los eventos que la base puede escribir tienen etiqueta en castellano', () => {
    const base = [
      'USER_INVITED', 'MEMBERSHIP_ADDED', 'INVITATION_RESENT', 'MEMBERSHIP_ROLE_CHANGED', 'MEMBERSHIP_SUSPENDED', 'MEMBERSHIP_REACTIVATED',
      'COMPANY_UPDATED', 'COMPANY_LOGO_UPDATED', 'COMPANY_LOGO_REMOVED',
      'BRAND_CREATED', 'BRAND_DISABLED', 'BRAND_ENABLED', 'BRAND_DELETED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED',
      'NUMBERING_AUTHORITY_INSERT', 'NUMBERING_AUTHORITY_UPDATE', 'NUMBERING_AUTHORITY_DELETE',
    ]
    for (const c of base) expect(etiquetaEvento(c)).not.toMatch(/desconocido/)
    expect(Object.keys(EVENTOS).sort()).toEqual([...base].sort())
  })
  it('un evento nuevo no rompe: fallback con el código', () => {
    expect(etiquetaEvento('ALGO_NUEVO')).toBe('Evento desconocido (ALGO_NUEVO)')
  })
  it('eventos por módulo', () => {
    expect(eventosDeModulo('empresa').map((e) => e.codigo)).toEqual(['COMPANY_UPDATED', 'COMPANY_LOGO_UPDATED', 'COMPANY_LOGO_REMOVED'])
    expect(eventosDeModulo('')).toHaveLength(19)
  })
})

describe('actor y entidad', () => {
  it('no inventa actor', () => {
    expect(etiquetaActor(ev({}))).toBe('Jano')
    expect(etiquetaActor(ev({ actor: { id: 'a', nombre: null, email: 'x@y.test', miembro: true } }))).toBe('x@y.test')
    expect(etiquetaActor(ev({ actor: null }))).toBe('Sin actor registrado')
    expect(etiquetaActor(ev({ actor: null, detalles: { origen_tecnico: 'postgres' } }))).toBe('Proceso del sistema (sin usuario)')
  })
  it('entidad con nombre actual o snapshot, y aviso si ya no existe', () => {
    expect(etiquetaEntidad(ev({}))).toBe('Usuario: Norberto')
    expect(etiquetaEntidad(ev({ entidadTipo: 'marca', entidadNombre: 'ZZ Libre', entidadExiste: false }))).toBe('Marca: ZZ Libre (ya no existe)')
    expect(etiquetaEntidad(ev({ entidadTipo: 'tipo_documento', entidadNombre: 'delivery' }))).toBe('Tipo de documento: Notas de entrega (remitos)')
    expect(etiquetaEntidad(ev({ entidadNombre: null, entidadId: '12345678-aaaa' }))).toBe('Usuario: id 12345678')
  })
})

describe('resumen', () => {
  it('rol, estado, empresa, categoría y numeración', () => {
    expect(resumenEvento(ev({ detalles: { rol_anterior: 'salesperson', rol_nuevo: 'employee' } }))).toBe('Vendedor → Empleado')
    expect(resumenEvento(ev({ evento: 'MEMBERSHIP_SUSPENDED', detalles: { estado_anterior: 'active', estado_nuevo: 'suspended' } }))).toBe('Activo → Suspendido')
    expect(resumenEvento(ev({ evento: 'USER_INVITED', detalles: { rol_nuevo: 'technician' } }))).toBe('Como Técnico')
    expect(resumenEvento(ev({ evento: 'COMPANY_UPDATED', detalles: { campos: ['phone', 'legal_name'] } }))).toMatch(/^Campos: .+, .+$/)
    expect(resumenEvento(ev({ evento: 'CATEGORY_UPDATED', detalles: { nombre_registrado: 'Puntas' } }))).toBe('Nuevo nombre: Puntas')
    expect(resumenEvento(ev({ evento: 'NUMBERING_AUTHORITY_INSERT', detalles: { tipo_documento: 'quote', autoridad_nueva: 'STEL' } }))).toBe('Cotizaciones: STEL')
    expect(resumenEvento(ev({ evento: 'NUMBERING_AUTHORITY_UPDATE', detalles: { tipo_documento: 'quote', autoridad_anterior: 'STEL', autoridad_nueva: 'ERP' } }))).toBe('Cotizaciones: STEL → ERP')
  })
  it('marcas y categorías: el resumen no repite el nombre de la entidad', () => {
    expect(resumenEvento(ev({ evento: 'BRAND_CREATED', detalles: { nombre_registrado: 'ZZ Marca' } }))).toBe('Alta')
    expect(resumenEvento(ev({ evento: 'BRAND_DISABLED', detalles: { nombre_registrado: 'ZZ Marca' } }))).toBe('Activa → Inactiva')
    expect(resumenEvento(ev({ evento: 'BRAND_ENABLED', detalles: {} }))).toBe('Inactiva → Activa')
    expect(resumenEvento(ev({ evento: 'CATEGORY_DELETED', detalles: { nombre_registrado: 'X' } }))).not.toMatch(/X/)
    expect(resumenEvento(ev({ evento: 'EVENTO_NUEVO', detalles: { nombre_registrado: 'X' } }))).toBe('')
  })
  it('sin datos no escribe «undefined» ni «null»', () => {
    for (const codigo of Object.keys(EVENTOS).concat('RARO')) {
      const r = resumenEvento(ev({ evento: codigo, detalles: {} }))
      expect(r).not.toMatch(/undefined|null|NaN/)
    }
  })
})

describe('detalle seguro', () => {
  it('sólo campos conocidos; nada que parezca secreto', () => {
    const d = detallesSeguros(ev({
      detalles: { rol_anterior: 'salesperson', rol_nuevo: 'employee', email_afectado: 'n@b.test', token: 'abc', invite_link: 'https://x', otro: 1, authorization: 'Bearer x' },
    }))
    expect(d).toEqual([
      { etiqueta: 'Rol anterior', valor: 'Vendedor' },
      { etiqueta: 'Rol nuevo', valor: 'Empleado' },
      { etiqueta: 'Email de la persona', valor: 'n@b.test' },
    ])
  })
  it('campos de empresa traducidos', () => {
    expect(detallesSeguros(ev({ evento: 'COMPANY_UPDATED', detalles: { campos: ['name'] } }))[0]).toMatchObject({ etiqueta: 'Campos modificados' })
  })
})

describe('filtros y formato', () => {
  it('rango de fechas inválido', () => {
    expect(errorFechas({ desde: '2026-09-14', hasta: '2026-09-01' })).toMatch(/anterior/)
    expect(errorFechas({ desde: '2026-09-01', hasta: '' })).toBeNull()
  })
  it('hay filtros', () => {
    expect(hayFiltros(FILTROS_VACIOS)).toBe(false)
    expect(hayFiltros({ ...FILTROS_VACIOS, modulo: 'empresa' })).toBe(true)
  })
  it('fecha en hora de Argentina; inválida no muestra NaN', () => {
    expect(formatearFechaHora('2026-09-14T15:30:00Z')).toMatch(/14\/09\/2026.*12:30/)
    expect(formatearFechaHora('no-es-fecha')).toBe('—')
  })
})
