import { describe, expect, it } from 'vitest'
import { actividadACsv, contenidoConBom, importe, nombreArchivo, numero, pipelineACsv, rankingACsv, texto } from './csv'
import type { FilaActividad, FilaPipeline, FilaRanking, ParametrosRanking } from '../types'

const fila = (p: Partial<FilaRanking>): FilaRanking => ({
  posicion: 1, total_filas: 1, clave: 'x', cliente_id: null, producto_id: null, etiqueta: 'X', codigo: null, moneda: null,
  importe: null, cantidad: null, documentos: 1, lineas_atipicas: null, cantidad_atipica: null, vinculado: true, activo: true,
  desde: '2025-10-01', hasta: '2026-09-13', ...p,
})

describe('texto: escape e inyección de fórmulas', () => {
  it('protege =, +, -, @, tabulación y retorno al inicio', () => {
    expect(texto('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(texto('+54 11 5555')).toBe("'+54 11 5555")
    expect(texto('-10')).toBe("'-10")
    expect(texto('@SUMA(A1)')).toBe("'@SUMA(A1)")
    expect(texto('\tcmd')).toBe("'\tcmd")
  })

  it('escapa separador, comillas y saltos; deja el resto igual', () => {
    expect(texto('Mabe; Argentina')).toBe('"Mabe; Argentina"')
    expect(texto('Pinza "grande"')).toBe('"Pinza ""grande"""')
    expect(texto('dos\nlíneas')).toBe('"dos\nlíneas"')
    expect(texto('Laminación S.A.I.C.')).toBe('Laminación S.A.I.C.')
    expect(texto('a=b')).toBe('a=b')
    expect(texto(null)).toBe('')
  })

  it('los números NO pasan por el escape: un negativo sigue siendo número', () => {
    expect(importe(-12.5)).toBe('-12.50')
    expect(importe('1234.5678')).toBe('1234.57')
    expect(importe(null)).toBe('')
    expect(numero(1585000)).toBe('1585000')
    expect(numero('144.09000')).toBe('144.09')
    expect(numero(0)).toBe('0')
  })
})

describe('UTF-8 y nombre de archivo', () => {
  it('BOM adelante y acentos intactos', () => {
    const c = contenidoConBom('Cliente\r\nLaminación')
    expect(c.charCodeAt(0)).toBe(0xfeff)
    expect(c.slice(1)).toBe('Cliente\r\nLaminación')
    expect(new TextEncoder().encode(c).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]))
  })

  it('sólo caracteres seguros', () => {
    expect(nombreArchivo(['clientes', 'entregado', 'USD', 'mes', '2026-09'])).toBe('informe-clientes-entregado-USD-mes-2026-09.csv')
    expect(nombreArchivo(['clientes', 'entregado', 'SIN MONEDA', '12m', '2026-09'])).toBe('informe-clientes-entregado-SIN-MONEDA-12m-2026-09.csv')
    expect(nombreArchivo(['../../x', 'a/b\\c', null, ''])).toBe('informe-..-..-x-a-b-c.csv')
  })
})

describe('ranking a CSV', () => {
  const cli: ParametrosRanking = { dimension: 'clientes', fuente: 'entregado', medida: 'importe', periodo: 'mes', moneda: 'SIN MONEDA' }

  it('clientes: moneda en su columna, SIN MONEDA escrito, importe sin símbolo', () => {
    const csv = rankingACsv(cli, [fila({ cliente_id: 'c1', etiqueta: '=cmd|calc', moneda: 'SIN MONEDA', importe: 12921677.51, documentos: 10 })])
    const [cab, uno] = csv.split('\r\n')
    expect(cab).toBe('Posicion;Cliente ID;Cliente;Activo;Fuente;Desde;Hasta;Moneda;Importe;Documentos')
    expect(uno).toBe("1;c1;'=cmd|calc;si;entregado;2025-10-01;2026-09-13;SIN MONEDA;12921677.51;10")
  })

  it('productos por cantidad: moneda «no aplica», sin importe, atípicos y vínculo', () => {
    const p: ParametrosRanking = { dimension: 'productos', fuente: 'entregado', medida: 'cantidad', periodo: '12m', moneda: null }
    const csv = rankingACsv(p, [
      fila({ producto_id: 'p1', codigo: 'GRAMPA.80-4T', etiqueta: 'GRAMPA 80-4T', cantidad: 1598510, documentos: 8, lineas_atipicas: 2, cantidad_atipica: 1598500 }),
      fila({ posicion: 2, codigo: 'SER00006', etiqueta: 'ALQUILER', cantidad: 397, documentos: 16, lineas_atipicas: 0, cantidad_atipica: 0, vinculado: false, activo: null }),
    ])
    const lineas = csv.split('\r\n')
    expect(lineas[0]).toBe('Posicion;Producto ID;SKU;Producto;Vinculado al catalogo;Activo;Fuente;Medida;Desde;Hasta;Moneda;Importe;Cantidad;Documentos;Lineas atipicas;Cantidad atipica')
    expect(lineas[1]).toBe('1;p1;GRAMPA.80-4T;GRAMPA 80-4T;si;si;entregado;cantidad;2025-10-01;2026-09-13;no aplica;;1598510;8;2;1598500')
    expect(lineas[2]).toBe('2;;SER00006;ALQUILER;no;;entregado;cantidad;2025-10-01;2026-09-13;no aplica;;397;16;0;0')
  })

  it('producto a precio 0 en importe: 0.00, no vacío', () => {
    const p: ParametrosRanking = { dimension: 'productos', fuente: 'pedido', medida: 'importe', periodo: '12m', moneda: 'USD' }
    const csv = rankingACsv(p, [fila({ producto_id: 'p1', codigo: 'GRAMPA.80-4T', moneda: 'USD', importe: 0, cantidad: 1598510 })])
    expect(csv.split('\r\n')[1]).toContain(';USD;0.00;1598510;')
  })
})

describe('actividad y pipeline a CSV', () => {
  it('actividad: sin las filas de rango, SIN MONEDA explícito, tipo en castellano', () => {
    const filas: FilaActividad[] = [
      { periodo: 'rango_actual', tipo: null, mes: '2026-09-01', desde: '2026-09-01', hasta: '2026-09-13', moneda: null, documentos: 0, importe: 0, en_revision: 0 },
      { periodo: 'actual', tipo: 'entregas', mes: '2026-09-01', desde: '2026-09-01', hasta: '2026-09-13', moneda: null, documentos: 15, importe: 12996570.72, en_revision: 15 },
    ]
    expect(actividadACsv(filas).split('\r\n')).toEqual([
      'Periodo;Tipo;Mes;Desde;Hasta;Moneda;Documentos;Importe;En revision',
      'actual;Entregado;2026-09-01;2026-09-01;2026-09-13;SIN MONEDA;15;12996570.72;15',
    ])
  })

  it('pipeline: moneda sólo donde hay dinero; TODAS sin importe', () => {
    const base = { desde: null, hasta: null, categoria: null, moneda: null, importe: null, convertidas: null, importe_convertido: null, abiertas: null, aceptadas: null }
    const filas: FilaPipeline[] = [
      { ...base, seccion: 'rango_actual', periodo: 'actual', desde: '2026-09-01', hasta: '2026-09-13', documentos: 0 },
      { ...base, seccion: 'conversion', periodo: '12m', moneda: 'TODAS', documentos: 288, convertidas: 132, abiertas: 156, aceptadas: 134 },
      { ...base, seccion: 'pedidos_pendientes', periodo: 'todos', categoria: 'sin_entrega', documentos: 2, importe: 1203.2 },
      { ...base, seccion: 'cumplimiento', periodo: 'todos', categoria: 'no_consta_entrega', documentos: 21 },
    ]
    expect(pipelineACsv(filas).split('\r\n').slice(1)).toEqual([
      'conversion;12m;;;;TODAS;288;;132;;156;134',
      'pedidos_pendientes;todos;;;sin_entrega;SIN MONEDA;2;1203.20;;;;',
      'cumplimiento;todos;;;no_consta_entrega;no aplica;21;;;;;',
    ])
  })
})
