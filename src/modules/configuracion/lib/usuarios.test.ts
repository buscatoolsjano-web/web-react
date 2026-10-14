import { describe, expect, it } from 'vitest'
import { puedeAdministrarUsuarios, puedeVerConfiguracion, seccionesVisibles } from './permisos'
import {
  adminsActivos,
  esAutoDegradacion,
  estadoVisible,
  filtrarUsuarios,
  mensajeError,
  puedeCambiarRol,
  puedeEliminar,
  puedeReenviar,
  puedeSuspender,
  rolesPermitidos,
  seguroQueBorraLaCuenta,
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
  it('entran admin y employee; el resto no', () => {
    expect(['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor', 'supplier', '', null].map(puedeVerConfiguracion)).toEqual([
      true, true, false, false, false, false, false, false, false,
    ])
  })
  /*
   * Fase 58 · E1: de once secciones a seis. Marcas, Categorías, Atributos,
   * Auditoría y Borrados salieron del menú —«tanta información hace que se
   * entienda menos el sistema»—. Las rutas siguen existiendo, así que un
   * enlace guardado no da 404; lo que cambia es qué se ofrece.
   */
  /*
   * Fase 68: entra «Formas de pago» y son siete. Marcas y Categorías siguen
   * afuera, y la diferencia es quién las mantiene: ésas llegan con la
   * sincronización del catálogo y casi nunca se tocan a mano, mientras que las
   * formas de pago las escribe la empresa de a una y salen impresas en una
   * cotización. Employee la ve porque puede agregar una; administrarlas es de
   * admin y eso lo decide la pantalla, no esta lista.
   */
  it('Usuarios es sólo admin, y el menú quedó en siete secciones', () => {
    expect(['admin', 'employee', 'salesperson'].map(puedeAdministrarUsuarios)).toEqual([true, false, false])
    expect(seccionesVisibles('admin').map((s) => s.label)).toEqual(['Empresa', 'Numeración', 'Usuarios', 'Listas de precios', 'Formas de pago', 'WhatsApp · IA', 'Plantillas de correo'])
    // Plantillas lo ve también employee: la firma que sale es la suya, y el
    // correo es de admin y employee.
    expect(seccionesVisibles('employee').map((s) => s.label)).toEqual(['Empresa', 'Numeración', 'Listas de precios', 'Formas de pago', 'Plantillas de correo'])
    expect(seccionesVisibles('salesperson')).toEqual([])
    expect(seccionesVisibles('technician')).toEqual([])
  })

  it('las cinco que se sacaron ya no están en el menú', () => {
    const etiquetas = seccionesVisibles('admin').map((s) => s.label)
    for (const fuera of ['Marcas', 'Categorías', 'Atributos', 'Auditoría', 'Borrados']) {
      expect(etiquetas).not.toContain(fuera)
    }
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

/*
 * Eliminar, no suspender (Fase 58 · E4).
 *
 * Las barreras son las mismas que para suspender y por la misma razón, pero acá
 * pesan más: de esto no se vuelve apretando «Reactivar». La base las vuelve a
 * aplicar; esto es sólo no ofrecer un botón que va a fallar.
 */
describe('puedeEliminar', () => {
  it('no se puede eliminar a uno mismo', () => {
    const yo = u({ esPropia: true })
    expect(puedeEliminar(yo, [yo]).ok).toBe(false)
    expect(puedeEliminar(yo, [yo]).motivo).toMatch(/tu propia cuenta/)
  })

  it('no se puede eliminar al único administrador activo', () => {
    const admin = u({ rol: 'admin' })
    expect(puedeEliminar(admin, [admin, u({ rol: 'employee' })]).ok).toBe(false)
  })

  it('con dos administradores activos, sí', () => {
    const a = u({ rol: 'admin' })
    const b = u({ rol: 'admin' })
    expect(puedeEliminar(a, [a, b]).ok).toBe(true)
  })

  /* Un admin SUSPENDIDO no cuenta como el último: ya no puede entrar, así que
     dejarlo sin borrar no protege a nadie. Es la misma cuenta que `puedeSuspender`. */
  it('un admin suspendido no es «el último administrador activo»', () => {
    const activo = u({ rol: 'admin' })
    const suspendido = u({ rol: 'admin', estado: 'suspended' })
    expect(puedeEliminar(suspendido, [activo, suspendido]).ok).toBe(true)
  })

  it('a un empleado cualquiera, sí', () => {
    const e = u({ rol: 'employee' })
    expect(puedeEliminar(e, [u({ rol: 'admin' }), e]).ok).toBe(true)
  })
})

describe('seguroQueBorraLaCuenta', () => {
  /*
   * Sólo dice «seguro» cuando NO PUDO dejar historial. Es el caso que motivó el
   * pedido —un email mal tipeado en una invitación— y el único en que la
   * pantalla puede prometer que la cuenta se borra: con 84 claves foráneas
   * protegiendo a quien cargó algo, para el resto se intenta y se informa.
   */
  it('una invitación que nunca se usó no pudo dejar historial', () => {
    expect(seguroQueBorraLaCuenta(u({ emailConfirmado: false, ultimoIngreso: null }))).toBe(true)
  })

  it('quien ya entró puede haber cargado algo', () => {
    expect(seguroQueBorraLaCuenta(u({ emailConfirmado: false, ultimoIngreso: '2026-01-05T10:00:00Z' }))).toBe(false)
  })

  it('una cuenta confirmada no se promete', () => {
    expect(seguroQueBorraLaCuenta(u({ emailConfirmado: true, ultimoIngreso: null }))).toBe(false)
  })
})

describe('los códigos nuevos de la base tienen texto', () => {
  it('no_auto_eliminacion y no_encontrado', () => {
    expect(mensajeError('no_auto_eliminacion')).toMatch(/tu propia cuenta/)
    expect(mensajeError('no_encontrado')).toMatch(/Recargá/)
  })
})
