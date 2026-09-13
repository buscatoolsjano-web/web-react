import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { actividadACsv, descargarCsv, nombreArchivo, pipelineACsv } from '../lib/csv'
import { obtenerActividad, obtenerPipeline } from '../services/actividad'
import styles from './Informes.module.css'

type Tipo = 'actividad' | 'pipeline'

interface Props {
  /** `YYYY-MM` elegido en la URL, o `null` = mes en curso. */
  mes: string | null
  mesEfectivo: string
}

/**
 * Un solo botón para los dos informes agregados (actividad; pipeline,
 * conversión y cumplimiento). Pide las filas al servidor con el mes elegido en
 * el momento del clic: el archivo trae lo mismo que la pantalla, completo. El
 * ranking tiene su propio botón, al lado de sus filtros.
 */
export function ExportarInforme({ mes, mesEfectivo }: Props) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const [tipo, setTipo] = useState<Tipo>('actividad')
  const exportar = useMutation({
    mutationFn: async (t: Tipo) =>
      t === 'actividad'
        ? { nombre: nombreArchivo(['actividad', mesEfectivo]), csv: actividadACsv(await obtenerActividad(companyId!, mes)) }
        : { nombre: nombreArchivo(['pipeline-conversion-cumplimiento', mesEfectivo]), csv: pipelineACsv(await obtenerPipeline(companyId!, mes)) },
    onSuccess: ({ nombre, csv }) => descargarCsv(nombre, csv),
  })

  return (
    <div className={styles.exportar}>
      <label className={styles.control}>
        <span className={styles.controlEtiqueta}>Exportar</span>
        <select className={styles.select} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
          <option value="actividad">Actividad comercial</option>
          <option value="pipeline">Pipeline, conversión y cumplimiento</option>
        </select>
      </label>
      <button
        type="button"
        className={styles.boton}
        disabled={exportar.isPending || companyId === null}
        onClick={() => exportar.mutate(tipo)}
        aria-label={`Descargar CSV de ${tipo === 'actividad' ? 'actividad comercial' : 'pipeline, conversión y cumplimiento'}`}
      >
        {exportar.isPending ? 'Exportando…' : 'CSV'}
      </button>
      {exportar.error ? (
        <span className={styles.errorEnLinea} role="alert">No se pudo exportar: {exportar.error.message}</span>
      ) : null}
    </div>
  )
}
