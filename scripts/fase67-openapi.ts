/**
 * Escribe los documentos OpenAPI de `erp-api`, sin desplegar nada.
 *
 *   npx vite-node scripts/fase67-openapi.ts
 *
 * (`vite-node` no está en las dependencias: lo baja `npx` en el momento.)
 *
 * Deja en `docs/fase67-chatgpt/` un documento completo y uno por GPT. Los de
 * un GPT son más cortos a propósito: en ChatGPT las acciones salen de UN
 * esquema, así que «el GPT de Ventas ve sólo lo de ventas» no es una
 * instrucción, es un documento con menos operaciones. El reparto se deriva de
 * `agentes.ts`, que ya resolvió qué sabe cada especialista.
 *
 * La función sirve el documento completo en `GET /openapi.json` y ésa es la
 * fuente de verdad; esto existe porque con `verify_jwt` puesto el constructor
 * de GPT no puede ir a buscarlo solo, y porque poder leerlos en una revisión
 * sin levantar nada vale la pena.
 *
 * Se GENERAN, nunca se editan a mano: el día que alguien agregue un parámetro
 * a una RPC, una copia escrita a mano seguiría mandando el viejo y la llamada
 * fallaría sin que nadie supiera por qué.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { documentoOpenAPI, gptsAArmar, herramientasDelGpt } from '../supabase/functions/erp-api/logica.ts'

const url = process.env['VITE_SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? ''
if (url === '') {
  console.error('Falta VITE_SUPABASE_URL en el entorno.')
  process.exit(1)
}

const servidor = `${url.replace(/\/+$/, '')}/functions/v1/erp-api`
const destino = 'docs/fase67-chatgpt'
mkdirSync(destino, { recursive: true })

function escribir(nombre: string, doc: Record<string, unknown>): void {
  const ruta = `${destino}/${nombre}`
  writeFileSync(ruta, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  const ops = Object.keys(doc['paths'] as Record<string, unknown>).length
  console.log(`${ruta} — ${ops} operaciones`)
}

escribir('openapi-completo.json', documentoOpenAPI(servidor))

for (const gpt of gptsAArmar()) {
  escribir(`openapi-${gpt.id}.json`, documentoOpenAPI(servidor, gpt.herramientas))
}

// El de «todo en uno», por si se prefiere un solo GPT en vez de cinco.
escribir('openapi-unico.json', documentoOpenAPI(servidor, herramientasDelGpt('general')))
