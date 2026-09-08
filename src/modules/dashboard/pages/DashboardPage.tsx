import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Button } from '@/components/ui/Button'
import { verificarConexion } from '@/services/supabase/health'

/**
 * FASE 1 — pantalla de verificación, no el dashboard real.
 *
 * Cumple dos funciones concretas:
 *  1. Probar de punta a punta que el cliente Supabase conecta con el
 *     proyecto nuevo (solo lectura: getSession()).
 *  2. Servir de banco de pruebas visual de ResponsiveTable en los 6 anchos
 *     del checklist.
 *
 * El dashboard real (indicadores, widgets) llega después de Ventas.
 */

interface PedidoDemo {
  numero: string
  cliente: string
  fecha: string
  estado: string
  total: string
  vendedor: string
}

// DATOS INVENTADOS. Ningún dato real de clientes entra al repo — es una de
// las reglas del proyecto. Ver README › Seguridad.
const FILAS_DEMO: PedidoDemo[] = [
  {
    numero: 'PEDIDO #1001',
    cliente: 'Cliente Demo A',
    fecha: '08/09/2026',
    estado: 'Pendiente',
    total: 'USD 8.450',
    vendedor: 'DEMO',
  },
  {
    numero: 'PEDIDO #1002',
    cliente: 'Cliente Demo B',
    fecha: '07/09/2026',
    estado: 'Entregado',
    total: 'USD 1.200',
    vendedor: 'DEMO',
  },
  {
    numero: 'PEDIDO #1003',
    cliente: 'Cliente Demo C',
    fecha: '05/09/2026',
    estado: 'Parcial',
    total: 'USD 23.900',
    vendedor: 'DEMO',
  },
]

const COLUMNAS: Column<PedidoDemo>[] = [
  { key: 'numero', header: 'N°', mobile: 'title', width: '160px' },
  { key: 'cliente', header: 'Cliente' },
  { key: 'fecha', header: 'Fecha', width: '120px' },
  { key: 'estado', header: 'Estado', width: '120px' },
  { key: 'total', header: 'Total', align: 'right', width: '140px' },
  { key: 'vendedor', header: 'Vendedor', width: '120px', mobile: 'hide' },
]

export function DashboardPage() {
  const [seleccionado, setSeleccionado] = useState<string | null>(null)

  const conexion = useQuery({
    queryKey: ['supabase', 'health'],
    queryFn: verificarConexion,
    staleTime: 60_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <section>
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-2)' }}>Dashboard</h1>
        <p style={{ color: 'var(--text-soft)' }}>
          Base del proyecto (Fase 1). Los módulos se migran uno por uno.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
          Conexión a Supabase
        </h2>
        {conexion.isPending && <StatusMessage tono="pending" titulo="Verificando conexión…" />}
        {conexion.isError && (
          <StatusMessage
            tono="error"
            titulo="No se pudo verificar la conexión"
            detalle={conexion.error.message}
          />
        )}
        {conexion.data?.estado === 'ok' && (
          <StatusMessage
            tono="ok"
            titulo="Conectado al proyecto Supabase nuevo"
            detalle={
              conexion.data.conSesion
                ? 'Hay una sesión activa.'
                : 'Sin sesión activa — esperado en Fase 1: Auth se implementa en Fase 2.5.'
            }
          />
        )}
        {conexion.data?.estado === 'error' && (
          <StatusMessage tono="error" titulo="Error de conexión" detalle={conexion.data.mensaje} />
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
          ResponsiveTable — tabla en escritorio, cards en celular
        </h2>
        <p style={{ color: 'var(--text-soft)', marginBottom: 'var(--space-3)' }}>
          Achicá la ventana por debajo de 768px para ver el cambio. Datos de ejemplo.
        </p>
        <ResponsiveTable
          columns={COLUMNAS}
          rows={FILAS_DEMO}
          rowKey={(p) => p.numero}
          actions={(p) => (
            <Button variant="secondary" onClick={() => setSeleccionado(p.numero)}>
              Ver
            </Button>
          )}
        />
        {seleccionado && (
          <p style={{ marginTop: 'var(--space-3)', color: 'var(--text-soft)' }}>
            Seleccionado: {seleccionado}
          </p>
        )}
      </section>
    </div>
  )
}
