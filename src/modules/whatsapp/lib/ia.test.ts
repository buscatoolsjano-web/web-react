import { describe, expect, it } from 'vitest'
import {
  agruparConversaciones,
  compromisosVencidos,
  nivelDeConfianza,
  periodoDiario,
  periodoSemanal,
  presentarMotivos,
  seccionesIA,
  textoDeErrorIA,
  type ConversacionInforme,
  type ItemIA,
} from './ia'

const item = (p: Partial<ItemIA> = {}): ItemIA => ({
  id: 'i1',
  conversacionId: 'c1',
  tipo: 'pending',
  actor: 'company',
  descripcion: 'ZZ algo',
  fuentes: ['m1'],
  confianza: 0.9,
  venceEn: null,
  estado: 'open',
  generadoEn: '2026-09-16T12:00:00Z',
  resueltoEn: null,
  ...p,
})

const conv = (p: Partial<ConversacionInforme> = {}): ConversacionInforme => ({
  id: 'c1',
  contacto: 'ZZ Ana',
  clienteId: null,
  cliente: null,
  asignadoId: null,
  asignado: null,
  nueva: false,
  ultimoMensajeEn: null,
  motivos: [],
  resumen: null,
  estadoIA: null,
  ...p,
})

describe('seccionesIA', () => {
  it('separa los compromisos por quién se comprometió', () => {
    const s = seccionesIA([
      item({ id: 'a', tipo: 'commitment', actor: 'company' }),
      item({ id: 'b', tipo: 'commitment', actor: 'contact' }),
      item({ id: 'c', tipo: 'commitment', actor: 'unknown' }),
    ])
    expect(s.find((x) => x.clave === 'compromisos-empresa')?.items.map((i) => i.id)).toEqual(['a'])
    expect(s.find((x) => x.clave === 'compromisos-contacto')?.items.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('sólo muestra lo abierto, y lo que vence primero va arriba', () => {
    const s = seccionesIA([
      item({ id: 'sin-fecha' }),
      item({ id: 'resuelto', estado: 'resolved', resueltoEn: 'x' }),
      item({ id: 'tarde', venceEn: '2026-09-30' }),
      item({ id: 'pronto', venceEn: '2026-09-17' }),
    ])
    expect(s[0]?.items.map((i) => i.id)).toEqual(['pronto', 'tarde', 'sin-fecha'])
  })
})

describe('períodos en hora argentina', () => {
  it('un día va de 00:00 a 00:00 de Buenos Aires (03:00 UTC)', () => {
    const p = periodoDiario('2026-09-16')
    expect(p.desde).toBe('2026-09-16T03:00:00.000Z')
    expect(p.hasta).toBe('2026-09-17T03:00:00.000Z')
    expect(p.etiqueta).toMatch(/miércoles/)
  })

  it('la semana es de lunes a lunes y contiene el día pedido', () => {
    const p = periodoSemanal('2026-09-16')
    expect(p.desde).toBe('2026-09-14T03:00:00.000Z')
    expect(p.hasta).toBe('2026-09-21T03:00:00.000Z')
    expect(p.etiqueta).toBe('Semana del 14/09 al 20/09')
    // Un domingo pertenece a la semana que empezó el lunes anterior.
    expect(periodoSemanal('2026-09-20').desde).toBe('2026-09-14T03:00:00.000Z')
  })
})

describe('agruparConversaciones', () => {
  const cs = [
    conv({ id: '1', clienteId: 'k2', cliente: 'Zeta SA', asignadoId: 'u1', asignado: 'Juan' }),
    conv({ id: '2' }),
    conv({ id: '3', clienteId: 'k1', cliente: 'Acme SA', asignadoId: 'u1', asignado: 'Juan' }),
  ]

  it('por cliente: alfabético y «sin cliente» al final', () => {
    expect(agruparConversaciones(cs, 'cliente').map((g) => g.titulo)).toEqual(['Acme SA', 'Zeta SA', 'Sin cliente vinculado'])
  })

  it('por asignado: agrupa y deja «sin asignar» al final', () => {
    const g = agruparConversaciones(cs, 'asignado')
    expect(g.map((x) => `${x.titulo}:${x.conversaciones.length}`)).toEqual(['Juan:2', 'Sin asignar:1'])
  })

  it('por contacto: una por conversación', () => {
    expect(agruparConversaciones(cs, 'contacto')).toHaveLength(3)
  })
})

describe('compromisosVencidos', () => {
  it('sólo los abiertos con fecha escrita y pasada; sin fecha no hay vencimiento', () => {
    const v = compromisosVencidos(
      [
        item({ id: 'vencido', tipo: 'commitment', venceEn: '2026-09-10' }),
        item({ id: 'hoy', tipo: 'commitment', venceEn: '2026-09-16' }),
        item({ id: 'sin-fecha', tipo: 'commitment' }),
        item({ id: 'resuelto', tipo: 'commitment', venceEn: '2026-09-01', estado: 'resolved', resueltoEn: 'x' }),
        item({ id: 'pendiente', tipo: 'pending', venceEn: '2026-09-01' }),
      ],
      '2026-09-16',
    )
    expect(v.map((i) => i.id)).toEqual(['vencido'])
  })
})

describe('textos', () => {
  it('los motivos se dicen en palabras, en un orden fijo', () => {
    expect(presentarMotivos(['ia', 'sin_respuesta', 'error_envio', 'otro'])).toEqual([
      'Falló un envío',
      'Último mensaje del contacto',
      'Marcada por el análisis',
    ])
  })

  it('la confianza va en tres niveles, no como un número falsamente preciso', () => {
    expect(nivelDeConfianza(0.9).etiqueta).toBe('Confianza alta')
    expect(nivelDeConfianza(0.7).etiqueta).toBe('Confianza media')
    expect(nivelDeConfianza(0.5).etiqueta).toBe('Confianza baja')
  })

  it('los errores del análisis se traducen sin jerga del proveedor', () => {
    expect(textoDeErrorIA('proveedor_sin_configurar')).toMatch(/no está configurado/)
    expect(textoDeErrorIA('salida_json_invalido')).toMatch(/no era válida/)
    expect(textoDeErrorIA('proveedor_caido')).toMatch(/no respondió/)
  })
})
