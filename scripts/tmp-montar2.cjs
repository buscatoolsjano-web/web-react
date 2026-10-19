/* Script de un solo uso: sube los dos consts y monta el bloque. */
const fs = require('fs')

for (const archivo of ['CotizacionDetallePage', 'PedidoDetallePage', 'EntregaDetallePage']) {
  const p = `src/modules/ventas/pages/${archivo}.tsx`
  let s = fs.readFileSync(p, 'utf8')
  const nl = s.includes('\r\n') ? '\r\n' : '\n'
  const j = (t) => t.split('\n').join(nl)

  // 1 · los dos consts se van arriba, al lado de la pestaña
  const viejos = j(`  /* Con la hoja abierta la pestaña no existe: si alguien la tenía abierta y
     muestra la hoja, se vuelve a «Líneas» en vez de quedar en una pestaña que
     ya no está. */
  const hayPestanaMasInfo = !verPrevia
  const pestanaVisible = pestana === 'masinfo' && !hayPestanaMasInfo ? 'lineas' : pestana
`)
  if (!s.includes(viejos)) throw new Error('sin consts: ' + archivo)
  s = s.replace(viejos, '')

  const anclaPestana = /( {2}const \[pestana, setPestana\] = useTabDeUrl<Pestana>\(PESTANAS, 'lineas'\)\r?\n)/
  if (!anclaPestana.test(s)) throw new Error('sin useTabDeUrl: ' + archivo)
  s = s.replace(
    anclaPestana,
    `$1` +
      j(`  /*
   * «Más información» es pestaña sólo con la hoja cerrada (Fase 84).
   *
   * Con la hoja al lado la columna mide unos 500 px, y mandar seis campos a
   * una pestaña ahí es un viaje de ida y vuelta para ver dos datos: va
   * adentro de «Líneas», debajo de la tarjeta. Con la hoja cerrada hay ancho
   * de sobra y se gana su pestaña, como en el sistema anterior.
   *
   * Si alguien la tenía abierta y muestra la hoja, la pestaña deja de
   * existir: se vuelve a «Líneas» en vez de quedar mirando una pestaña que ya
   * no está.
   */
  const hayPestanaMasInfo = !verPrevia
  const pestanaVisible = pestana === 'masinfo' && !hayPestanaMasInfo ? 'lineas' : pestana
`),
  )

  // 2 · el panel de la pestaña, antes de adjuntos
  const antesAdjuntos = j(`        {pestanaVisible === 'adjuntos' ? (`)
  const i = s.indexOf(antesAdjuntos)
  if (i < 0) throw new Error('sin adjuntos: ' + archivo)
  s =
    s.slice(0, i) +
    j(`        {pestanaVisible === 'masinfo' ? (
          <div className={editor.columnaEditor}>{bloqueMasInfo}</div>
        ) : null}

`) +
    s.slice(i)

  // 3 · y adentro de «Líneas» cuando no hay pestaña
  const cierreTarjeta = /(\r?\n {10}<\/DocSection>\r?\n)(\r?\n? {10}<DocSection)/
  if (!cierreTarjeta.test(s)) throw new Error('sin cierre de la tarjeta: ' + archivo)
  s = s.replace(
    cierreTarjeta,
    `$1` +
      nl +
      j(`          {/* Con la hoja al lado, acá: es el mismo bloque que la pestaña. */}
          {hayPestanaMasInfo ? null : bloqueMasInfo}
`) +
      `$2`,
  )

  fs.writeFileSync(p, s)
  console.log('ok', archivo)
}
