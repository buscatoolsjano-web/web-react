import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Checkbox } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Icon } from '@/components/icons/Icon'
import tabla from '@/components/tables/Tabla.module.css'
import { permisosDe } from '../lib/permisos'
import { formatearFecha, formatearImporte } from '../lib/formato'
import { BuscadorCliente } from '../components/BuscadorCliente'
import type { ClienteBuscado } from '../services/catalogo'
import { crearLote, listarLotes, ordenesElegibles } from '../services/lotes'
import { ChipLote } from '../components/ChipEstado'
import styles from './Pagina.module.css'

/**
 * Cotización por lotes (lo que el sitio viejo del taller llamaba «Cotiz. por
 * Lotes»): varias órdenes de un mismo cliente en un solo presupuesto, que se
 * manda, se aprueba y se factura de una vez.
 */
export function LotesPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const navegar = useNavigate()
  const qc = useQueryClient()

  const lotes = useQuery({
    queryKey: ['mantenimiento', companyId, 'lotes'],
    queryFn: () => listarLotes(companyId!),
    enabled: companyId !== null && permisos.ver,
    staleTime: 30_000,
  })

  const [armando, setArmando] = useState(false)
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())

  const elegibles = useQuery({
    queryKey: ['mantenimiento', companyId, 'lotes-elegibles', cliente?.id],
    queryFn: () => ordenesElegibles(companyId!, cliente!.id),
    enabled: companyId !== null && cliente !== null,
    staleTime: 0,
  })

  const crear = useMutation({
    mutationFn: () => crearLote(companyId!, cliente!.id, [...elegidas]),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ['mantenimiento', companyId] })
      void navegar(`/mantenimiento/lotes/${id}`)
    },
  })

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Lotes de cotización" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento.</p>
        </Alert>
      </div>
    )
  }

  const filas = lotes.data ?? []
  const marcar = (id: string, si: boolean) =>
    setElegidas((s) => {
      const n = new Set(s)
      if (si) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <div className={doc.listado}>
      <PageHeader
        back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }}
        title="Lotes de cotización"
        subtitle={lotes.isPending ? 'Cargando…' : `${filas.length} ${filas.length === 1 ? 'lote' : 'lotes'}`}
        actions={
          permisos.crear && !armando ? (
            <Button icon={<Icon name="plus" size={16} />} onClick={() => setArmando(true)}>
              Nuevo lote
            </Button>
          ) : undefined
        }
      />

      <p className={styles.nota}>
        Un lote junta las órdenes de un mismo cliente en un solo presupuesto: se manda en un PDF, se aprueba o se
        rechaza de una vez y genera un solo pedido de venta, con un capítulo por equipo.
      </p>

      {armando ? (
        <DocSection title="Nuevo lote">
          <BuscadorCliente
            elegido={cliente}
            etiqueta="Cliente"
            obligatorio
            onElegir={(c) => {
              setCliente(c)
              setElegidas(new Set())
            }}
            onLimpiar={() => {
              setCliente(null)
              setElegidas(new Set())
            }}
          />
          {cliente ? (
            elegibles.isPending ? (
              <SkeletonRows rows={3} columns={3} label="Buscando las órdenes del cliente…" />
            ) : elegibles.error ? (
              <ErrorState compact title="No se pudieron leer las órdenes." description={elegibles.error.message} />
            ) : (elegibles.data ?? []).length === 0 ? (
              <p className={styles.nota}>
                Este cliente no tiene órdenes abiertas con la cotización pendiente fuera de otro lote.
              </p>
            ) : (
              <ul className={styles.listaChecks}>
                {(elegibles.data ?? []).map((o) => (
                  <li key={o.id}>
                    <Checkbox
                      label={`${o.numero} · ${[o.activoReferencia, o.modelo, o.serie ? `serie ${o.serie}` : null].filter(Boolean).join(' · ')} — ${o.lineas === 0 ? 'sin cotizar' : formatearImporte(o.total, o.moneda)}`}
                      checked={elegidas.has(o.id)}
                      onChange={(e) => marcar(o.id, e.target.checked)}
                    />
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {crear.error ? (
            <Alert tone="danger" role="alert">
              <p>{crear.error.message}</p>
            </Alert>
          ) : null}
          <div className={styles.acciones}>
            <Button disabled={!cliente || elegidas.size === 0} loading={crear.isPending} onClick={() => crear.mutate()}>
              {elegidas.size === 0 ? 'Crear el lote' : `Crear el lote con ${elegidas.size} ${elegidas.size === 1 ? 'orden' : 'órdenes'}`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setArmando(false)
                setCliente(null)
                setElegidas(new Set())
              }}
            >
              Cancelar
            </Button>
          </div>
        </DocSection>
      ) : null}

      {lotes.error ? (
        <ErrorState title="No se pudieron leer los lotes." description={lotes.error.message} />
      ) : lotes.isPending ? (
        <SkeletonRows rows={4} columns={5} label="Cargando lotes…" />
      ) : filas.length === 0 ? (
        <EmptyState icon="inbox" title="Todavía no hay lotes" description="Armá uno con «Nuevo lote»." />
      ) : (
        <div className={tabla.contenedor}>
          <table className={tabla.tabla}>
            <thead>
              <tr>
                <th scope="col">Lote</th>
                <th scope="col">Cliente</th>
                <th scope="col" className={tabla.num}>
                  Equipos
                </th>
                <th scope="col" className={tabla.num}>
                  Total
                </th>
                <th scope="col">Estado</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/mantenimiento/lotes/${l.id}`}>{l.numero}</Link>
                  </td>
                  <td>{l.cliente}</td>
                  <td className={tabla.num}>{l.equipos}</td>
                  <td className={`${tabla.num} ${styles.mono}`}>{formatearImporte(l.total, l.moneda)}</td>
                  <td>
                    <ChipLote estado={l.estado} />
                  </td>
                  <td>{formatearFecha(l.creadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
