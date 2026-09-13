import { describe, expect, it } from 'vitest'
import { FILTROS_INICIALES, type SugerenciaCliente } from '../types'
import { dependeDelTrabajo, escribirFiltros, hayFiltrosActivos, leerFiltros } from './filtros'
import { ErrorContenido, clasificarRespuesta, mensajeDeError } from './errores'
import {
  adjuntosVisibles,
  fechaBandeja,
  presentarSugerencias,
  resumenParticipantes,
  tamanoLegible,
} from './formato'
import { puedeUsarEmails } from './permisos'

const UUID = '0b5c8a8e-6f0e-4d3c-9a57-1a2b3c4d5e6f'

describe('filtros en la URL', () => {
  it('ida y vuelta', () => {
    const f = {
      ...FILTROS_INICIALES,
      q: 'cotización',
      soloNoLeidos: true,
      estado: 'en_proceso' as const,
      asignado: UUID,
      cliente: 'sin' as const,
      soloConAdjuntos: true,
      pagina: 3,
      porPagina: 50,
    }
    expect(leerFiltros(escribirFiltros(f))).toEqual(f)
  })

  it('la URL por defecto está vacía', () => {
    expect(escribirFiltros(FILTROS_INICIALES).toString()).toBe('')
  })

  it('ignora valores inventados en vez de mandarlos al servidor', () => {
    const f = leerFiltros(
      new URLSearchParams('estado=spam&asignado=robert;drop&cliente=todos&cuenta=x&per=1000&page=-2'),
    )
    expect(f.estado).toBeNull()
    expect(f.asignado).toBeNull()
    expect(f.cliente).toBeNull()
    expect(f.cuenta).toBeNull()
    expect(f.porPagina).toBe(25)
    expect(f.pagina).toBe(1)
  })

  it('acepta yo y nadie', () => {
    expect(leerFiltros(new URLSearchParams('asignado=yo')).asignado).toBe('yo')
    expect(leerFiltros(new URLSearchParams('asignado=nadie')).asignado).toBe('nadie')
  })

  it('sabe cuándo hay filtros y cuándo un cambio de trabajo puede sacar filas', () => {
    expect(hayFiltrosActivos(FILTROS_INICIALES)).toBe(false)
    expect(hayFiltrosActivos({ ...FILTROS_INICIALES, soloNoLeidos: true })).toBe(true)
    expect(dependeDelTrabajo({ ...FILTROS_INICIALES, soloNoLeidos: true })).toBe(false)
    expect(dependeDelTrabajo({ ...FILTROS_INICIALES, estado: 'resuelto' })).toBe(true)
  })
})

describe('permisos: quién ve Emails', () => {
  it.each([
    ['admin', true],
    ['employee', true],
    ['salesperson', false],
    ['technician', false],
    ['customer', false],
    ['distributor', false],
    ['', false],
    [null, false],
  ])('%s → %s', (rol, esperado) => {
    expect(puedeUsarEmails(rol)).toBe(esperado)
  })
})

describe('errores del servicio de contenido', () => {
  it('usa el código del cuerpo si es conocido', () => {
    expect(clasificarRespuesta(502, { error: 'gmail_no_autorizado' })).toBe('gmail_no_autorizado')
  })
  it('cae al status si el cuerpo no sirve', () => {
    expect(clasificarRespuesta(401, null)).toBe('sesion_invalida')
    expect(clasificarRespuesta(429, { error: 'otra cosa' })).toBe('gmail_ocupado')
    expect(clasificarRespuesta(503, '<html>')).toBe('gmail_no_disponible')
  })
  it('nunca muestra texto crudo: todo código tiene un mensaje propio', () => {
    for (const c of ['sesion_invalida', 'hilo_no_disponible', 'gmail_ocupado', 'gmail_no_autorizado', 'desconocido'] as const) {
      expect(mensajeDeError(c)).not.toMatch(/google|stack|error:/i)
    }
  })
  it('ofrece reintentar sólo lo que puede cambiar', () => {
    expect(new ErrorContenido('gmail_ocupado').reintentable).toBe(true)
    expect(new ErrorContenido('hilo_no_disponible').reintentable).toBe(false)
    expect(new ErrorContenido('sesion_invalida').reintentable).toBe(false)
  })
})

describe('formato', () => {
  it('tamaños', () => {
    expect(tamanoLegible(0)).toBe('—')
    expect(tamanoLegible(512)).toBe('512 B')
    expect(tamanoLegible(20480)).toBe('20 KB')
    expect(tamanoLegible(3 * 1024 * 1024 + 200000)).toBe('3,2 MB')
  })

  it('la fecha de hoy muestra la hora', () => {
    const ahora = new Date('2026-09-12T15:00:00-03:00')
    expect(fechaBandeja('2026-09-12T09:05:00-03:00', ahora)).toMatch(/09:05/)
    expect(fechaBandeja(null, ahora)).toBe('—')
  })

  it('los adjuntos listados no incluyen las imágenes inline del cuerpo', () => {
    const a = [
      { partId: '1', nombre: 'logo', mime: 'image/png', tamano: 1, contentId: 'x', inline: true },
      { partId: '2', nombre: 'factura.pdf', mime: 'application/pdf', tamano: 1, contentId: null, inline: false },
    ]
    expect(adjuntosVisibles(a).map((x) => x.nombre)).toEqual(['factura.pdf'])
  })

  it('los participantes excluyen el propio buzón', () => {
    expect(resumenParticipantes(['info@bt.com', 'a@x.com', 'b@y.com', 'c@z.com'], 'INFO@bt.com')).toBe(
      'a@x.com, b@y.com y 1 más',
    )
  })
})

describe('sugerencias de CRM', () => {
  const s = (p: Partial<SugerenciaCliente>): SugerenciaCliente => ({
    clienteId: 'c1',
    clienteNombre: 'Cliente',
    contactoId: null,
    contactoNombre: null,
    direccion: 'a@x.com',
    clase: 'exacto',
    ...p,
  })

  it('el exacto único es el único recomendado', () => {
    const r = presentarSugerencias([
      s({ clienteId: 'c2', clienteNombre: 'Dominio SA', clase: 'sugerido_dominio' }),
      s({ clienteId: 'c1', clienteNombre: 'Exacto SA' }),
    ])
    expect(r.map((x) => [x.clienteNombre, x.recomendada])).toEqual([
      ['Exacto SA', true],
      ['Dominio SA', false],
    ])
  })

  it('dos exactos distintos: ninguno recomendado', () => {
    const r = presentarSugerencias([s({ clienteId: 'c1' }), s({ clienteId: 'c2' })])
    expect(r.every((x) => !x.recomendada)).toBe(true)
  })

  it('un ambiguo nunca es recomendado', () => {
    expect(presentarSugerencias([s({ clase: 'ambiguo' })])[0]?.recomendada).toBe(false)
  })
})
