import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { cx } from '@/utils/cx'
import { useAtributos } from '../hooks/useMaestros'
import { AUTORIDAD, etiquetaTipoAtributo, filtrarAtributos, mensajeErrorMaestro, type Atributo } from '../lib/maestros'
import { ErrorMaestro } from '../services/maestros'
import styles from '../components/Configuracion.module.css'

const ATRIBUTOS = { singular: 'atributo', plural: 'atributos' }

const codigo = (e: unknown) => (e instanceof ErrorMaestro ? e.codigo : 'desconocido')

/**
 * Configuración → Atributos: SÓLO LECTURA. Muestra la estructura (clave, tipo,
 * filtrable, categorías) y cuántos productos usan cada atributo.
 */
export function AtributosPage() {
  const { activa } = useEmpresa()
  const q = useAtributos()
  const [busqueda, setBusqueda] = useState('')
  const lista = q.data ?? []
  const visibles = filtrarAtributos(lista, busqueda)

  const columnas: Column<Atributo>[] = [
    {
      key: 'atributo',
      header: 'Atributo',
      mobile: 'title',
      render: (a) => (
        <span className={styles.persona}>
          <span className={styles.nombre}>{a.etiqueta}</span>
          <code className={cx(styles.codigo, styles.email)}>{a.clave}</code>
        </span>
      ),
    },
    { key: 'tipo', header: 'Tipo', width: '9rem', render: (a) => etiquetaTipoAtributo(a.tipo, a.unidad) },
    { key: 'filtrable', header: 'Filtro en Catálogo', width: '9rem', render: (a) => (a.filtrable ? 'Sí' : 'No') },
    { key: 'categorias', header: 'Categorías', render: (a) => (a.categorias.length ? a.categorias.join(', ') : '—') },
    { key: 'productos', header: 'Productos', align: 'right', width: '8rem', render: (a) => a.productos.toLocaleString('es-AR') },
  ]

  return (
    <>
      <PageHeader title="Atributos" subtitle={`Características de los productos de ${activa?.companyName ?? 'la empresa'}.`} status={<Badge tone="neutral" outline>Sólo lectura</Badge>} />

      <StatusMessage tono="pending" titulo={AUTORIDAD.atributos.titulo} detalle={AUTORIDAD.atributos.detalle} />

      {q.isError ? (
        <StatusMessage tono="error" titulo={codigo(q.error) === 'sin_permiso' ? 'Tu rol no tiene acceso a los atributos.' : mensajeErrorMaestro(codigo(q.error))} />
      ) : (
        <>
          <div className={styles.barra}>
<Field label="Buscar atributo" hideLabel className={styles.buscar}>
              <Input type="search" placeholder="Buscar por nombre, clave o categoría" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </Field>
            {q.data && <span className={styles.nota}>{visibles.length === lista.length ? contar(lista.length, ATRIBUTOS) : `${visibles.length} de ${lista.length}`}</span>}
          </div>
          <ResponsiveTable
            columns={columnas}
            rows={visibles}
            rowKey={(a) => a.clave}
            isLoading={q.isPending}
            emptyMessage={lista.length === 0 ? 'Esta empresa no tiene atributos definidos.' : 'Ningún atributo coincide con la búsqueda.'}
          />
        </>
      )}
    </>
  )
}
