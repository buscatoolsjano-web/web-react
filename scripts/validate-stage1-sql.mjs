/**
 * Validación estática de STAGE_1_SCHEMA.sql antes de ejecutarlo.
 * No se conecta a ninguna base: sólo analiza el texto del DDL.
 */
import { readFileSync } from 'node:fs'
const sql = readFileSync(process.argv[2] ?? 'docs/database/STAGE_1_SCHEMA.sql', 'utf8')
const linesOf = (re) => [...sql.matchAll(re)].map((m) => m[1])
let fallos = 0, avisos = 0
const ok   = (t, d = '') => console.log(`  PASS  ${t}${d ? ' — ' + d : ''}`)
const fail = (t, d = '') => { fallos++; console.log(`  FAIL  ${t}${d ? ' — ' + d : ''}`) }
const warn = (t, d = '') => { avisos++; console.log(`  WARN  ${t}${d ? ' — ' + d : ''}`) }

console.log('=== VALIDACIÓN ESTÁTICA — STAGE_1_SCHEMA.sql ===\n')

// 1. Tablas y orden de dependencias
const tablas = linesOf(/CREATE TABLE (\w+)/g)
console.log(`1. TABLAS (${tablas.length})`)
tablas.length === 15 ? ok('son 15 tablas') : fail(`se esperaban 15, hay ${tablas.length}`)

// 2. FKs: toda referencia debe apuntar a una tabla ya creada (o a auth.users)
console.log('\n2. FOREIGN KEYS Y ORDEN DE DEPENDENCIAS')
const posTabla = new Map(tablas.map((t) => [t, sql.indexOf(`CREATE TABLE ${t}`)]))
let fkTotal = 0, fkMal = 0
for (const m of sql.matchAll(/REFERENCES\s+([\w.]+)\s*\(/g)) {
  fkTotal++
  const destino = m[1]
  if (destino === 'auth.users') continue
  if (!posTabla.has(destino)) { fail(`FK a tabla inexistente: ${destino}`); fkMal++; continue }
  // ¿la referencia aparece dentro de un CREATE TABLE previo a la tabla destino?
  const antes = sql.lastIndexOf('CREATE TABLE ', m.index)
  const tablaActual = /CREATE TABLE (\w+)/.exec(sql.slice(antes))?.[1]
  const esAlter = sql.lastIndexOf('ALTER TABLE', m.index) > antes
  if (!esAlter && tablaActual && posTabla.get(destino) > antes && destino !== tablaActual) {
    fail(`orden: ${tablaActual} referencia ${destino}, que se crea después`); fkMal++
  }
}
fkMal === 0 ? ok(`${fkTotal} FKs, todas hacia tablas ya definidas`) : null

// 3. SECURITY DEFINER con search_path
console.log('\n3. FUNCIONES SECURITY DEFINER')
const funcs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)\s*\(([\s\S]*?)(?:AS\s+\$\$)/g)]
let sd = 0, sdSinPath = []
for (const f of funcs) {
  const cuerpo = f[2]
  if (/SECURITY DEFINER/i.test(cuerpo)) {
    sd++
    if (!/SET\s+search_path\s*=/i.test(cuerpo)) sdSinPath.push(f[1])
  }
}
sdSinPath.length === 0
  ? ok(`${sd} funciones SECURITY DEFINER, todas con SET search_path explícito`)
  : fail(`sin search_path: ${sdSinPath.join(', ')}`)

// 4. RLS habilitado
console.log('\n4. ROW LEVEL SECURITY')
const rls = linesOf(/ALTER TABLE (\w+)\s+ENABLE ROW LEVEL SECURITY/g)
const sinRls = tablas.filter((t) => !rls.includes(t))
sinRls.length === 0 ? ok(`RLS habilitado en las ${rls.length} tablas`)
                    : fail(`sin RLS: ${sinRls.join(', ')}`)

// 5. Ninguna política para anon, ninguna permisiva
console.log('\n5. POLÍTICAS')
const pols = [...sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+(\w+)\s+FOR\s+(\w+)\s+TO\s+([\w, ]+)/g)]
console.log(`  (${pols.length} políticas)`)
const paraAnon = pols.filter((p) => /\banon\b/.test(p[4]))
paraAnon.length === 0 ? ok('ninguna política otorga acceso a anon')
                      : fail(`políticas para anon: ${paraAnon.map((p) => p[1]).join(', ')}`)
const usingTrue = [...sql.matchAll(/USING\s*\(\s*true\s*\)/gi)]
const soloCurrencies = usingTrue.length === 1 && /currencies_select[\s\S]{0,120}USING \(true\)/.test(sql)
soloCurrencies ? ok('único USING (true): currencies (catálogo de monedas, sólo lectura autenticada)')
  : usingTrue.length === 0 ? ok('sin USING (true)')
  : warn(`${usingTrue.length} políticas con USING (true) — revisar`)
const withCheckTrue = [...sql.matchAll(/WITH CHECK\s*\(\s*true\s*\)/gi)]
withCheckTrue.length === 0 ? ok('sin WITH CHECK (true) — el patrón del bug de erp_emails no se repite')
                           : fail(`${withCheckTrue.length} WITH CHECK (true)`)

// 6. stock_balances: sin escritura
console.log('\n6. STOCK_BALANCES INMUTABLE DESDE EL CLIENTE')
const polBal = pols.filter((p) => p[2] === 'stock_balances')
const escrituraBal = polBal.filter((p) => /INSERT|UPDATE|DELETE|ALL/i.test(p[3]))
escrituraBal.length === 0 ? ok(`${polBal.length} política(s), ninguna de escritura`)
                          : fail(`políticas de escritura: ${escrituraBal.map((p) => p[1]).join(', ')}`)
;/REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+stock_balances\s+FROM\s+authenticated/i.test(sql)
  ? ok('REVOKE explícito a authenticated (defensa en profundidad)')
  : fail('falta el REVOKE sobre stock_balances')

// 7. stock_movements: append-only
console.log('\n7. STOCK_MOVEMENTS APPEND-ONLY')
const polMov = pols.filter((p) => p[2] === 'stock_movements')
const mutaMov = polMov.filter((p) => /UPDATE|DELETE|ALL/i.test(p[3]))
mutaMov.length === 0 ? ok(`${polMov.length} políticas (SELECT + INSERT), sin UPDATE ni DELETE para nadie`)
                     : fail(`políticas mutantes: ${mutaMov.map((p) => p[1] + ':' + p[3]).join(', ')}`)

// 8. Triggers: la función y la tabla deben existir
console.log('\n8. TRIGGERS')
const trgs = [...sql.matchAll(/CREATE TRIGGER\s+(\w+)[\s\S]*?ON\s+([\w.]+)[\s\S]*?EXECUTE FUNCTION\s+([\w.]+)\(\)/g)]
const funcNames = new Set(funcs.map((f) => f[1]))
let trgMal = 0
for (const t of trgs) {
  if (!funcNames.has(t[3])) { fail(`trigger ${t[1]} usa función inexistente ${t[3]}`); trgMal++ }
  if (t[2] !== 'auth.users' && !posTabla.has(t[2])) { fail(`trigger ${t[1]} sobre tabla inexistente ${t[2]}`); trgMal++ }
}
trgMal === 0 ? ok(`${trgs.length} triggers, funciones y tablas existentes`) : null

// 9. Secretos y legacy
console.log('\n9. SEGURIDAD')
// Los chequeos de secretos corren sobre el CÓDIGO, no sobre los comentarios:
// mencionar 'service_role' en un comentario explicativo no es usarlo.
const codigo = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
;/service_role/i.test(codigo) ? fail('menciona service_role') : ok('sin service_role')
;/hnyngsejohkmlaccpkux/.test(codigo) ? fail('referencia al Supabase legacy') : ok('sin referencias al Supabase legacy')
;/erp_store|bterp_|sk-ant-/.test(codigo) ? fail('referencias legacy') : ok('sin tablas ni tokens del legacy')
;/CREATE EXTENSION[^;]*vector/i.test(sql) ? fail('instala pgvector') : ok('no instala pgvector')
;/REVOKE ALL ON ALL TABLES\s+IN SCHEMA public FROM anon/i.test(sql)
  ? ok('REVOKE ALL a anon sobre public') : fail('falta REVOKE a anon')
;/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC/i.test(sql)
  ? ok('EXECUTE revocado a PUBLIC en las funciones SECURITY DEFINER')
  : fail('PUBLIC conserva EXECUTE sobre las funciones de app')

// 10. Balance de bloques y sintaxis gruesa
console.log('\n10. ESTRUCTURA')
const dolares = (sql.match(/\$\$/g) || []).length
dolares % 2 === 0 ? ok(`delimitadores $$ balanceados (${dolares})`) : fail(`$$ impares: ${dolares}`)
const par = (sql.match(/\(/g) || []).length - (sql.match(/\)/g) || []).length
par === 0 ? ok('paréntesis balanceados') : fail(`desbalance de paréntesis: ${par}`)
const bloques = (sql.match(/^-- BLOQUE \d/gm) || []).length
bloques === 8 ? ok('8 bloques') : warn(`${bloques} bloques`)

console.log(`\n=== RESULTADO: ${fallos} fallos, ${avisos} avisos ===`)
process.exit(fallos > 0 ? 1 : 0)
