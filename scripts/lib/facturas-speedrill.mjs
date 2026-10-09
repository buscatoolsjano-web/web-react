/*
 * Lectura de los renglones de una factura de compra de SPEEDRILL (Fase 55).
 *
 * El formato es `CÓDIGO  DESCRIPCIÓN  CANTIDAD  PRECIO  IMPORTE`, y el texto
 * que extrae el lector de PDF llega sin saltos de línea fiables: los renglones
 * se pegan entre sí y las descripciones se cortan y siguen DESPUÉS de los
 * importes del propio renglón.
 *
 * TODO SE ANCLA EN LA ARITMÉTICA, porque es lo único que no miente:
 *
 *     importe = cantidad × precio
 *
 * Y hace falta de verdad, no es elegancia. En la FA240008 las descripciones
 * TERMINAN EN NÚMERO:
 *
 *     6G2-007 MIDDLE GEAR 19 4 16,07 64,28
 *
 * El «19» es parte de «MIDDLE GEAR 19» y la cantidad es 4. Un parseo
 * posicional toma 19 como cantidad y carga un costo que no existe. La cuenta
 * descarta esa combinación —19 × 4 ≠ 16,07— y se queda con la correcta.
 *
 * LA TOLERANCIA ES POR UNIDAD, no fija. El precio impreso viene redondeado a
 * dos decimales y el importe sale de más decimales: en la FA240007,
 * `40 × 5,43 = 217,20` pero la factura dice 217,27, porque el unitario real es
 * 5,43175. Medio centavo por unidad cubre ese redondeo sin aflojar la guardia.
 *
 * EL COSTO QUE SE GUARDA ES `importe / cantidad`, no el precio impreso: es el
 * que de verdad se pagó, con todos sus decimales.
 *
 * EL CÓDIGO LO DECIDE EL CATÁLOGO. Acá se devuelven CANDIDATOS —todos los
 * tokens del tramo que precede a cada renglón— y el cargador busca cuál existe.
 * No hay forma de distinguir un código de una palabra de la descripción
 * mirando el texto: `SPCOPMGR` no tiene dígitos y `MIDDLE GEAR 19` sí.
 */

/** «1.489,09» → 1489.09. Formato europeo. */
export function aNumero(s) {
  if (s === null || s === undefined) return Number.NaN
  return Number(String(s).trim().replace(/\./g, '').replace(',', '.'))
}

/**
 * Un renglón: cantidad entera, precio y importe con dos decimales.
 *
 * Se buscan TODAS las combinaciones que encajen en el patrón y después se
 * filtran por la cuenta. El patrón solo no alcanza: en la FA240008 hay cuatro
 * números seguidos y dos combinaciones posibles por renglón.
 */
const TRIPLE = /(\d{1,5})\s+([\d.]*\d,\d{2})\s+([\d.]*\d,\d{2})/g

/** Un token que podría ser un código: sin espacios, con pinta de referencia. */
const TOKEN = /[A-Z0-9][A-Z0-9/.\-]{1,24}/g

/**
 * Lee los renglones de una factura.
 *
 * `sumaEsperada` es «Suma Importes» —el subtotal de la mercadería, SIN IVA ni
 * portes—. No es el total del nombre del archivo: ése lleva el 21 % de IVA y a
 * veces portes, y compararse contra él daría siempre por debajo.
 */
export function leerFactura(texto, sumaEsperada) {
  /*
   * El cuerpo: entre el encabezado de la tabla y «Suma Importes».
   *
   * El corte de abajo importa: después vienen los totales —base, IVA, total—,
   * que son más números con el mismo formato y que encajarían en el patrón.
   */
  const desde = texto.search(/Descripci[oó]n\s+Cantidad\s+Precio\s+Importe/i)
  const hasta = texto.search(/Suma\s+Importes/i)
  if (desde < 0 || hasta < 0 || hasta <= desde) {
    return { renglones: [], sinCodigo: [], descartados: ['no se encontró el cuerpo de la tabla'], suma: 0, valida: false }
  }

  // Se saltea la línea del albarán, que trae fechas con números.
  let cuerpo = texto.slice(desde, hasta)
  const albaran = cuerpo.search(/Contacto:/i)
  if (albaran > 0) {
    const fin = cuerpo.indexOf('\n', albaran)
    cuerpo = cuerpo.slice(fin > 0 ? fin : albaran + 'Contacto:'.length)
  }

  /* Los candidatos a renglón, con su posición y si la cuenta cierra. */
  const candidatos = []
  for (const m of cuerpo.matchAll(TRIPLE)) {
    const cantidad = Number(m[1])
    const precio = aNumero(m[2])
    const importe = aNumero(m[3])
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue
    if (![precio, importe].every((x) => Number.isFinite(x) && x > 0)) continue

    // Medio centavo por unidad: el precio impreso está redondeado.
    const margen = Math.max(0.02, cantidad * 0.005)
    const cierra = Math.abs(cantidad * precio - importe) <= margen

    candidatos.push({ cantidad, precio, importe, cierra, desde: m.index ?? 0, hasta: (m.index ?? 0) + m[0].length })
  }

  const renglones = []
  const sinCodigo = []
  const descartados = []

  /*
   * Los que cierran, en orden. Un candidato que no cierra se ignora: es una
   * combinación espuria de números de una descripción.
   *
   * Pueden solaparse —dos combinaciones del mismo tramo que ambas cierren—, y
   * en ese caso se queda la primera y se salta hasta donde termina, porque
   * usar las dos contaría el mismo importe dos veces.
   */
  const buenos = []
  let limite = -1
  for (const c of candidatos) {
    if (!c.cierra) continue
    if (c.desde < limite) continue
    buenos.push(c)
    limite = c.hasta
  }

  for (let i = 0; i < buenos.length; i += 1) {
    const c = buenos[i]
    const inicio = i === 0 ? 0 : buenos[i - 1].hasta
    const tramo = cuerpo.slice(inicio, c.desde)

    /*
     * Todos los tokens del tramo, de izquierda a derecha, SIN repetir.
     *
     * El código suele ser el primero, pero no siempre: cuando la descripción
     * del renglón anterior sigue después de sus importes, el tramo empieza con
     * su cola —«A=3,86, D=4,8 VPTX20/300 PUNTA…»—. Y hay facturas donde el
     * código viene escrito dos veces seguidas («VPPH2/90 VPPH2/90 PUNTA…»).
     */
    const vistos = new Set()
    const candidatosCodigo = []
    for (const t of tramo.matchAll(TOKEN)) {
      const tok = t[0].replace(/[.,]+$/, '')
      if (tok.length < 2) continue
      if (vistos.has(tok)) continue
      vistos.add(tok)
      candidatosCodigo.push(tok)
    }

    if (candidatosCodigo.length === 0) {
      sinCodigo.push(`renglón ${i + 1}: ningún token antes de ${c.importe}`)
      continue
    }

    renglones.push({
      orden: i + 1,
      candidatos: candidatosCodigo,
      cantidad: c.cantidad,
      precioImpreso: c.precio,
      importe: c.importe,
      // El costo REAL: el importe dividido la cantidad. El precio impreso está
      // redondeado a dos decimales.
      unitario: Math.round((c.importe / c.cantidad) * 10000) / 10000,
    })
  }

  const suma = Math.round(renglones.reduce((a, r) => a + r.importe, 0) * 100) / 100

  /*
   * LA GUARDIA QUE IMPORTA: la suma de los renglones leídos tiene que dar la
   * «Suma Importes» de la factura. Si falta un renglón o se contó uno dos
   * veces, esto lo ve. Es la única verificación que cubre el documento entero.
   */
  const cierra = sumaEsperada === null || sumaEsperada === undefined
    ? null
    : Math.abs(suma - sumaEsperada) <= 0.05

  if (cierra === false) {
    descartados.push(`la suma de los renglones (${suma}) no da la Suma Importes (${sumaEsperada})`)
  }

  return { renglones, sinCodigo, descartados, suma, sumaEsperada: sumaEsperada ?? null, cierra, valida: cierra === true }
}
