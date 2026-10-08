import { describe, expect, it } from 'vitest'
import { destinosPara, entradaActiva, navegacionPara, NAVEGACION } from './navegacion'
import { ROLES_EMAILS } from '@/modules/emails/lib/permisos'
import { ROLES_INFORMES } from '@/modules/informes/lib/permisos'
import { ROLES_CONFIGURACION } from '@/modules/configuracion/lib/permisos'
import { ROLES_WHATSAPP } from '@/modules/whatsapp/lib/permisos'
import { ROLES_CHAT } from '@/modules/chat/lib/permisos'

/**
 * La lista plana de Fase 1 tal como estaba en AppLayout.tsx antes de la
 * Fase 13 (commit 0525de0). La navegación agrupada tiene que ofrecerle a cada
 * rol exactamente estos destinos: el rediseño no cambia permisos.
 *
 * Fase 16: se suma /whatsapp, que hasta ahora figuraba como «próximamente».
 *
 * Fase 28 · E15: se suma /chat, el chat interno.
 *
 * Fase 29 · E7: se suma /ventas/facturas. Va SIN restricción de rol, como el
 * resto de Ventas: quién ve qué factura lo decide `invoices_select` —internos
 * ven las de su empresa, un cliente sólo las suyas—, y quién puede emitirlas
 * lo decide la RPC. Ocultar el enlace sería una cortesía, no el control.
 *
 * Fase 30 · E6: se suma /ventas/importar-oc. También sin restricción de rol, y
 * por la misma razón: quién puede importar lo decide `importar_oc`, que exige
 * ser escritor de la empresa y lo dice con un motivo. Un enlace escondido no
 * es un permiso.
 */
const AC = ['admin', 'employee']
const NAV_FASE_1: { to: string; roles?: readonly string[] }[] = [
  { to: '/' },
  { to: '/catalogo' },
  // Fase 49: las listas de precios son COSTOS, o sea información comercial.
  // Sólo roles internos, igual que Compras. Lo que de verdad lo protege es
  // RLS con `app.current_internal_company_ids()`; esconder el enlace es una
  // cortesía.
  { to: '/precios', roles: AC },
  { to: '/ventas/cotizaciones' },
  { to: '/ventas/pedidos' },
  { to: '/ventas/entregas' },
  { to: '/ventas/facturas' },
  { to: '/clientes' },
  { to: '/compras/proveedores', roles: AC },
  { to: '/compras/pedidos', roles: AC },
  { to: '/compras/recepciones', roles: AC },
  { to: '/compras/facturas', roles: AC },
  { to: '/mantenimiento/activos', roles: AC },
  { to: '/mantenimiento/ordenes', roles: AC },
  { to: '/emails', roles: ROLES_EMAILS },
  { to: '/whatsapp', roles: ROLES_WHATSAPP },
  { to: '/chat', roles: ROLES_CHAT },
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
    // Fase 27 · E3: Comunicación subió a segunda, pegada a Inicio: es lo que
    // se mira al empezar el día y lleva los contadores de sin leer.
    expect(NAVEGACION.map((g) => g.label)).toEqual([null, 'Comunicación', 'Datos', 'Operación', 'Análisis', 'Administración'])
  })

  it('un vendedor no ve Compras ni Mantenimiento; los grupos sin enlaces desaparecen', () => {
    const nav = navegacionPara('salesperson')
    const operacion = nav.find((g) => g.id === 'operacion')!
    expect(operacion.entradas.map((e) => e.id)).toEqual(['ventas'])
    expect(nav.some((g) => g.id === 'administracion')).toBe(false)
    expect(nav.some((g) => g.id === 'analisis')).toBe(false)
  })

  it('WhatsApp ya no es «próximamente»: lleva a la bandeja de quien puede usarla', () => {
    for (const rol of ROLES_WHATSAPP) {
      const w = navegacionPara(rol).flatMap((g) => g.entradas).find((e) => e.id === 'whatsapp')!
      expect(w.proximamente).toBeUndefined()
      expect(w.destino?.to).toBe('/whatsapp')
    }
  })

  it('technician, customer y el sin rol no ven WhatsApp', () => {
    for (const rol of ['technician', 'customer', 'distributor', '']) {
      const w = navegacionPara(rol).flatMap((g) => g.entradas).find((e) => e.id === 'whatsapp')
      expect(w).toBeUndefined()
    }
  })

  it('entrada activa por prefijo de ruta (Inicio sólo exacto)', () => {
    const [inicio] = NAVEGACION[0]!.entradas
    // Por id y no por posición: el orden de los grupos cambió en la Fase 27
    // y un test que cuenta posiciones se rompe cada vez que se reordena.
    const ventas = NAVEGACION.flatMap((g) => g.entradas).find((e) => e.id === 'ventas')!
    expect(entradaActiva(inicio!, '/')).toBe(true)
    expect(entradaActiva(inicio!, '/catalogo')).toBe(false)
    expect(entradaActiva(ventas, '/ventas/pedidos/123')).toBe(true)
    expect(entradaActiva(ventas, '/ventas-historicas')).toBe(false)
    expect(entradaActiva(ventas, '/compras/pedidos')).toBe(false)
  })
})
