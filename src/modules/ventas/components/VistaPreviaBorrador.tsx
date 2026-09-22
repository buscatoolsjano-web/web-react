import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Field } from '@/components/forms/Field'
import { Checkbox, Select } from '@/components/forms/controls'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  FORMATOS,
  OPCIONES_INICIALES,
  imprimibleDelBorrador,
  type FormatoImpresion,
  type EmpresaImpresion,
} from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import { VistaImpresion, type EdicionEnHoja } from './VistaImpresion'
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
  /** Si viene, la hoja se puede editar (Fase 22 · A3). */
  edicion?: EdicionEnHoja | null
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
  edicion = null,
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

  const opciones = { formato, preciosConImpuestos: conImpuestos, papel: OPCIONES_INICIALES.papel, conFotos: false }

  /**
   * La hoja entra ENTERA, y la escala se mide (Fase 22 · A2).
   *
   * Antes era `scale(0.66)` fijo dentro de una caja con `max-height` y
   * scroll: a 1600×805 se veía la mitad de arriba de la hoja y para saber
   * cómo terminaba había que scrollear dentro de la previa. Una vista previa
   * que no muestra el final del documento no previsualiza nada.
   *
   * Ahora se mide el hueco disponible —ancho de la columna y alto hasta el
   * borde de la ventana— y se escala la hoja para que la PÁGINA entre
   * completa. Se escala en bloque, sin re-maquetar: sigue siendo exactamente
   * la misma hoja que se imprime.
   */
  const marco = useRef<HTMLDivElement | null>(null)
  const hoja = useRef<HTMLDivElement | null>(null)
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 })
  const [escala, setEscala] = useState(1)

  const medir = useCallback(() => {
    const m = marco.current
    const h = hoja.current?.firstElementChild as HTMLElement | null
    if (!m || !h) return
    const anchoHoja = h.offsetWidth
    const altoHoja = h.offsetHeight
    if (anchoHoja === 0) return
    setMedida((p) => (p.ancho === anchoHoja && p.alto === altoHoja ? p : { ancho: anchoHoja, alto: altoHoja }))

    // El alto de UNA página: con 33 líneas, entrar el documento entero
    // significaría mirarlo al 30 %. Entra la página; el resto se desplaza.
    const altoDePagina = anchoHoja * (297 / 210)
    // El hueco disponible es el del MARCO, que el CSS ya acota al alto de la
    // ventana menos el header. Medir la posición del momento daba una hoja
    // chiquita: en la primera pantalla la columna arranca 400 px abajo, y la
    // hoja terminaba al 41 % para entrar en lo que sobraba.
    const disponibleAlto = Math.max(m.clientHeight - 16, 320)
    const cabeEnAncho = m.clientWidth / anchoHoja
    const cabeEnAlto = disponibleAlto / Math.min(altoHoja, altoDePagina)
    setEscala(Math.min(cabeEnAncho, cabeEnAlto, 1))
  }, [])

  useLayoutEffect(medir, [medir, ajustarAlAncho, lineas.length, formato, conImpuestos])

  useEffect(() => {
    const m = marco.current
    if (!m || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(m)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [medir])
  const doc = imprimibleDelBorrador(tipo, { fecha, cliente, contacto, moneda, formaPago, notas, lineas }, opciones)

  return (
    <section className={styles.panel} aria-label={edicion ? 'Documento' : 'Vista previa del documento'}>
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
        {/* La aclaración va en la MISMA línea que los controles: sacarla
            ganaba 28 px de hoja, pero el dato —que el número y el total los
            pone el servidor— hace falta y no puede vivir en un tooltip. */}
        <span className={styles.aclaracion}>
          El número y el total definitivo los pone el servidor al crear el documento.
        </span>
      </div>

      <div className={styles.marco} ref={marco}>
        {/* La caja toma el tamaño YA escalado: sin esto queda una hoja chica
            flotando dentro de un contenedor enorme, con un hueco abajo. */}
        <div
          className={styles.escalador}
          style={ajustarAlAncho && medida.ancho > 0 ? { width: medida.ancho * escala, height: medida.alto * escala } : undefined}
        >
          <div
            ref={hoja}
            className={styles.enEscala}
            style={ajustarAlAncho ? { transform: `scale(${escala})` } : undefined}
          >
            <VistaImpresion doc={doc} empresa={empresa} opciones={opciones} edicion={edicion} />
          </div>
        </div>
      </div>
    </section>
  )
}
