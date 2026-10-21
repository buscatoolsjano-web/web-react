/*
 * Reconciliación del catálogo APEX contra sus fuentes (Fase 89). SÓLO LEE.
 *
 * Orden de fuentes, como pidió el usuario:
 *   1. apexbits.com (Omega) — índice crawleado por fase89-apex-crawl. Trae la
 *      FOTO REAL de cada producto (mrotools.de) y el título con specs.
 *   2. apexbits.com.ar — products.json, sólo si el producto no está en (1).
 *      Da modelo/encastre/medida/origen; su foto es por familia o ninguna.
 *
 * Propone por producto:
 *   modelo/sku/nombre : sin el `*` (basura de importación).
 *   imagen            : la de apexbits.com si existe (verificada 200); si no,
 *                       la de la familia de .ar; si no, ninguna.
 *   atributos         : se LLENAN huecos, no se pisa lo cargado. Se MARCA el
 *                       «bola» sospechoso (en tipos que no son de bola) para
 *                       que una persona decida; no se toca solo.
 *
 * Salida: scripts/.apex/propuestas.json y /piloto.json. No escribe en la base.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) =>
  Object.fromEntries(
    readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]),
  )
const env = rd('.env')
const mig = rd('.env.migration')
const DIR = 'scripts/.apex'
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const nid = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const nidSinCeros = (s) => nid(s).replace(/\b0+(\d)/g, '$1').replace(/^0+(\d)/, '$1')
const limpiar = (s) => (s ?? '').replace(/\*/g, '').replace(/\s{2,}/g, ' ').trim()

// ── Fuente 1: apexbits.com ──────────────────────────────────────────────────
const idx = JSON.parse(readFileSync(`${DIR}/apexbits-index.json`, 'utf8'))
const apx = new Map()
for (const p of idx) {
  for (const k of [nid(p.model), nidSinCeros(p.model)]) if (k && !apx.has(k)) apx.set(k, p)
}

// ── Fuente 2: apexbits.com.ar ───────────────────────────────────────────────
console.log('[rec] products.json (.ar)…')
const ar = await (await fetch('https://apexbits.com.ar/buscador/products.json')).json()
const arMap = new Map()
for (const p of ar) for (const k of [nid(p.modelo), nid(p.sku), nidSinCeros(p.modelo)]) if (k && !arMap.has(k)) arMap.set(k, p)

// ── Nuestros productos ──────────────────────────────────────────────────────
console.log('[rec] APEX de la base…')
const { data: marca } = await sb.from('brands').select('id').ilike('name', 'apex').single()
let desde = 0, filas = []
for (;;) {
  const { data, error } = await sb.from('products').select('id,sku,name,model_code,product_type,series,attributes,origin_country').eq('brand_id', marca.id).is('deleted_at', null).order('sku').range(desde, desde + 999)
  if (error) throw error
  filas.push(...data)
  if (data.length < 1000) break
  desde += 1000
}

const TIPOS_BOLA = /HEX|TORQ|ALLEN/i // sólo estos usan punta de bola; en otros «bola» es sospechoso
const stats = { total: filas.length, apexbits: 0, soloAr: 0, sinFuente: 0, conAsterisco: 0, fotoApexbits: 0, fotoFamiliaAr: 0, sinFoto: 0, bolaSospechosa: 0 }
const propuestas = []

for (const f of filas) {
  const base = (f.model_code || f.sku.replace(/^AP\.|^PRO/i, '')).replace(/\*/g, '')
  const k = nid(base), kz = nidSinCeros(base)
  const a = apx.get(k) || apx.get(kz) || null
  const b = arMap.get(k) || arMap.get(kz) || null
  if (a) stats.apexbits++
  else if (b) stats.soloAr++
  else stats.sinFuente++

  const tieneAst = /\*/.test(`${f.sku}${f.name}${f.model_code ?? ''}`)
  if (tieneAst) stats.conAsterisco++

  // Atributos: llenar huecos.
  const attrs = { ...(f.attributes ?? {}) }
  const ponerSiFalta = (kk, v) => { if (v != null && String(v).trim() !== '' && (attrs[kk] == null || String(attrs[kk]).trim() === '')) attrs[kk] = String(v).trim() }
  if (b) { ponerSiFalta('encastre', b.encastre && b.encastre.replace(/"/g, '').trim()); if (!/MM/i.test(String(f.model_code))) ponerSiFalta('medida', b.medida_display) }

  // «bola» sospechoso: está cargado pero el tipo no es de bola.
  const bolaMal = Array.isArray(attrs.sufijos) && attrs.sufijos.includes('bola') && !TIPOS_BOLA.test(`${attrs.encastre ?? ''} ${f.product_type ?? ''} ${f.series ?? ''}`)
  if (bolaMal) stats.bolaSospechosa++

  // Imagen.
  let image = null, imgSrc = 'ninguna'
  if (a) { image = a.image; imgSrc = 'apexbits' }
  else if (b && b._raw && b._raw.img_url_original) { image = b._raw.img_url_original; imgSrc = 'familia-ar' }

  propuestas.push({
    id: f.id, fuente: a ? 'apexbits' : b ? 'ar' : 'ninguna', product_type: f.product_type,
    antes: { sku: f.sku, name: f.name, model_code: f.model_code, attributes: f.attributes, origin_country: f.origin_country },
    despues: { sku: limpiar(f.sku), name: limpiar(f.name), model_code: limpiar(f.model_code), attributes: attrs, origin_country: f.origin_country || (b && b.origen) || null },
    imagen: { url: image, src: imgSrc, apexbitsUrl: a && a.url, title: a && a.title },
    bolaSospechosa: bolaMal,
    cambiaSku: limpiar(f.sku) !== f.sku,
  })
}

// Verificar imágenes de apexbits para el PILOTO (no para los 3.887 acá).
async function img200(url) {
  try { const r = await fetch(url, { headers: { 'user-agent': 'buscatools' } }); return r.ok && (+r.headers.get('content-length') || 9999) > 1500 } catch { return false }
}

// Piloto: los `*` + un abanico por tipo + algunos con bola sospechosa.
const conAst = propuestas.filter((p) => /\*/.test(`${p.antes.sku}${p.antes.name}`)).slice(0, 12)
const porTipo = new Map(); for (const p of propuestas) if (p.fuente === 'apexbits' && !porTipo.has(p.product_type)) porTipo.set(p.product_type, p)
const bola = propuestas.filter((p) => p.bolaSospechosa).slice(0, 3)
const pilotoSet = new Map(); for (const p of [...conAst, ...porTipo.values(), ...bola]) pilotoSet.set(p.id, p)
const piloto = [...pilotoSet.values()].slice(0, 26)
for (const p of piloto) { p.imagen.ok = p.imagen.src === 'apexbits' && p.imagen.url ? await img200(p.imagen.url) : false }

mkdirSync(DIR, { recursive: true })
writeFileSync(`${DIR}/propuestas.json`, JSON.stringify(propuestas), 'utf8')
writeFileSync(`${DIR}/piloto.json`, JSON.stringify(piloto, null, 2), 'utf8')
console.log('[rec] RESUMEN', JSON.stringify(stats, null, 2))
console.log(`[rec] piloto ${piloto.length} (imgs ok: ${piloto.filter((p) => p.imagen.ok).length})`)
