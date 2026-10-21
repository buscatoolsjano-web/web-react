/*
 * Fase 90/92 · foto representativa por opción del filtro guiado. SÓLO LEE.
 *
 * El filtro guiado muestra foto REAL por opción: por TIPO (Embocadura, Torx…)
 * y por CATEGORÍA (la portada del rubro). La foto sale de un producto que tiene
 * esa opción Y foto hosteada —APEX y SPEEDRILL—, así es real y no inventada.
 * Escribe un JSON que consume el componente.
 *
 * OJO: pagina con `.range` porque un select pelado trunca en 1.000 filas y se
 * perdían tipos (ver memoria «PostgREST trunca en 1.000 filas»).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const { data: cats } = await sb.from('product_categories').select('id, slug_publico, name').eq('publica', true).not('slug_publico', 'is', null)
const out = {}
for (const c of cats) {
  const porTipo = {}
  let portada = null
  let desde = 0
  for (;;) {
    const { data, error } = await sb
      .from('products')
      .select('product_type, product_images!inner(source_url, is_primary, storage_path, position)')
      .eq('category_id', c.id).is('deleted_at', null).eq('status', 'active')
      .eq('product_images.is_primary', true).like('product_images.storage_path', 'catalogo-publico/%')
      .order('product_type')
      .range(desde, desde + 999)
    if (error) throw error
    for (const p of data) {
      const img = Array.isArray(p.product_images) ? p.product_images[0] : p.product_images
      const url = img && img.source_url
      if (!url) continue
      if (!portada) portada = url
      const t = p.product_type
      if (t && !porTipo[t]) porTipo[t] = url
    }
    if (data.length < 1000) break
    desde += 1000
  }
  if (portada || Object.keys(porTipo).length) {
    out[c.slug_publico] = {}
    if (portada) out[c.slug_publico].portada = portada
    if (Object.keys(porTipo).length) out[c.slug_publico].tipo = porTipo
  }
}
writeFileSync('src/modules/publico/lib/fotosDeOpcion.generated.json', JSON.stringify(out, null, 0) + '\n', 'utf8')
const nTipos = Object.values(out).reduce((a, c) => a + Object.keys(c.tipo ?? {}).length, 0)
const nPort = Object.values(out).filter((c) => c.portada).length
console.log(`[fotos] ${Object.keys(out).length} categorías · ${nPort} portadas · ${nTipos} tipos con foto`)
