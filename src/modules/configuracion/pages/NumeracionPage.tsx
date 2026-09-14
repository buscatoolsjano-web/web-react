import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { useNumeracion } from '../hooks/useEmpresaConfig'
import { alertas, etiquetaTipo, formatearNumero, presentarAutoridad, presentarEmision, presentarEstado, type SecuenciaDiagnostico } from '../lib/numeracion'
import styles from '../components/Configuracion.module.css'

/**
 * Configuración → Numeración: SÓLO LECTURA.
 *
 * Muestra cada secuencia contra los documentos que hay en esta base. No hay
 * botones para cambiar prefijos, próximos números, resetear ni cambiar la
 * autoridad: mientras STEL siga emitiendo, alinear la numeración es una
 * decisión de cutover.
 */
export function NumeracionPage() {
  const { activa } = useEmpresa()
  const q = useNumeracion()
  const lista = q.data ?? []

  const columnas: Column<SecuenciaDiagnostico>[] = [
    {
      key: 'tipo',
      header: 'Tipo de documento',
      mobile: 'title',
      render: (s) => (
        <span className={styles.persona}>
          <span className={styles.nombre}>{etiquetaTipo(s.docType)}</span>
          <span className={styles.email}>
            Prefijo {s.prefijo}
            {s.serie && s.serie !== s.prefijo ? ` · serie ${s.serie}` : ''}
            {s.esDefault ? '' : ' · no predeterminada'}
          </span>
        </span>
      ),
    },
    { key: 'proximo', header: 'Próximo (servidor)', render: (s) => <code className={styles.codigo}>{s.proximo}</code> },
    {
      key: 'max',
      header: 'Mayor existente',
      render: (s) =>
        s.maxSinAtipicos === null ? (
          '—'
        ) : (
          <span>
            <code className={styles.codigo}>{formatearNumero(s, s.maxSinAtipicos)}</code>
            {s.atipicosPorEncima > 0 && (
              <span className={styles.email}> (+{s.atipicosPorEncima} atípicos, hasta {formatearNumero(s, s.maxNumero)})</span>
            )}
          </span>
        ),
    },
    {
      key: 'docs',
      header: 'Documentos',
      align: 'right',
      render: (s) => (
        <span>
          {s.documentos.toLocaleString('es-AR')}
          {s.fueraPatron > 0 && <span className={styles.email}> ({s.fueraPatron} fuera de patrón)</span>}
        </span>
      ),
    },
    { key: 'estado', header: 'Estado', render: (s) => <Chip p={presentarEstado(s)} /> },
    {
      key: 'autoridad',
      header: 'Autoridad',
      render: (s) => (
        <span className={styles.chips}>
          <Chip p={presentarAutoridad(s.autoridad)} />
          {s.autoridad === 'STEL' && <Chip p={presentarEmision(s.autoridad)} />}
        </span>
      ),
    },
  ]

  return (
    <>
      <div className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Numeración</h1>
          <p className={styles.subtitulo}>Secuencias de {activa?.companyName ?? 'la empresa'} comparadas con los documentos de esta base.</p>
        </div>
      </div>

      <StatusMessage
        tono="pending"
        titulo="Sólo lectura"
        detalle="No se pueden cambiar prefijos ni próximos números desde acá. Mientras STEL siga emitiendo cotizaciones, pedidos y remitos, alinear la numeración queda para el cutover."
      />

      {q.isError ? (
        <StatusMessage tono="error" titulo={q.error.message === 'sin_permiso' ? 'Tu rol no tiene acceso a la numeración.' : 'No se pudo leer la numeración.'} />
      ) : (
        <>
          {alertas(lista).map((a) => (
            <p key={a} className={styles.alerta} role="note">
              {a}
            </p>
          ))}
          <ResponsiveTable
            columns={columnas}
            rows={lista}
            rowKey={(s) => `${s.docType}:${s.serie}`}
            isLoading={q.isPending}
            emptyMessage="Esta empresa no tiene secuencias configuradas."
            renderCard={(s) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  {columnas[0]!.render!(s)}
                  <Chip p={presentarEstado(s)} />
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Próximo</dt>
                  <dd>
                    <code className={styles.codigo}>{s.proximo}</code>
                  </dd>
                  <dt>Mayor existente</dt>
                  <dd>{columnas[2]!.render!(s)}</dd>
                  <dt>Documentos</dt>
                  <dd>{columnas[3]!.render!(s)}</dd>
                  <dt>Autoridad</dt>
                  <dd>
                    <Chip p={presentarAutoridad(s.autoridad)} />
                  </dd>
                  <dt>Estado de emisión</dt>
                  <dd>
                    <Chip p={presentarEmision(s.autoridad)} />
                  </dd>
                </dl>
                <p className={styles.nota}>{presentarEstado(s).detalle}</p>
              </article>
            )}
          />
          <p className={styles.nota}>
            «Autoridad» viene de la base y no se edita desde acá: donde dice STEL, la base bloquea la emisión desde el ERP y
            sólo un cutover auditado la pasa a ERP. Los tipos sin autoridad configurada los numera el ERP. «Atípicos» son
            números mal tipeados marcados en la importación; no se tienen en cuenta para el estado.
          </p>
        </>
      )}
    </>
  )
}

function Chip({ p }: { p: { etiqueta: string; tono: string; detalle: string } }) {
  return (
    <span className={cx(styles.chip, styles[`tono_${p.tono}`])} title={p.detalle}>
      {p.etiqueta}
    </span>
  )
}
