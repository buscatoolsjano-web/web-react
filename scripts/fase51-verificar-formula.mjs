/*
 * ¿La fórmula PVP = costo × 3 reproduce el Excel de SPEEDRILL? (Fase 51)
 *
 *   node scripts/fase51-verificar-formula.mjs <archivo-json-del-drive>
 *
 * PARA QUÉ. La Fase 49 ancló la carga en «PVP ESPAÑA €», que NO es el costo:
 * es el precio de venta al público en España. El archivo tiene seis columnas y
 * una de ellas es el costo de verdad —«COSTOS BUSCATOOLS ESPAÑA €»—, que es la
 * que tiene que alimentar la fórmula.
 *
 * Antes de recargar 3.630 renglones con otra columna hay que demostrar que la
 * fórmula elegida (×3) reproduce la columna «PVP BUSCATOOLS ARG USD» que el
 * archivo ya trae calculada. Si coincide, la fórmula del ERP va a dar los
 * mismos números que la planilla que se usa hoy, y eso se puede afirmar en vez
 * de suponerlo.
 *
 * SÓLO LEE Y COMPARA. No toca la base.
 *
 * EL PARSEO. Cada renglón termina en el segundo «USD». Partir por comas no
 * sirve: 777 descripciones tienen comas, y así se perdió el 24 % de las filas
 * la primera vez. Se ancla al final de renglón, que es inequívoco.
 */
import fs from 'node:fs'

const ruta = process.argv[2]
if (!ruta) {
  console.error('✗ Falta la ruta del JSON con el contenido del archivo del Drive.')
  process.exit(1)
}

const bruto = JSON.parse(fs.readFileSync(ruta, 'utf8')).fileContent

/*
 * Un renglón: referencia, descripción, y cuatro importes —dos en € y dos en
 * USD—. El último USD cierra el renglón y el siguiente token es la referencia
 * que sigue.
 */
const RENGLON =
  /([A-Z0-9][A-Z0-9/.\-+]*),(.*?),\s*€\s*([\d.,]+)\s*,\s*€\s*([\d.,]+)\s*,\s*([\d.,]+)\s*USD\s*,\s*([\d.,]+)\s*USD/g

const num = (s) => Number(String(s).replace(/,/g, ''))

const filas = []
for (const m of bruto.matchAll(RENGLON)) {
  const [, ref, desc, pvpEs, costoEs, pvpArg, costoArg] = m
  filas.push({
    ref: ref.trim(),
    desc: desc.trim(),
    pvpEs: num(pvpEs),
    costoEs: num(costoEs),
    pvpArg: num(pvpArg),
    costoArg: num(costoArg),
  })
}

console.log(`Renglones parseados: ${filas.length}`)

const usables = filas.filter(
  (f) => [f.pvpEs, f.costoEs, f.pvpArg, f.costoArg].every((x) => Number.isFinite(x) && x > 0),
)
console.log(`Con los cuatro importes: ${usables.length}\n`)

/*
 * Cada hipótesis se mide contra la columna que el archivo ya trae calculada.
 * «Coincide» es a un centavo: el Excel redondea a dos decimales y la cuenta
 * exacta difiere en el último dígito, que no es un desacuerdo.
 */
const hipotesis = [
  { nombre: 'PVP ARG = costo ESPAÑA × 3', calc: (f) => f.costoEs * 3, contra: (f) => f.pvpArg },
  { nombre: 'PVP ARG = PVP ESPAÑA × 1,5', calc: (f) => f.pvpEs * 1.5, contra: (f) => f.pvpArg },
  { nombre: 'costo ESPAÑA = PVP ESPAÑA × 0,50', calc: (f) => f.pvpEs * 0.5, contra: (f) => f.costoEs },
  { nombre: 'costo ARG = costo ESPAÑA × 1,75', calc: (f) => f.costoEs * 1.75, contra: (f) => f.costoArg },
  { nombre: 'PVP ARG = costo ARG × 3', calc: (f) => f.costoArg * 3, contra: (f) => f.pvpArg },
]

for (const h of hipotesis) {
  let ok = 0
  let peor = 0
  let ejemplo = null
  for (const f of usables) {
    const esperado = h.contra(f)
    const dio = h.calc(f)
    const dif = Math.abs(dio - esperado)
    if (dif <= 0.011) ok += 1
    else if (dif > peor) {
      peor = dif
      ejemplo = { ref: f.ref, esperado, dio }
    }
  }
  const pct = ((ok / usables.length) * 100).toFixed(2)
  const marca = ok === usables.length ? '✓' : ok / usables.length > 0.98 ? '≈' : '✗'
  console.log(`${marca} ${h.nombre.padEnd(36)} ${ok}/${usables.length} (${pct} %)`)
  if (ejemplo) {
    console.log(
      `    peor caso: ${ejemplo.ref} esperaba ${ejemplo.esperado.toFixed(2)}, dio ${ejemplo.dio.toFixed(2)}`,
    )
  }
}

/* El múltiplo real del archivo, para no depender de una hipótesis. */
const multiplos = usables.map((f) => f.pvpArg / f.costoEs).sort((a, b) => a - b)
const q = (p) => multiplos[Math.round((multiplos.length - 1) * p)]
console.log(
  `\nPVP ARG / costo ESPAÑA → min ${q(0).toFixed(4)} · mediana ${q(0.5).toFixed(4)} · max ${q(1).toFixed(4)}`,
)
