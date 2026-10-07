import { describe, expect, it } from 'vitest'
import {
  firmaPorDefecto,
  marcadoresUsados,
  puedeEditar,
  revisar,
  sePuedeGuardar,
  visiblesPara,
  type Plantilla,
} from './plantillas'

/**
 * Lo que decide de las plantillas de correo, sin pantalla.
 *
 * Lo que vale probar acá no es que una expresión regular encuentre llaves: es
 * que no se pueda guardar una plantilla que después manda un mail roto. Un
 * envoltorio sin `{{cuerpo}}` no muestra un error: **se traga el mensaje** y el
 * cliente recibe un mail vacío con membrete.
 */

const plantilla = (extra: Partial<Plantilla> = {}): Plantilla => ({
  id: 'p1',
  usuarioId: null,
  clase: 'firma',
  nombre: 'Una',
  contenido: 'hola',
  esDefault: false,
  activa: true,
  ...extra,
})

describe('Los marcadores que usa un texto', () => {
  it('los encuentra, sin repetir, y tolera espacios adentro', () => {
    expect(marcadoresUsados('{{usuario.nombre}} y {{ usuario.nombre }} y {{empresa.web}}')).toEqual([
      'usuario.nombre',
      'empresa.web',
    ])
  })

  it('un texto sin marcadores no tiene ninguno', () => {
    expect(marcadoresUsados('Saludos cordiales')).toEqual([])
  })
})

describe('Revisar antes de guardar', () => {
  it('un envoltorio SIN {{cuerpo}} no se puede guardar', () => {
    const p = revisar('envoltorio', 'Institucional', '<div>{{empresa.nombre}}</div>')
    expect(p.some((x) => x.gravedad === 'error' && x.texto.includes('{{cuerpo}}'))).toBe(true)
    expect(sePuedeGuardar(p)).toBe(false)
  })

  it('un envoltorio sin {{firma}} se guarda igual, pero avisa', () => {
    const p = revisar('envoltorio', 'Institucional', '<div>{{cuerpo}}</div>')
    expect(p).toEqual([
      { gravedad: 'aviso', texto: 'No usás {{firma}}: los mails van a salir sin la firma de quien los manda.' },
    ])
    expect(sePuedeGuardar(p)).toBe(true)
  })

  it('un marcador mal escrito se señala por su nombre', () => {
    const p = revisar('firma', 'La mía', '{{usuario.nombre}} · {{usuario.telefno}}')
    expect(p).toEqual([{ gravedad: 'error', texto: '{{usuario.telefno}} no existe: revisá cómo se escribe.' }])
  })

  /**
   * Un hueco en una firma no lo rellena nadie: el que rellena es el envoltorio.
   * Dejarlo pasar significa un mail con `{{cuerpo}}` escrito, o un agujero.
   */
  it('un hueco dentro de una firma es un error, no un adorno', () => {
    const p = revisar('firma', 'La mía', '{{usuario.nombre}}\n{{cuerpo}}')
    expect(p).toEqual([{ gravedad: 'error', texto: '{{cuerpo}} sólo funciona en el envoltorio, no en una firma.' }])
  })

  it('sin nombre y sin contenido, dos errores', () => {
    expect(revisar('firma', '   ', '  ')).toEqual([
      { gravedad: 'error', texto: 'Poné un nombre para reconocerla.' },
      { gravedad: 'error', texto: 'La plantilla está vacía.' },
    ])
  })

  it('una firma correcta no tiene nada que decir', () => {
    expect(revisar('firma', 'La mía', '{{usuario.nombre}}\n{{empresa.telefono}}')).toEqual([])
  })
})

describe('Quién puede tocar cuál', () => {
  const deLaEmpresa = plantilla({ usuarioId: null })
  const mia = plantilla({ id: 'p2', usuarioId: 'u1' })
  const ajena = plantilla({ id: 'p3', usuarioId: 'u2' })

  it('el admin toca todo, incluso la de otro', () => {
    expect([deLaEmpresa, mia, ajena].map((p) => puedeEditar(p, 'admin', 'u1'))).toEqual([true, true, true])
  })

  it('un empleado toca la suya y nada más', () => {
    expect([deLaEmpresa, mia, ajena].map((p) => puedeEditar(p, 'employee', 'u1'))).toEqual([false, true, false])
  })

  it('y ve la de la empresa aunque no la pueda editar: su mail la usa', () => {
    expect(visiblesPara([deLaEmpresa, mia, ajena], 'u1').map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('Cuál firma se usa si nadie elige', () => {
  const dela = plantilla({ id: 'emp', usuarioId: null, clase: 'firma', esDefault: true })
  const propia = plantilla({ id: 'mia', usuarioId: 'u1', clase: 'firma', esDefault: true })

  it('la propia gana', () => {
    expect(firmaPorDefecto([dela, propia], 'u1')?.id).toBe('mia')
  })

  it('sin propia, la de la empresa', () => {
    expect(firmaPorDefecto([dela, propia], 'u9')?.id).toBe('emp')
  })

  it('una desactivada no se usa aunque esté marcada por defecto', () => {
    expect(firmaPorDefecto([{ ...propia, activa: false }], 'u1')).toBeNull()
  })

  it('sin ninguna, null: el envío sale sin firma, no con una ajena', () => {
    expect(firmaPorDefecto([], 'u1')).toBeNull()
  })
})
