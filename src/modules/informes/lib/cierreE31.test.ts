import { describe, expect, it } from 'vitest'
import { monedasDeEvolucion, puntosDeEvolucion } from './actividad'
import { participacionDe } from './rankings'
import { documentosACsv, texto } from './csv'
import type { SerieActividad } from '../types'

/**
 * Los pendientes de E3, cerrados (Fase 21 · E3.1).
 *
 * Tres reglas que, si se aflojan, devuelven la pantalla a mentir con números
 * que parecen datos: los puntos del gráfico y los de la tabla tienen que ser
 * los MISMOS, la participación sólo existe si el denominador es el mismo
 * universo, y el CSV no puede perder la protección contra fórmulas.
 */
const SERIES: SerieActividad[] = [
  {
    tipo: 'entregas',
    monedas: ['USD', 'ARS'],
    meses: [
      { mes: '2026-08-01', porMoneda: { USD: { documentos: 3, importe: 100, enRevision: 0 } } },
      { mes: '2026-09-01', porMoneda: { USD: { documentos: 5, importe: 250, enRevision: 0 }, ARS: { documentos: 2, importe: 9000, enRevision: 0 } } },
    ],
  },
  {
    tipo: 'cotizaciones',
    monedas: ['USD'],
    meses: [
      { mes: '2026-08-01', porMoneda: { USD: { documentos: 9, importe: 700, enRevision: 0 } } },
      { mes: '2026-09-01', porMoneda: { USD: { documentos: 1, importe: 20, enRevision: 0 } } },
    ],
  },
  { tipo: 'pedidos', monedas: [], meses: [] },
]

describe('Evolución: una transformación, dos presentaciones (§1, §2)', () => {
  it('responde a la métrica', () => {
    expect(puntosDeEvolucion(SERIES, 'entregas', 'USD').map((p) => p.importe)).toEqual([100, 250])
    expect(puntosDeEvolucion(SERIES, 'cotizaciones', 'USD').map((p) => p.importe)).toEqual([700, 20])
  })

  it('responde a la moneda, y NO las suma', () => {
    expect(puntosDeEvolucion(SERIES, 'entregas', 'ARS').map((p) => p.importe)).toEqual([0, 9000])
  })

  it('un mes sin documentos vale 0, pero sigue estando: el hueco es información', () => {
    const p = puntosDeEvolucion(SERIES, 'entregas', 'ARS')
    expect(p).toHaveLength(2)
    expect(p[0]).toEqual({ mes: '2026-08-01', importe: 0, documentos: 0 })
  })

  it('el gráfico y la tabla no pueden separarse: salen de la misma llamada', () => {
    const a = puntosDeEvolucion(SERIES, 'entregas', 'USD')
    const b = puntosDeEvolucion(SERIES, 'entregas', 'USD')
    expect(a).toEqual(b)
    // Y cada punto trae importe Y documentos: la tabla no recalcula nada.
    expect(a[1]).toEqual({ mes: '2026-09-01', importe: 250, documentos: 5 })
  })

  it('sin moneda no hay serie: no se inventa una', () => {
    expect(puntosDeEvolucion(SERIES, 'entregas', null)).toEqual([])
  })

  it('las monedas ofrecidas son las que tuvieron documentos de ESA métrica', () => {
    expect(monedasDeEvolucion(SERIES, 'entregas')).toEqual(['USD', 'ARS'])
    expect(monedasDeEvolucion(SERIES, 'cotizaciones')).toEqual(['USD'])
    expect(monedasDeEvolucion(SERIES, 'pedidos')).toEqual([])
  })
})

describe('Participación: sólo si el denominador es el mismo universo (§5)', () => {
  const fila = (importe: number | null) => ({ importe })

  it('cliente sobre el total de su propio universo', () => {
    expect(participacionDe(fila(12000), { medida: 'importe' }, 90000)).toBeCloseTo(13.33, 2)
  })

  it('en CANTIDAD no existe: sumar unidades de SKU distintos no da un total', () => {
    expect(participacionDe(fila(12000), { medida: 'cantidad' }, 90000)).toBeNull()
  })

  it('sin denominador no se inventa', () => {
    expect(participacionDe(fila(12000), { medida: 'importe' }, null)).toBeNull()
  })

  it('denominador cero es null, no división por cero', () => {
    expect(participacionDe(fila(12000), { medida: 'importe' }, 0)).toBeNull()
  })

  it('una fila sin importe no participa de nada', () => {
    expect(participacionDe(fila(null), { medida: 'importe' }, 90000)).toBe(0)
  })

  it('el Top N NO suma 100 %, y está bien', () => {
    const total = 1000
    const top = [500, 200, 100].map((i) => participacionDe(fila(i), { medida: 'importe' }, total)!)
    expect(top.reduce((a, b) => a + b, 0)).toBe(80)
  })
})

describe('CSV de documentos (§6, §7, §8)', () => {
  const doc = (x: Partial<Parameters<typeof documentosACsv>[0][number]> = {}) => ({
    tipo: 'entregas' as const,
    id: 'd1',
    numero: 'RT-ERP00002',
    fecha: '2026-09-15',
    clienteId: 'c1',
    cliente: 'NORBERTO S.A.',
    estado: 'shipped',
    serie: 'RT-ERP',
    origen: null,
    moneda: 'USD',
    importe: 1234.5,
    enRevision: false,
    ...x,
  })

  it('exporta las columnas del universo que se está viendo', () => {
    const csv = documentosACsv([doc()])
    const [cab, fila] = csv.split('\r\n')
    // El separador es ';': es lo que espera Excel en español.
    expect(cab).toBe('fecha;tipo;numero;cliente;estado;serie;origen;importe;moneda;en_revision')
    expect(fila).toContain('RT-ERP00002')
    expect(fila).toContain('1234.50')
  })

  it('el origen nulo se escribe ERP: vacío se leería como dato faltante', () => {
    expect(documentosACsv([doc({ origen: null })])).toContain('ERP')
    expect(documentosACsv([doc({ origen: 'stel' })])).toContain('stel')
  })

  it('sin filas, sólo la cabecera: un archivo vacío no miente', () => {
    expect(documentosACsv([]).split('\r\n')).toHaveLength(1)
  })

  it('la protección contra fórmulas sigue activa en los campos nuevos', () => {
    // Un cliente que se llame «=cmd» no puede ejecutarse al abrir la planilla.
    const csv = documentosACsv([doc({ cliente: '=1+1', numero: '+49', serie: '-X', estado: '@dde' })])
    expect(csv).toContain("'=1+1")
    expect(csv).toContain("'+49")
    expect(csv).toContain("'-X")
    expect(csv).toContain("'@dde")
  })

  it.each(['=', '+', '-', '@', '\t', '\r'])('«%s» al inicio se neutraliza', (c) => {
    // La comilla va SIEMPRE delante del carácter peligroso. Con el retorno de
    // carro el valor además queda entrecomillado, así que no se mira el primer
    // carácter del resultado sino que la comilla esté antes del peligro.
    expect(texto(`${c}peligro`)).toContain(`'${c}peligro`)
  })
})
