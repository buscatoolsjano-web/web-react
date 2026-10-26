import { Field } from '@/components/forms/Field'
import { Input, Textarea, Checkbox } from '@/components/forms/controls'
import {
  BLOQUES,
  COLUMNAS,
  type ClaveBloque,
  type ClaveColumna,
  type ConfigPlantilla,
} from '../lib/plantillas'
import styles from './EditorPlantilla.module.css'

export interface EditorPlantillaProps {
  nombre: string
  config: ConfigPlantilla
  onNombre: (v: string) => void
  onConfig: (c: ConfigPlantilla) => void
}

/**
 * El formulario de una plantilla de impresión (Fase 152).
 *
 * Elige qué columnas de producto se ven, qué bloques de la hoja aparecen, el
 * título propio y los textos de encabezado y pie. Es puro de presentación: no
 * guarda nada ni sabe de la base; sube los cambios y la pantalla que lo usa
 * —la de impresión o la de Configuración— decide cuándo persistir.
 */
export function EditorPlantilla({ nombre, config, onNombre, onConfig }: EditorPlantillaProps) {
  const setColumna = (clave: ClaveColumna, visible: boolean) =>
    onConfig({ ...config, columnas: { ...config.columnas, [clave]: visible } })
  const setBloque = (clave: ClaveBloque, visible: boolean) =>
    onConfig({ ...config, bloques: { ...config.bloques, [clave]: visible } })

  return (
    <div className={styles.form}>
      <Field label="Nombre de la plantilla" required>
        <Input value={nombre} onChange={(e) => onNombre(e.target.value)} placeholder="Ej.: Remito sin precios" />
      </Field>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Columnas de los productos</legend>
        <p className={styles.nota}>Referencia, Nombre y Unidades van siempre.</p>
        <div className={styles.checks}>
          {COLUMNAS.map((c) => (
            <Checkbox
              key={c.clave}
              label={c.etiqueta}
              checked={config.columnas[c.clave]}
              onChange={(e) => setColumna(c.clave, e.target.checked)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Bloques de la hoja</legend>
        <div className={styles.checks}>
          {BLOQUES.map((b) => (
            <Checkbox
              key={b.clave}
              label={b.etiqueta}
              checked={config.bloques[b.clave]}
              onChange={(e) => setBloque(b.clave, e.target.checked)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Textos</legend>
        <Field label="Título de la hoja" optional help="Si lo dejás vacío, usa el del tipo de documento (p. ej. NOTA DE ENTREGA).">
          <Input
            value={config.titulo ?? ''}
            onChange={(e) => onConfig({ ...config, titulo: e.target.value === '' ? null : e.target.value })}
            placeholder="Dejar vacío para el título por defecto"
          />
        </Field>
        <Field label="Encabezado" optional help="Un texto que sale arriba de los productos.">
          <Textarea
            rows={2}
            value={config.encabezado ?? ''}
            onChange={(e) => onConfig({ ...config, encabezado: e.target.value === '' ? null : e.target.value })}
          />
        </Field>
        <Field label="Pie" optional help="Un texto que sale al final de la hoja.">
          <Textarea
            rows={2}
            value={config.pie ?? ''}
            onChange={(e) => onConfig({ ...config, pie: e.target.value === '' ? null : e.target.value })}
          />
        </Field>
      </fieldset>
    </div>
  )
}
