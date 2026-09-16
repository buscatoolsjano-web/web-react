import { describe, expect, it } from 'vitest'
import { desdeHace, fechaCorta, presentarEstadoSync, ETIQUETA_ENTIDAD, type SyncStel } from './sync-stel'

const base: SyncStel = {
  entidad: 'products',
  estado: 'finished',
  inicio: '2026-09-15T10:00:00Z',
  fin: '2026-09-15T10:00:05Z',
  checkpoint: '2026-09-15T09:00:00Z',
  ultimoVisto: '555001',
  llamadas: 2,
  error: null,
  bloqueado: false,
  resumen: {},
}

describe('presentarEstadoSync', () => {
  it('una corrida terminada se ve al día', () => {
    expect(presentarEstadoSync(base)).toMatchObject({ etiqueta: 'Al día', tono: 'ok' })
  })

  it('una corrida fallida muestra el error de la base, no uno genérico', () => {
    const p = presentarEstadoSync({ ...base, estado: 'failed', error: 'sync_en_curso:products:otro' })
    expect(p.tono).toBe('error')
    expect(p.detalle).toBe('sync_en_curso:products:otro')
  })

  it('si falló sin mensaje, explica que el punto de control no avanzó', () => {
    expect(presentarEstadoSync({ ...base, estado: 'failed', error: null }).detalle).toContain('checkpoint no avanzó')
  })

  it('distingue en curso de sin correr', () => {
    expect(presentarEstadoSync({ ...base, estado: 'running' }).etiqueta).toBe('En curso')
    expect(presentarEstadoSync({ ...base, estado: 'idle' }).etiqueta).toBe('Sin correr')
  })
})

describe('desdeHace', () => {
  const ahora = Date.parse('2026-09-15T12:00:00Z')

  it('sin fecha dice «nunca»', () => {
    expect(desdeHace(null, ahora)).toBe('nunca')
  })

  it('redondea a minutos, horas y días', () => {
    expect(desdeHace('2026-09-15T11:59:50Z', ahora)).toBe('recién')
    expect(desdeHace('2026-09-15T11:30:00Z', ahora)).toBe('hace 30 min')
    expect(desdeHace('2026-09-15T09:00:00Z', ahora)).toBe('hace 3 h')
    expect(desdeHace('2026-09-13T12:00:00Z', ahora)).toBe('hace 2 días')
    expect(desdeHace('2026-09-14T12:00:00Z', ahora)).toBe('hace 1 día')
  })

  it('una fecha futura o inválida no inventa un número', () => {
    expect(desdeHace('2026-09-16T12:00:00Z', ahora)).toBe('—')
    expect(desdeHace('no es una fecha', ahora)).toBe('—')
  })
})

describe('fechaCorta', () => {
  it('sin fecha o con fecha inválida devuelve un guion', () => {
    expect(fechaCorta(null)).toBe('—')
    expect(fechaCorta('cualquier cosa')).toBe('—')
  })

  it('con fecha válida devuelve algo legible', () => {
    expect(fechaCorta('2026-09-15T10:00:00Z')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })
})

describe('etiquetas', () => {
  it('nombra las dos entidades que sincroniza', () => {
    expect(Object.keys(ETIQUETA_ENTIDAD).sort()).toEqual(['documents', 'products'])
  })
})
