import { useState } from 'react'
import { Input, Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/feedback/Alert'
import type { FormaDePago } from '@/modules/configuracion/services/maestros'
import styles from './SelectorFormaDePago.module.css'

/** El valor del `<option>` que abre el campo para escribir una nueva. */
const AGREGAR = '\u0000agregar'

export interface SelectorFormaDePagoProps {
  /** Lo que tiene el documento HOY. Texto, no un id: ver abajo. */
  valor: string
  opciones: readonly FormaDePago[]
  cargando?: boolean | undefined
  onCambiar: (valor: string) => void
  /**
   * Guardar una opción nueva en el catálogo y devolver su nombre normalizado.
   *
   * Si no viene, no se ofrece agregar. Sirve para las pantallas donde el
   * documento es de sólo lectura.
   */
  onAgregar?: ((nombre: string) => Promise<string>) | undefined
}

/**
 * La forma de pago: un desplegable, no un campo de texto (Fase 68).
 *
 * ── Por qué el valor es TEXTO y no un id ────────────────────────────────────
 *
 * El documento guarda lo que se acordó, no una referencia a una fila que puede
 * cambiar. Si mañana se renombra «30 días» a «30 días F/F», las cotizaciones de
 * marzo tienen que seguir diciendo lo que decían cuando se mandaron. Es el
 * mismo criterio que los `sku_snapshot` de los renglones.
 *
 * Consecuencia práctica: un documento viejo puede tener un texto que ya no está
 * en la lista —se borró la opción, o se escribió a mano antes de que esto
 * existiera—. Ese valor se agrega al desplegable como una opción más, marcada,
 * en vez de desaparecer: perder en silencio lo que decía un documento sería
 * peor que mostrar una opción de más.
 *
 * ── Por qué no un `datalist` ────────────────────────────────────────────────
 *
 * Un `<input list>` da sugerencias pero deja escribir cualquier cosa, que es
 * justo lo que se pidió evitar. Agregar una opción tiene que ser un acto
 * aparte y deliberado, no el resultado de un tipeo.
 */
export function SelectorFormaDePago({
  valor,
  opciones,
  cargando = false,
  onCambiar,
  onAgregar,
}: SelectorFormaDePagoProps) {
  const [agregando, setAgregando] = useState(false)
  const [nuevo, setNuevo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activas = opciones.filter((o) => o.activa)
  // El valor del documento, si ya no está entre las activas. Ver el docblock.
  const huerfano =
    valor !== '' && !activas.some((o) => o.nombre === valor) ? valor : null

  async function guardar() {
    const nombre = nuevo.trim()
    if (nombre === '' || !onAgregar) return
    setGuardando(true)
    setError(null)
    try {
      const guardado = await onAgregar(nombre)
      onCambiar(guardado)
      setAgregando(false)
      setNuevo('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  if (agregando) {
    return (
      <div className={styles.alta}>
        <div className={styles.linea}>
          <Input
            autoFocus
            value={nuevo}
            maxLength={80}
            placeholder="Por ejemplo: 90 días"
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              // Enter guarda y Escape cancela: es un campo solo, meterlo en un
              // formulario aparte enviaría el de la cotización.
              if (e.key === 'Enter') {
                e.preventDefault()
                void guardar()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setAgregando(false)
                setError(null)
              }
            }}
          />
          <Button size="sm" onClick={() => void guardar()} disabled={nuevo.trim() === ''} loading={guardando}>
            Guardar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAgregando(false)
              setError(null)
            }}
            disabled={guardando}
          >
            Cancelar
          </Button>
        </div>
        <p className={styles.ayuda}>Queda guardada para las próximas cotizaciones.</p>
        {error !== null && (
          <Alert tone="danger" role="alert">{error}</Alert>
        )}
      </div>
    )
  }

  return (
    <Select
      value={valor}
      disabled={cargando}
      onChange={(e) => {
        if (e.target.value === AGREGAR) {
          setAgregando(true)
          return
        }
        onCambiar(e.target.value)
      }}
    >
      <option value="">Sin especificar</option>
      {huerfano !== null && <option value={huerfano}>{`${huerfano} (fuera de la lista)`}</option>}
      {activas.map((o) => (
        <option key={o.id} value={o.nombre}>
          {o.nombre}
        </option>
      ))}
      {onAgregar !== undefined && <option value={AGREGAR}>➕ Agregar otra…</option>}
    </Select>
  )
}
