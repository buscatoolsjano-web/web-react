import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/forms/controls'
import { Spinner } from '@/components/ui/Spinner'
import { Alert } from '@/components/feedback/Alert'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  aplicarVisibilidad,
  buscarProductosVisibilidad,
  visibilidadCategorias,
} from '../services/visibilidad'
import { useDebounce } from '@/hooks/useDebounce'
import styles from './VisibilidadWebPage.module.css'

/**
 * Qué productos se muestran en el sitio público (Fase 116).
 *
 * «Visible en la web» = el producto tiene `public_slug`. Se puede mostrar u
 * ocultar una categoría entera de un click (el trabajo pesado lo hace el
 * servidor) o buscar productos puntuales y tildarlos de a uno. Ocultar no borra
 * nada: el producto sigue en el catálogo del ERP, sólo no aparece en la web.
 */
export function VisibilidadWebPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const qc = useQueryClient()

  const cats = useQuery({
    queryKey: ['web', companyId, 'visibilidad-cats'],
    queryFn: () => visibilidadCategorias(companyId!),
    enabled: companyId !== null,
  })

  const aplicar = useMutation({
    mutationFn: (v: { visible: boolean; categoryId?: string; productId?: string }) =>
      aplicarVisibilidad(companyId!, v.visible, { categoryId: v.categoryId, productId: v.productId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['web', companyId, 'visibilidad-cats'] })
      void qc.invalidateQueries({ queryKey: ['web', companyId, 'visibilidad-buscar'] })
    },
  })

  const [texto, setTexto] = useState('')
  const q = useDebounce(texto, 300)
  const busqueda = useQuery({
    queryKey: ['web', companyId, 'visibilidad-buscar', q],
    queryFn: () => buscarProductosVisibilidad(companyId!, q),
    enabled: companyId !== null && q.trim().length >= 2,
  })

  return (
    <div>
      <PageHeader
        title="Visibilidad en la web"
        subtitle="Elegí qué productos ven los clientes en el sitio público. Ocultar no borra: sigue en el catálogo del ERP."
      />

      {aplicar.isError ? <Alert tone="danger">No se pudo aplicar el cambio.</Alert> : null}

      {/* ── Buscar productos puntuales ─────────────────────────────────── */}
      <section className={styles.panel}>
        <h2 className={styles.titulo}>Buscar un producto</h2>
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Referencia o nombre…"
          aria-label="Buscar producto"
        />
        {q.trim().length >= 2 ? (
          busqueda.isPending ? (
            <div className={styles.cargando}><Spinner size={16} /> Buscando…</div>
          ) : (busqueda.data ?? []).length === 0 ? (
            <p className={styles.vacio}>Sin resultados.</p>
          ) : (
            <ul className={styles.listaProd}>
              {busqueda.data!.map((p) => (
                <li key={p.id}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={p.visible}
                      disabled={aplicar.isPending}
                      onChange={(e) => aplicar.mutate({ visible: e.target.checked, productId: p.id })}
                    />
                    <code className={styles.sku}>{p.sku}</code>
                    <span className={styles.nombre} title={p.nombre}>{p.nombre}</span>
                  </label>
                  <span className={p.visible ? styles.badgeOn : styles.badgeOff}>
                    {p.visible ? 'En la web' : 'Oculto'}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {/* ── Por categoría ──────────────────────────────────────────────── */}
      <section className={styles.panel}>
        <h2 className={styles.titulo}>Por categoría</h2>
        {cats.isPending ? (
          <div className={styles.cargando}><Spinner /> Cargando…</div>
        ) : (cats.data ?? []).length === 0 ? (
          <p className={styles.vacio}>No hay categorías con productos.</p>
        ) : (
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Categoría</th>
                <th className={styles.num}>En la web</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.data!.map((c) => {
                const pct = c.total > 0 ? Math.round((c.visibles / c.total) * 100) : 0
                return (
                  <tr key={c.categoryId}>
                    <td>{c.nombre}</td>
                    <td className={styles.num}>
                      <span className={styles.conteo}>{c.visibles.toLocaleString('es-AR')} / {c.total.toLocaleString('es-AR')}</span>
                      <span className={styles.barra}><span className={styles.barraLlena} style={{ width: `${pct}%` }} /></span>
                    </td>
                    <td className={styles.acciones}>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={aplicar.isPending || c.visibles === c.total}
                        onClick={() => aplicar.mutate({ visible: true, categoryId: c.categoryId })}
                      >
                        Mostrar todo
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={aplicar.isPending || c.visibles === 0}
                        onClick={() => aplicar.mutate({ visible: false, categoryId: c.categoryId })}
                      >
                        Ocultar todo
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
