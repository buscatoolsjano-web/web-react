import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Field } from '@/components/forms/Field'
import { Checkbox, Select } from '@/components/forms/controls'
import { useState } from 'react'
import {
  FORMATOS,
  OPCIONES_INICIALES,
  imprimibleDelBorrador,
  type FormatoImpresion,
  type EmpresaImpresion,
} from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import { VistaImpresion } from './VistaImpresion'
import type { LineaDocumento, TipoDocumento } from '../types'
import styles from './VistaPreviaBorrador.module.css'

export interface VistaPreviaBorradorProps {
  tipo: TipoDocumento
  fecha: string
  cliente: string
  contacto: string | null
  moneda: string | null
  formaPago: string | null
  notas: string | null
  lineas: readonly LineaDocumento[]
  /** Al lado del editor la hoja A4 no entra a tamaño real: se achica. */
  ajustarAlAncho?: boolean
}


/**
 * El documento como va a salir, mientras se lo está cargando (Fase 19 · E3).
 *
 * **No guarda nada para mostrarse.** Se arma desde el borrador que está en
 * memoria, con el MISMO `VistaImpresion` que usa la impresión del documento ya
 * creado: no hay una plantilla para la pantalla y otra para el papel, que es
 * como el legacy terminaba mostrando una cosa e imprimiendo otra.
 *
 * Lo que no puede mostrar, lo dice: el número lo asigna el servidor al crear,
 * y el total definitivo también —con el descuento global y la percepción—.
 */
export function VistaPreviaBorrador({
  tipo,
  fecha,
  cliente,
  contacto,
  moneda,
  formaPago,
  notas,
  lineas,
  ajustarAlAncho = false,
}: VistaPreviaBorradorProps) {
  const { activa } = useEmpresa()
  const [formato, setFormato] = useState<FormatoImpresion>(OPCIONES_INICIALES.formato)
  const [conImpuestos, setConImpuestos] = useState(OPCIONES_INICIALES.preciosConImpuestos)

  // La misma consulta y la misma clave que usa el modal de impresión: si ya se
  // imprimió algo en esta sesión, la vista previa no pide nada.
  const { data: empresaDb } = useQuery({
    queryKey: ['ventas', activa?.companyId, 'empresa-impresion'],
    queryFn: () => datosDeEmpresa(activa!.companyId),
    enabled: activa?.companyId !== undefined,
    staleTime: 10 * 60_000,
  })

  const empresa: EmpresaImpresion = empresaDb ?? {
    nombre: activa?.companyName ?? 'Empresa',
    razonSocial: null,
    cuit: null,
    direccion: null,
    telefono: null,
    email: null,
    web: null,
    color: '#1f2937',
  }

  const opciones = { formato, preciosConImpuestos: conImpuestos, papel: OPCIONES_INICIALES.papel }
  const doc = imprimibleDelBorrador(tipo, { fecha, cliente, contacto, moneda, formaPago, notas, lineas }, opciones)

  return (
    <section className={styles.panel} aria-label="Vista previa del documento">
      <div className={styles.controles}>
        <Field label="Formato" hideLabel>
          <Select value={formato} onChange={(e) => setFormato(e.target.value as FormatoImpresion)}>
            {FORMATOS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label="Precios con impuestos"
          checked={conImpuestos}
          onChange={(e) => setConImpuestos(e.target.checked)}
        />
      </div>

      <p className={styles.aclaracion}>
        Así va a salir. El número y el total definitivo los pone el servidor al crear el documento.
      </p>

      <div className={ajustarAlAncho ? `${styles.hoja} ${styles.achicada}` : styles.hoja}>
        <VistaImpresion doc={doc} empresa={empresa} opciones={opciones} />
      </div>
    </section>
  )
}
