/*
 * Completa las fotos del filtro guiado: una foto REAL en cada botón.
 *
 * «Ponerle foto a todo.» La lista de fotos por rubro y por tipo
 * (`fotosDeOpcion.generated.json`) estaba escrita a mano y le faltaban rubros
 * enteros —Llaves dinamométricas, Repuestos, EPP…— y tipos sueltos. Esto
 * recorre el catálogo PÚBLICO (las mismas RPC que usa la web, con la clave
 * anónima: sólo lee) y, donde falta una foto, pone la de un producto real de
 * ese rubro o de ese tipo. Las fotos elegidas a mano NO se tocan.
 *
 * Uso:  node scripts/fotos-de-opcion-completar.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const RAIZ = resolve(import.meta.dirname, '..')
const RUTA = join(RAIZ, 'src/modules/publico/lib/fotosDeOpcion.generated.json')

function leerEnv(nombre) {
  if (process.env[nombre]) return process.env[nombre]
  const archivo = join(RAIZ, '.env')
  if (!existsSync(archivo)) return undefined
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && m[1] === nombre) return m[2].replace(/^["']|["']$/g, '').trim()
  }
  return undefined
}

const supabase = createClient(leerEnv('VITE_SUPABASE_URL'), leerEnv('VITE_SUPABASE_ANON_KEY'), {
  auth: { persistSession: false },
})

const fotos = JSON.parse(readFileSync(RUTA, 'utf8'))

/** La miniatura del primer producto con foto de una búsqueda. */
async function fotoDe(categoria, tipo) {
  for (let pagina = 1; pagina <= 3; pagina++) {
    const { data, error } = await supabase.rpc('catalogo_publico_listar', {
      p_categoria: categoria, p_marca: null, p_serie: null, p_tipo: tipo, p_texto: null,
      p_modelo: null, p_atributos: null, p_pagina: pagina, p_por_pagina: 48,
    })
    if (error) throw new Error(`${categoria}/${tipo}: ${error.message}`)
    const productos = Array.isArray(data?.productos) ? data.productos : []
    // La miniatura (400 px): es lo que entra en un botón de 48 px y pesa poco.
    const con = productos.find((p) => p.imagenUrl && /miniaturas\//.test(p.imagenUrl)) ?? productos.find((p) => p.imagenUrl)
    if (con) return con.imagenUrl
    if (productos.length < 48) return null
  }
  return null
}

const { data: categorias, error } = await supabase.rpc('catalogo_publico_categorias')
if (error) throw new Error(error.message)

let agregadas = 0
for (const c of categorias ?? []) {
  const slug = c.slug
  if (!slug) continue
  fotos[slug] ??= {}
  if (!fotos[slug].portada && !c.portadaUrl) {
    const f = await fotoDe(slug, null)
    if (f) {
      fotos[slug].portada = f
      agregadas++
      console.log(`portada ${slug}`)
    }
  }
  const { data: fac, error: e2 } = await supabase.rpc('catalogo_publico_facetas', {
    p_categoria: slug, p_marca: null, p_serie: null, p_tipo: null,
    p_atributos: null, p_texto: null, p_modelo: null, p_rangos: null,
  })
  if (e2) throw new Error(e2.message)
  const tipos = Array.isArray(fac?.tipos) ? fac.tipos : []
  fotos[slug].tipo ??= {}
  for (const t of tipos) {
    const nombre = t.nombre ?? t.valor
    if (!nombre || fotos[slug].tipo[nombre]) continue
    const f = await fotoDe(slug, nombre)
    if (f) {
      fotos[slug].tipo[nombre] = f
      agregadas++
      console.log(`tipo ${slug} / ${nombre}`)
    } else {
      console.log(`  (sin foto) ${slug} / ${nombre}`)
    }
  }
}

writeFileSync(RUTA, `${JSON.stringify(fotos, null, 2)}\n`)
console.log(`listo: ${agregadas} fotos agregadas`)
