/*
 * Fase 90 · foto representativa por opción de filtro. SÓLO LEE.
 *
 * El filtro guiado muestra, en la pregunta "¿qué tipo?", un tile con FOTO REAL
 * por opción (Embocadura, Torx, Phillips…). La foto sale de un producto que
 * tiene esa opción Y tiene foto hosteada —hoy, APEX—, así es real y no
 * inventada. Escribe un JSON que consume el componente.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd=f=>Object.fromEntries(readFileSync(f,'utf8').split('\n').map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'').trim()]))
const env=rd('.env'), mig=rd('.env.migration')
const sb=createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY,{auth:{persistSession:false}})

// categorías públicas (slug ← product_categories.slug_publico)
const { data: cats } = await sb.from('product_categories').select('id, slug_publico, name').eq('publica', true).not('slug_publico','is',null)
const out = {}
for (const c of cats) {
  // productos activos de la categoría con foto hosteada y su tipo
  const { data: prods } = await sb
    .from('products')
    .select('product_type, product_images!inner(source_url, is_primary, storage_path)')
    .eq('category_id', c.id).is('deleted_at', null).eq('status','active')
    .eq('product_images.is_primary', true).like('product_images.storage_path','catalogo-publico/%')
    .limit(4000)
  if (!prods || !prods.length) continue
  const porTipo = {}
  for (const p of prods) {
    const t = p.product_type
    if (!t || porTipo[t]) continue
    const img = Array.isArray(p.product_images) ? p.product_images[0] : p.product_images
    if (img && img.source_url) porTipo[t] = img.source_url
  }
  if (Object.keys(porTipo).length) out[c.slug_publico] = { tipo: porTipo }
}
writeFileSync('src/modules/publico/lib/fotosDeOpcion.generated.json', JSON.stringify(out, null, 0)+'\n', 'utf8')
const n = Object.values(out).reduce((a,c)=>a+Object.keys(c.tipo).length,0)
console.log(`[fase90] ${Object.keys(out).length} categorías, ${n} tipos con foto → fotosDeOpcion.generated.json`)
