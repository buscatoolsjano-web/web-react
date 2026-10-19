/* Script de un solo uso: agrega la pestaña «Más información» al detalle. */
const fs = require('fs')

const PAGINAS = [
  { archivo: 'CotizacionDetallePage', tipo: 'cotizacion', doc: 'doc' },
  { archivo: 'PedidoDetallePage', tipo: 'pedido', doc: 'doc' },
]

for (const { archivo } of PAGINAS) {
  const p = `src/modules/ventas/pages/${archivo}.tsx`
  let s = fs.readFileSync(p, 'utf8')
  const nl = s.includes('\r\n') ? '\r\n' : '\n'
  const j = (t) => t.split('\n').join(nl)
  const props = fs.readFileSync(`scripts/props-${archivo}.txt`, 'utf8')

  // 1 · la clave de la pestaña
  const lista = `const PESTANAS = ['lineas', 'adjuntos', 'relacionados', 'trazabilidad'] as const`
  if (!s.includes(lista)) throw new Error('sin PESTANAS: ' + archivo)
  s = s.replace(lista, `const PESTANAS = ['lineas', 'masinfo', 'adjuntos', 'relacionados', 'trazabilidad'] as const`)

  // 2 · el rótulo, al lado de «Líneas»
  const rotulo = /\{ key: 'lineas' as const, label: 'Líneas', count: [A-Za-z.]+ \},/
  const m = rotulo.exec(s)
  if (!m) throw new Error('sin rótulo de líneas: ' + archivo)
  s = s.replace(
    rotulo,
    m[0] + nl + `    { key: 'masinfo' as const, label: 'Más información' },`,
  )

  // 3 · el panel, antes del de adjuntos
  const antes = j(`        {pestana === 'adjuntos' ? (`)
  const i = s.indexOf(antes)
  if (i < 0) throw new Error('sin panel de adjuntos: ' + archivo)
  const panel =
    j(`        {/*
          «Más información», la otra mitad de la cabecera (Fase 84).

          La tarjeta de arriba muestra lo que identifica al documento y es
          igual mirándolo que editándolo; el resto —contactos, moneda, tipo de
          cambio, domicilio, observaciones— vive acá, y acá también se edita.
          Es la forma del sistema anterior, y resuelve lo que se pidió: que
          «Editar» no agregue un montón de filas nuevas arriba.

          Se edita con el MISMO borrador y se guarda con el mismo botón de la
          barra: esto no es un formulario aparte.
        */}
        {pestana === 'masinfo' ? (
          <DocSection title="Más información">
            {editando ? (
`) +
    props
      .split('\n')
      .map((l) => (l.trim() === '' ? l : '  ' + l))
      .join(nl) +
    j(`
            ) : (
              <InformacionDocumento parte="mas" doc={doc} onVerCliente={() => setViendoCliente(true)} />
            )}
          </DocSection>
        ) : null}

`)
  s = s.slice(0, i) + panel + s.slice(i)

  fs.writeFileSync(p, s)
  fs.unlinkSync(`scripts/props-${archivo}.txt`)
  console.log('ok', archivo)
}
