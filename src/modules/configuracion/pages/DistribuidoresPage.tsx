import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAdminGeneral } from '@/features/empresa/useAdminGeneral'
import { useCategorias } from '@/modules/catalogo/hooks/useCatalogoFacetas'
import { guardarCompartido, listarCompartidosDe, type Compartido } from '@/modules/catalogo/services/compartido'
import styles from './DistribuidoresPage.module.css'

/**
 * Compartir el catálogo de la empresa activa con distribuidores (2026-11-27).
 *
 * Sólo administradores generales (la base lo vuelve a exigir en
 * `config_compartir_catalogo`). El distribuidor es otra empresa del sistema:
 * aparecen las empresas a las que pertenece quien administra, que es como se
 * crearon (Agregar empresa → Distribuidor).
 *
 * El precio que ve el distribuidor: el de la lista elegida si ese producto lo
 * tiene; si no, el PVP de esta empresa menos el descuento.
 */
export function DistribuidoresPage() {
  const { activa, membresias } = useEmpresa()
  const esGeneral = useAdminGeneral()
  const ownerId = activa?.companyId ?? null
  const compartidos = useQuery({
    queryKey: ['config', ownerId, 'catalogos-compartidos'],
    queryFn: () => listarCompartidosDe(ownerId!),
    enabled: ownerId !== null && esGeneral,
  })
  const [elegido, setElegido] = useState<string>('')

  if (!esGeneral) {
    return (
      <EmptyState
        icon="settings"
        title="Sin acceso a Distribuidores"
        description="Compartir el catálogo con un distribuidor lo hace un administrador general."
      />
    )
  }

  const candidatas = membresias.filter((m) => m.companyId !== ownerId)
  const nombreDe = (id: string) => membresias.find((m) => m.companyId === id)?.companyName ?? 'Empresa'
  const distribuidorId = elegido || compartidos.data?.[0]?.distribuidorId || ''

  return (
    <>
      <PageHeader
        title="Distribuidores"
        subtitle={`El catálogo de ${activa?.companyName ?? 'esta empresa'} que ve cada distribuidor, y a qué precio. Nunca ven costos ni stock.`}
      />
      {compartidos.isPending ? (
        <SkeletonRows rows={3} columns={2} label="Cargando…" />
      ) : candidatas.length === 0 ? (
        <EmptyState
          icon="users"
          title="Todavía no hay distribuidores"
          description="Creá uno desde el selector de empresa: Agregar empresa → Tipo: Distribuidor."
        />
      ) : (
        <div className={styles.cuerpo}>
          <Field label="Distribuidor">
            <Select value={distribuidorId} onChange={(e) => setElegido(e.target.value)}>
              <option value="" disabled>
                Elegí una empresa
              </option>
              {candidatas.map((m) => {
                const c = compartidos.data?.find((x) => x.distribuidorId === m.companyId)
                return (
                  <option key={m.companyId} value={m.companyId}>
                    {m.companyName}
                    {c ? (c.activo ? ' · compartido' : ' · pausado') : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
          {distribuidorId ? (
            <FormularioCompartido
              key={distribuidorId}
              ownerId={ownerId!}
              distribuidorId={distribuidorId}
              nombre={nombreDe(distribuidorId)}
              actual={compartidos.data?.find((x) => x.distribuidorId === distribuidorId) ?? null}
            />
          ) : null}
        </div>
      )}
    </>
  )
}

function FormularioCompartido({
  ownerId,
  distribuidorId,
  nombre,
  actual,
}: {
  ownerId: string
  distribuidorId: string
  nombre: string
  actual: Compartido | null
}) {
  const { activa } = useEmpresa()
  const qc = useQueryClient()
  const categorias = useCategorias(ownerId)
  const [descuento, setDescuento] = useState(String(actual?.descuentoPct ?? 0))
  const [lista, setLista] = useState(actual?.listaPrecioId ?? '')
  const [todosLosRubros, setTodosLosRubros] = useState(actual?.categorias == null)
  const [rubros, setRubros] = useState<string[]>(actual?.categorias ?? [])
  const [activo, setActivo] = useState(actual?.activo ?? true)

  const guardar = useMutation({
    mutationFn: () => {
      const n = Number(descuento.replace(',', '.'))
      if (!Number.isFinite(n)) throw new Error('El descuento tiene que ser un número.')
      return guardarCompartido({
        ownerId,
        distribuidorId,
        descuentoPct: n,
        listaPrecioId: lista || null,
        marcas: null,
        categorias: todosLosRubros ? null : rubros,
        activo,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config', ownerId, 'catalogos-compartidos'] }),
  })

  return (
    <form
      className={styles.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        guardar.mutate()
      }}
    >
      <label className={styles.check}>
        <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        <span>
          <strong>Compartir el catálogo con {nombre}</strong>
          <span className={styles.ayuda}>Si lo pausás, deja de verlo al instante y no puede cotizar esos productos.</span>
        </span>
      </label>

      <div className={styles.fila}>
        <Field label="Descuento sobre el PVP (%)" help="Su precio de distribuidor. 30 = ve el PVP menos 30 %.">
          <Input inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} />
        </Field>
        <Field label="Lista de precios (opcional)" help="Si un producto tiene precio en esta lista, se usa ése tal cual.">
          <Select value={lista} onChange={(e) => setLista(e.target.value)}>
            <option value="">Ninguna: PVP menos el descuento</option>
            {(activa?.listasDePrecios ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre} ({l.moneda})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className={styles.rubros}>
        <legend>Rubros que ve</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={todosLosRubros} onChange={(e) => setTodosLosRubros(e.target.checked)} />
          <span>Todos los rubros (incluye los que se agreguen después)</span>
        </label>
        {!todosLosRubros ? (
          <div className={styles.listaRubros}>
            {(categorias.data ?? []).map((c) => (
              <label key={c.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={rubros.includes(c.id)}
                  onChange={() => setRubros(rubros.includes(c.id) ? rubros.filter((r) => r !== c.id) : [...rubros, c.id])}
                />
                <span>{c.nombre}</span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" loading={guardar.isPending}>
          Guardar
        </Button>
      </div>
      {guardar.isError ? (
        <Alert tone="danger" title="No se guardó">
          {guardar.error.message}
        </Alert>
      ) : null}
      {guardar.isSuccess ? <Alert tone="success" role="status" title="Guardado. El distribuidor ya lo ve así." /> : null}
    </form>
  )
}
