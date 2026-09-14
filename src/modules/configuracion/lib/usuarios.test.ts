import { describe, expect, it } from 'vitest'
import { puedeVerConfiguracion } from './permisos'
import {
  adminsActivos,
  esAutoDegradacion,
  estadoVisible,
  filtrarUsuarios,
  mensajeError,
  puedeCambiarRol,
  puedeReenviar,
  puedeSuspender,
  rolesPermitidos,
  textoResultadoInvitacion,
  validarInvitacion,
} from './usuarios'
import type { UsuarioEmpresa } from '../types'

const u = (p: Partial<UsuarioEmpresa>): UsuarioEmpresa => ({
  membershipId: p.membershipId ?? crypto.randomUUID(),
  userId: 'u',
  nombre: 'Ana',
  email: 'ana@buscatools.test',
  rol: 'employee',
  estado: 'active',
  cliente: null,
  alta: '2026-09-14T00:00:00Z',
  invitadoEl: null,
  emailConfirmado: true,
  ultimoIngreso: null,
  bloqueada: false,
  esPropia: false,
  ...p,
})

describe('permisos de Configuración', () => {
  it('sólo admin', () => {
    expect(['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor', 'supplier', '', null].map(puedeVerConfiguracion)).toEqual([
      true, false, false, false, false, false, false, false, false,
    ])
  })
})

describe('estadoVisible', () => {
  it('suspendido gana sobre todo', () => {
    expect(estadoVisible(u({ estado: 'suspended', emailConfirmado: false, invitadoEl: '2026-09-01' }))).toBe('suspendido')
  })
  it('invitación pendiente sólo si Auth registró la invitación y no confirmó', () => {
    expect(estadoVisible(u({ emailConfirmado: false, invitadoEl: '2026-09-01' }))).toBe('invitacion_pendiente')
    expect(estadoVisible(u({ emailConfirmado: false, invitadoEl: null }))).toBe('sin_confirmar')
  })
  it('nunca haber iniciado sesión NO es invitación pendiente', () => {
    expect(estadoVisible(u({ emailConfirmado: true, ultimoIngreso: null }))).toBe('activo')
  })
  it('cuenta bloqueada', () => {
    expect(estadoVisible(u({ bloqueada: true }))).toBe('bloqueada')
  })
})

describe('último admin en la interfaz', () => {
  const unico = u({ rol: 'admin', esPropia: true })
  const lista1 = [unico, u({ rol: 'employee' }), u({ rol: 'admin', estado: 'suspended' })]
  it('el único admin activo no se degrada ni se suspende', () => {
    expect(adminsActivos(lista1)).toBe(1)
    expect(puedeCambiarRol(unico, lista1).ok).toBe(false)
    expect(rolesPermitidos(unico, lista1)).toEqual(['admin'])
    expect(puedeSuspender(unico, lista1).ok).toBe(false)
  })
  it('con otro admin activo, sí puede cambiar de rol (con aviso) pero nunca suspenderse', () => {
    const lista2 = [unico, u({ rol: 'admin' })]
    expect(puedeCambiarRol(unico, lista2).ok).toBe(true)
    expect(esAutoDegradacion(unico, 'employee')).toBe(true)
    expect(puedeSuspender(unico, lista2)).toEqual({ ok: false, motivo: 'No podés suspender tu propio acceso.' })
    expect(puedeSuspender(lista2[1]!, lista2).ok).toBe(true)
  })
  it('los roles externos no se cambian desde la UI', () => {
    const cliente = u({ rol: 'customer', cliente: 'ACME' })
    expect(rolesPermitidos(cliente, [cliente])).toEqual([])
    expect(puedeCambiarRol(cliente, [cliente]).ok).toBe(false)
  })
})

describe('reenviar', () => {
  it('sólo cuentas activas sin confirmar', () => {
    expect(puedeReenviar(u({ emailConfirmado: false, invitadoEl: 'x' })).ok).toBe(true)
    expect(puedeReenviar(u({ emailConfirmado: true })).ok).toBe(false)
    expect(puedeReenviar(u({ emailConfirmado: false, estado: 'suspended' })).ok).toBe(false)
    expect(puedeReenviar(u({ emailConfirmado: false, bloqueada: true })).ok).toBe(false)
  })
})

describe('validarInvitacion', () => {
  it('normaliza y valida', () => {
    expect(validarInvitacion({ email: '  Ana@BuscaTools.com ', nombre: '  Ana  ', rol: 'employee' })).toEqual({ ok: true, email: 'ana@buscatools.com', nombre: 'Ana', rol: 'employee' })
    expect(validarInvitacion({ email: 'ana@buscatools.com', nombre: '', rol: 'admin' })).toMatchObject({ ok: true, nombre: null })
  })
  it('rechaza email inválido, roles externos o inventados y nombres largos', () => {
    const r = validarInvitacion({ email: 'no-es', nombre: 'x'.repeat(121), rol: 'customer' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(['email', 'nombre', 'rol'])
    expect(validarInvitacion({ email: 'a@b.co', nombre: '', rol: 'owner' }).ok).toBe(false)
  })
})

describe('mensajes', () => {
  it('todo código conocido tiene texto propio y lo desconocido un genérico', () => {
    for (const c of ['sin_permiso', 'ultimo_admin', 'no_auto_suspension', 'ya_es_miembro', 'membresia_suspendida', 'demasiados_envios', 'correo_no_autorizado', 'email_rechazado']) {
      expect(mensajeError(c)).not.toBe(mensajeError('xyz'))
    }
  })
  it('resultado de invitación', () => {
    expect(textoResultadoInvitacion({ resultado: 'agregado_existente', emailEnviado: false, errorEnvio: null }, 'a@b.co').detalle).toMatch(/No se envió/)
    expect(textoResultadoInvitacion({ resultado: 'agregado_pendiente', emailEnviado: false, errorEnvio: 'demasiados_envios' }, 'a@b.co').tono).toBe('pending')
  })
})

describe('filtrarUsuarios', () => {
  it('por nombre, email o rol en castellano', () => {
    const lista = [u({ nombre: 'Juan', rol: 'admin', email: 'j@x.co' }), u({ nombre: 'Norberto', email: 'n@x.co' })]
    expect(filtrarUsuarios(lista, 'administ').map((x) => x.nombre)).toEqual(['Juan'])
    expect(filtrarUsuarios(lista, 'N@X').map((x) => x.nombre)).toEqual(['Norberto'])
    expect(filtrarUsuarios(lista, '  ')).toHaveLength(2)
  })
})
