import { lazy, Suspense, useState } from 'react'
import { IconButton } from '@/components/ui/IconButton'

// El diálogo se descarga recién al abrirlo: no pesa en la carga inicial.
const DialogoApariencia = lazy(() => import('./DialogoApariencia').then((m) => ({ default: m.DialogoApariencia })))

/** Acceso desde el header a «Apariencia». */
export function BotonApariencia({ className }: { className?: string | undefined }) {
  const [abierto, setAbierto] = useState(false)
  const [cargar, setCargar] = useState(false)
  return (
    <>
      <IconButton
        icon="palette"
        aria-label="Apariencia"
        aria-haspopup="dialog"
        className={className}
        onPointerEnter={() => setCargar(true)}
        onFocus={() => setCargar(true)}
        onClick={() => {
          setCargar(true)
          setAbierto(true)
        }}
      />
      {cargar && (
        <Suspense fallback={null}>
          <DialogoApariencia open={abierto} onClose={() => setAbierto(false)} />
        </Suspense>
      )}
    </>
  )
}
