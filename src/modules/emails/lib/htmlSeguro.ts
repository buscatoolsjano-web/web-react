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
 *  3. **Una CSP propia dentro del iframe**: `default-src 'none'`, sin fuentes,
 *     sin CSS externo, sin formularios. Las imágenes sí: `img-src` deja pasar
 *     `data:`, `https:` y `http:`.
 *
 * LAS IMÁGENES REMOTAS SE CARGAN SIEMPRE (Fase 59 · E1). Antes quedaban
 * bloqueadas hasta que la persona apretara un botón, para que un píxel de
 * seguimiento no le avisara al remitente que el mail se abrió. Se sacó a
 * pedido: «quiero que me aparezcan todas las fotos, y si se muestra que abrí
 * el mensaje no me importa, la idea es centralizarlo todo acá».
 *
 * Es una decisión de PRIVACIDAD, no de seguridad, y por eso se puede tomar: lo
 * que impide que un mail haga algo son las capas 1 y 2, que no se tocaron. Una
 * imagen remota no ejecuta nada. Lo que se pierde es que el remitente se entera
 * de que se abrió, y de la IP desde donde. El `<meta name="referrer"
 * content="no-referrer">` sigue puesto, así que al menos no viaja de qué
 * mensaje salió el pedido.
 *
 * `dangerouslySetInnerHTML` no se usa para cuerpos de email. Nunca.
 */

/** `allow-popups` para que un link se abra en pestaña nueva. Nada más. */
export const SANDBOX_IFRAME = 'allow-popups allow-popups-to-escape-sandbox'

export interface HtmlPreparado {
  /** El cuerpo sanitizado, listo para `construirSrcdoc`. */
  html: string
  /** Content-IDs referenciados como `cid:` que no se pudieron resolver todavía. */
  cidsPendientes: string[]
}

export interface OpcionesHtml {
  /** Content-ID → data URI de la imagen inline. */
  inline?: ReadonlyMap<string, string>
}

export function prepararHtml(crudo: string, opciones: OpcionesHtml = {}): HtmlPreparado {
  const cidsPendientes = new Set<string>()

  DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
    const el = nodo
    if (typeof el.getAttribute !== 'function') return

    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }

    /*
     * Las `cid:` son parte del mensaje, no seguimiento: viajan en el propio
     * mail y hay que resolverlas pidiéndoselas a Gmail. Las remotas se dejan
     * como vienen y las carga el navegador.
     */
    const src = el.getAttribute('src')
    if (src && /^cid:/i.test(src.trim())) {
      const cid = decodeURIComponent(src.trim().slice(4)).replace(/^<|>$/g, '')
      const dato = opciones.inline?.get(cid)
      if (dato) el.setAttribute('src', dato)
      else {
        el.removeAttribute('src')
        cidsPendientes.add(cid)
      }
    }
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
    return { html, cidsPendientes: [...cidsPendientes] }
  } finally {
    DOMPurify.removeAllHooks()
  }
}

/**
 * La CSP del documento del iframe.
 *
 * `img-src` abierto y todo lo demás cerrado: una imagen no ejecuta nada, y
 * `script-src 'none'` con `object-src 'none'` siguen siendo lo que impide que
 * un mail haga algo. Ver la nota de arriba sobre por qué las remotas pasan.
 */
export function cspDelCuerpo(): string {
  return [
    "default-src 'none'",
    'img-src data: https: http:',
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
  a { color: #b8430e; }
`

/** El documento completo del iframe: CSP primero, antes que cualquier contenido. */
export function construirSrcdoc(htmlSanitizado: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${cspDelCuerpo()}">` +
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

// ── El papel sobre el que se escribe (Fase 59 · E2) ─────────────────────────

/** Dónde entra el cuadro de texto dentro del envoltorio. */
export const ATRIBUTO_HUECO = 'data-bt-cuerpo'

const HUECO_CUERPO = /\{\{\s*cuerpo\s*\}\}/g

export interface MarcoPreparado {
  /** El envoltorio sanitizado, con un ancla vacía donde va el cuerpo. */
  html: string
  /** Hubo `{{cuerpo}}` y quedó el ancla. Sin esto no se puede escribir encima. */
  tieneHueco: boolean
}

/**
 * El envoltorio de la empresa, listo para escribir ADENTRO.
 *
 * El pedido era no escribir en una caja vacía y después mirar una previa, sino
 * escribir directamente sobre la hoja con el membrete puesto. Para eso el
 * `{{cuerpo}}` se cambia por un ancla vacía, y quien lo use monta ahí el
 * cuadro de texto con un portal.
 *
 * POR QUÉ UN ANCLA Y NO PARTIR EL STRING. El envoltorio es una tabla y el
 * `{{cuerpo}}` vive dentro de un `<td>`: cortar el texto en dos dejaría la
 * primera mitad con etiquetas abiertas, el navegador las cerraría solo, y el
 * cuadro de texto terminaría fuera de la celda. Con un ancla la estructura
 * queda intacta.
 *
 * SE SANITIZA IGUAL AUNQUE SEA PROPIO. Lo escribe un admin de la empresa, no
 * un desconocido, pero esto se dibuja DENTRO de la aplicación —no en un iframe
 * aislado como el cuerpo de un mail recibido— así que es el único lugar donde
 * un `<script>` en una plantilla correría con la sesión de quien escribe. Se
 * pasa por el mismo DOMPurify, con la misma lista de prohibidos.
 */
export function prepararMarco(envoltorio: string | null | undefined): MarcoPreparado {
  // Acepta null/undefined y no sólo '': esto se alimenta de una RPC a través
  // de un hook, y «todavía no llegó» tiene que dar el cuadro pelado, no una
  // pantalla rota.
  if (!envoltorio?.trim() || !HUECO_CUERPO.test(envoltorio)) {
    // `test` con una regex global mueve `lastIndex`: se reinicia o el próximo
    // llamado con el mismo texto puede dar false.
    HUECO_CUERPO.lastIndex = 0
    return { html: '', tieneHueco: false }
  }
  HUECO_CUERPO.lastIndex = 0

  const conAncla = envoltorio.replace(HUECO_CUERPO, `<div ${ATRIBUTO_HUECO}="1"></div>`)

  const html = DOMPurify.sanitize(conAncla, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [ATRIBUTO_HUECO],
    FORBID_TAGS: [
      'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset',
      'object', 'embed', 'base', 'meta', 'link', 'script', 'noscript', 'template', 'svg', 'math',
    ],
    FORBID_ATTR: ['formaction', 'ping'],
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: true,
  })

  // Si el ancla no sobrevivió, no hay dónde escribir y es mejor el cuadro
  // pelado que una hoja bonita sin cursor.
  return { html, tieneHueco: html.includes(ATRIBUTO_HUECO) }
}
