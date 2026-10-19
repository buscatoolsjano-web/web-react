/* Script de un solo uso: monta el bloque en la pestaña y dentro de «Líneas». */
const fs = require('fs')

const CIERRES = {
  CotizacionDetallePage: `              </DocSection>

              <DocSection
                title="Líneas"`,
  PedidoDetallePage: `              </DocSection>

              <DocSection
                title="Líneas"`,
  EntregaDetallePage: `            </DocSection>

            <DocSection
              title="Líneas"`,
}

for (const [archivo, cierre] of Object.entries(CIERRES)) {
  const p = `src/modules/ventas/pages/${archivo}.tsx`
  let s = fs.readFileSync(p, 'utf8')
  const nl = s.includes('\r\n') ? '\r\n' : '\n'
  const j = (t) => t.split('\n').join(nl)

  // 1 · los dos consts suben, si todavía no lo hicieron
  const viejos = j(`  /* Con la hoja abierta la pestaña no existe: si alguien la tenía abierta y
     muestra la hoja, se vuelve a «Líneas» en vez de quedar en una pestaña que
     ya no está. */
  const hayPestanaMasInfo = !verPrevia
  const pestanaVisible = pestana === 'masinfo' && !hayPestanaMasInfo ? 'lineas' : pestana
`)
  if (s.includes(viejos)) {
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
  }

  // 2 · el panel de la pestaña, antes de adjuntos
  const antesAdjuntos = j(`        {pestanaVisible === 'adjuntos' ? (`)
  if (!s.includes(j(`{pestanaVisible === 'masinfo' ?`))) {
    const i = s.indexOf(antesAdjuntos)
    if (i < 0) throw new Error('sin adjuntos: ' + archivo)
    s =
      s.slice(0, i) +
      j(`        {pestanaVisible === 'masinfo' ? (
          <div className={editor.columnaEditor}>{bloqueMasInfo}</div>
        ) : null}

`) +
      s.slice(i)
  }

  // 3 · y adentro de «Líneas» cuando no hay pestaña
  if (!s.includes(j(`{hayPestanaMasInfo ? null : bloqueMasInfo}`))) {
    const sangria = cierre.match(/^ */)[0]
    const nuevo =
      cierre.split('\n')[0] +
      nl +
      nl +
      sangria +
      `{/* Con la hoja al lado, acá: es el mismo bloque que la pestaña. */}` +
      nl +
      sangria +
      `{hayPestanaMasInfo ? null : bloqueMasInfo}` +
      nl +
      cierre.split('\n').slice(1).join(nl)
    if (!s.includes(j(cierre))) throw new Error('sin cierre: ' + archivo)
    s = s.replace(j(cierre), j(nuevo))
  }

  fs.writeFileSync(p, s)
  console.log('ok', archivo)
}
