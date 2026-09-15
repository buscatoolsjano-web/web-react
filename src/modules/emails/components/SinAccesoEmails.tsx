import { PageHeader } from '@/components/layout/PageHeader'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'

/** El rol no tiene la bandeja: mismo texto en las cuatro páginas del módulo. */
export function SinAccesoEmails({ titulo }: { titulo: string }) {
  return (
    <div className={doc.listado}>
      <PageHeader title={titulo} />
      <EmptyState icon="mail" title="Sin acceso a la bandeja" description="Tu rol en esta empresa no tiene acceso a la bandeja de correo." />
    </div>
  )
}
