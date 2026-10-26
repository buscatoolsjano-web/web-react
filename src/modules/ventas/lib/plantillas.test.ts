import { describe, expect, it } from 'vitest'
import { CONFIG_POR_DEFECTO, normalizarConfig, verDePlantilla } from './plantillas'

describe('normalizarConfig (Fase 152)', () => {
  it('un config vacío queda como el por defecto', () => {
    expect(normalizarConfig({})).toEqual(CONFIG_POR_DEFECTO)
    expect(normalizarConfig(null)).toEqual(CONFIG_POR_DEFECTO)
  })

  it('completa lo que falta y respeta lo que viene', () => {
    const c = normalizarConfig({ columnas: { precio: false }, bloques: { firmas: true }, titulo: 'REMITO INTERNO' })
    expect(c.columnas.precio).toBe(false)
    // Lo que no vino queda en el default.
    expect(c.columnas.foto).toBe(true)
    expect(c.bloques.firmas).toBe(true)
    expect(c.titulo).toBe('REMITO INTERNO')
  })

  it('un título o texto vacío es null, no cadena vacía', () => {
    expect(normalizarConfig({ titulo: '   ', encabezado: '' }).titulo).toBeNull()
    expect(normalizarConfig({ encabezado: '' }).encabezado).toBeNull()
  })

  it('el orden guardado se respeta y se completa con las columnas que falten', () => {
    const c = normalizarConfig({ orden: ['precio', 'foto'] })
    // Las dos que vinieron, primero; el resto detrás, sin perder ninguna.
    expect(c.orden.slice(0, 2)).toEqual(['precio', 'foto'])
    expect(new Set(c.orden)).toEqual(new Set(['foto', 'descripcion', 'precio', 'descuento', 'impuesto', 'subtotal']))
  })

  it('descarta un valor de orden inventado', () => {
    const c = normalizarConfig({ orden: ['precio', 'inventado'] })
    expect(c.orden).not.toContain('inventado')
  })
})

describe('verDePlantilla', () => {
  it('traduce columnas y bloques a lo que la hoja entiende', () => {
    const c = normalizarConfig({ columnas: { precio: false, impuesto: true }, bloques: { totales: false } })
    expect(verDePlantilla(c)).toMatchObject({
      precios: false,
      impuestos: true,
      totales: false,
      ticket: false,
      proForma: false,
      packing: 'no',
    })
  })
})
