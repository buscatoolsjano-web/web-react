/* Fase 91 · plan de recategorización. SÓLO LEE. Deriva el tipo/categoría real
 * del slug de apexbits y arma el antes→después, sin escribir. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd=f=>Object.fromEntries(readFileSync(f,'utf8').split('\n').map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'').trim()]))
const env=rd('.env'), mig=rd('.env.migration')
const sb=createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY,{auth:{persistSession:false}})
const nid=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const nidZ=s=>nid(s).replace(/^0+(\d)/,'$1').replace(/\b0+(\d)/g,'$1')
const idx=JSON.parse(readFileSync('scripts/.apex/apexbits-index.json','utf8'))
const apx=new Map();for(const p of idx)for(const k of[nid(p.model),nidZ(p.model)])if(k&&!apx.has(k))apx.set(k,p)

// slug → product_type real (prioridad de arriba hacia abajo)
function tipoReal(slug){
  const s=slug.toLowerCase()
  if((/(plastic-)?ret-?ring|retaining-ring/.test(s)&&!/holder|adapter|adaptor/.test(s))||/\bo-ring\b/.test(s)) return {tipo:'Accesorio', cat:'Accesorios'}
  if(/bit-holder|screw-shank.*holder|quick-release.*(chuck|holder)|magnetic-bit-holder|-chuck\b/.test(s)) return {tipo:'Holder Bit'}
  if(/extension/.test(s)) return {tipo:'Extensión'}
  if(/universal|swivel/.test(s)) return {tipo:'Cardánico'}
  if(/nutsetter|nut-setter/.test(s)) return {tipo:'Nutsetter'}
  if(/adapter|adaptor/.test(s)) return {tipo:'Adaptador'}
  if(/torq-set/.test(s)) return {tipo:'Torq-Set'}
  if(/torx-plus/.test(s)) return {tipo:'Torx Plus'}
  if(/torx/.test(s)) return {tipo:'Torx'}
  if(/phillips/.test(s)) return {tipo:'Phillips'}
  if(/pozidriv/.test(s)) return {tipo:'Pozidrive'}
  if(/tri-wing|triwing/.test(s)) return {tipo:'Tri-Wing'}
  if(/square-recess|robertson/.test(s)) return {tipo:'Cuadrado'}
  if(/slotted/.test(s)) return {tipo:'Plana'}
  if(/socket-head|hex-allen|-allen-/.test(s)) return {tipo:'Allen'}
  if(/socket/.test(s)) return {tipo:'Embocadura'}
  return null
}
const PUNTAS=new Set(['Allen','Torx','Phillips','Pozidrive','Torq-Set','Plana','Cuadrado','Tri-Wing','Bi-hexagonal','Hexagonal','Torx Plus','Torx Plus (IP)','Punta','Destornillador Manual'])
const fam=t=>({Embocadura:'socket','Holder Bit':'portapuntas',Portapuntas:'portapuntas','Extensión':'extension','Cardánico':'cardanico',Adaptador:'adaptador',Nutsetter:'nutsetter',Accesorio:'accesorio'}[t]??(PUNTAS.has(t)?'punta':'otro'))

const {data:marca}=await sb.from('brands').select('id').ilike('name','apex').single()
const {data:cats}=await sb.from('product_categories').select('id,name')
const catId=Object.fromEntries(cats.map(c=>[c.name,c.id])), catName=Object.fromEntries(cats.map(c=>[c.id,c.name]))
let desde=0, filas=[]
for(;;){const {data}=await sb.from('products').select('id,sku,product_type,category_id').eq('brand_id',marca.id).is('deleted_at',null).range(desde,desde+999);filas.push(...data);if(data.length<1000)break;desde+=1000}

const plan=[]
for(const f of filas){
  const base=(f.sku||'').replace(/^AP\.|^PRO/i,'').replace(/\*/g,'')
  const a=apx.get(nid(base))||apx.get(nidZ(base)); if(!a)continue
  const r=tipoReal(a.slug); if(!r)continue
  if(fam(r.tipo)===fam(f.product_type)) continue // misma familia: no es error
  const nuevaCat=r.cat?catId[r.cat]:f.category_id
  plan.push({id:f.id, sku:f.sku, tipoDe:f.product_type, tipoA:r.tipo, catDe:catName[f.category_id], catA:r.cat||catName[f.category_id], nuevaCat})
}
writeFileSync('scripts/.apex/plan-recat.json', JSON.stringify(plan,null,0))
const dist={}; for(const p of plan){const k=p.tipoDe+'  →  '+p.tipoA+(p.catA!==p.catDe?'  [cat: '+p.catDe+'→'+p.catA+']':'');dist[k]=(dist[k]||0)+1}
console.log('PLAN:', plan.length, 'productos\n')
for(const [k,n] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) console.log(String(n).padStart(4), k)
