import { describe, expect, it } from 'vitest'
import {
  alternar,
  capacidadesDeRol,
  esRolConfigurable,
  hayCambios,
  mensajeErrorPermisos,
  resumenDeRol,
  ROLES_CONFIGURABLES,
  type Capacidad,
  type Concesion,
} from './capacidades'

/** El catálogo real de la Fase 58, en su orden. */
const CATALOGO: Capacidad[] = [
  { clave: 'comercial_ver', etiqueta: 'Ver lo comercial', descripcion: '', posicion: 1 },
  { clave: 'comercial_escribir', etiqueta: 'Cargar y editar documentos', descripcion: '', posicion: 2 },
  { clave: 'emails', etiqueta: 'Correo', descripcion: '', posicion: 3 },
  { clave: 'whatsapp', etiqueta: 'WhatsApp', descripcion: '', posicion: 4 },
  { clave: 'mantenimiento', etiqueta: 'Mantenimiento', descripcion: '', posicion: 5 },
]

/** Las concesiones que sembró la migración: las de antes, tal cual. */
const CONCESIONES: Concesion[] = [
  { rol: 'employee', capacidad: 'comercial_ver' },
  { rol: 'employee', capacidad: 'comercial_escribir' },
  { rol: 'employee', capacidad: 'emails' },
  { rol: 'employee', capacidad: 'whatsapp' },
  { rol: 'employee', capacidad: 'mantenimiento' },
  { rol: 'salesperson', capacidad: 'comercial_ver' },
  { rol: 'salesperson', capacidad: 'whatsapp' },
  { rol: 'technician', capacidad: 'comercial_ver' },
]

describe('qué permisos tiene cada rol', () => {
  it('los de la tabla, para los roles que se configuran', () => {
    expect(capacidadesDeRol('salesperson', CATALOGO, CONCESIONES).sort()).toEqual([
      'comercial_ver',
      'whatsapp',
    ])
    expect(capacidadesDeRol('technician', CATALOGO, CONCESIONES)).toEqual(['comercial_ver'])
  })

  /*
   * EL CASO QUE IMPORTA. El admin tiene TODO sin figurar en la tabla, igual que
   * resuelve `app.rol_tiene` antes de consultarla. Si acá se leyera la tabla, la
   * pantalla mostraría al administrador sin permisos y daría un susto que no es.
   */
  it('el admin tiene todo el catálogo aunque no tenga ni una fila', () => {
    expect(capacidadesDeRol('admin', CATALOGO, [])).toEqual(CATALOGO.map((c) => c.clave))
  })

  it('un rol sin concesiones no tiene nada, y eso es un estado válido', () => {
    expect(capacidadesDeRol('technician', CATALOGO, [])).toEqual([])
  })

  it('un rol externo no tiene nada', () => {
    expect(capacidadesDeRol('customer', CATALOGO, CONCESIONES)).toEqual([])
  })

  it('sólo se configuran empleado, vendedor y técnico', () => {
    expect([...ROLES_CONFIGURABLES]).toEqual(['employee', 'salesperson', 'technician'])
    expect(esRolConfigurable('admin')).toBe(false)
    expect(esRolConfigurable('customer')).toBe(false)
    expect(esRolConfigurable('employee')).toBe(true)
  })
})

describe('prender y apagar casillas', () => {
  it('prende y apaga', () => {
    expect(alternar(['comercial_ver'], CATALOGO, 'emails', true)).toEqual(['comercial_ver', 'emails'])
    expect(alternar(['comercial_ver', 'emails'], CATALOGO, 'emails', false)).toEqual(['comercial_ver'])
  })

  /* El orden del catálogo y no el orden en que se tocaron: así comparar con el
     original no depende del camino que recorrió el usuario. */
  it('devuelve en el orden del catálogo, no en el de los clics', () => {
    const r = alternar(['mantenimiento'], CATALOGO, 'comercial_ver', true)
    expect(r).toEqual(['comercial_ver', 'mantenimiento'])
  })

  it('prender algo que ya estaba no lo duplica', () => {
    expect(alternar(['emails'], CATALOGO, 'emails', true)).toEqual(['emails'])
  })

  it('apagar algo que no estaba no rompe', () => {
    expect(alternar(['emails'], CATALOGO, 'whatsapp', false)).toEqual(['emails'])
  })

  /*
   * Una clave que ya no está en el catálogo se cae. Sin esto se reenviaría al
   * guardar y la base la rechazaría con `permiso_desconocido`: el usuario vería
   * un error por un permiso que ni tocó.
   */
  it('descarta claves que ya no existen en el catálogo', () => {
    expect(alternar(['emails', 'permiso_viejo'], CATALOGO, 'whatsapp', true)).toEqual([
      'emails',
      'whatsapp',
    ])
  })
})

describe('si hay algo para guardar', () => {
  it('no hay cambios si es el mismo conjunto en otro orden', () => {
    expect(hayCambios(['emails', 'whatsapp'], ['whatsapp', 'emails'])).toBe(false)
  })

  it('hay cambios al agregar, al quitar y al cambiar uno por otro', () => {
    expect(hayCambios(['emails'], ['emails', 'whatsapp'])).toBe(true)
    expect(hayCambios(['emails', 'whatsapp'], ['emails'])).toBe(true)
    expect(hayCambios(['emails'], ['whatsapp'])).toBe(true)
  })

  it('dos listas vacías no son un cambio', () => {
    expect(hayCambios([], [])).toBe(false)
  })
})

describe('el resumen de una línea', () => {
  it('enumera los permisos en el orden del catálogo', () => {
    expect(resumenDeRol(['whatsapp', 'comercial_ver'], CATALOGO)).toBe('Ver lo comercial · WhatsApp')
  })

  // «Sin permisos» y no una cadena vacía: un rol sin nada entra al sistema y no
  // ve nada, y eso tiene que poder leerse.
  it('sin nada dice «Sin permisos»', () => {
    expect(resumenDeRol([], CATALOGO)).toBe('Sin permisos')
  })

  it('con todo no enumera los cinco', () => {
    expect(resumenDeRol(CATALOGO.map((c) => c.clave), CATALOGO)).toBe('Todos los permisos')
  })

  it('ignora una clave que no está en el catálogo', () => {
    expect(resumenDeRol(['emails', 'fantasma'], CATALOGO)).toBe('Correo')
  })
})

describe('los errores de la base', () => {
  it('cada código tiene su texto, y el desconocido no queda vacío', () => {
    for (const c of ['sin_permiso', 'rol_no_configurable', 'permiso_desconocido', 'sin_red']) {
      expect(mensajeErrorPermisos(c).length).toBeGreaterThan(10)
    }
    expect(mensajeErrorPermisos('algo_nuevo').length).toBeGreaterThan(10)
  })

  it('el de rol no configurable explica lo del admin', () => {
    expect(mensajeErrorPermisos('rol_no_configurable')).toContain('administrador')
  })
})
