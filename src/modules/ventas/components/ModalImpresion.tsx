import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Icon } from '@/components/icons/Icon'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  construirImprimible,
  FORMATOS,
  OPCIONES_INICIALES,
  type EmpresaImpresion,
  type FormatoImpresion,
  type OpcionesImpresion,
} from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import { fotosDeProductos } from '../services/documentos'
import type { DocumentoDetalle } from '../types'
import { VistaImpresion } from './VistaImpresion'
import styles from './ModalImpresion.module.css'

export interface ModalImpresionProps {
  doc: DocumentoDetalle
  onCerrar: () => void
}

/** Los saltos del zoom manual, como en el sistema anterior. */
/**
 * Cuánto puede agrandarse la hoja al «Ajustar» (Fase 27 · E6).
 *
 * Un A4 son ~794 px. En este modal la previsualización ocupa casi toda la
 * ventana, así que dejarla en su tamaño real volvería a dejar gris al costado.
 * El tope existe para que en una pantalla muy ancha no termine en una hoja de
 * dos metros.
 */
const ESCALA_MAXIMA = 2.5

/** El `padding` de `.previa`, en píxeles. Tiene que coincidir con el CSS. */
const PADDING_PREVIA = 4

/**
 * Los pasos del zoom. Llegan hasta 2,5 porque «Ajustar» ahora puede dar más
 * de 1: con los pasos viejos, tocar «+» después de ajustar ACHICABA la hoja.
 */
const ZOOMS = [0.5, 0.65, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5] as const

/**
 * Vista previa e impresión.
 *
 * Un solo camino para las dos cosas: lo que se ve en el panel es el mismo
 * componente que el navegador manda a la impresora. El legacy generaba un
 * string de HTML y lo escribía en un iframe, con una previsualización que
 * salía de un camino parecido pero no idéntico.
 *
 * Fase 19 · E6 · **la hoja no se adapta a la pantalla: se escala.** El
 * documento mide siempre lo que mide un A4; lo que cambia con el tamaño de la
 * ventana es el `transform: scale` de la previsualización, que no toca la
 * composición. Antes, por debajo de 800 px, la hoja cambiaba de layout y se
 * veía una cosa distinta de la que se imprimía.
 *
 * Al imprimir se marca el `<body>`: la hoja de estilos global esconde todo lo
 * demás y deja sólo el documento.
 */
export function ModalImpresion({ doc, onCerrar }: ModalImpresionProps) {
  const { activa } = useEmpresa()
  const [opciones, setOpciones] = useState<OpcionesImpresion>(OPCIONES_INICIALES)
  const caja = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  // Fase 13: foco adentro, Escape y retorno del foco, sin cambiar la estructura
  // (la hoja de impresión depende de ella).
  useModalAccesible(caja, { onClose: onCerrar })

  const { data: empresaDb } = useQuery({
    queryKey: ['ventas', activa?.companyId, 'empresa-impresion'],
    queryFn: () => datosDeEmpresa(activa!.companyId),
    enabled: !!activa,
    staleTime: 10 * 60_000,
  })

  // Las fotos sólo se piden si el formato las lleva.
  const idsDeProducto = doc.lineas.map((l) => l.productId).filter((x): x is string => x !== null)
  const { data: fotos } = useQuery({
    queryKey: ['ventas', activa?.companyId, 'fotos-impresion', doc.id],
    queryFn: () => fotosDeProductos(activa!.companyId, idsDeProducto),
    enabled: !!activa && opciones.conFotos && idsDeProducto.length > 0,
    staleTime: 10 * 60_000,
  })

  const empresa: EmpresaImpresion = empresaDb ?? {
    nombre: activa?.companyName ?? '',
    razonSocial: null, cuit: null, direccion: null,
    telefono: null, email: null, web: null, color: '#f37021',
  }

  const imprimible = construirImprimible(doc, opciones, fotos)

  // ── La escala de la previsualización ──────────────────────────────────
  //
  // `null` = ajustar a lo que haya; un número = el zoom que pidió la persona.
  const [zoom, setZoom] = useState<number | null>(null)
  const [escala, setEscala] = useState(1)
  const marco = useRef<HTMLDivElement>(null)
  const hoja = useRef<HTMLDivElement>(null)
  /**
   * Lo que mide la hoja SIN escalar, en estado.
   *
   * Se guarda en vez de leerlo del ref al dibujar: durante el render el ref
   * todavía tiene la medida del render anterior, así que la caja de afuera
   * quedaría un paso atrás de la hoja de adentro.
   */
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 })

  // Las medidas reales del papel: de ellas sale dónde corta cada página.
  const papelAncho = opciones.papel === 'carta' ? 216 : 210
  const papelAlto = opciones.papel === 'carta' ? 279 : 297

  const medir = useCallback(() => {
    const m = marco.current
    const h = hoja.current?.firstElementChild as HTMLElement | null
    if (!m || !h) return
    const anchoHoja = h.offsetWidth
    const altoHoja = h.offsetHeight
    if (anchoHoja === 0) return
    setMedida((p) => (p.ancho === anchoHoja && p.alto === altoHoja ? p : { ancho: anchoHoja, alto: altoHoja }))
    /*
     * «Ajustar» = ocupar todo el ANCHO (Fase 27 · E6).
     *
     * Antes entraba una página completa: se medía el ancho y el alto y ganaba
     * el alto, así que en una ventana normal la hoja quedaba al 45 % con dos
     * franjas grises enormes a los costados y la letra ilegible. Es el mismo
     * arreglo que en la vista previa del documento, y por el mismo pedido:
     * grande aunque no entre el largo, que para eso está el scroll.
     *
     * Los botones de zoom siguen: esto es sólo lo que se ve al abrir y lo que
     * hace «Ajustar».
     */
    const cabeEnAncho = (m.clientWidth - PADDING_PREVIA * 2) / anchoHoja
    setEscala(zoom ?? Math.min(cabeEnAncho, ESCALA_MAXIMA))
  }, [zoom])

  useLayoutEffect(medir, [medir, opciones, imprimible.lineas.length])

  useEffect(() => {
    const m = marco.current
    if (!m || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(m)
    return () => ro.disconnect()
  }, [medir])

  const { ancho, alto } = medida

  // Los cortes de página, en píxeles del documento sin escalar.
  const altoPagina = ancho > 0 ? ancho * (papelAlto / papelAncho) : 0
  const cortes =
    altoPagina > 0 && alto > altoPagina
      ? Array.from({ length: Math.ceil(alto / altoPagina) - 1 }, (_, i) => (i + 1) * altoPagina)
      : []

  const cambiarZoom = (paso: number) => {
    const actual = zoom ?? escala
    const i = ZOOMS.findIndex((z) => z >= actual - 0.001)
    const siguiente = ZOOMS[Math.min(Math.max((i < 0 ? ZOOMS.length - 1 : i) + paso, 0), ZOOMS.length - 1)]
    setZoom(siguiente ?? 1)
  }

  const imprimir = () => {
    document.body.dataset['imprimiendo'] = 'si'
    const limpiar = () => {
      delete document.body.dataset['imprimiendo']
      window.removeEventListener('afterprint', limpiar)
    }
    window.addEventListener('afterprint', limpiar)
    window.print()
    // Safari en iOS no siempre dispara `afterprint`; el respaldo evita dejar
    // la aplicación entera oculta.
    setTimeout(limpiar, 3000)
  }

  return (
    <div className={styles.fondo}>
      {/* El tamaño del papel es una opción, y `@page` no se puede cambiar con
          una clase: se inyecta. Los márgenes los pone la página, no la hoja,
          así que en papel el documento no arrastra su propio padding. */}
      <style>{`@page { size: ${opciones.formato === 'ticket' ? '80mm auto' : opciones.papel === 'carta' ? 'Letter' : 'A4'}; margin: ${opciones.formato === 'ticket' ? '4mm' : '12mm'}; }`}</style>
      <div ref={caja} className={styles.caja} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <header className={styles.cabecera} data-no-imprimir>
          <h2 id={idTitulo} className={styles.titulo}>
            Vista previa <span className={styles.ref}>{doc.numero}</span>
          </h2>
          <div className={styles.zoom}>
            <IconButton icon="minus" aria-label="Alejar" onClick={() => cambiarZoom(-1)} />
            <span className={styles.escala}>{Math.round(escala * 100)}%</span>
            <IconButton icon="plus" aria-label="Acercar" onClick={() => cambiarZoom(1)} />
            <Button variant="ghost" size="sm" onClick={() => setZoom(null)}>
              Ajustar
            </Button>
          </div>
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>

        <div className={styles.cuerpo}>
          <aside className={styles.opciones} data-no-imprimir>
            <label className={styles.campo}>
              <span>Formato</span>
              <select
                className={styles.control}
                value={opciones.formato}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, formato: e.target.value as FormatoImpresion }))
                }
              >
                {FORMATOS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={opciones.preciosConImpuestos}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, preciosConImpuestos: e.target.checked }))
                }
              />
              Precios con impuestos incluidos
            </label>

            {/* La foto es del FORMATO, no de cada línea: cuando está activada,
                el hueco existe en todas las filas aunque el producto no tenga
                imagen, y las columnas no se mueven. */}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={opciones.conFotos}
                disabled={opciones.formato === 'ticket'}
                onChange={(e) => setOpciones((o) => ({ ...o, conFotos: e.target.checked }))}
              />
              Con foto del producto
            </label>

            <label className={styles.campo}>
              <span>Papel</span>
              <select
                className={styles.control}
                value={opciones.papel}
                disabled={opciones.formato === 'ticket'}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, papel: e.target.value as 'A4' | 'carta' }))
                }
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="carta">Carta (216 × 279 mm)</option>
              </select>
            </label>

            <Button icon={<Icon name="printer" size={16} />} onClick={imprimir}>
              Imprimir
            </Button>
            <p className={styles.ayuda}>
              Se imprime exactamente lo que se ve. Para guardar un PDF, elegí «Guardar como PDF»
              en el diálogo del navegador.
            </p>
          </aside>

          <div className={styles.previa} data-previa-impresion ref={marco}>
            {/* La caja toma el tamaño YA escalado: así no queda una hoja
                chiquita flotando adentro de un contenedor enorme. */}
            <div
              data-escalador
              className={styles.escalador}
              style={ancho > 0 ? { width: ancho * escala, height: alto * escala } : undefined}
            >
              {/* Dónde corta cada página. Es una guía de la vista previa, no
                  parte del documento: no se imprime ni vive dentro de la hoja. */}
              {cortes.map((y) => (
                <div key={y} className={styles.corte} style={{ top: y * escala }} />
              ))}
              <div
                ref={hoja}
                data-en-escala
                className={styles.enEscala}
                style={{ transform: `scale(${escala})` }}
              >
                <VistaImpresion doc={imprimible} empresa={empresa} opciones={opciones} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
