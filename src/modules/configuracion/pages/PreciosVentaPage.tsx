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
import { MONEDAS } from '@/services/empresa/crearEmpresa'
import { guardarAjustesDistribuidor, leerAjustesDistribuidor, listarCompartido } from '@/modules/catalogo/services/compartido'
import { claveAjustesDistribuidor } from '@/modules/catalogo/hooks/useAjustesDistribuidor'
import { precioDeVenta, type AjustesDistribuidor } from '@/modules/catalogo/lib/precioDistribuidor'
import { formatearPrecio } from '@/modules/catalogo/lib/formato'
import styles from './DistribuidoresPage.module.css'

/**
 * Los precios de venta de un distribuidor (2026-11-27) — Fase 3.
 *
 * Su costo es el precio que le da su proveedor; acá decide con qué margen vende
 * —uno general y, si quiere, otro por rubro— y en qué moneda, con su tipo de
 * cambio. Lo cambian los admins de SU empresa (lo vuelve a exigir la RLS).
 */
export function PreciosVentaPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const ajustes = useQuery({
    queryKey: claveAjustesDistribuidor(companyId),
    queryFn: () => leerAjustesDistribuidor(companyId!),
    enabled: companyId !== null,
  })
  // Los rubros y la moneda del proveedor salen del propio catálogo compartido.
  const catalogo = useQuery({
    queryKey: ['catalogo-compartido', companyId, 'rubros'],
    queryFn: () => listarCompartido(companyId!, { q: '', categoria: null, marca: null, pagina: 1, porPagina: 1 }),
    enabled: companyId !== null,
    staleTime: 10 * 60_000,
  })

  if (activa?.modulos == null) {
    return <EmptyState icon="settings" title="No aplica" description="Los precios de venta son para distribuidores." />
  }
  if (ajustes.isPending || catalogo.isPending) return <SkeletonRows rows={4} columns={2} label="Cargando…" />
  if (!catalogo.data?.proveedor) {
    return (
      <EmptyState
        icon="package"
        title="Todavía no tenés un catálogo"
        description="Cuando tu proveedor te comparta su catálogo, acá vas a poner tu margen."
      />
    )
  }

  return (
    <>
      <PageHeader
        title="Precios de venta"
        subtitle={`Tu costo es el precio de ${catalogo.data.proveedor}. Acá ponés tu margen y en qué moneda vendés.`}
      />
      <Formulario
        companyId={companyId!}
        inicial={ajustes.data!}
        monedaProveedor={catalogo.data.moneda}
        rubros={catalogo.data.categorias}
        puedeEditar={activa?.rol === 'admin'}
      />
    </>
  )
}

function Formulario({
  companyId,
  inicial,
  monedaProveedor,
  rubros,
  puedeEditar,
}: {
  companyId: string
  inicial: AjustesDistribuidor
  monedaProveedor: string | null
  rubros: { id: string; nombre: string }[]
  puedeEditar: boolean
}) {
  const qc = useQueryClient()
  const [margen, setMargen] = useState(String(inicial.margenPct))
  const [moneda, setMoneda] = useState(inicial.monedaVenta ?? monedaProveedor ?? '')
  const [cambio, setCambio] = useState(String(inicial.tipoCambio))
  const [porRubro, setPorRubro] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(inicial.margenesRubro).map(([k, v]) => [k, String(v)])),
  )

  const num = (t: string) => Number(t.replace(',', '.'))
  const otraMoneda = moneda !== '' && moneda !== monedaProveedor
  const armar = (): AjustesDistribuidor => ({
    margenPct: num(margen),
    margenesRubro: Object.fromEntries(
      Object.entries(porRubro)
        .filter(([, v]) => v.trim() !== '' && Number.isFinite(num(v)))
        .map(([k, v]) => [k, num(v)]),
    ),
    monedaVenta: moneda || null,
    tipoCambio: otraMoneda ? num(cambio) : 1,
  })

  const guardar = useMutation({
    mutationFn: () => {
      const a = armar()
      if (!Number.isFinite(a.margenPct) || a.margenPct < 0) throw new Error('El margen tiene que ser un número positivo.')
      if (!Number.isFinite(a.tipoCambio) || a.tipoCambio <= 0) throw new Error('El tipo de cambio tiene que ser mayor a cero.')
      return guardarAjustesDistribuidor(companyId, a)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: claveAjustesDistribuidor(companyId) }),
  })

  const ejemplo = (() => {
    const a = armar()
    if (!Number.isFinite(a.margenPct) || !Number.isFinite(a.tipoCambio)) return null
    return precioDeVenta(100, null, monedaProveedor, a)
  })()

  return (
    <form
      className={styles.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        guardar.mutate()
      }}
    >
      <fieldset className={styles.rubros} disabled={!puedeEditar}>
        <legend>Margen y moneda</legend>
        <div className={styles.fila}>
          <Field label="Margen general (%)" help="Sobre tu costo. 35 = vendés a tu costo + 35 %.">
            <Input inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} />
          </Field>
          <Field label="Moneda de venta">
            <Select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          {otraMoneda ? (
            <Field label={`Tipo de cambio: 1 ${monedaProveedor ?? ''} =`} help={`Cuántos ${moneda} vale cada ${monedaProveedor ?? ''}.`}>
              <Input inputMode="decimal" value={cambio} onChange={(e) => setCambio(e.target.value)} />
            </Field>
          ) : null}
        </div>
        {ejemplo !== null ? (
          <p className={styles.ayuda}>
            Ejemplo: algo que te cuesta {formatearPrecio(100, monedaProveedor)} lo vendés a{' '}
            <strong>{formatearPrecio(ejemplo, moneda || monedaProveedor)}</strong>.
          </p>
        ) : null}
      </fieldset>

      <fieldset className={styles.rubros} disabled={!puedeEditar}>
        <legend>Margen por rubro (opcional)</legend>
        <p className={styles.ayuda}>Vacío = usa el margen general.</p>
        <div className={styles.listaRubros}>
          {rubros.map((r) => (
            <Field key={r.id} label={r.nombre}>
              <Input
                inputMode="decimal"
                placeholder={margen}
                value={porRubro[r.id] ?? ''}
                onChange={(e) => setPorRubro({ ...porRubro, [r.id]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </fieldset>

      {puedeEditar ? (
        <div>
          <Button type="submit" loading={guardar.isPending}>
            Guardar
          </Button>
        </div>
      ) : (
        <Alert tone="info" title="Sólo un administrador de tu empresa cambia los precios de venta." />
      )}
      {guardar.isError ? (
        <Alert tone="danger" title="No se guardó">
          {guardar.error.message}
        </Alert>
      ) : null}
      {guardar.isSuccess ? <Alert tone="success" role="status" title="Guardado. El catálogo y las cotizaciones ya usan estos precios." /> : null}
    </form>
  )
}
