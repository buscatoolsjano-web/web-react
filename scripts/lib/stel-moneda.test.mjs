/*
 * La moneda REAL de un documento de STEL (Fase 201).
 *
 *   node scripts/lib/stel-moneda.test.mjs
 *
 * STEL tuvo un error de carga: ofertas en la moneda base (USD para Buscatools)
 * creadas con la moneda puesta en ARS, con los precios igual escritos en USD.
 * Quedaban como «2623 ARS» cuando eran «2623 USD» —1500× menos—. `monedaReal`
 * corrige SÓLO ese caso (moneda extranjera cuyo valor convertido a la base da
 * un absurdo) y respeta los documentos genuinos en ARS, EUR o USD.
 *
 * Node suelto, sin vitest, como el resto de `scripts/lib/*.test.mjs`.
 */
import { monedaReal } from './stel-reconciliacion.mjs'

let fallos = 0
const chequeo = (nombre, got, esperado) => {
  const ok = got === esperado
  if (!ok) fallos++
  console.log(`${ok ? '✓' : '✗'} ${nombre}${ok ? '' : ` — esperado ${esperado}, dio ${got}`}`)
}

// Caso real COTI02667: USD mal etiquetada ARS (1 USD ≈ 1538 ARS → rate 0.00065).
chequeo('USD mal etiquetada ARS → USD', monedaReal({ 'currency-code': 'ARS', 'currency-rate': 0.00065, 'total-amount': 2623.68 }, 'USD'), 'USD')
// Caso real COTI02271: lo mismo con otra tasa del día.
chequeo('USD mal etiquetada ARS (otra tasa) → USD', monedaReal({ 'currency-code': 'ARS', 'currency-rate': 0.0007, 'total-amount': 1087.19 }, 'USD'), 'USD')
// Caso real COTI02339: ARS genuina (4,79 M ARS ≈ 3450 USD) → se respeta.
chequeo('ARS genuina (millones) → ARS', monedaReal({ 'currency-code': 'ARS', 'currency-rate': 0.00072, 'total-amount': 4791600 }, 'USD'), 'ARS')
// Caso real COTI02371: EUR genuina con base USD → se respeta.
chequeo('EUR genuina (base USD) → EUR', monedaReal({ 'currency-code': 'EUR', 'currency-rate': 1.17813, 'total-amount': 6711.81 }, 'USD'), 'EUR')
// Caso real COV00001 (Torquetools): USD genuina con base EUR → se respeta.
chequeo('USD genuina (base EUR) → USD', monedaReal({ 'currency-code': 'USD', 'currency-rate': 0.87827, 'total-amount': 26178.65 }, 'EUR'), 'USD')
// Documento en la propia base, rate 1 → tal cual.
chequeo('base con rate 1 → base', monedaReal({ 'currency-code': 'USD', 'currency-rate': 1, 'total-amount': 2623.68 }, 'USD'), 'USD')
// Total 0 (sin precios): no se puede juzgar, se respeta lo que diga STEL.
chequeo('total 0 → se respeta el código', monedaReal({ 'currency-code': 'ARS', 'currency-rate': 0.00065, 'total-amount': 0 }, 'USD'), 'ARS')
// Sin base conocida: no se corrige nada.
chequeo('sin moneda base → código tal cual', monedaReal({ 'currency-code': 'ARS', 'currency-rate': 0.00065, 'total-amount': 2623.68 }, null), 'ARS')
// Sin currency-code: null.
chequeo('sin código → null', monedaReal({ 'currency-rate': 1, 'total-amount': 100 }, 'USD'), null)

console.log(fallos === 0 ? '\nTODOS OK' : `\n${fallos} FALLA(S)`)
process.exit(fallos === 0 ? 0 : 1)
