import OpenAI from 'npm:openai@7.17.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_BYTES = 5 * 1024 * 1024
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['razonSocial', 'nombreComercial', 'cuit', 'telefono', 'email', 'rubro', 'notas'],
  properties: {
    razonSocial: { type: ['string', 'null'] }, nombreComercial: { type: ['string', 'null'] }, cuit: { type: ['string', 'null'] },
    telefono: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, rubro: { type: ['string', 'null'] }, notas: { type: ['string', 'null'] },
  },
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Sólo POST.' }, 405)
  const proveedor = (Deno.env.get('CLIENTE_AI_PROVIDER') ?? Deno.env.get('OC_AI_PROVIDER') ?? 'falso').trim()
  const key = Deno.env.get('OPENAI_API_KEY')
  if (proveedor !== 'openai' || !key) return json({ error: 'La extracción de clientes no está configurada.' }, 503)
  const form = await req.formData()
  const archivo = form.get('imagen')
  if (!(archivo instanceof File)) return json({ error: 'No llegó ninguna imagen.' }, 400)
  if (archivo.size > MAX_BYTES || !archivo.type.startsWith('image/')) return json({ error: 'La imagen debe ser válida y pesar menos de 5 MB.' }, 400)
  // Reencode without logging or persisting the document.
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const dataUrl = `data:${archivo.type};base64,${btoa(bin)}`
  const client = new OpenAI({ apiKey: key, timeout: 60_000, maxRetries: 1 })
  try {
    const response = await client.responses.create({
      model: Deno.env.get('CLIENTE_AI_MODEL') ?? 'gpt-5.6-luna', store: false,
      instructions: 'Leé la imagen de una tarjeta, membrete o ficha comercial argentina. Extraé sólo datos visibles del cliente. No inventes valores: usa null cuando no estén.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Completá los datos del cliente.' }, { type: 'input_image', image_url: dataUrl }] }],
      text: { format: { type: 'json_schema', name: 'cliente', strict: true, schema: SCHEMA } },
      max_output_tokens: 800,
    } as unknown as Parameters<typeof client.responses.create>[0])
    const output = (response.output ?? []).flatMap((x) => x.content ?? []).find((x) => x.type === 'output_text') as { text?: string } | undefined
    if (!output?.text) return json({ error: 'La IA no pudo leer datos de la imagen.' }, 422)
    return json({ datos: JSON.parse(output.text) })
  } catch {
    return json({ error: 'No se pudo analizar la imagen. Probá con una foto más nítida.' }, 502)
  }
})
