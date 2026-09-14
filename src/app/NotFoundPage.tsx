import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { EmptyState } from '@/components/feedback/EmptyState'

/** 404 dentro del shell: con header y navegación para seguir trabajando. */
export function NotFoundPage() {
  const navegar = useNavigate()
  return (
    <EmptyState
      headingLevel={1}
      icon="search"
      title="No encontramos esta pantalla"
      description="La dirección no existe o cambió. Podés volver al inicio o elegir un módulo en el menú."
      action={
        <Button icon={<Icon name="home" size={16} />} onClick={() => void navegar('/')}>
          Ir al inicio
        </Button>
      }
    />
  )
}
