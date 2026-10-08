/*
 * Lectura de los renglones de una factura de Ingersoll-Rand (Fase 53).
 *
 * POR QUÉ ESTO EXISTE Y POR QUÉ ES ASÍ DE DESCONFIADO.
 *
 * Ingersoll Rand no manda lista de precios: lo único con costos es la factura
 * de compra en PDF. Y el texto que se extrae de ese PDF llega DESORDENADO,
 * porque la extracción lee por columnas y no por filas. Tres cosas concretas:
 *
 *  1 · El código del artículo viene PARTIDO. `BC1124-E` + `U` es `BC1124-EU`;
 *      `475109650` + `01` es `47510965001`; `RTS025PQ` + `4` es `RTS025PQ4`.
 *      Verificado contra el catálogo: `RTS060PS` + `6` existe como
 *      `IR.RTS060PS6`, «RTS 60Nm - 3/8" Pin Retainer».
 *
 *  2 · Los importes de los últimos renglones salen MEZCLADOS con las etiquetas
 *      de la tabla de totales:
 *        «O1 2 rEA EA ig901,00 293,00 inTotal Cargos Seguro ... 47,20% 47,20%»
 *      Asociar cada importe a su artículo por posición sería adivinar.
 *
 *  3 · La descripción de un renglón puede aparecer entre el código y los
 *      importes de OTRO.
 *
 * LA SALIDA ES LA ARITMÉTICA. Cada renglón cumple
 *
 *     neto = cantidad × precio_de_lista × (1 − descuento)
 *
 * y eso identifica qué cuarteta (cantidad, lista, dto, neto) es consistente.
 * Donde la cuenta no cierra, el renglón se DESCARTA y se informa: es
 * preferible cargar menos costos que cargar un costo que no es de ese
 * producto. Un costo equivocado acá se convierte en un precio de venta
 * equivocado, porque el PVP es costo × 3.
 *
 * Y al final se compara la suma de los netos contra el total de la factura.
 * Si no coinciden, no se escribe nada.
 */

/** Convierte «5.446,00» o «47,20» a número. Formato europeo. */
export function aNumero(s) {
  if (s === null || s === undefined) return Number.NaN
  return Number(String(s).trim().replace(/\./g, '').replace(',', '.'))
}

/**
 * Las cuartetas de importes, en el orden en que aparecen.
 *
 * El patrón es inequívoco: país (dos letras), cantidad, «EA», precio, un
 * descuento con coma y «%», y después el neto. Se admite basura entre medio
 * porque la extracción intercala texto.
 *
 * CADA IMPORTE TERMINA EN DOS DECIMALES EXACTOS, y eso no es cosmético: hay
 * renglones donde el neto sale PEGADO al campo que sigue
 * («11.563,20,00 0»). Capturando «cualquier cosa con dígitos y comas» salía
 * `11.563,20,00`, que no es un número, el renglón se descartaba y se perdía un
 * costo de 11.563 euros sin más aviso que un contador. Con los dos decimales
 * el corte es exacto.
 */
const CUARTETA =
  /([A-Z]{2})\s+(\d+)\s+EA\s+([\d.]+,\d{2})\s+(\d+,\d{2})%\s+[\d.,]+%\s+([\d.]+,\d{2})/g

/**
 * Los códigos de artículo, en orden, ya reunificados.
 *
 * Un renglón abre con «<n> <código>» después del encabezado de la tabla. Los
 * fragmentos que siguen —y que no son palabras de descripción— se pegan al
 * código.
 */
const APERTURA = /(?:^|\s)(\d{1,2})\s+([A-Z0-9][A-Z0-9\-/.]{2,20})(?=\s)/g

/** Palabras que aparecen en descripciones y NUNCA son parte de un código. */
const NO_ES_CODIGO =
  /^(?:CN|IT|US|TW|EA|NOCLASS|DEFAULT|ORG|BEST|WAY|STANDARD|TL|Ground|Total|IVA|EUR|Factura|Pago|Fecha|P[aá]gina|SERIES|CABLE|METER|BATTERY|BOOT|CHARGER|CORDLESS|CLUTCH|PROGRAMMABLE|PISTOL|QUICK|CHANGE|SQUARE|ANGLE|KIT|BALANCER|CONTROLLER|POWER|SUPPLY|TRANSDUCERIZED|PUSH|START|RETAINER|FIELDBUS|MES|WITH|AND|NM|RTS|IQI)$/i

/**
 * Lee los renglones de una factura.
 *
 * `texto` es el contenido extraído del PDF. `total` es el importe neto de la
 * factura, que se usa para verificar; viene del nombre del archivo, que lo
 * trae, y no del propio texto —en el texto el total aparece mezclado con los
 * renglones, que es justo el problema—.
 *
 * Devuelve `{ renglones, descartados, suma, cierra }`.
 */
export function leerFactura(texto, total) {
  // Sólo la zona de renglones: después de «Instrucciones especiales» viene el
  // articulado legal, que trae números por todos lados.
  const fin = texto.indexOf('Instrucciones especiales')
  const zona = fin > 0 ? texto.slice(0, fin) : texto

  const inicio = zona.indexOf('Prod Code')
  const cuerpo = inicio > 0 ? zona.slice(inicio + 'Prod Code'.length) : zona

  /*
   * Las cuartetas que cierran la cuenta. Una que no cierra no se usa: puede
   * ser basura de la tabla de totales.
   *
   * LA TOLERANCIA ES RELATIVA, y hace falta: el descuento viene redondeado a
   * dos decimales («47,20 %» puede ser 47,1963…), así que el error crece con
   * el importe. Con una tolerancia fija de dos centavos, el renglón
   * «10 × 103,00 −47,20 % = 543,80» se descartaba porque la cuenta da 543,84.
   * Un milésimo del neto, con piso de dos centavos para los importes chicos.
   */
  const cuartetas = []
  for (const m of cuerpo.matchAll(CUARTETA)) {
    const cantidad = Number(m[2])
    const lista = aNumero(m[3])
    const dto = aNumero(m[4])
    const neto = aNumero(m[5])
    if (![cantidad, lista, dto, neto].every((x) => Number.isFinite(x))) continue
    const esperado = cantidad * lista * (1 - dto / 100)
    const margen = Math.max(0.02, Math.abs(neto) * 0.001)
    cuartetas.push({
      pais: m[1],
      cantidad,
      lista,
      dto,
      neto,
      cierra: Math.abs(esperado - neto) <= margen,
      posicion: m.index ?? 0,
    })
  }

  /*
   * Los códigos, como CANDIDATOS. No se elige acá cuál es el correcto.
   *
   * El código llega partido y la separación no es consistente: a veces el
   * pedazo que falta viene después de un salto de línea («IQI2LT025» + «0PQ4»)
   * y a veces en la misma línea («QCP2A30» + «S6-K2-EU»). Intenté deducir la
   * regla y es un camino equivocado: no hay forma de distinguir un pedazo de
   * código del comienzo de una descripción mirando sólo el texto.
   *
   * ASÍ QUE NO SE DEDUCE: se arman los candidatos —el código suelto, con el
   * token siguiente, y con los dos siguientes— y DECIDE EL CATÁLOGO, que es el
   * único que sabe qué códigos existen. Verificado: la regla resultó ser
   * concatenación sin separador, y así se confirmaron `IQI2LT0250PQ4`,
   * `QCP2A30S6-K2-EU`, `QCP2P02Q4-K2-EU` y `RTS025PQ4`.
   *
   * Un candidato que no existe en el catálogo no es un error del parseo: es un
   * producto que Buscatools compró y no tiene cargado —baterías y cargadores,
   * en estas facturas—.
   */
  const codigos = []
  for (const m of cuerpo.matchAll(APERTURA)) {
    const linea = Number(m[1])
    const base = m[2]
    if (NO_ES_CODIGO.test(base)) continue

    /*
     * Los pedazos candidatos salen de una VENTANA de texto posterior al
     * código, no sólo del token inmediato. Hacen falta las dos cosas:
     *
     *  · `IQI-CABLE` + `\-2M` → el pedazo empieza con guion, y el extractor le
     *    pone una barra invertida delante;
     *  · `QCP2A30` + `S6-K2-EU` → el pedazo aparece DESPUÉS de los importes
     *    («TW 2 EA 1.402,00 … 0,00 .01 S6-K2-EU»), no pegado al código.
     *
     * Una ventana amplia genera candidatos de más, y eso es inofensivo: el
     * catálogo descarta los que no existen. Lo que NO puede pasar es que dos
     * candidatos del mismo renglón existan los dos; el cargador exige que haya
     * exactamente uno y, si hay más, no carga ese renglón.
     */
    const ventana = cuerpo.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400)
    const pedazos = []
    for (const t of ventana.matchAll(/[\s\n]\\?(-?[A-Z0-9][A-Z0-9\-]{0,9})(?=[\s\n])/g)) {
      const limpio = t[1]
      if (NO_ES_CODIGO.test(limpio)) continue
      if (!pedazos.includes(limpio)) pedazos.push(limpio)
      if (pedazos.length >= 6) break
    }

    /*
     * CANDIDATOS: el código suelto, cada pedazo pegado por separado, y las
     * concatenaciones PROGRESIVAS de los primeros pedazos.
     *
     * Las progresivas hacen falta porque un código puede venir partido en
     * TRES: «QXXD2PT» + «004PQ04-» + «EU» es `QXXD2PT004PQ04-EU`. Con sólo un
     * pedazo quedaba `QXXD2PT004PQ04-`, que no existe, y el renglón se perdía
     * en silencio.
     *
     * Ningún candidato se valida acá. El catálogo descarta los que no existen,
     * y el cargador exige que exista exactamente uno.
     */
    const candidatos = [base]
    for (const p of pedazos) {
      const c = base + p
      if (!candidatos.includes(c)) candidatos.push(c)
    }
    let acumulado = base
    for (const p of pedazos.slice(0, 4)) {
      acumulado += p
      if (!candidatos.includes(acumulado)) candidatos.push(acumulado)
    }

    codigos.push({ linea, base, candidatos, posicion: m.index ?? 0 })
  }

  /*
   * EL EMPAREJAMIENTO: POR POSICIÓN EN EL DOCUMENTO, no por índice.
   *
   * Emparejar la lista de códigos con la lista de importes por índice fue el
   * primer intento y está mal: si falta UN importe —y faltan, porque los
   * últimos renglones salen entreverados con la tabla de totales— todo lo que
   * sigue se corre un lugar, y cada producto queda con el costo del de al
   * lado. El guardia lo frenaba, pero al costo de tirar la factura entera.
   *
   * En el PDF, el código SIEMPRE aparece antes de sus importes. Así que cada
   * cuarteta se asigna al último código aceptado que la precede. Un código sin
   * cuarteta queda sin costo y se informa por su nombre: ese producto no recibe
   * costo de esta factura, que es una pérdida de cobertura y no un error.
   *
   * Los números de renglón ordenan y filtran: se acepta el candidato cuyo
   * número es el que sigue (1, 2, 3…). Eso saca de encima los falsos positivos
   * del regex —fragmentos de la nomenclatura aduanera que parecen códigos—,
   * que en una factura de 16 renglones eran 2.
   */
  const descartados = []

  /*
   * UNA FACTURA PUEDE TRAER VARIOS BLOQUES DE PEDIDO, y cada bloque vuelve a
   * numerar desde 1. La 7070265 es así: dos licencias, las dos como «Línea 1».
   * Con una secuencia estrictamente creciente se leía la primera y se perdía
   * la segunda, sin aviso. Así que cuando no aparece el número que sigue, se
   * admite un reinicio en 1 más adelante en el documento.
   */
  const aceptados = []
  let esperado = 1
  let desde = -1
  for (;;) {
    const siguiente = (n) =>
      codigos.filter((c) => c.linea === n && c.posicion > desde).sort((a, b) => a.posicion - b.posicion)[0]

    let cand = siguiente(esperado)
    if (!cand && esperado > 1) {
      /*
       * Un reinicio sólo vale si en el medio empieza un bloque nuevo de
       * verdad, y eso lo marca el encabezado «Línea Artículo» repetido. Sin
       * esa condición el reinicio aceptaba cualquier cosa que empezara con un
       * número chico: en una factura tomó «5.0AH» como código, porque el «01»
       * de la línea anterior parecía un número de renglón.
       */
      const posible = siguiente(1)
      if (posible) {
        const enMedio = cuerpo.slice(desde, posible.posicion)
        if (/Línea\s+Artículo/.test(enMedio)) cand = posible
      }
    }
    if (!cand) break

    aceptados.push(cand)
    desde = cand.posicion
    esperado = cand.linea + 1
  }

  const sobrantes = codigos.length - aceptados.length
  if (sobrantes > 0) descartados.push(`${sobrantes} candidatos a código descartados por numeración`)

  const renglones = []
  const sinImporte = []

  for (let i = 0; i < aceptados.length; i += 1) {
    const c = aceptados[i]
    const hasta = aceptados[i + 1]?.posicion ?? Number.POSITIVE_INFINITY
    // La cuarteta de este renglón es la primera que cierra entre este código y
    // el siguiente.
    const q = cuartetas.find((x) => x.cierra && x.posicion > c.posicion && x.posicion < hasta)
    if (!q) {
      sinImporte.push(c.candidatos[0])
      continue
    }
    renglones.push({
      linea: c.linea,
      base: c.base,
      candidatos: c.candidatos,
      pais: q.pais,
      cantidad: q.cantidad,
      lista: q.lista,
      descuentoPct: q.dto,
      neto: q.neto,
      // El costo UNITARIO, que es lo que alimenta la fórmula. El neto es el
      // total del renglón, así que se divide por la cantidad: tomar el precio
      // de lista dejaría afuera el descuento, que acá llega al 52 %.
      unitario: Math.round((q.neto / q.cantidad) * 10000) / 10000,
    })
  }

  const suma = Math.round(renglones.reduce((a, r) => a + r.neto, 0) * 100) / 100

  /*
   * La cobertura contra el total de la factura.
   *
   * No se exige igualdad: los renglones que no se pudieron leer faltan a
   * propósito. Lo que NO puede pasar es que la suma SUPERE el total —eso
   * significaría que un importe se contó dos veces—, y eso sí es un error.
   */
  const cobertura = total ? Math.round((suma / total) * 1000) / 10 : null
  const seExcede = total ? suma > total + 0.05 : false
  if (seExcede) descartados.push(`la suma (${suma}) supera el total (${total}): hay importes repetidos`)

  return {
    renglones,
    sinImporte,
    descartados,
    suma,
    total: total ?? null,
    cobertura,
    valida: !seExcede && renglones.length > 0,
  }
}
