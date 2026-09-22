import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Select } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { actividadACsv, descargarCsv, documentosACsv, nombreArchivo, pipelineACsv } from '../lib/csv'
import { obtenerActividad, obtenerPipeline } from '../services/actividad'
import { obtenerDocumentosInforme, type FiltrosDocumentosInforme } from '../services/documentos'
import styles from './Informes.module.css'

type Tipo = 'documentos' | 'actividad' | 'pipeline'

interface Props {
  /** `YYYY-MM` elegido en la URL, o `null` = mes en curso. */
  mes: string | null
  mesEfectivo: string
  /**
   * El universo que el usuario está viendo (Fase 21 · E3.1).
   *
   * El export de documentos usa EXACTAMENTE estos filtros contra la misma
   * función del servidor que alimenta la sección Documentos. Así la cantidad
   * y la suma del archivo son las que muestra la pantalla, sin reconstruir
   * ninguna regla comercial en el navegador.
   */
  universo: FiltrosDocumentosInforme | null
  etiquetaUniverso: string
}

/**
 * Un solo botón para los dos informes agregados (actividad; pipeline,
 * conversión y cumplimiento). Pide las filas al servidor con el mes elegido en
 * el momento del clic: el archivo trae lo mismo que la pantalla, completo. El
 * ranking tiene su propio botón, al lado de sus filtros.
 *
 * Fase 13 · E5: sólo la presentación (Field + Button); la generación del CSV
 * es la misma.
 */
export function ExportarInforme({ mes, mesEfectivo, universo, etiquetaUniverso }: Props) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const [tipo, setTipo] = useState<Tipo>('documentos')
  const exportar = useMutation({
    mutationFn: async (t: Tipo) => {
      if (t === 'documentos') {
        if (!universo) throw new Error('todavía no se sabe qué período mostrar')
        // Se pide TODO el universo, no la página visible: el archivo es para
        // trabajarlo en una planilla, no para mirar cincuenta filas.
        const pagina = await obtenerDocumentosInforme(companyId!, universo, 5000, 0)
        return { nombre: nombreArchivo(['documentos', universo.tipo, universo.moneda, mesEfectivo]), csv: documentosACsv(pagina.filas) }
      }
      return t === 'actividad'
        ? { nombre: nombreArchivo(['actividad', mesEfectivo]), csv: actividadACsv(await obtenerActividad(companyId!, mes)) }
        : { nombre: nombreArchivo(['pipeline-conversion-cumplimiento', mesEfectivo]), csv: pipelineACsv(await obtenerPipeline(companyId!, mes)) }
    },
    onSuccess: ({ nombre, csv }) => descargarCsv(nombre, csv),
  })

  return (
    <div className={styles.exportar}>
      <Field label="Exportar">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
          <option value="documentos">Documentos · {etiquetaUniverso}</option>
          <option value="actividad">Actividad comercial (todo)</option>
          <option value="pipeline">Pipeline, conversión y cumplimiento</option>
        </Select>
      </Field>
      <Button
        variant="secondary"
        icon={<Icon name="download" size={16} />}
        loading={exportar.isPending}
        disabled={companyId === null}
        onClick={() => exportar.mutate(tipo)}
        aria-label={`Descargar CSV de ${tipo === 'actividad' ? 'actividad comercial' : 'pipeline, conversión y cumplimiento'}`}
      >
        {exportar.isPending ? 'Exportando…' : 'CSV'}
      </Button>
      {exportar.error ? (
        <span className={styles.errorEnLinea} role="alert">
          No se pudo exportar: {exportar.error.message}
        </span>
      ) : null}
    </div>
  )
}
