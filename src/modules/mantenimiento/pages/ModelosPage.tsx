import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { Alert } from '@/components/feedback/Alert'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Input, Select } from '@/components/forms/controls'
import { Field } from '@/components/forms/Field'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { permisosDe } from '../lib/permisos'
import { formatearNumero } from '../lib/formato'
import { flotaPorModelo, listarModelos } from '../services/modelos'
import styles from './Pagina.module.css'

/**
 * Los modelos de herramienta que atiende el taller (FEIN AccuTec), con sus
 * especificaciones, accesorios compatibles y cuántos hay en la flota. Es la
 * pantalla «Modelos FEIN» del sitio viejo, y de acá sale el rango de torque
 * que usa la pestaña Torque de cada orden.
 */
export function ModelosPage() {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const permisos = permisosDe(activa)
  const [familia, setFamilia] = useState('')
  const [texto, setTexto] = useState('')

  const modelos = useQuery({
    queryKey: ['mantenimiento', companyId, 'modelos'],
    queryFn: () => listarModelos(companyId!),
    enabled: companyId !== null && permisos.ver,
    staleTime: 10 * 60_000,
  })
  const flota = useQuery({
    queryKey: ['mantenimiento', companyId, 'flota-por-modelo'],
    queryFn: () => flotaPorModelo(companyId!),
    enabled: companyId !== null && permisos.ver,
    staleTime: 5 * 60_000,
  })

  const filtrados = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return (modelos.data ?? [])
      .filter((m) => familia === '' || m.familia === familia)
      .filter(
        (m) =>
          t === '' ||
          m.codigo.toLowerCase().includes(t) ||
          (m.codigoFabricante ?? '').replace(/\s/g, '').includes(t.replace(/\s/g, '')) ||
          m.accesorios.some((a) => a.nombre.toLowerCase().includes(t) || (a.codigoFabricante ?? '').replace(/\s/g, '').includes(t.replace(/\s/g, ''))),
      )
  }, [modelos.data, familia, texto])

  if (!permisos.ver) {
    return (
      <div className={doc.listado}>
        <PageHeader title="Modelos" />
        <Alert tone="neutral">
          <p>Tu rol no tiene acceso a Mantenimiento.</p>
        </Alert>
      </div>
    )
  }

  return (
    <div className={doc.listado}>
      <PageHeader
        back={{ to: '/mantenimiento/ordenes', label: 'Órdenes' }}
        title="Modelos"
        subtitle={modelos.isPending ? 'Cargando…' : `${(modelos.data ?? []).length} modelos FEIN AccuTec`}
      />

      <div className={styles.accionesFila}>
        <Field label="Familia" hideLabel>
          <Select value={familia} onChange={(e) => setFamilia(e.target.value)}>
            <option value="">Todas las familias</option>
            <option value="ASM">ASM · empuñadura central</option>
            <option value="ASW">ASW · angular</option>
          </Select>
        </Field>
        <Field label="Buscar" hideLabel>
          <Input
            type="search"
            placeholder="Modelo, accesorio o código FEIN"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </Field>
      </div>

      {modelos.error ? (
        <ErrorState title="No se pudieron leer los modelos." description={modelos.error.message} />
      ) : modelos.isPending ? (
        <SkeletonRows rows={6} columns={3} label="Cargando modelos…" />
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon="search"
          title={(modelos.data ?? []).length === 0 ? 'Esta empresa no tiene modelos cargados' : 'Ningún modelo coincide'}
        />
      ) : (
        filtrados.map((m) => (
          <DocSection key={m.id} title={`${m.marca} ${m.codigo}`}>
            <p className={styles.nota}>
              {m.descripcion}
              {m.codigoFabricante ? ` · código ${m.codigoFabricante}` : ''}
              {flota.data ? ` · ${flota.data[m.codigo] ?? 0} en la flota` : ''}
            </p>
            <dl className={styles.especificaciones}>
              <div>
                <dt>Torque</dt>
                <dd>
                  <strong>
                    {formatearNumero(m.torqueMin)}–{formatearNumero(m.torqueMax)} Nm
                  </strong>
                </dd>
              </div>
              {(
                [
                  ['Velocidad', m.velocidad],
                  ['De fábrica', m.velocidadFabrica],
                  ['Peso', m.peso],
                  ['Batería', m.bateria],
                  ['Precisión', m.precision],
                  ['Programación', m.programacion],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {m.usoTipico ? <p className={styles.nota}>Uso típico: {m.usoTipico}.</p> : null}
            {m.accesorios.length > 0 ? (
              <details>
                <summary>Accesorios compatibles ({m.accesorios.length})</summary>
                <ul className={styles.listaChecks}>
                  {m.accesorios.map((a) => (
                    <li key={a.codigo} className={styles.nota}>
                      {a.nombre}
                      {a.codigoFabricante ? <span className={styles.mono}> · {a.codigoFabricante}</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </DocSection>
        ))
      )}
    </div>
  )
}
