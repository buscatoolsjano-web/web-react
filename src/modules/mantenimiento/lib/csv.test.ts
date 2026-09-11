import { describe, expect, it } from 'vitest'
import { celda, equiposACsv, importe, ordenesACsv } from './csv'
import type { ActivoListado, OrdenListado } from '../types'

const EQUIPO: ActivoListado = {
  id: 'a1',
  referencia: 'EQ00001',
  identificador: null,
  serie: 'FEIN-88231-A',
  serieNormalizada: 'FEIN88231A',
  duenoId: 'c1',
  dueno: 'TORQUEAR SA',
  productoId: null,
  productoSku: null,
  marca: 'Fein',
  modelo: 'ASCD 18-1000',
  tipo: null,
  ciudad: null,
  bajoContrato: false,
  dadoDeBaja: false,
  ordenes: 2,
  creadoEn: '2026-09-11T14:00:00.000Z',
}

const ORDEN: OrdenListado = {
  id: 'o1',
  numero: 'OS00001',
  activoId: 'a1',
  activoReferencia: 'EQ00001',
  activoSerie: 'FEIN-88231-A',
  clienteId: 'c1',
  cliente: 'TORQUEAR SA',
  estado: 'open',
  etapa: 'torque',
  enEspera: false,
  tipoServicio: 'corrective',
  motivoIngreso: null,
  tecnicoId: null,
  tecnico: null,
  fechaIngreso: '2026-09-11',
  fechaEntrega: null,
  estadoCotizacion: 'approved',
  moneda: 'ARS',
  total: 36000,
}

const cruda = (s: string) => s

describe('celda', () => {
  it('escapa el separador, que es lo que rompe un CSV', () => {
    expect(celda('Pérez, Juan')).toBe('"Pérez, Juan"')
    expect(celda('a;b')).toBe('"a;b"')
  })

  it('duplica las comillas de adentro', () => {
    expect(celda('el "grande"')).toBe('"el ""grande"""')
  })

  it('un salto de línea no parte la fila en dos', () => {
    expect(celda('dos\nlíneas')).toBe('"dos\nlíneas"')
  })

  it('null y undefined son celda vacía, no «null»', () => {
    expect(celda(null)).toBe('')
    expect(celda(undefined)).toBe('')
  })

  it('un texto común no se toca', () => {
    expect(celda('EQ00001')).toBe('EQ00001')
  })
})

describe('importe', () => {
  it('punto decimal y sin separador de miles: si no, Excel lo lee como texto', () => {
    expect(importe(36000)).toBe('36000.00')
    expect(importe(1234.5)).toBe('1234.50')
  })

  it('null es vacío, no cero — no es lo mismo no tener total que valer cero', () => {
    expect(importe(null)).toBe('')
  })
})

describe('equiposACsv', () => {
  it('la primera línea son los encabezados', () => {
    const csv = equiposACsv([])
    expect(csv.split('\r\n')[0]).toContain('Referencia;Identificador;Serie')
  })

  it('una fila por equipo, con la serie entera', () => {
    const csv = equiposACsv([EQUIPO])
    const filas = csv.split('\r\n')
    expect(filas).toHaveLength(2)
    expect(filas[1]).toContain('EQ00001;;FEIN-88231-A')
    expect(filas[1]).toContain('TORQUEAR SA')
  })

  it('la fecha de alta va sin la hora', () => {
    expect(equiposACsv([EQUIPO]).split('\r\n')[1]).toContain('2026-09-11')
    expect(equiposACsv([EQUIPO])).not.toContain('T14:00')
  })
})

describe('ordenesACsv', () => {
  it('la moneda va en su propia columna, aparte del total', () => {
    const csv = ordenesACsv([ORDEN], cruda, cruda, cruda, cruda)
    const fila = csv.split('\r\n')[1] ?? ''
    // Moneda y total son dos celdas contiguas y separadas: nadie puede sumar
    // una columna que mezcla ARS con USD sin ver antes cuál es cuál.
    expect(fila.endsWith('ARS;36000.00')).toBe(true)
  })

  it('las etiquetas salen traducidas por quien llama, no crudas', () => {
    const csv = ordenesACsv([ORDEN], () => 'Torque', () => 'Abierta', () => 'Correctivo', () => 'Aprobada')
    const fila = csv.split('\r\n')[1] ?? ''
    expect(fila).toContain('Correctivo;Torque;Abierta')
    expect(fila).toContain('Aprobada')
  })

  it('sin entrega la celda queda vacía', () => {
    const fila = ordenesACsv([ORDEN], cruda, cruda, cruda, cruda).split('\r\n')[1] ?? ''
    expect(fila.startsWith('OS00001;2026-09-11;;')).toBe(true)
  })
})
