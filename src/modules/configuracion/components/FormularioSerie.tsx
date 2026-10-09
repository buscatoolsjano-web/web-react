import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { StatusMessage } from '@/components/ui/StatusMessage'
import {
  etiquetaTipo,
  TIPOS_CON_SECUENCIA,
  validarSerie,
  vistaPreviaNumero,
  type ErroresSerie,
  type FormularioSerie as Datos,
  type SecuenciaDiagnostico,
  type SerieValida,
} from '../lib/numeracion'
import { Dialogo } from './Dialogo'
import styles from './Configuracion.module.css'

export interface FormularioSerieProps {
  /** La serie a editar, o `null` para dar una de alta. */
  serie: SecuenciaDiagnostico | null
  /**
   * Todas las secuencias de la empresa. Hacen falta dos cosas de acá: el mayor
   * número ya emitido con un prefijo —para avisar antes de viajar al servidor—
   * y si la serie que se está editando es la única predeterminada de su tipo.
   */
  secuencias: readonly SecuenciaDiagnostico[]
  guardando: boolean
  error: string | null
  onGuardar: (v: SerieValida) => void
  onCerrar: () => void
}

/**
 * Alta y edición de una serie de numeración (Fase 58 · E3).
 *
 * EL TIPO Y EL NOMBRE NO SE EDITAN cuando la serie ya existe: juntos con la
 * empresa son la clave primaria de `document_sequences`. Cambiarlos sería
 * borrar una serie y crear otra, y los documentos ya emitidos se quedarían
 * apuntando a un nombre que no existe. Para cambiar un nombre se crea la serie
 * nueva y se deja de usar la vieja.
 *
 * EL PREFIJO SÍ se edita: es lo que se imprime en los números siguientes. Pero
 * el guarda del próximo número se recalcula contra el prefijo NUEVO, porque
 * cambiar el prefijo cambia qué documentos cuentan como ya emitidos.
 */
export function FormularioSerie({ serie, secuencias, guardando, error, onGuardar, onCerrar }: FormularioSerieProps) {
  const esAlta = serie === null

  const [datos, setDatos] = useState<Datos>({
    docType: serie?.docType ?? 'quote',
    serie: serie?.serie ?? '',
    prefijo: serie?.prefijo ?? '',
    relleno: String(serie?.padding ?? 5),
    proximo: String(serie?.proximoNumero ?? 1),
    esDefault: serie?.esDefault ?? false,
    seleccionable: true,
  })
  const [errores, setErrores] = useState<ErroresSerie>({})

  const set = <K extends keyof Datos>(k: K, v: Datos[K]) => setDatos((d) => ({ ...d, [k]: v }))

  /*
   * El mayor ya emitido con EL PREFIJO ESCRITO, no con el de la serie.
   *
   * Y `maxNumero`, no `maxSinAtipicos`: el guarda de la base cuenta todos los
   * números que casan con el patrón, atípicos del import incluidos. Si acá se
   * usara el número «confiable», la pantalla aceptaría algo que el servidor
   * después rechaza.
   */
  const prefijoEscrito = datos.prefijo.trim().toUpperCase()
  const mayorEmitido =
    secuencias.find((s) => s.docType === datos.docType && s.prefijo.toUpperCase() === prefijoEscrito)?.maxNumero ?? null

  /* Desmarcar la única predeterminada dejaría al tipo sin ninguna, y la base lo
     rechaza con `sin_predeterminada`. Mejor no ofrecer el clic. */
  const esUnicaDefault =
    !esAlta &&
    serie.esDefault &&
    secuencias.filter((s) => s.docType === serie.docType).length === 1

  function enviar(e: FormEvent) {
    e.preventDefault()
    const v = validarSerie(datos, mayorEmitido)
    if (!v.ok) {
      setErrores(v.errores)
      return
    }
    setErrores({})
    onGuardar(v.valor)
  }

  return (
    <Dialogo
      titulo={esAlta ? 'Nueva serie de numeración' : `Editar ${serie.serie}`}
      onCerrar={onCerrar}
      bloqueado={guardando}
      pie={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="submit" form="form-serie" disabled={guardando}>
            {guardando ? 'Guardando…' : esAlta ? 'Crear serie' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="form-serie" onSubmit={enviar} noValidate className={styles.formDialogo}>
        <Field label="Tipo de documento" error={errores.docType} help={esAlta ? undefined : 'No se cambia: junto con el nombre identifica la serie.'}>
          <Select value={datos.docType} onChange={(e) => set('docType', e.target.value)} disabled={guardando || !esAlta}>
            {TIPOS_CON_SECUENCIA.map((t) => (
              <option key={t} value={t}>
                {etiquetaTipo(t)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Nombre de la serie"
          error={errores.serie}
          help={esAlta ? 'Cómo se llama esta serie dentro del tipo. Por ejemplo COT-2026.' : 'No se cambia: los documentos emitidos la referencian por este nombre.'}
        >
          <Input type="text" autoComplete="off" maxLength={20} value={datos.serie} onChange={(e) => set('serie', e.target.value)} disabled={guardando || !esAlta} />
        </Field>

        <Field label="Prefijo" error={errores.prefijo} help="Lo que se imprime antes del número. Letras, números y guiones.">
          <Input type="text" autoComplete="off" maxLength={20} value={datos.prefijo} onChange={(e) => set('prefijo', e.target.value)} disabled={guardando} />
        </Field>

        <Field label="Ceros a la izquierda" error={errores.relleno} help="Cuántos dígitos ocupa el número. 5 da 00001; 0 no rellena.">
          <Input type="number" inputMode="numeric" min={0} max={20} value={datos.relleno} onChange={(e) => set('relleno', e.target.value)} disabled={guardando} />
        </Field>

        <Field
          label="Próximo número"
          error={errores.proximo}
          help={
            mayorEmitido === null
              ? 'Todavía no hay documentos emitidos con este prefijo.'
              : `El mayor ya emitido con ${prefijoEscrito} es ${mayorEmitido}: el próximo tiene que ser mayor.`
          }
        >
          <Input type="number" inputMode="numeric" min={1} value={datos.proximo} onChange={(e) => set('proximo', e.target.value)} disabled={guardando} />
        </Field>

        {/* La vista previa, que es lo que de verdad se quiere ver antes de
            guardar: cómo va a salir el próximo documento. */}
        <p className={styles.nota}>
          El próximo documento va a salir <code className={styles.codigo}>{vistaPreviaNumero(datos)}</code>.
        </p>

        <Checkbox
          label="Serie predeterminada de este tipo"
          checked={datos.esDefault}
          disabled={guardando || esUnicaDefault}
          {...(esUnicaDefault ? { help: 'Es la única serie de este tipo, así que tiene que quedar como predeterminada.' } : {})}
          onChange={(e) => set('esDefault', e.target.checked)}
        />

        <Checkbox
          label="Se puede elegir al crear un documento"
          checked={datos.seleccionable}
          disabled={guardando}
          help="Desmarcá esto para las series viejas que sólo quedan para reconocer números ya emitidos."
          onChange={(e) => set('seleccionable', e.target.checked)}
        />

        {error && <StatusMessage tono="error" titulo={error} />}
      </form>
    </Dialogo>
  )
}
