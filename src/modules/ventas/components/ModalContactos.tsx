import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/modals/Dialog'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { EditorContactos } from '@/modules/clientes/components/EditorContactos'
import { contactosDeCliente } from '@/modules/clientes/services/clientes'

export interface ModalContactosProps {
  clienteId: string
  /** Para el título: «Contactos de El Gitano». */
  clienteNombre: string
  onCerrar: () => void
}

/**
 * La agenda de contactos del cliente, sin salir del documento (Fase 28 · E14).
 *
 * Antes había que abandonar la cotización a medio cargar, ir a la ficha del
 * cliente, crear el contacto y volver a empezar. Ahora se abre acá.
 *
 * Monta el `EditorContactos` del módulo de Clientes tal cual: crear, editar,
 * marcar el principal y desactivar son de allá y siguen siendo de allá. Una
 * sola definición de cómo se edita un contacto, con su guardado atómico y su
 * testigo de concurrencia — reimplementarlo acá habría sido la segunda.
 *
 * Al cerrar se invalida la lista que usa el selector del documento: si acabás
 * de crear un contacto, tiene que estar para elegirlo.
 */
export function ModalContactos({ clienteId, clienteNombre, onCerrar }: ModalContactosProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const qc = useQueryClient()

  const contactos = useQuery({
    queryKey: ['clientes', companyId, 'contactos', clienteId],
    queryFn: () => contactosDeCliente(companyId!, clienteId),
    enabled: companyId !== null,
    staleTime: 60_000,
  })

  const cerrar = () => {
    void qc.invalidateQueries({ queryKey: ['ventas', companyId, 'contactos', clienteId] })
    onCerrar()
  }

  return (
    <Dialog
      open
      onClose={cerrar}
      title={`Contactos de ${clienteNombre}`}
      description="Lo que crees acá queda en la ficha del cliente y se puede elegir en este documento."
      size="lg"
      footer={
        <Button variant="secondary" onClick={cerrar}>
          Listo
        </Button>
      }
    >
      <EditorContactos
        clienteId={clienteId}
        contactos={contactos.data ?? []}
        cargando={contactos.isPending}
        // Quien puede cargar un documento de venta puede cargarle un contacto
        // al cliente. Lo que de verdad lo impide es `puede_administrar_cliente`
        // en la base: acá no se decide ningún permiso.
        puedeEditar
        onRecargar={() => void contactos.refetch()}
      />
    </Dialog>
  )
}
