import { describe, expect, it } from 'vitest'
import {
  atributosDeLaCategoria,
  atributosParaGuardar,
  filaDesdeFormulario,
  FORMULARIO_VACIO,
  gramosDesdeKg,
  hayErrores,
  marcaQueYaUsaElPrefijo,
  prefijoDeMarca,
  puedeCrearProductos,
  referenciaDerivada,
  skuSugerido,
  validarNuevoProducto,
  type FormularioNuevoProducto,
} from './nuevoProducto'
import type { DefinicionAtributo } from '../types'

const F = (over: Partial<FormularioNuevoProducto> = {}): FormularioNuevoProducto => ({
  ...FORMULARIO_VACIO,
  sku: 'SP.9999',
  marcaId: 'marca-1',
  modelo: '9999',
  nombre: 'Adaptador de prueba',
  categoriaId: 'cat-punta',
  ...over,
})

/**
 * Alta de producto (Fase 26 · E3).
 *
 * Cada bloque referencia la línea de `app.js` de donde sale la regla: no son
 * tests de «que ande», son de «que haga lo mismo que el legacy» — salvo donde
 * el esquema manda otra cosa, que es lo que fijan los tests de la categoría y
 * del peso.
 */
describe('La referencia sugerida (app.js:13653)', () => {
  it('dos letras de la marca, punto y el modelo en mayúsculas', () => {
    expect(skuSugerido('SPEEDRILL', '2520/8b')).toBe('SP.2520/8B')
  })

  it('las dos primeras LETRAS: los números y símbolos de la marca no cuentan', () => {
    expect(skuSugerido('3M Argentina', 'x1')).toBe('MA.X1')
  })

  it('sin modelo, la hora en base 36 — cuatro caracteres', () => {
    const s = skuSugerido('TECNA', '', 0x5f5e100)
    expect(s.startsWith('TE-')).toBe(true)
    expect(s).toHaveLength(7)
  })

  /**
   * Ojo con la hora: este test FALLABA cada tanto.
   *
   * La segunda comparación llamaba dos veces a `skuSugerido('', 'ABC')` sin
   * pasarle `ahora`, así que las dos usaban `Date.now()`. El sufijo sale de
   * los últimos caracteres del milisegundo en base 36 y cambia en cada
   * milisegundo: si las dos llamadas caían a los costados de uno, daban
   * distinto y el test se caía sin motivo aparente.
   *
   * Con la hora fija el resultado es el mismo siempre, y lo que se comprueba
   * queda dicho de frente: prefijo `PRO-` y cinco caracteres de sufijo.
   */
  it('sin marca, el prefijo es PRO', () => {
    expect(skuSugerido(null, '', 0x5f5e100).startsWith('PRO-')).toBe(true)
    const s = skuSugerido('', 'ABC', 0x5f5e100)
    expect(s.startsWith('PRO-')).toBe(true)
    expect(s).toHaveLength(9)
  })
})

describe('Qué se exige antes de guardar', () => {
  it('el legacy exige SKU y nombre, y acá también', () => {
    expect(validarNuevoProducto(F({ sku: '   ' })).sku).toMatch(/referencia/)
    expect(validarNuevoProducto(F({ nombre: '' })).nombre).toMatch(/nombre/)
  })

  /**
   * La diferencia con el legacy que no elegimos: `products.category_id` es NOT
   * NULL. Pedirla en el formulario es mejor que recibir el error de la base.
   */
  it('la categoría es obligatoria, porque la columna es NOT NULL', () => {
    expect(validarNuevoProducto(F({ categoriaId: '' })).categoriaId).toMatch(/categoría/)
  })

  /**
   * La marca pasó a ser OBLIGATORIA para lo que se crea de ahora en más.
   *
   * Antes no lo era, y el motivo era descriptivo: el 25 % del catálogo
   * (5.509 de 21.828 productos) entró sin marca en la importación del sistema
   * anterior. Pero eso describe lo que HAY, no lo que se quiere agregar: sin
   * marca no hay prefijo, y sin prefijo cada quien inventa su propio código.
   * Los 5.509 de antes siguen como están; esto sólo gobierna el alta.
   */
  it('la marca es obligatoria: la referencia sale de ella', () => {
    expect(validarNuevoProducto(F({ marcaId: '' })).marcaId).toMatch(/marca/)
  })

  it('el modelo es obligatorio, por lo mismo', () => {
    expect(validarNuevoProducto(F({ modelo: '   ' })).modelo).toMatch(/modelo/)
  })

  it('una imagen que no es una dirección web se rechaza antes de guardarla', () => {
    expect(validarNuevoProducto(F({ imagenUrl: 'foto.jpg' })).imagenUrl).toMatch(/http/)
    expect(hayErrores(validarNuevoProducto(F({ imagenUrl: 'https://x.com/a.jpg' })))).toBe(false)
    expect(hayErrores(validarNuevoProducto(F({ imagenUrl: '' })))).toBe(false)
  })

  it('el peso y el volumen son enteros: las columnas son integer', () => {
    expect(validarNuevoProducto(F({ pesoG: '1,5' })).pesoG).toMatch(/entero/)
    expect(validarNuevoProducto(F({ volumenCm3: '2.3' })).volumenCm3).toMatch(/entero/)
    expect(hayErrores(validarNuevoProducto(F({ pesoG: '1500', volumenCm3: '300' })))).toBe(false)
  })

  it('un formulario completo no tiene errores', () => {
    expect(validarNuevoProducto(F())).toEqual({})
  })
})

describe('Los atributos del jsonb (app.js:14491)', () => {
  it('lo que parece número entra como número', () => {
    expect(atributosParaGuardar({ largo: '200', medida: '8' }, '')).toEqual({ largo: 200, medida: 8 })
  })

  it('lo que no es número entra como texto', () => {
    expect(atributosParaGuardar({ encastre: '1/4 HEX' }, '')).toEqual({ encastre: '1/4 HEX' })
  })

  it('la coma decimal se entiende', () => {
    expect(atributosParaGuardar({ largo: '1,5' }, '')).toEqual({ largo: 1.5 })
  })

  it('lo vacío NO entra: una clave vacía cuenta como valor en el filtro', () => {
    expect(atributosParaGuardar({ largo: '', medida: '   ' }, '')).toEqual({})
  })

  it('el código de barras va adentro de los atributos, como en el legacy', () => {
    expect(atributosParaGuardar({}, ' 7791234567890 ')).toEqual({ barcode: '7791234567890' })
    expect(atributosParaGuardar({}, '')).toEqual({})
  })
})

describe('El formulario convertido en fila', () => {
  /**
   * El fixture trae marca y modelo porque son obligatorios para el alta; acá
   * se vacían a propósito, que es lo que este test mira: un campo sin escribir
   * tiene que llegar a la base como NULL y no como cadena vacía. La diferencia
   * importa: `''` cuenta como valor en los filtros del catálogo y en los
   * índices únicos, y NULL no.
   */
  it('lo vacío es NULL, no cadena vacía', () => {
    const fila = filaDesdeFormulario(F({ modelo: '', marcaId: '' }))
    expect(fila.model_code).toBeNull()
    expect(fila.description).toBeNull()
    expect(fila.brand_id).toBeNull()
    expect(fila.weight_g).toBeNull()
    expect(fila.ncm_code).toBeNull()
  })

  it('los espacios de más se colapsan, como hace la base con los maestros', () => {
    expect(filaDesdeFormulario(F({ nombre: '  Llave   de   impacto ' })).name).toBe('Llave de impacto')
    expect(filaDesdeFormulario(F({ sku: '  SP.1  ' })).sku).toBe('SP.1')
  })

  /** La descripción larga NO se colapsa: los saltos de línea son del texto. */
  it('la descripción larga conserva su formato', () => {
    const fila = filaDesdeFormulario(F({ descripcionLarga: 'Línea uno\n\nLínea dos' }))
    expect(fila.description_long).toBe('Línea uno\n\nLínea dos')
  })

  it('el estado y el kit viajan tal cual', () => {
    const fila = filaDesdeFormulario(F({ estado: 'draft', esKit: true }))
    expect(fila.status).toBe('draft')
    expect(fila.is_kit).toBe(true)
  })

  it('no manda company_id ni needs_review: los pone el servicio y la base', () => {
    const fila = filaDesdeFormulario(F())
    expect('company_id' in fila).toBe(false)
    expect('needs_review' in fila).toBe(false)
  })
})

describe('Kilos a gramos', () => {
  it('el legacy pide kilos y la columna guarda gramos', () => {
    expect(gramosDesdeKg('1,5')).toBe('1500')
    expect(gramosDesdeKg('0.25')).toBe('250')
  })

  it('una basura no se convierte en cero', () => {
    expect(gramosDesdeKg('abc')).toBe('')
    expect(gramosDesdeKg('')).toBe('')
    expect(gramosDesdeKg('-3')).toBe('')
  })
})

describe('Los atributos que se ofrecen al cargar', () => {
  const def = (key: string, filtrable: boolean, posicion: number): DefinicionAtributo => ({
    key,
    enFicha: true,
    label: key,
    unidad: null,
    tipo: 'text',
    filtrable,
    posicion,
    enumerada: false,
    opciones: [],
  })
  const definiciones = [def('largo', true, 2), def('encastre', true, 1), def('nota', false, 3)]
  const porCategoria = new Map([['cat-punta', new Set(['largo', 'encastre', 'nota'])]])

  /**
   * A diferencia del FILTRO del catálogo, al cargar se ofrecen también los que
   * no son filtrables: si la categoría tiene el dato definido, se tiene que
   * poder escribir.
   */
  it('se ofrecen todos los de la categoría, filtrables o no, en su orden', () => {
    expect(atributosDeLaCategoria(definiciones, 'cat-punta', porCategoria).map((d) => d.key)).toEqual([
      'encastre',
      'largo',
      'nota',
    ])
  })

  it('sin categoría elegida no se ofrece ninguno: no hay con qué decidir', () => {
    expect(atributosDeLaCategoria(definiciones, '', porCategoria)).toEqual([])
  })

  it('una categoría sin atributos cargados no ofrece nada', () => {
    expect(atributosDeLaCategoria(definiciones, 'cat-otros', porCategoria)).toEqual([])
  })
})

describe('Quién puede crear', () => {
  it('admin y employee; el resto no, y RLS lo vuelve a decidir', () => {
    expect(puedeCrearProductos('admin')).toBe(true)
    expect(puedeCrearProductos('employee')).toBe(true)
    expect(puedeCrearProductos('customer')).toBe(false)
    expect(puedeCrearProductos(undefined)).toBe(false)
  })
})

/*
 * El prefijo NO son siempre las dos primeras letras (Fase 45).
 *
 * Sobre los 21.816 productos del catálogo, 3.824 usan un prefijo propio de su
 * marca, y en el 100 % de los productos de esa marca. Hay dos motivos:
 * COLISIÓN —TORERO ya ocupa «TO», así que TOHNICHI es «TC»; BROPPE ya ocupa
 * «BR», así que BREMEN es «BM»— y LA ABREVIATURA DE LA PROPIA MARCA: «CP» es
 * Chicago Pneumatic, cuyos productos se llaman CP9911.
 */
describe('El prefijo de la marca', () => {
  it('usa el guardado cuando la marca lo tiene', () => {
    expect(prefijoDeMarca('CHICAGO PNEUMATIC', 'CP')).toBe('CP')
    expect(prefijoDeMarca('TOHNICHI', 'TC')).toBe('TC')
  })

  /* Sin prefijo cargado se cae a las dos primeras letras, que es lo que hacía
     el código antes de la Fase 45 y sigue sirviendo para una marca nueva. */
  it('sin prefijo guardado, las dos primeras letras', () => {
    expect(prefijoDeMarca('Speedrill', null)).toBe('SP')
    expect(prefijoDeMarca('Speedrill', '')).toBe('SP')
  })

  /** La marca puede empezar con un número —«3M»—: cuentan las LETRAS. */
  it('ignora lo que no es letra', () => {
    expect(prefijoDeMarca('3M Argentina', null)).toBe('MA')
  })

  // Un valor guardado que no tiene forma de prefijo no se usa a medias.
  it('un guardado con basura cae al respaldo', () => {
    expect(prefijoDeMarca('Speedrill', 'sp.')).toBe('SP')
    expect(prefijoDeMarca('Speedrill', 'X')).toBe('SP')
  })
})

describe('La referencia que sale del prefijo y el modelo', () => {
  it('es el prefijo, un punto y el modelo en mayúsculas', () => {
    expect(referenciaDerivada('SP', 'vpph2/150')).toBe('SP.VPPH2/150')
  })

  /* El caso que motivó todo: con las dos primeras letras daba CH.9958 contra
     los 73 Chicago Pneumatic que ya son CP.*. */
  it('con el prefijo de la marca da la referencia que usa el catálogo', () => {
    expect(referenciaDerivada(prefijoDeMarca('CHICAGO PNEUMATIC', 'CP'), '9958')).toBe('CP.9958')
    expect(referenciaDerivada(prefijoDeMarca('CHICAGO PNEUMATIC', null), '9958')).toBe('CH.9958')
  })

  /**
   * Sin prefijo o sin modelo NO inventa nada. Un prefijo de relleno más la
   * hora da una referencia distinta en cada tecla: imposible de leer mientras
   * se escribe, e imposible de reproducir después.
   */
  it('devuelve vacío cuando no alcanza para armarla', () => {
    expect(referenciaDerivada('', 'vpph2')).toBe('')
    expect(referenciaDerivada('SP', '   ')).toBe('')
    expect(referenciaDerivada('X', 'vpph2')).toBe('')
  })

  it('es determinística: con los mismos datos da siempre lo mismo', () => {
    expect(referenciaDerivada('SP', 'a')).toBe(referenciaDerivada('SP', 'a'))
  })
})

/*
 * El aviso de colisión. Avisa, no prohíbe: que dos marcas compartan prefijo es
 * casi siempre un descuido, pero prohibirlo sería decidir por quien carga.
 */
describe('Dos marcas con el mismo prefijo', () => {
  const MARCAS = [
    { id: 'm1', nombre: 'BROPPE', prefijo: 'BR' },
    { id: 'm2', nombre: 'BREMEN', prefijo: 'BM' },
    { id: 'm3', nombre: 'SPEEDRILL', prefijo: 'SP' },
    // Sin prefijo cargado: cae a las dos primeras letras, «BR», que ya es de
    // BROPPE. Es exactamente el caso que el aviso tiene que cazar.
    { id: 'm4', nombre: 'BROWN & SHARPE', prefijo: null },
  ]

  it('dice qué marca ya usa ese prefijo', () => {
    expect(marcaQueYaUsaElPrefijo('BR', 'm4', MARCAS)).toBe('BROPPE')
  })

  it('no se acusa a sí misma', () => {
    expect(marcaQueYaUsaElPrefijo('SP', 'm3', MARCAS)).toBeNull()
  })

  /*
   * Se compara contra el prefijo EFECTIVO de cada marca, no contra el
   * guardado: una marca sin prefijo igual ocupa sus dos letras, y si no se la
   * contara el aviso no serviría justo cuando hace falta.
   */
  it('una marca sin prefijo guardado igual ocupa sus dos letras', () => {
    expect(marcaQueYaUsaElPrefijo('BR', 'm1', MARCAS)).toBe('BROWN & SHARPE')
  })

  it('sin conflicto devuelve null', () => {
    expect(marcaQueYaUsaElPrefijo('ZZ', 'm4', MARCAS)).toBeNull()
    expect(marcaQueYaUsaElPrefijo('', 'm4', MARCAS)).toBeNull()
  })
})
