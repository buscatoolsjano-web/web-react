/**
 * Lector MIME SÓLO PARA TESTS.
 *
 * Convierte el mensaje crudo que arma `construirMime` en la forma que devuelve
 * Gmail con `format=full` (payload, headers, parts, body.data / attachmentId).
 * Sirve para dos cosas: que el Gmail falso se comporte como el real, y probar ida
 * y vuelta que lo que se construye se lee igual.
 *
 * No es un parser MIME general: entiende lo que produce nuestro constructor
 * (CRLF, base64, boundaries entre comillas, encoded-words B).
 */

export interface ParteLeida {
  partId: string
  mimeType: string
  filename: string
  headers: Array<{ name: string; value: string }>
  body: { size: number; data?: string; attachmentId?: string }
  parts?: ParteLeida[]
}

export function decodificarPalabras(v: string): string {
  return v
    .replace(/\?=\r\n\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_m, b64: string) => Buffer.from(b64, 'base64').toString('utf8'))
}

function separarCabeceras(
  bloque: string,
  decodificar = true,
): { headers: Array<{ name: string; value: string }>; cuerpo: string } {
  const i = bloque.indexOf('\r\n\r\n')
  const cabeza = i >= 0 ? bloque.slice(0, i) : bloque
  const cuerpo = i >= 0 ? bloque.slice(i + 4) : ''
  const headers: Array<{ name: string; value: string }> = []
  for (const linea of cabeza.split('\r\n')) {
    if (/^[ \t]/.test(linea) && headers.length > 0) {
      headers[headers.length - 1]!.value += '\r\n' + linea
    } else {
      const j = linea.indexOf(':')
      if (j > 0) headers.push({ name: linea.slice(0, j), value: linea.slice(j + 1).trim() })
    }
  }
  // Gmail entrega las cabeceras con las encoded-words ya decodificadas.
  for (const x of headers) {
    if (decodificar && /=\?UTF-8\?B\?/i.test(x.value) && !/^content-/i.test(x.name)) {
      x.value = decodificarPalabras(x.value).replace(/\r\n\s+/g, '')
    }
  }
  return { headers, cuerpo }
}

const h = (hs: Array<{ name: string; value: string }>, n: string) =>
  hs.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? ''

export function leerMime(
  raw: Buffer,
  registrarAdjunto: (partId: string, bytes: Buffer) => string,
): { headers: Array<{ name: string; value: string }>; payload: ParteLeida } {
  const texto = raw.toString('utf8')
  const leer = (bloque: string, partId: string): ParteLeida => {
    const { headers, cuerpo } = separarCabeceras(bloque)
    const ct = h(headers, 'Content-Type')
    const mimeType = (ct.split(';')[0] ?? '').trim().toLowerCase()
    const disp = h(headers, 'Content-Disposition')
    const filenameEstrella = /filename\*=UTF-8''([^;\r\n]+)/i.exec(disp)?.[1]
    const filename = filenameEstrella ? decodeURIComponent(filenameEstrella) : (/filename="([^"]*)"/i.exec(disp)?.[1] ?? '')
    if (mimeType.startsWith('multipart/')) {
      const limite = /boundary="([^"]+)"/i.exec(ct)?.[1] ?? ''
      const trozos = cuerpo.split(`--${limite}`).slice(1)
      const parts: ParteLeida[] = []
      for (const t of trozos) {
        if (t.startsWith('--')) break
        const contenido = t.replace(/^\r\n/, '').replace(/\r\n$/, '')
        parts.push(leer(contenido, partId === '' ? String(parts.length) : `${partId}.${parts.length}`))
      }
      return { partId, mimeType, filename, headers, body: { size: 0 }, parts }
    }
    const bytes = Buffer.from(cuerpo.replace(/\r\n/g, ''), 'base64')
    if (filename) {
      return { partId, mimeType, filename, headers, body: { size: bytes.length, attachmentId: registrarAdjunto(partId, bytes) } }
    }
    return { partId, mimeType, filename, headers, body: { size: bytes.length, data: bytes.toString('base64url') } }
  }
  const payload = leer(texto, '')
  return { headers: payload.headers, payload }
}

/** La cabecera TAL COMO VIAJA (sin decodificar encoded-words), para verificar el formato. */
export function cabecera(raw: Buffer, nombre: string): string {
  const { headers } = separarCabeceras(raw.toString('utf8'), false)
  return h(headers, nombre)
}
