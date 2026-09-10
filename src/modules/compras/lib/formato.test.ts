import { describe, expect, it } from 'vitest'
import {
  etiquetaDeAccion,
  etiquetaDeEstado,
  formatearCuit,
  formatearFecha,
  formatearFechaHora,
  formatearImporte,
  formatearNumero,
  nombreDePais,
  nombreVisible,
  rangoVisible,
  totalDePaginas,
} from './formato'

describe('formatearFecha', () => {
  it('parte el ISO a mano para no correrse un día por la zona horaria', () => {
    expect(formatearFecha('2026-09-10')).toBe('10/09/2026')
    expect(formatearFecha('2026-01-01T03:00:00.000Z')).toBe('01/01/2026')
  })

  it('sin fecha, raya', () => {
    expect(formatearFecha(null)).toBe('—')
  })
})

describe('formatearFechaHora', () => {
  it('agrega la hora cuando está', () => {
    expect(formatearFechaHora('2026-09-10T14:35:12.000Z')).toBe('10/09/2026 14:35')
  })

  it('y no la inventa cuando no', () => {
    expect(formatearFechaHora('2026-09-10')).toBe('10/09/2026')
  })
})

describe('formatearCuit', () => {
  it('once dígitos se muestran con guiones', () => {
    expect(formatearCuit('30503284410')).toBe('30-50328441-0')
    expect(formatearCuit('30-50328441-0')).toBe('30-50328441-0')
  })

  it('lo que no es un CUIT se muestra tal cual, sin corregirlo', () => {
    expect(formatearCuit('Básculas Magris S.A')).toBe('Básculas Magris S.A')
    expect(formatearCuit(null)).toBe('—')
  })
})

describe('nombreDePais', () => {
  it('escribe el nombre de los que trajo la migración', () => {
    expect(nombreDePais('AR')).toBe('Argentina')
    expect(nombreDePais('ES')).toBe('España')
    expect(nombreDePais('IT')).toBe('Italia')
    expect(nombreDePais('UY')).toBe('Uruguay')
    expect(nombreDePais('US')).toBe('Estados Unidos')
  })

  it('un código que no conoce se muestra crudo, no desaparece', () => {
    expect(nombreDePais('ZZ')).toBe('ZZ')
  })

  it('sin país, raya', () => {
    expect(nombreDePais(null)).toBe('—')
  })
})

describe('etiquetaDeEstado', () => {
  it('la baja gana sobre el estado', () => {
    expect(etiquetaDeEstado('active', true)).toBe('Dado de baja')
    expect(etiquetaDeEstado('inactive', true)).toBe('Dado de baja')
  })

  it('y si no hay baja, manda el estado', () => {
    expect(etiquetaDeEstado('active', false)).toBe('Activo')
    expect(etiquetaDeEstado('inactive', false)).toBe('Inactivo')
  })
})

describe('etiquetaDeAccion', () => {
  it('traduce las acciones de la auditoría', () => {
    expect(etiquetaDeAccion('create')).toBe('Alta')
    expect(etiquetaDeAccion('status_change')).toBe('Cambio de estado')
  })

  it('una acción desconocida se muestra cruda', () => {
    expect(etiquetaDeAccion('lo_que_sea')).toBe('lo_que_sea')
  })
})

describe('nombreVisible', () => {
  it('un proveedor se titula SIEMPRE con su razón social', () => {
    // El «nombre comercial» del maestro legacy es casi siempre una persona de
    // contacto: «Mauricio Mendez» en DHL, «Walter Maldonado» en LAAPSA. Un
    // contacto no es el proveedor.
    expect(nombreVisible('Pinturerias REX S.A.')).toBe('Pinturerias REX S.A.')
    expect(nombreVisible('ABELSON EXPRESS')).toBe('ABELSON EXPRESS')
  })

  it('se recorta', () => {
    expect(nombreVisible('  DHL Express Argentina  ')).toBe('DHL Express Argentina')
  })

  it('sin razón social, algo se muestra', () => {
    expect(nombreVisible('')).toBe('Sin nombre')
    expect(nombreVisible('   ')).toBe('Sin nombre')
  })
})

describe('rangoVisible y totalDePaginas', () => {
  it('cuenta los 142 proveedores de a 25', () => {
    expect(totalDePaginas(142, 25)).toBe(6)
    expect(rangoVisible(1, 25, 142)).toBe('1–25 de 142')
    expect(rangoVisible(6, 25, 142)).toBe('126–142 de 142')
  })

  it('sin resultados no miente', () => {
    expect(rangoVisible(1, 25, 0)).toBe('0 resultados')
    expect(totalDePaginas(0, 25)).toBe(1)
  })
})

describe('formatearImporte', () => {
  it('el importe lleva su moneda al lado', () => {
    expect(formatearImporte(1460, 'USD')).toBe('USD 1.460,00')
    expect(formatearImporte(8471.25, 'ARS')).toBe('ARS 8.471,25')
  })

  it('sin moneda va el número solo, no un guion delante', () => {
    // Un pedido nuevo empieza sin moneda elegida: «— 0,00» parece un error.
    expect(formatearImporte(0, '')).toBe('0,00')
    expect(formatearImporte(0, null)).toBe('0,00')
    expect(formatearImporte(1460, '—')).toBe('1.460,00')
  })

  it('sin importe, raya', () => {
    expect(formatearImporte(null, 'USD')).toBe('—')
    expect(formatearImporte(Number.NaN, 'USD')).toBe('—')
  })
})

describe('formatearNumero', () => {
  it('una cantidad entera va sin decimales', () => {
    // «30», no «30,00»: en una grilla de nueve columnas los ceros ensucian.
    expect(formatearNumero(30)).toBe('30')
    expect(formatearNumero(0)).toBe('0')
    expect(formatearNumero(1000)).toBe('1.000')
  })

  it('y una con decimales los muestra', () => {
    expect(formatearNumero(2.5)).toBe('2,5')
    expect(formatearNumero(0.125)).toBe('0,125')
  })

  it('sin cantidad, raya', () => {
    expect(formatearNumero(null)).toBe('—')
    expect(formatearNumero(Number.NaN)).toBe('—')
  })
})
