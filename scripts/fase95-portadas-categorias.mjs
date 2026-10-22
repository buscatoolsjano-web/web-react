/*
 * Fase 95 · Portadas de categoría para el filtro guiado del catálogo público.
 *
 * El tile de cada rubro mostraba foto sólo en «Puntas y tubos» y «Accesorios»;
 * el resto caía al ícono dibujado. Acá se completan las portadas que faltan con
 * una foto real de un producto de esa categoría (la misma que ya se sirve en la
 * ficha). Parchea el .generated.json sin tocar los `tipo` ya generados.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RUTA = 'src/modules/publico/lib/fotosDeOpcion.generated.json'
const fotos = JSON.parse(readFileSync(RUTA, 'utf8'))

// Portadas nuevas, por slug público. Foto real de un producto del rubro.
const PORTADAS = {
  balanceadores: 'https://www.buscatool.com/wp-content/uploads/2025/11/CHICAGO_PNEUMATIC_CP991x_BALANCEADOR.jpg',
  atornilladores: 'https://www.buscatool.com/wp-content/uploads/2024/06/FEIN_ASM18-8_71127860000.jpeg',
  'llaves-de-impacto': 'https://www.buscatool.com/wp-content/uploads/2026/06/DUROFIX-RI2036A1-Llave-de-impacto-Jumbo-ETC.png',
  remachadoras: 'https://www.buscatool.com/wp-content/uploads/2026/06/DUROFIX-RV20103-Remachadora-de-tuercas-Rivet-Nut.jpg',
}

for (const [slug, url] of Object.entries(PORTADAS)) {
  fotos[slug] = { ...(fotos[slug] ?? {}), portada: url }
}

writeFileSync(RUTA, JSON.stringify(fotos, null, 2) + '\n')
console.log('[95] portadas:', Object.keys(PORTADAS).join(', '))
console.log('[95] con portada ahora:', Object.keys(fotos).filter((k) => fotos[k].portada).join(', '))
