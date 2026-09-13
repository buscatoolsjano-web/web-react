import DOMPurify from 'dompurify'

/**
 * El HTML de un email, dibujado sin que pueda hacer nada.
 *
 * Tres capas, y cada una alcanza sola para lo que cubre:
 *
 *  1. **DOMPurify** saca scripts, handlers (`onerror=`, `onload=`), `javascript:`,
 *     iframes, formularios, SVG y MathML. Corre sobre un documento inerte: parsear
 *     no ejecuta nada.
 *  2. **`<iframe sandbox>` SIN `allow-scripts` y SIN `allow-same-origin`.** Aunque
 *     algo pasara la capa 1, no corre; y el documento queda en un origen opaco,
 *     sin acceso a `bt-auth` ni al DOM de la app. Las dos juntas lo pondrían en
 *     el mismo origen que el ERP: por eso NUNCA van juntas.
 *  3. **Una CSP propia dentro del iframe**: `default-src 'none'`. Sin imágenes
 *     remotas mientras la persona no las pida —así un píxel de seguimiento no le
 *     avisa al remitente que el mail se abrió—, sin fuentes, sin CSS externo,
 *     sin formularios.
 *
 * Además, con las remotas bloqueadas, el `src` remoto ni siquiera queda en el
 * DOM: se mueve a un atributo inerte. No depende sólo de que el navegador honre
 * la CSP antes de que su preload scanner pida la imagen.
 *
 * `dangerouslySetInnerHTML` no se usa para cuerpos de email. Nunca.
 */

/** `allow-popups` para que un link se abra en pestaña nueva. Nada más. */
export const SANDBOX_IFRAME = 'allow-popups allow-popups-to-escape-sandbox'

const REMOTA = /^\s*(https?:)?\/\//i
const URL_REMOTA_CSS = /url\(\s*['"]?\s*(https?:)?\/\//i

export interface HtmlPreparado {
  /** El cuerpo sanitizado, listo para `construirSrcdoc`. */
  html: string
  /** Hay imágenes remotas (bloqueadas o no). Decide si se muestra la barra. */
  hayRemotas: boolean
  /** Content-IDs referenciados como `cid:` que no se pudieron resolver todavía. */
  cidsPendientes: string[]
}

export interface OpcionesHtml {
  remotas: boolean
  /** Content-ID → data URI de la imagen inline. */
  inline?: ReadonlyMap<string, string>
}

export function prepararHtml(crudo: string, opciones: OpcionesHtml): HtmlPreparado {
  let hayRemotas = false
  const cidsPendientes = new Set<string>()

  DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
    const el = nodo
    if (typeof el.getAttribute !== 'function') return

    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }

    const src = el.getAttribute('src')
    if (src && /^cid:/i.test(src.trim())) {
      const cid = decodeURIComponent(src.trim().slice(4)).replace(/^<|>$/g, '')
      const dato = opciones.inline?.get(cid)
      if (dato) el.setAttribute('src', dato)
      else {
        el.removeAttribute('src')
        cidsPendientes.add(cid)
      }
    } else if (src && REMOTA.test(src)) {
      hayRemotas = true
      if (!opciones.remotas) {
        el.removeAttribute('src')
        el.setAttribute('data-bt-remota', '1')
      }
    }

    for (const atributo of ['srcset', 'background', 'poster']) {
      const v = el.getAttribute(atributo)
      if (v && /(https?:)?\/\//i.test(v)) {
        hayRemotas = true
        if (!opciones.remotas) el.removeAttribute(atributo)
      }
    }

    const estilo = el.getAttribute('style')
    if (estilo && URL_REMOTA_CSS.test(estilo)) hayRemotas = true
  })

  DOMPurify.addHook('uponSanitizeElement', (nodo, datos) => {
    if (datos.tagName === 'style' && URL_REMOTA_CSS.test(nodo.textContent ?? '')) hayRemotas = true
  })

  try {
    const html = DOMPurify.sanitize(crudo, {
      USE_PROFILES: { html: true },
      ADD_TAGS: ['style'],
      FORBID_TAGS: [
        'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset',
        'object', 'embed', 'base', 'meta', 'link', 'script', 'noscript', 'template', 'svg', 'math',
      ],
      FORBID_ATTR: ['formaction', 'ping'],
      ALLOW_DATA_ATTR: false,
      // Los <style> del principio del mail sobreviven: sin esto, DOMPurify los
      // descarta por aparecer antes del body.
      FORCE_BODY: true,
    })
    return { html, hayRemotas, cidsPendientes: [...cidsPendientes] }
  } finally {
    DOMPurify.removeAllHooks()
  }
}

/** La CSP del documento del iframe. */
export function cspDelCuerpo(remotas: boolean): string {
  return [
    "default-src 'none'",
    `img-src data:${remotas ? ' https: http:' : ''}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

const ESTILO_BASE = `
  html, body { margin: 0; padding: 0; }
  body { padding: 12px; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
         color: #1a1a1a; background: #fff; overflow-wrap: anywhere; word-break: break-word; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; }
  img[data-bt-remota] { display: inline-block; min-width: 16px; min-height: 16px;
                        background: repeating-linear-gradient(45deg,#eee 0 6px,#f7f7f7 6px 12px); }
  a { color: #b8430e; }
`

/** El documento completo del iframe: CSP primero, antes que cualquier contenido. */
export function construirSrcdoc(htmlSanitizado: string, remotas: boolean): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${cspDelCuerpo(remotas)}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>${ESTILO_BASE}</style></head><body>${htmlSanitizado}</body></html>`
  )
}

/** Los Content-ID que el HTML crudo referencia, para pedir sólo esas imágenes. */
export function cidsReferenciados(crudo: string): string[] {
  const salida = new Set<string>()
  for (const m of crudo.matchAll(/["'(]\s*cid:([^"')\s>]+)/gi)) {
    if (m[1]) salida.add(decodeURIComponent(m[1]).replace(/^<|>$/g, ''))
  }
  return [...salida]
}
