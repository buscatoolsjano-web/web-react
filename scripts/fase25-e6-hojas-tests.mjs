/**
 * Fase 25 · E6 — Suite de las reglas de «hoja del catálogo».
 *
 * **No toca la base ni el legacy.** Prueba las tres funciones con decisiones:
 * a qué catálogo va cada producto, cómo se arma el nombre del archivo, y el
 * respaldo por serie de TECNA. Todo calcado del legacy, con la línea de
 * `app.js` al lado de cada regla.
 *
 *   node scripts/fase25-e6-hojas-tests.mjs
 */
import { catalogoTecnaPorSerie, urlDePagina } from './fase25-e6-hojas-legacy-extraer.mjs'
import { hojaPara } from './fase25-e6-hojas-aplicar.mjs'

let fallos = 0
const seccion = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(72)}`)
const PASS = (t) => console.log(`    PASS  ${t}`)
const FAIL = (t, d) => { fallos++; console.log(`    FAIL  ${t} — ${d}`) }
const cmp = (t, esperado, real) =>
  JSON.stringify(esperado) === JSON.stringify(real)
    ? PASS(t)
    : FAIL(t, `esperaba ${JSON.stringify(esperado)}, dio ${JSON.stringify(real)}`)

const MAPEO = {
  'SP.2520/8B': { catalogo: 'speedrill', pagina: 93, regla: 'mapeo SPEEDRILL' },
  'TE.X-LIGHT.05': { catalogo: 'nogravity', pagina: 3, regla: 'mapeo TECNA' },
}
const P = (over) => ({ sku: 'X', serie: null, marca: null, categoria: null, atributos: {}, ...over })

seccion('El mapeo por SKU manda sobre cualquier regla (app.js:35, :84)')
cmp('un SKU de SPEEDRILL sale del mapeo, con su página',
  { catalogo: 'speedrill', pagina: 93, regla: 'mapeo SPEEDRILL' },
  hojaPara(P({ sku: 'SP.2520/8B', marca: 'SPEEDRILL' }), MAPEO))
cmp('un SKU de TECNA también, y su catálogo puede no ser el del respaldo',
  { catalogo: 'nogravity', pagina: 3, regla: 'mapeo TECNA' },
  hojaPara(P({ sku: 'TE.X-LIGHT.05', marca: 'TECNA', categoria: 'balanceador', serie: 'FOOD INDUSTRY' }), MAPEO))
cmp('el mapeo gana incluso si la marca cargada en la base es otra',
  'speedrill',
  hojaPara(P({ sku: 'SP.2520/8B', marca: 'OTRA' }), MAPEO)?.catalogo)

seccion('TORERO: serie LTR o LTU, página 1 (app.js:50)')
cmp('serie LTR', { catalogo: 'torero', pagina: 1, regla: 'regla TORERO LTR/LTU' },
  hojaPara(P({ sku: 'TO.LTR.100', marca: 'TORERO', serie: 'LTR' }), MAPEO))
cmp('serie LTU, en minúscula en la base', 'torero',
  hojaPara(P({ sku: 'TO.LTU.50', marca: 'TORERO', serie: 'ltu' }), MAPEO)?.catalogo)
cmp('otra serie de TORERO no tiene hoja: el catálogo es sólo de esas dos series', null,
  hojaPara(P({ sku: 'TO.OTRA.1', marca: 'TORERO', serie: 'LTZ' }), MAPEO))
cmp('TORERO sin serie tampoco', null, hojaPara(P({ sku: 'TO.X', marca: 'TORERO' }), MAPEO))

seccion('TECNA sin mapeo: respaldo por serie, y sólo balanceadores (app.js:83, :89)')
cmp('«NO GRAVITY» → nogravity', 'nogravity',
  hojaPara(P({ sku: 'TE.NG.1', marca: 'TECNA', categoria: 'balanceador', serie: 'NO GRAVITY' }), MAPEO)?.catalogo)
cmp('un SKU con X-LIGHT → nogravity aunque la serie diga otra cosa', 'nogravity',
  hojaPara(P({ sku: 'TE.X-LIGHT.9', marca: 'TECNA', categoria: 'balanceador', serie: 'GENERAL' }), MAPEO)?.catalogo)
cmp('«FOOD INDUSTRY» → food', 'food',
  hojaPara(P({ sku: 'TE.F.1', marca: 'TECNA', categoria: 'balanceador', serie: 'FOOD INDUSTRY' }), MAPEO)?.catalogo)
cmp('terminado en IL → food', 'food',
  hojaPara(P({ sku: 'TE.9310IL', marca: 'TECNA', categoria: 'balanceador', serie: 'X' }), MAPEO)?.catalogo)
cmp('terminado en RL → food', 'food',
  hojaPara(P({ sku: 'TE.9310RL', marca: 'TECNA', categoria: 'balanceador', serie: 'X' }), MAPEO)?.catalogo)
cmp('cualquier otro → generale', 'generale',
  hojaPara(P({ sku: 'TE.9300', marca: 'TECNA', categoria: 'balanceador', serie: 'X' }), MAPEO)?.catalogo)
cmp('el respaldo NO trae página: el legacy tampoco la sabía', null,
  hojaPara(P({ sku: 'TE.9300', marca: 'TECNA', categoria: 'balanceador' }), MAPEO)?.pagina)
cmp('un TECNA que no es balanceador se queda sin hoja', null,
  hojaPara(P({ sku: 'TE.9300', marca: 'TECNA', categoria: 'accesorio' }), MAPEO))

seccion('Lo que no cae en ninguna regla se queda sin hoja')
cmp('marca desconocida', null, hojaPara(P({ sku: 'ZZ.1', marca: 'FEIN', serie: 'LTR' }), MAPEO))
cmp('sin marca ni serie', null, hojaPara(P({}), MAPEO))

seccion('El nombre del archivo de la página (app.js:16830)')
cmp('SPEEDRILL rellena a 3 dígitos',
  'https://janoguarini.github.io/catalogos-buscatools/speedrill-093.jpg', urlDePagina('speedrill', 93))
cmp('SPEEDRILL con página de un dígito',
  'https://janoguarini.github.io/catalogos-buscatools/speedrill-007.jpg', urlDePagina('speedrill', 7))
cmp('el resto rellena a 2',
  'https://janoguarini.github.io/catalogos-buscatools/food-05.jpg', urlDePagina('food', 5))
cmp('y una página de dos dígitos queda igual',
  'https://janoguarini.github.io/catalogos-buscatools/generale-12.jpg', urlDePagina('generale', 12))

seccion('El respaldo por serie, aislado')
cmp('sin serie ni pista, generale', 'generale', catalogoTecnaPorSerie(null, 'TE.1'))
cmp('no distingue mayúsculas', 'nogravity', catalogoTecnaPorSerie('no gravity', 'TE.1'))

console.log(`\n  ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLO(S)`}\n`)
process.exit(fallos === 0 ? 0 : 1)
