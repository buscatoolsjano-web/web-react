/**
 * Importar la orden de compra del cliente: leer el PDF (Fase 30 · E4).
 *
 * Recibe el archivo, le saca el texto, se lo da al proveedor de IA y devuelve
 * la orden ya VALIDADA. No escribe nada en la base: guardar es otra decisión y
 * la toma la persona después de revisar, con `importar_oc`.
 *
 * Esta función es la frontera con el mundo —HTTP, secrets, el PDF—. Todo lo
 * que se puede decidir sin eso vive en `logica.ts`, que corre en vitest.
 */
import { extractText, getDocumentProxy } from 'npm:unpdf@1.3.2'
import {
  MAX_BYTES_PDF,
  OcInvalida,
  PdfIlegible,
  revisarTextoPdf,
  validarOcExtraida,
} from './logica.ts'
import { FalloProveedor, proveedorConfigurado } from './proveedor.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

/** Un error que la pantalla puede mostrar tal cual. */
const falla = (motivo: string, mensaje: string, status = 400) =>
  json({ error: { motivo, mensaje } }, status)

/**
 * El texto del PDF.
 *
 * `unpdf` se eligió porque corre en un runtime de edge sin binarios nativos
 * —trae su propia build de pdf.js—, que es la condición que descarta a casi
 * todas las librerías de PDF de Node.
 */
async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  try {
    const doc = await getDocumentProxy(bytes)
    const { text } = await extractText(doc, { mergePages: true })
    return typeof text === 'string' ? text : text.join('\n')
  } catch {
    // No se filtra el error de la librería: no le dice nada a nadie y puede
    // traer pedazos del documento.
    throw new PdfIlegible('ilegible', 'No se pudo abrir el PDF. ¿Está completo?')
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  /**
   * GET: en qué estado está la lectura, sin procesar nada.
   *
   * Es lo que le permite a la pantalla mostrar «IA activa» y que sea verdad.
   * Un cartel que dice que la IA está encendida cuando no lo está es peor que
   * no tener cartel: manda a probar y a no entender por qué salen datos de
   * demo. No se devuelve la clave ni el modelo, sólo si está configurado.
   */
  if (req.method === 'GET') {
    const p = proveedorConfigurado()
    return json({ proveedor: p.nombre, listo: p.nombre !== 'falso' })
  }
  if (req.method !== 'POST') return falla('metodo', 'Sólo GET o POST.', 405)

  try {
    const form = await req.formData()
    const archivo = form.get('archivo')

    if (!(archivo instanceof File)) {
      return falla('sin_archivo', 'No llegó ningún archivo.')
    }
    if (archivo.size > MAX_BYTES_PDF) {
      return falla('demasiado_grande', 'El PDF pesa más de 15 MB.')
    }
    // Se mira el tipo Y los primeros bytes: el navegador manda el content-type
    // que dice el sistema operativo, y un .pdf renombrado pasaría igual.
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const firma = new TextDecoder().decode(bytes.slice(0, 5))
    if (firma !== '%PDF-') {
      return falla('no_es_pdf', 'El archivo no es un PDF.')
    }

    const texto = revisarTextoPdf(await textoDelPdf(bytes))

    const proveedor = proveedorConfigurado()
    const crudo = await proveedor.leer(texto)
    const oc = validarOcExtraida(crudo)

    return json({
      ...oc,
      // El texto crudo viaja de vuelta para guardarlo con la OC: es lo que
      // permite revisar después sin volver a abrir el PDF.
      texto,
      proveedor: proveedor.nombre,
    })
  } catch (e) {
    if (e instanceof PdfIlegible) return falla(e.motivo, e.message)
    if (e instanceof OcInvalida) return falla(e.motivo, `No se pudo leer la orden: ${e.message}`)
    if (e instanceof FalloProveedor) {
      const mensajes: Record<string, string> = {
        sin_configurar: 'La lectura con IA no está configurada en este entorno.',
        rechazo: 'El proveedor de IA rechazó el pedido.',
        limite: 'El proveedor de IA está al límite de uso. Probá de nuevo en un rato.',
        caido: 'No se pudo contactar al proveedor de IA.',
        truncado: 'La orden es demasiado larga y la respuesta quedó cortada.',
        refusal: 'El proveedor de IA declinó leer este documento.',
      }
      return falla(e.motivo, mensajes[e.motivo] ?? 'El proveedor de IA falló.', 502)
    }
    return falla('error_interno', 'No se pudo leer el PDF.', 500)
  }
})
