/* Fase 91 · aplica la recategorización de APEX. ESCRIBE product_type/category.
 * Lee el plan (scripts/.apex/plan-recat.json). Reversible desde fase91.categoria_bak. */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd=f=>Object.fromEntries(readFileSync(f,'utf8').split('\n').map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'').trim()]))
const env=rd('.env'), mig=rd('.env.migration')
const sb=createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY,{auth:{persistSession:false}})
const plan=JSON.parse(readFileSync('scripts/.apex/plan-recat.json','utf8'))
let ok=0, err=0
async function aplicar(p){
  const patch={ product_type: p.tipoA }
  if (p.nuevaCat) patch.category_id = p.nuevaCat
  const {error}=await sb.from('products').update(patch).eq('id', p.id)
  if(error){err++; console.error(p.sku, error.message)} else ok++
}
const CONC=10
for(let i=0;i<plan.length;i+=CONC){ await Promise.all(plan.slice(i,i+CONC).map(aplicar)); if((i+CONC)%100<CONC) console.log(`${Math.min(i+CONC,plan.length)}/${plan.length}`) }
console.log(`[recat] LISTO · ok ${ok} · err ${err}`)
