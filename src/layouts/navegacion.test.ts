import { describe, expect, it } from 'vitest'
import { destinosPara, entradaActiva, navegacionPara, NAVEGACION } from './navegacion'
import { ROLES_EMAILS } from '@/modules/emails/lib/permisos'
import { ROLES_INFORMES } from '@/modules/informes/lib/permisos'
import { ROLES_CONFIGURACION } from '@/modules/configuracion/lib/permisos'

/**
 * La lista plana de Fase 1 tal como estaba en AppLayout.tsx antes de la
 * Fase 13 (commit 0525de0). La navegación agrupada tiene que ofrecerle a cada
 * rol exactamente estos destinos: el rediseño no cambia permisos.
 */
const AC = ['admin', 'employee']
const NAV_FASE_1: { to: string; roles?: readonly string[] }[] = [
  { to: '/' },
  { to: '/catalogo' },
  { to: '/ventas/cotizaciones' },
  { to: '/ventas/pedidos' },
  { to: '/ventas/entregas' },
  { to: '/clientes' },
  { to: '/compras/proveedores', roles: AC },
  { to: '/compras/pedidos', roles: AC },
  { to: '/compras/recepciones', roles: AC },
  { to: '/compras/facturas', roles: AC },
  { to: '/mantenimiento/activos', roles: AC },
  { to: '/mantenimiento/ordenes', roles: AC },
  { to: '/emails', roles: ROLES_EMAILS },
  { to: '/informes', roles: ROLES_INFORMES },
  { to: '/configuracion', roles: ROLES_CONFIGURACION },
]
const fase1 = (rol: string) => NAV_FASE_1.filter((i) => !i.roles || i.roles.includes(rol)).map((i) => i.to)

describe('navegación agrupada', () => {
  it.each(['admin', 'employee', 'salesperson', 'technician', 'customer', 'distributor', ''])('rol «%s»: mismos destinos que la lista de Fase 1', (rol) => {
    expect(new Set(destinosPara(rol))).toEqual(new Set(fase1(rol)))
    expect(destinosPara(rol)).toHaveLength(fase1(rol).length)
  })

  it('grupos en el orden aprobado', () => {
    expect(NAVEGACION.map((g) => g.label)).toEqual([null, 'Operación', 'Datos', 'Comunicación', 'Análisis', 'Administración'])
  })

  it('un vendedor no ve Compras ni Mantenimiento; los grupos sin enlaces desaparecen', () => {
    const nav = navegacionPara('salesperson')
    const operacion = nav.find((g) => g.id === 'operacion')!
    expect(operacion.entradas.map((e) => e.id)).toEqual(['ventas'])
    expect(nav.some((g) => g.id === 'administracion')).toBe(false)
    expect(nav.some((g) => g.id === 'analisis')).toBe(false)
  })

  it('WhatsApp sigue como «próximamente» para todos, sin enlace', () => {
    for (const rol of ['admin', 'salesperson', '']) {
      const w = navegacionPara(rol).flatMap((g) => g.entradas).find((e) => e.id === 'whatsapp')!
      expect(w.proximamente).toBe(true)
      expect(w.destino).toBeUndefined()
    }
  })

  it('entrada activa por prefijo de ruta (Inicio sólo exacto)', () => {
    const [inicio] = NAVEGACION[0]!.entradas
    const ventas = NAVEGACION[1]!.entradas[0]!
    expect(entradaActiva(inicio!, '/')).toBe(true)
    expect(entradaActiva(inicio!, '/catalogo')).toBe(false)
    expect(entradaActiva(ventas, '/ventas/pedidos/123')).toBe(true)
    expect(entradaActiva(ventas, '/ventas-historicas')).toBe(false)
    expect(entradaActiva(ventas, '/compras/pedidos')).toBe(false)
  })
})
