import type { IconName } from '@/components/icons/Icon'
import { ROLES_EMAILS } from '@/modules/emails/lib/permisos'
import { ROLES_INFORMES } from '@/modules/informes/lib/permisos'
import { ROLES_CONFIGURACION } from '@/modules/configuracion/lib/permisos'

/**
 * Navegación del shell (Fase 13 · E2): agrupada, pero con EXACTAMENTE los
 * mismos destinos y los mismos roles que la lista plana de Fase 1.
 * `navegacion.test.ts` lo compara rol por rol.
 *
 * Ocultar un enlace es una cortesía, no el control de acceso: lo que protege
 * los datos es RLS (y las RPC). Un ítem sin `roles` lo ve cualquiera.
 */

/** Los roles que escriben en Compras: el conjunto de `app.current_writer_company_ids()`. */
const ESCRIBEN_COMPRAS = ['admin', 'employee'] as const

/**
 * Los roles de Mantenimiento. Hoy el mismo conjunto que Compras, pero por su
 * propia razón: `app.current_maintenance_company_ids()` es admin + employee.
 * Son dos helpers distintos y pueden divergir, así que son dos constantes.
 */
const ESCRIBEN_MANTENIMIENTO = ['admin', 'employee'] as const

export interface Destino {
  to: string
  label: string
  /** Coincidencia exacta (sólo Inicio). */
  end?: boolean
  roles?: readonly string[]
}

export interface EntradaNav {
  id: string
  label: string
  icon: IconName
  /** Hoja: navega directo. */
  destino?: Destino
  /** Módulo con subsecciones: se despliega. */
  hijos?: Destino[]
  /** Visible pero sin enlace (módulo todavía no migrado). */
  proximamente?: boolean
}

export interface GrupoNav {
  id: string
  /** `null`: sin título (Inicio). */
  label: string | null
  entradas: EntradaNav[]
}

export const NAVEGACION: GrupoNav[] = [
  {
    id: 'inicio',
    label: null,
    entradas: [{ id: 'inicio', label: 'Inicio', icon: 'home', destino: { to: '/', label: 'Inicio', end: true } }],
  },
  {
    id: 'operacion',
    label: 'Operación',
    entradas: [
      {
        id: 'ventas',
        label: 'Ventas',
        icon: 'cart',
        hijos: [
          { to: '/ventas/cotizaciones', label: 'Cotizaciones' },
          { to: '/ventas/pedidos', label: 'Pedidos' },
          { to: '/ventas/entregas', label: 'Notas de entrega' },
        ],
      },
      {
        id: 'compras',
        label: 'Compras',
        icon: 'truck',
        hijos: [
          { to: '/compras/proveedores', label: 'Proveedores', roles: ESCRIBEN_COMPRAS },
          { to: '/compras/pedidos', label: 'Pedidos', roles: ESCRIBEN_COMPRAS },
          { to: '/compras/recepciones', label: 'Notas de entrada', roles: ESCRIBEN_COMPRAS },
          { to: '/compras/facturas', label: 'Facturas', roles: ESCRIBEN_COMPRAS },
        ],
      },
      {
        id: 'mantenimiento',
        label: 'Mantenimiento',
        icon: 'wrench',
        hijos: [
          { to: '/mantenimiento/activos', label: 'Equipos', roles: ESCRIBEN_MANTENIMIENTO },
          { to: '/mantenimiento/ordenes', label: 'Órdenes de servicio', roles: ESCRIBEN_MANTENIMIENTO },
        ],
      },
    ],
  },
  {
    id: 'datos',
    label: 'Datos',
    entradas: [
      { id: 'catalogo', label: 'Catálogo', icon: 'package', destino: { to: '/catalogo', label: 'Catálogo' } },
      { id: 'clientes', label: 'Clientes', icon: 'users', destino: { to: '/clientes', label: 'Clientes' } },
    ],
  },
  {
    id: 'comunicacion',
    label: 'Comunicación',
    entradas: [
      { id: 'emails', label: 'Emails', icon: 'mail', destino: { to: '/emails', label: 'Emails', roles: ROLES_EMAILS } },
      { id: 'whatsapp', label: 'WhatsApp', icon: 'message-circle', proximamente: true },
    ],
  },
  {
    id: 'analisis',
    label: 'Análisis',
    entradas: [{ id: 'informes', label: 'Informes', icon: 'bar-chart', destino: { to: '/informes', label: 'Informes', roles: ROLES_INFORMES } }],
  },
  {
    id: 'administracion',
    label: 'Administración',
    entradas: [
      {
        id: 'configuracion',
        label: 'Configuración',
        icon: 'sliders',
        destino: { to: '/configuracion', label: 'Configuración', roles: ROLES_CONFIGURACION },
      },
    ],
  },
]

const permitido = (d: Destino, rol: string) => !d.roles || d.roles.includes(rol)

/**
 * La navegación que corresponde a un rol: hijos filtrados, módulos sin hijos
 * visibles y grupos vacíos fuera. «Próximamente» se muestra a todos, como hoy.
 */
export function navegacionPara(rol: string): GrupoNav[] {
  return NAVEGACION.map((g) => ({
    ...g,
    entradas: g.entradas.flatMap<EntradaNav>((e) => {
      if (e.proximamente) return [e]
      if (e.destino) return permitido(e.destino, rol) ? [e] : []
      const hijos = (e.hijos ?? []).filter((h) => permitido(h, rol))
      return hijos.length ? [{ ...e, hijos }] : []
    }),
  })).filter((g) => g.entradas.length > 0)
}

/** Todos los destinos navegables de un rol, en orden (para tests y el drawer compacto). */
export function destinosPara(rol: string): string[] {
  return navegacionPara(rol).flatMap((g) => g.entradas.flatMap((e) => (e.destino ? [e.destino.to] : (e.hijos ?? []).map((h) => h.to))))
}

/** ¿La ruta actual pertenece a esta entrada? (para desplegar el módulo activo) */
export function entradaActiva(e: EntradaNav, pathname: string): boolean {
  const coincide = (to: string, end?: boolean) => (end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`))
  if (e.destino) return coincide(e.destino.to, e.destino.end)
  return (e.hijos ?? []).some((h) => coincide(h.to))
}
