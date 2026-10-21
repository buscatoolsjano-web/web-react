/*
 * Fase 91 · auditar la FAMILIA de cada APEX contra apexbits.com. SÓLO LEE.
 * Compara familias (socket/punta/extensión/…), no etiquetas, para no confundir
 * un sinónimo (Holder Bit = Portapuntas) con un error real (anillo = socket).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const rd=f=>Object.fromEntries(readFileSync(f,'utf8').split('\n').map(l=>l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'').trim()]))
const env=rd('.env'), mig=rd('.env.migration')
const sb=createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY,{auth:{persistSession:false}})
const nid=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const nidZ=s=>nid(s).replace(/^0+(\d)/,'$1').replace(/\b0+(\d)/g,'$1')
const idx=JSON.parse(readFileSync('scripts/.apex/apexbits-index.json','utf8'))
const apx=new Map();for(const p of idx)for(const k of[nid(p.model),nidZ(p.model)])if(k&&!apx.has(k))apx.set(k,p)

// familia REAL según el slug (orden = prioridad)
function familiaSlug(slug){
  const s=slug.toLowerCase()
  if(/(plastic-)?ret-?ring|retaining-ring/.test(s) && !/holder|adapter|adaptor/.test(s)) return 'accesorio'
  if(/\bo-ring\b/.test(s)) return 'accesorio'
  if(/bit-holder|screw-shank.*holder|quick-release.*(chuck|holder)|magnetic-bit-holder|-chuck\b/.test(s)) return 'portapuntas'
  if(/extension/.test(s)) return 'extension'
  if(/universal|swivel-flex|swivel/.test(s)) return 'cardanico'
  if(/nutsetter|nut-setter/.test(s)) return 'nutsetter'
  if(/adapter|adaptor/.test(s)) return 'adaptador'
  if(/insert-bit|power-drive-bit|power-bit|-bits?\b/.test(s)) return 'punta'
  if(/socket/.test(s)) return 'socket'
  return null
}
// familia de NUESTRO product_type
const FAM={Embocadura:'socket','Holder Bit':'portapuntas',Portapuntas:'portapuntas','Extensión':'extension','Cardánico':'cardanico',Adaptador:'adaptador',Nutsetter:'nutsetter', Husillo:'otro'}
const PUNTAS=new Set(['Allen','Torx','Phillips','Pozidrive','Torq-Set','Plana','Cuadrado','Tri-Wing','Bi-hexagonal','Hexagonal','Torx Plus','Torx Plus (IP)','Punta','Destornillador Manual'])
function familiaTipo(t){ if(PUNTAS.has(t))return 'punta'; return FAM[t]??'otro' }

const {data:marca}=await sb.from('brands').select('id').ilike('name','apex').single()
const {data:cats}=await sb.from('product_categories').select('id,name')
const catName=Object.fromEntries(cats.map(c=>[c.id,c.name]))
let desde=0, filas=[]
for(;;){const {data}=await sb.from('products').select('id,sku,product_type,category_id').eq('brand_id',marca.id).is('deleted_at',null).range(desde,desde+999);filas.push(...data);if(data.length<1000)break;desde+=1000}

const errores={}, lista=[]
for(const f of filas){
  const base=(f.sku||'').replace(/^AP\.|^PRO/i,'').replace(/\*/g,'')
  const a=apx.get(nid(base))||apx.get(nidZ(base)); if(!a)continue
  const real=familiaSlug(a.slug); if(!real)continue
  const actual=familiaTipo(f.product_type)
  if(real!==actual && actual!=='otro'){
    const k=`${actual}  →  ${real}`
    errores[k]=(errores[k]||0)+1
    lista.push({sku:f.sku, tipoActual:f.product_type, cat:catName[f.category_id], famActual:actual, famReal:real, slug:a.slug})
  }
}
const orden=Object.entries(errores).sort((a,b)=>b[1]-a[1])
console.log(`ERRORES DE FAMILIA (apexbits manda): ${lista.length}\n`)
for(const[k,n]of orden)console.log(String(n).padStart(4),k)
writeFileSync('scripts/.apex/recategorizar.json', JSON.stringify(lista,null,0))
console.log('\n→ scripts/.apex/recategorizar.json ('+lista.length+' productos)')
