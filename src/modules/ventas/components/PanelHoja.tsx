import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Field } from '@/components/forms/Field'
import { Checkbox, Select } from '@/components/forms/controls'
import {
  FORMATOS,
  OPCIONES_INICIALES,
  type EmpresaImpresion,
  type FormatoImpresion,
  type OpcionesImpresion,
} from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import styles from './PanelHoja.module.css'

/**
 * Cuánto puede agrandarse la hoja más allá de su tamaño real.
 *
 * Un A4 son 210 mm, que en CSS son ~794 px. En una pantalla de 1920 la columna
 * del documento pasa los 1.200, y dejar la hoja en 794 px sería volver a tener
 * gris al costado. Se permite agrandarla —el texto es HTML, escala nítido— pero
 * con tope: al 160 % ya es una hoja de 1.270 px y más grande no ayuda a leer.
 */
const ESCALA_MAXIMA = 1.6

/** El `padding` de `.marco`, en píxeles. Tiene que coincidir con el CSS. */
const PADDING_MARCO = 1

export interface PanelHojaProps {
  /** Para el `aria-label` de la sección. */
  etiqueta: string
  /** Lo que hay que aclarar sobre esta hoja. `null` si no hay nada. */
  aclaracion: string | null
  /** Al lado del editor la hoja A4 no entra a tamaño real: se escala. */
  ajustarAlAncho?: boolean
  /**
   * Las opciones de la hoja, cuando las maneja la pantalla (Fase 28 · E12).
   *
   * Con esto el panel NO dibuja su renglón de controles: los pone la pantalla
   * donde quiera —en el alta, adentro de la barra de acciones—. Sin esto se
   * comporta como siempre y los maneja él.
   */
  opciones?: OpcionesImpresion | undefined
  /** La hoja, armada con las opciones y los datos de empresa que da el panel. */
  children: (opciones: OpcionesImpresion, empresa: EmpresaImpresion) => ReactNode
}

/**
 * La hoja del documento en pantalla, con sus controles y su escala.
 *
 * **Una sola implementación** para los dos usos: el borrador que se está
 * cargando (`VistaPreviaBorrador`) y el documento ya guardado
 * (`VistaPreviaDocumento`). Tener dos era la forma segura de que la previa del
 * alta y la del detalle se vieran distintas — que es justo lo que pasaba antes
 * de la Fase 26, cuando el detalle no tenía hoja y había que abrir el modal de
 * impresión para ver cómo salía.
 *
 * Lo que aporta el panel:
 *
 *  · los controles de **formato** y **precios con impuestos**, que valen para
 *    los dos casos;
 *  · los **datos de la empresa**, con la misma clave de caché que el modal de
 *    impresión: si ya se imprimió algo en esta sesión, no pide nada;
 *  · la **escala**, que sale del ancho disponible.
 *
 * La hoja en sí la arma quien lo usa, con `VistaImpresion`: no hay una
 * plantilla para la pantalla y otra para el papel.
 */
export function PanelHoja({ etiqueta, aclaracion, ajustarAlAncho = false, opciones: opcionesDeAfuera, children }: PanelHojaProps) {
  const { activa } = useEmpresa()
  const [formato, setFormato] = useState<FormatoImpresion>(OPCIONES_INICIALES.formato)
  const [conImpuestos, setConImpuestos] = useState(OPCIONES_INICIALES.preciosConImpuestos)

  // La misma consulta y la misma clave que usa el modal de impresión.
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

  const opciones: OpcionesImpresion = opcionesDeAfuera ?? {
    formato,
    preciosConImpuestos: conImpuestos,
    papel: OPCIONES_INICIALES.papel,
    // Fase 28 · E9: la hoja lleva foto SIEMPRE. El hueco existe en todas las
    // filas aunque el producto no tenga imagen, así todas miden lo mismo.
    conFotos: true,
  }

  /**
   * La hoja ocupa TODO el ancho disponible, y el resto se desplaza
   * (Fase 26 · E1).
   *
   * Antes entraba la página completa: se escalaba por el alto **y** por el
   * ancho, y ganaba el alto. Con una ventana de 900 px eso daba la hoja al
   * 55 %, o sea un A4 de 440 px en una columna de 1.000, con dos franjas grises
   * de 280 px a los costados. El documento quedaba ilegible para que se viera
   * el final.
   *
   * El pedido fue explícito y va al revés: **que sea lo más grande posible,
   * aunque no se vea el largo total de la hoja.** Ahora la escala sale sólo del
   * ancho y el marco desplaza en vertical. Sigue siendo la misma hoja escalada
   * en bloque, sin re-maquetar: es exactamente la que se imprime.
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

    // `clientWidth` incluye el padding del marco (1 px por lado): sin restarlo
    // la hoja escalada sale 2 px más ancha que su caja y aparece un scroll
    // horizontal de dos píxeles.
    const disponible = Math.max(m.clientWidth - PADDING_MARCO * 2, 1)
    setEscala(Math.min(disponible / anchoHoja, ESCALA_MAXIMA))
  }, [])

  useLayoutEffect(medir, [medir, ajustarAlAncho])

  /**
   * Se observan el marco **y la hoja**.
   *
   * La hoja, porque su alto cambia con cada línea que se agrega y con el
   * formato; antes eso se listaba a mano como dependencias del efecto y cada
   * control nuevo había que acordarse de agregarlo. El `transform: scale` no
   * afecta lo que mide el observer —no es layout— así que no hay bucle.
   */
  useEffect(() => {
    const m = marco.current
    const h = hoja.current?.firstElementChild
    if (!m || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(m)
    if (h) ro.observe(h)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [medir])

  return (
    <section className={styles.panel} aria-label={etiqueta}>
      {/* El renglón de controles sólo existe cuando el panel maneja sus
          opciones. Si las pone la pantalla —que las lleva a la barra de
          acciones— acá no queda nada que dibujar, y son 40 px más de hoja. */}
      {opcionesDeAfuera === undefined || aclaracion ? (
        <div className={styles.controles}>
          {opcionesDeAfuera === undefined ? (
            <>
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
            </>
          ) : null}
          {/* La aclaración no puede vivir en un tooltip: el dato hace falta. */}
          {aclaracion ? <span className={styles.aclaracion}>{aclaracion}</span> : null}
        </div>
      ) : null}

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
            {children(opciones, empresa)}
          </div>
        </div>
      </div>
    </section>
  )
}
