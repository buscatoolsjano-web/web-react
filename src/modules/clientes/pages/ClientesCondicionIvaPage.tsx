import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/Button'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { CONDICIONES_IVA } from '../lib/condicionIva'
import { sugerirCondicionIva } from '../lib/sugerenciaIva'
import { permisosDe } from '../lib/permisos'
import { clientesSinCondicionIva } from '../services/clientes'
import { guardarDatosFiscales } from '../services/edicion'
import styles from './ClientesCondicionIvaPage.module.css'

/** De a cuántos se guardan: la base se satura con muchas escrituras a la vez. */
const EN_PARALELO = 4

/**
 * Carga masiva de la condición frente al IVA.
 *
 * Ningún cliente la tenía, y sin ella no se factura: la pide el modal de
 * facturar, de a uno. Acá se cargan todos juntos. La sugerencia sale del
 * prefijo del CUIT (una sociedad casi siempre es Responsable Inscripta) y
 * viene preelegida, pero se guarda sólo lo que la persona deja elegido.
 */
export function ClientesCondicionIvaPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const puede = permisosDe(activa).editarCliente
  const qc = useQueryClient()

  const lista = useQuery({
    queryKey: ['clientes', companyId, 'sin-condicion-iva'],
    queryFn: () => clientesSinCondicionIva(companyId!),
    enabled: companyId !== null,
    staleTime: 0,
  })

  // Lo elegido por fila: si no se tocó, vale la sugerencia.
  const [elegidas, setElegidas] = useState<Record<string, string>>({})
  const [texto, setTexto] = useState('')
  const [soloConSugerencia, setSoloConSugerencia] = useState(false)
  const [guardando, setGuardando] = useState<{ hechos: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ ok: number; errores: string[] } | null>(null)

  const filas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return (lista.data ?? [])
      .map((c) => ({ ...c, sugerencia: sugerirCondicionIva(c.cuit) }))
      .filter((c) => (!soloConSugerencia || c.sugerencia !== null))
      .filter((c) => t === '' || c.razonSocial.toLowerCase().includes(t) || (c.cuit ?? '').includes(t) || (c.referencia ?? '').toLowerCase().includes(t))
  }, [lista.data, texto, soloConSugerencia])

  const valorDe = (id: string, sugerencia: string | null) => elegidas[id] ?? sugerencia ?? ''
  // Sólo lo que está a la vista (la tabla muestra las primeras 500): no se
  // guarda nada que la persona no pudo revisar.
  const visibles = filas.slice(0, 500)
  const aGuardar = visibles.filter((f) => valorDe(f.id, f.sugerencia) !== '')

  const guardar = async () => {
    const pendientes = aGuardar.map((f) => ({ id: f.id, nombre: f.razonSocial, cond: valorDe(f.id, f.sugerencia) }))
    setResultado(null)
    setGuardando({ hechos: 0, total: pendientes.length })
    let ok = 0
    const errores: string[] = []
    for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
      const lote = pendientes.slice(i, i + EN_PARALELO)
      const r = await Promise.allSettled(lote.map((p) => guardarDatosFiscales(p.id, p.cond, null)))
      r.forEach((x, j) => {
        if (x.status === 'fulfilled') ok++
        else errores.push(`${lote[j]!.nombre}: ${x.reason instanceof Error ? x.reason.message : String(x.reason)}`)
      })
      setGuardando({ hechos: Math.min(i + EN_PARALELO, pendientes.length), total: pendientes.length })
    }
    setGuardando(null)
    setResultado({ ok, errores })
    setElegidas({})
    await qc.invalidateQueries({ queryKey: ['clientes', companyId] })
  }

  const volver = { to: '/clientes', label: 'Clientes' }

  if (!puede) {
    return (
      <div className={doc.listado}>
        <PageHeader back={volver} title="Condición frente al IVA" />
        <Alert tone="neutral">
          <p>Tu rol no puede editar clientes.</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={doc.listado}>
      <PageHeader
        back={volver}
        title="Condición frente al IVA"
        subtitle={lista.isPending ? 'Cargando…' : `${(lista.data ?? []).length} clientes activos sin cargar`}
        actions={
          <Button onClick={() => void guardar()} disabled={aGuardar.length === 0 || guardando !== null} loading={guardando !== null}>
            {guardando ? `Guardando ${guardando.hechos} de ${guardando.total}…` : `Guardar ${aGuardar.length}`}
          </Button>
        }
      />

      <Alert tone="info" role="status">
        <p>
          Sin la condición frente al IVA no se puede facturar. A las sociedades (CUIT 30, 33 o 34) se les sugiere
          Responsable Inscripto: revisalo antes de guardar. A una persona (CUIT 20, 23, 24 o 27) el CUIT no le dice si
          es inscripta o monotributista: elegila vos. Se guardan sólo las filas que tienen una condición elegida.
        </p>
      </Alert>

      {resultado ? (
        <Alert tone={resultado.errores.length > 0 ? 'warning' : 'success'} role="status" title={`Guardados ${resultado.ok}`}>
          {resultado.errores.length > 0 ? (
            <ul>
              {resultado.errores.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div className={styles.filtros}>
        <Input
          type="search"
          placeholder="Buscar por nombre, CUIT o referencia"
          aria-label="Buscar cliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Checkbox
          label="Sólo los que tienen sugerencia"
          checked={soloConSugerencia}
          onChange={(e) => setSoloConSugerencia(e.target.checked)}
        />
      </div>

      {lista.isPending ? (
        <SkeletonRows rows={8} columns={3} label="Cargando clientes…" />
      ) : lista.error ? (
        <ErrorState title="No se pudieron leer los clientes." description={lista.error.message} onRetry={() => void lista.refetch()} retrying={lista.isFetching} />
      ) : (lista.data ?? []).length === 0 ? (
        <EmptyState icon="users" title="Todos los clientes activos tienen la condición de IVA cargada" description="Ya se les puede facturar." />
      ) : (
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">CUIT</th>
              <th scope="col">Condición frente al IVA</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link to={`/clientes/${f.id}`}>{f.razonSocial}</Link>
                  {f.referencia ? <small className={styles.ref}> · {f.referencia}</small> : null}
                </td>
                <td>{f.cuit ?? '—'}</td>
                <td>
                  <Select
                    aria-label={`Condición frente al IVA de ${f.razonSocial}`}
                    value={valorDe(f.id, f.sugerencia)}
                    onChange={(e) => setElegidas((x) => ({ ...x, [f.id]: e.target.value }))}
                  >
                    <option value="">Sin elegir</option>
                    {CONDICIONES_IVA.map((c) => (
                      <option key={c.valor} value={c.valor}>
                        {c.etiqueta}
                        {f.sugerencia === c.valor && elegidas[f.id] === undefined ? ' (sugerida)' : ''}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {filas.length > 500 ? <p>Se muestran los primeros 500: buscá o guardá estos para ver el resto.</p> : null}
    </div>
  )
}
