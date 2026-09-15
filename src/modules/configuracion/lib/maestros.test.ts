import { describe, expect, it } from 'vitest'
import {
  AUTORIDAD,
  buscarDuplicado,
  etiquetaTipoAtributo,
  filtrarAtributos,
  filtrarCategorias,
  filtrarMarcas,
  formatearPrecio,
  mensajeErrorMaestro,
  normalizarNombre,
  normalizarVigencia,
  presentarVigencia,
  puedeEliminarCategoria,
  puedeEliminarMarca,
  textoDesactivar,
  textoVigenciaLista,
  validarNombre,
  type Atributo,
  type Categoria,
  type Marca,
} from './maestros'

const marca = (p: Partial<Marca>): Marca => ({ id: 'm1', nombre: 'APEX', activa: true, productos: 0, equipos: 0, ...p })
const categoria = (p: Partial<Categoria>): Categoria => ({ id: 'c1', nombre: 'Puntas y tubos', slug: 'punta', enRevision: false, productos: 0, atributos: 0, subcategorias: 0, ...p })

describe('nombres', () => {
  it('normaliza como la base: trim y espacios colapsados, sin tocar mayúsculas ni acentos', () => {
    expect(normalizarNombre('   Llaves   de  Impacto ')).toBe('Llaves de Impacto')
    expect(normalizarNombre('Ñandú\t\nÁcido')).toBe('Ñandú Ácido')
  })
  it('valida vacío y largo', () => {
    expect(validarNombre('   ')).toMatch(/Escribí/)
    expect(validarNombre('x'.repeat(81))).toMatch(/80/)
    expect(validarNombre(` ${'x'.repeat(80)} `)).toBeNull()
  })
  it('detecta duplicados sin distinguir mayúsculas ni espacios y excluye el propio', () => {
    const lista = [marca({ id: 'a', nombre: 'Chicago Pneumatic' }), marca({ id: 'b', nombre: 'FEIN' })]
    expect(buscarDuplicado(lista, '  chicago   PNEUMATIC ')?.id).toBe('a')
    expect(buscarDuplicado(lista, 'fein', 'b')).toBeNull()
    expect(buscarDuplicado(lista, '')).toBeNull()
    expect(buscarDuplicado([], 'APEX')).toBeNull()
  })
})

describe('filtros', () => {
  const marcas = [marca({ id: '1', nombre: 'APEX' }), marca({ id: '2', nombre: 'Apex Bits', activa: false }), marca({ id: '3', nombre: 'FEIN' })]
  it('marcas por texto y estado', () => {
    expect(filtrarMarcas(marcas, 'apex', 'todas').map((m) => m.id)).toEqual(['1', '2'])
    expect(filtrarMarcas(marcas, '', 'inactivas').map((m) => m.id)).toEqual(['2'])
    expect(filtrarMarcas(marcas, 'fein', 'inactivas')).toEqual([])
  })
  it('categorías por nombre o slug', () => {
    const cats = [categoria({ id: '1' }), categoria({ id: '2', nombre: 'Otros', slug: 'otros' })]
    expect(filtrarCategorias(cats, 'punta').map((c) => c.id)).toEqual(['1'])
    expect(filtrarCategorias(cats, 'OTR').map((c) => c.id)).toEqual(['2'])
  })
  it('atributos por etiqueta, clave o categoría', () => {
    const a: Atributo[] = [{ clave: 'torq_max', etiqueta: 'Torque máximo', tipo: 'number', unidad: 'Nm', filtrable: true, categorias: ['Atornilladores'], productos: 173 }]
    expect(filtrarAtributos(a, 'torq_')).toHaveLength(1)
    expect(filtrarAtributos(a, 'atornill')).toHaveLength(1)
    expect(filtrarAtributos(a, 'voltaje')).toHaveLength(0)
  })
})

describe('borrado y desactivación', () => {
  it('una marca con productos o equipos no se elimina, con motivo', () => {
    expect(puedeEliminarMarca(marca({ productos: 4928 }))).toEqual({ ok: false, motivo: 'Tiene 4.928 productos: se desactiva, no se elimina.' })
    expect(puedeEliminarMarca(marca({ equipos: 1 })).motivo).toMatch(/1 equipo de mantenimiento/)
    expect(puedeEliminarMarca(marca({}))).toEqual({ ok: true, motivo: null })
  })
  it('una categoría con productos, atributos o subcategorías no se elimina', () => {
    expect(puedeEliminarCategoria(categoria({ productos: 1 })).motivo).toBe('Tiene 1 producto.')
    expect(puedeEliminarCategoria(categoria({ atributos: 13 })).motivo).toMatch(/13 atributos vinculados/)
    expect(puedeEliminarCategoria(categoria({ subcategorias: 2 })).motivo).toMatch(/2 subcategorías/)
    expect(puedeEliminarCategoria(categoria({})).ok).toBe(true)
  })
  it('desactivar explica el impacto sin prometer lo que no hace', () => {
    expect(textoDesactivar({ nombre: 'SPEEDRILL', productos: 4928 })).toMatch(/4\.928 productos la siguen teniendo como marca, y los documentos no cambian/)
    expect(textoDesactivar({ nombre: 'Nueva', productos: 0 })).not.toMatch(/productos/)
  })
})

describe('errores de la base', () => {
  it('traduce códigos, incluidos en_uso con conteos', () => {
    expect(mensajeErrorMaestro('nombre_duplicado')).toMatch(/Ya existe/)
    expect(mensajeErrorMaestro('en_uso:1:0')).toBe('No se puede eliminar: la usan 1 producto y 0 equipos. Desactivala.')
    expect(mensajeErrorMaestro('en_uso:2:1:0')).toBe('No se puede eliminar: tiene 2 productos, 1 atributo vinculado y 0 subcategorías.')
    expect(mensajeErrorMaestro('datos_invalidos:name')).toMatch(/1 a 80/)
    expect(mensajeErrorMaestro('campos_no_permitidos:slug')).toMatch(/no se acepta/)
    expect(mensajeErrorMaestro('conflicto_version')).toMatch(/Otra persona/)
    expect(mensajeErrorMaestro('algo_raro')).toBe('No se pudo completar la acción.')
  })
})

describe('listas de precios', () => {
  it('vigencia con texto, no sólo color', () => {
    expect(presentarVigencia('vigente')).toEqual({ etiqueta: 'Vigente', tono: 'ok' })
    expect(presentarVigencia('futura').etiqueta).toBe('Futura')
    expect(presentarVigencia('vencida').etiqueta).toBe('Vencida')
    expect(normalizarVigencia('otra')).toBe('vigente')
  })
  it('precio con su moneda, sin convertir; 0 es un precio válido; conserva 4 decimales', () => {
    expect(formatearPrecio(617765.91, 'USD')).toBe('USD 617.765,91')
    expect(formatearPrecio(0, 'ARS')).toBe('ARS 0,00')
    expect(formatearPrecio(0.06, 'USD')).toBe('USD 0,06')
    expect(formatearPrecio(1.2345, 'EUR')).toBe('EUR 1,2345')
  })
  it('vigencia de la lista', () => {
    expect(textoVigenciaLista({ items: 12254, vigenciaDesde: '2026-01-01', vigenciaHasta: null })).toBe('desde 01/01/2026, sin fin')
    expect(textoVigenciaLista({ items: 3, vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' })).toBe('desde 01/01/2026 hasta 31/12/2026')
    expect(textoVigenciaLista({ items: 0, vigenciaDesde: null, vigenciaHasta: null })).toBe('Sin precios')
  })
  it('tipo de atributo con unidad', () => {
    expect(etiquetaTipoAtributo('number', 'Nm')).toBe('Número (Nm)')
    expect(etiquetaTipoAtributo('boolean', null)).toBe('Sí / No')
  })
  it('la explicación de sólo lectura menciona la decisión pendiente', () => {
    expect(AUTORIDAD.listas.detalle).toMatch(/No está decidido quién es el maestro de precios/)
    expect(AUTORIDAD.marcasNombre).toMatch(/no se edita/)
  })
})
