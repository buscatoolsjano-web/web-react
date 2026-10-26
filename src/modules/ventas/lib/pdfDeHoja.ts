import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { cortesDePagina } from './paginasPdf'
import type { TipoDocumento } from '../types'

/**
 * La hoja del documento, en PDF (Fase 84).
 *
 * ── POR QUÉ ES UNA FOTO Y NO UN PDF DIBUJADO ────────────────────────────────
 *
 * Lo que se pidió es que el PDF que recibe el cliente salga **igual** que
 * cuando se imprime. Las librerías que dibujan un PDF «de verdad» —pdfmake,
 * pdf-lib— obligan a redibujar la hoja renglón por renglón dentro de la
 * librería: sería una SEGUNDA implementación de la hoja, y a la primera vez
 * que alguien cambie el renglón impreso y se olvide de la otra, el cliente
 * recibe algo distinto de lo que se vio en pantalla. Este código evita eso a
 * propósito desde la Fase 26: hay una sola hoja, y por eso el preview y el
 * papel miden igual.
 *
 * Así que se fotografía la hoja que YA existe, la misma que dibuja
 * `VistaImpresion`, y la foto se reparte en páginas A4. No puede desviarse de
 * lo que se ve, porque es lo que se ve.
 *
 * Lo que cuesta: el texto del PDF no se puede seleccionar ni buscar, es una
 * imagen. La alternativa que sí da texto es renderizar la misma página con un
 * Chrome sin ventana en el servidor; eso necesita tocar el backend y
 * desplegarlo, y queda como el paso siguiente.
 *
 * ── LO QUE NO REPRODUCE ─────────────────────────────────────────────────────
 *
 * En un documento de varias páginas, el navegador al imprimir repite el
 * encabezado de la tabla arriba de cada hoja; la foto no, porque es una sola
 * tirada continua. De una página —el caso de casi todas las cotizaciones— es
 * idéntico.
 */

const A4_ANCHO_MM = 210
const A4_ALTO_MM = 297

/**
 * Cuánto más grande se saca la foto que el tamaño en pantalla.
 *
 * Un A4 son ~794 px de ancho en CSS. Por 2 son 1.588, o sea unos 190 puntos
 * por pulgada: alcanza para que el texto chico de la descripción se lea
 * impreso. Por 3 se vería algo mejor y pesaría el doble, y el tope de
 * adjuntos del mail son 10 MB entre todos.
 */
const ESCALA = 2

/** JPEG y no PNG: la hoja lleva fotos de producto, y en PNG pesan tres veces más. */
const CALIDAD_JPEG = 0.92

const NOMBRE: Record<TipoDocumento, string> = {
  cotizacion: 'Cotizacion',
  pedido: 'Pedido',
  entrega: 'Remito',
}

/** `Cotizacion-COT-BTS00007.pdf`. Sin acentos ni espacios: viaja por mail. */
export function nombreDePdf(tipo: TipoDocumento, numero: string): string {
  const limpio = numero
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
  return `${NOMBRE[tipo]}-${limpio}.pdf`
}

/**
 * Fotografía `nodo` y devuelve el PDF.
 *
 * `nodo` tiene que ser el `div` de la hoja a tamaño real y sin `transform`:
 * una hoja escalada se fotografía borrosa o directamente torcida.
 */
export async function pdfDeHoja(nodo: HTMLElement): Promise<Blob> {
  const lienzo = await html2canvas(nodo, {
    scale: ESCALA,
    // Las fotos de producto vienen de Storage, o sea de otro origen. Sin esto
    // el canvas queda «sucio» y no se puede exportar: el PDF saldría vacío.
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    /*
     * Capturar la hoja ENTERA, no lo que entra en la ventana (Fase 164).
     *
     * La hoja mide un A4 —unos 1.123 px de alto— y la ventana de un portátil
     * suele ser más baja. Por defecto html2canvas arma el clon contra el alto
     * de la VENTANA real, así que lo que caía por debajo —los totales, abajo de
     * todo— salía recortado: el PDF llegaba cortado justo después de la tabla,
     * sin el bloque de Subtotal/Impuestos/TOTAL, y en una sola página corta.
     *
     * Pasándole el alto y ancho del nodo como tamaño de ventana virtual, el
     * clon se dibuja a la altura completa de la hoja y entra todo, pase lo que
     * pase con el tamaño de la ventana de quien la manda.
     */
    width: nodo.offsetWidth,
    height: nodo.offsetHeight,
    windowWidth: nodo.scrollWidth,
    windowHeight: nodo.scrollHeight,
    scrollX: 0,
    scrollY: 0,
  })

  // La escala REAL de la foto, no la pedida: html2canvas la recorta cuando el
  // navegador no da para un lienzo tan grande, y ahí los límites calculados
  // con la escala pedida caerían en cualquier lado.
  const escalaReal = lienzo.width / Math.max(nodo.offsetWidth, 1)
  const arriba = nodo.getBoundingClientRect().top
  const limites = [...nodo.querySelectorAll('tbody tr')].map(
    (fila) => (fila.getBoundingClientRect().bottom - arriba) * escalaReal,
  )

  const altoPagina = lienzo.width * (A4_ALTO_MM / A4_ANCHO_MM)
  const paginas = cortesDePagina(lienzo.height, altoPagina, limites)

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  paginas.forEach((pagina, i) => {
    const alto = Math.round(pagina.hasta - pagina.desde)
    const recorte = document.createElement('canvas')
    recorte.width = lienzo.width
    recorte.height = alto
    const ctx = recorte.getContext('2d')
    if (!ctx) throw new Error('El navegador no pudo preparar la imagen del PDF.')
    // JPEG no tiene transparencia: sin esto, lo que no se dibuja sale negro.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, recorte.width, alto)
    ctx.drawImage(lienzo, 0, Math.round(pagina.desde), lienzo.width, alto, 0, 0, lienzo.width, alto)

    if (i > 0) pdf.addPage('a4', 'portrait')
    const altoMm = (alto / lienzo.width) * A4_ANCHO_MM
    pdf.addImage(recorte.toDataURL('image/jpeg', CALIDAD_JPEG), 'JPEG', 0, 0, A4_ANCHO_MM, altoMm)
  })

  return pdf.output('blob')
}

/**
 * El contenido del archivo en base64, que es como lo quiere el composer.
 *
 * Sin el prefijo `data:…;base64,`: el adjunto lleva sólo los datos.
 */
export function base64DeBlob(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () =>
      resolver(typeof lector.result === 'string' ? (lector.result.split(',')[1] ?? '') : '')
    lector.onerror = () => rechazar(lector.error ?? new Error('No se pudo leer el PDF.'))
    lector.readAsDataURL(blob)
  })
}
