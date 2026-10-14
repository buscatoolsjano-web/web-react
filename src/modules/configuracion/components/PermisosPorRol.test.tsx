// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Capacidad, Concesion } from '../lib/capacidades'

/**
 * La pantalla de permisos por rol (Fase 58 · E2).
 *
 * Lo que se prueba acá es lo que NO se puede probar en la lógica suelta: que el
 * administrador no tenga casillas, que el botón de guardar aparezca sólo cuando
 * hay algo para guardar, y que lo que se manda a la base sea el estado final de
 * las casillas de ESE rol y nada más.
 */

const estado = vi.hoisted(() => ({
  catalogo: [] as unknown[],
  concesiones: [] as unknown[],
  cargando: false,
  error: null as Error | null,
  guardando: false,
  guardados: [] as { rol: string; capacidades: readonly string[] }[],
  falla: null as string | null,
}))

/* El árbol de este test llega al cliente de Supabase, que valida el entorno al
   cargarse. Sin este mock el test exige variables VITE_* y falla en la suite
   aislada y en CI, donde no existen. Ver ADR-019. */
vi.mock('@/services/supabase/client', () => ({ supabase: {} }))

vi.mock('@/features/empresa/useEmpresa', () => ({
  useEmpresa: () => ({ activa: { companyId: 'c1', companyName: 'Buscatools', rol: 'admin' }, cargando: false }),
}))

vi.mock('../hooks/usePermisos', () => ({
  useCapacidades: () => ({ data: estado.catalogo, isPending: estado.cargando, error: null }),
  useConcesiones: () => ({ data: estado.concesiones, isPending: estado.cargando, error: estado.error }),
  useGuardarPermisos: () => ({
    isPending: estado.guardando,
    mutateAsync: async (v: { rol: string; capacidades: readonly string[] }) => {
      if (estado.falla) throw new (await import('../services/permisos')).ErrorPermisos(estado.falla)
      estado.guardados.push({ rol: v.rol, capacidades: [...v.capacidades] })
    },
  }),
}))

const { PermisosPorRol } = await import('./PermisosPorRol')

const CATALOGO: Capacidad[] = [
  { clave: 'comercial_ver', etiqueta: 'Ver lo comercial', descripcion: 'El catálogo con sus costos.', posicion: 1 },
  { clave: 'comercial_escribir', etiqueta: 'Cargar y editar documentos', descripcion: 'Crear y modificar.', posicion: 2 },
  { clave: 'emails', etiqueta: 'Correo', descripcion: 'Las casillas de la empresa.', posicion: 3 },
  { clave: 'whatsapp', etiqueta: 'WhatsApp', descripcion: 'Las conversaciones.', posicion: 4 },
  { clave: 'mantenimiento', etiqueta: 'Mantenimiento', descripcion: 'Equipos y órdenes.', posicion: 5 },
]

const CONCESIONES: Concesion[] = [
  { rol: 'employee', capacidad: 'comercial_ver' },
  { rol: 'employee', capacidad: 'comercial_escribir' },
  { rol: 'employee', capacidad: 'emails' },
  { rol: 'salesperson', capacidad: 'comercial_ver' },
  { rol: 'salesperson', capacidad: 'whatsapp' },
  { rol: 'technician', capacidad: 'comercial_ver' },
]

/** La tarjeta de un rol, por su título. */
const tarjeta = (nombre: string) => screen.getByRole('group', { name: nombre })

/**
 * Un clic, esperando el re-render.
 *
 * `act` envolviendo el clic y un microtask después: guardar es `async`, así que
 * sin esperar el estado posterior —el error, o el botón que desaparece— todavía
 * no está pintado cuando el test lo busca.
 */
async function clic(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
    await Promise.resolve()
  })
}

beforeEach(() => {
  estado.catalogo = CATALOGO
  estado.concesiones = CONCESIONES
  estado.cargando = false
  estado.error = null
  estado.guardando = false
  estado.guardados = []
  estado.falla = null
})

describe('qué muestra', () => {
  it('una tarjeta por rol, incluida la del administrador', () => {
    render(<PermisosPorRol />)
    for (const rol of ['Administrador', 'Empleado', 'Vendedor', 'Técnico']) {
      expect(tarjeta(rol)).toBeInTheDocument()
    }
  })

  /*
   * EL CASO QUE JUSTIFICA LA TARJETA FIJA. El administrador se muestra para que
   * se entienda el cuadro completo, pero SIN casillas: si tuviera una sola, un
   * admin podría quitarse el acceso a esta misma pantalla y dejar la empresa sin
   * nadie que pueda devolvérselo.
   */
  it('el administrador no tiene ni una casilla', () => {
    render(<PermisosPorRol />)
    const admin = tarjeta('Administrador')
    expect(within(admin).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(admin).getByText('No se configura')).toBeInTheDocument()
    // Y se enumera lo que tiene, que es todo.
    expect(within(admin).getByText(/Ver lo comercial · Cargar y editar documentos/)).toBeInTheDocument()
  })

  it('cada rol trae marcadas las que tiene y desmarcadas las que no', () => {
    render(<PermisosPorRol />)
    const vendedor = tarjeta('Vendedor')
    expect(within(vendedor).getByRole('checkbox', { name: 'Ver lo comercial' })).toBeChecked()
    expect(within(vendedor).getByRole('checkbox', { name: 'WhatsApp' })).toBeChecked()
    expect(within(vendedor).getByRole('checkbox', { name: 'Correo' })).not.toBeChecked()
  })

  // Era la mitad del pedido: «yo no sé a qué tiene acceso cada cosa». Sin la
  // explicación al lado, las etiquetas solas no alcanzan.
  it('cada permiso lleva su explicación', () => {
    render(<PermisosPorRol />)
    expect(within(tarjeta('Técnico')).getByText('El catálogo con sus costos.')).toBeInTheDocument()
  })

  it('dice qué no se configura acá, para que no parezca que esto es todo', () => {
    render(<PermisosPorRol />)
    expect(screen.getByText('Lo que no se configura acá')).toBeInTheDocument()
    expect(screen.getByText(/Chat interno/)).toBeInTheDocument()
  })

  it('un rol sin nada se lee como «Sin permisos» y no como una tarjeta vacía', () => {
    estado.concesiones = CONCESIONES.filter((c) => c.rol !== 'technician')
    render(<PermisosPorRol />)
    expect(within(tarjeta('Técnico')).getByText('Sin permisos')).toBeInTheDocument()
  })

  it('sin permiso para leerlos, lo dice en vez de mostrar tarjetas vacías', async () => {
    estado.error = new (await import('../services/permisos')).ErrorPermisos('sin_permiso')
    render(<PermisosPorRol />)
    expect(screen.getByText(/Sólo un administrador/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Empleado' })).not.toBeInTheDocument()
  })
})

describe('editar y guardar', () => {
  /* El botón sólo cuando hay algo que guardar: una barra siempre visible invita
     a apretar sin haber cambiado nada. */
  it('sin tocar nada no hay botón de guardar', () => {
    render(<PermisosPorRol />)
    expect(within(tarjeta('Empleado')).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('al tocar una casilla aparece Guardar, y manda el estado final de ese rol', async () => {
    render(<PermisosPorRol />)
    const vendedor = tarjeta('Vendedor')

    await clic(within(vendedor).getByRole('checkbox', { name: 'Correo' }))
    await clic(within(vendedor).getByRole('button', { name: 'Guardar' }))

    expect(estado.guardados).toEqual([
      // En el orden del catálogo, no en el de los clics.
      { rol: 'salesperson', capacidades: ['comercial_ver', 'emails', 'whatsapp'] },
    ])
  })

  it('quitar todas manda una lista vacía, que es un pedido válido', async () => {
    render(<PermisosPorRol />)
    const tecnico = tarjeta('Técnico')

    await clic(within(tecnico).getByRole('checkbox', { name: 'Ver lo comercial' }))
    expect(within(tecnico).getByText('Sin permisos')).toBeInTheDocument()
    await clic(within(tecnico).getByRole('button', { name: 'Guardar' }))

    expect(estado.guardados).toEqual([{ rol: 'technician', capacidades: [] }])
  })

  /* Cada tarjeta guarda SÓLO su rol: la RPC reemplaza los permisos de uno, así
     que dos administradores en roles distintos no se pisan. */
  it('tocar un rol no deja pendiente ningún otro', async () => {
    render(<PermisosPorRol />)
    await clic(within(tarjeta('Vendedor')).getByRole('checkbox', { name: 'Correo' }))

    expect(within(tarjeta('Empleado')).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(within(tarjeta('Técnico')).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('volver la casilla a como estaba hace desaparecer el botón: no hay nada que guardar', async () => {
    render(<PermisosPorRol />)
    const vendedor = tarjeta('Vendedor')
    const correo = within(vendedor).getByRole('checkbox', { name: 'Correo' })

    await clic(correo)
    expect(within(vendedor).getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
    await clic(correo)
    expect(within(vendedor).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('Deshacer vuelve a lo guardado sin tocar la base', async () => {
    render(<PermisosPorRol />)
    const vendedor = tarjeta('Vendedor')

    await clic(within(vendedor).getByRole('checkbox', { name: 'Correo' }))
    await clic(within(vendedor).getByRole('button', { name: 'Deshacer' }))

    expect(within(vendedor).getByRole('checkbox', { name: 'Correo' })).not.toBeChecked()
    expect(estado.guardados).toEqual([])
  })

  it('si la base rechaza, lo dice y deja las casillas como estaban para reintentar', async () => {
    estado.falla = 'sin_permiso'
    render(<PermisosPorRol />)
    const vendedor = tarjeta('Vendedor')

    await clic(within(vendedor).getByRole('checkbox', { name: 'Correo' }))
    await clic(within(vendedor).getByRole('button', { name: 'Guardar' }))

    expect(within(vendedor).getByText(/Sólo un administrador/)).toBeInTheDocument()
    expect(within(vendedor).getByRole('checkbox', { name: 'Correo' })).toBeChecked()
    expect(within(vendedor).getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
  })
})
