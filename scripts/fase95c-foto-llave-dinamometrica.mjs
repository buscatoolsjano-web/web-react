/*
 * Fase 95 · Portada de «Llaves dinamométricas».
 *
 * Era la única categoría sin foto (sus 2 GEDORE TSN no la tenían en el sistema
 * y las de los retailers están bot-protegidas). El usuario pasó una foto; se
 * sube al bucket público y se pone de portada. Uso: node <script> <ruta-imagen>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const rd = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').trim()]))
const env = rd('.env'), mig = rd('.env.migration')
const sb = createClient(env.VITE_SUPABASE_URL, mig.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const origen = process.argv[2]
if (!origen) { console.error('falta la ruta de la imagen'); process.exit(1) }
const BUCKET = 'catalogo-publico'
const DESTINO = 'categorias/llaves-dinamometricas.png'

const bytes = readFileSync(origen)
const { error } = await sb.storage.from(BUCKET).upload(DESTINO, bytes, { contentType: 'image/png', upsert: true })
if (error) { console.error('upload:', error.message); process.exit(1) }
const url = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${DESTINO}`
console.log('[95c] subida →', url)

const RUTA = 'src/modules/publico/lib/fotosDeOpcion.generated.json'
const fotos = JSON.parse(readFileSync(RUTA, 'utf8'))
fotos['llaves-dinamometricas'] = { ...(fotos['llaves-dinamometricas'] ?? {}), portada: url }
writeFileSync(RUTA, JSON.stringify(fotos, null, 2) + '\n')
console.log('[95c] portada de llaves-dinamometricas puesta')
