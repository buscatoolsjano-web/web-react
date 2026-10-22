/*
 * Fase 95 · Foto en CADA tile del filtro guiado, no sólo en las categorías.
 *
 * «Foto a todo filtro»: dentro de Puntas y tubos, foto en cada grupo (Puntas,
 * Tubos, Conexión, Accesorios) y en cada tipo (Embocadura, Allen, …); y lo
 * mismo en las demás categorías. La foto es la de un producto real de ese
 * tipo (la misma que ya se sirve en la ficha). Parchea el .generated.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const RUTA = 'src/modules/publico/lib/fotosDeOpcion.generated.json'
const fotos = JSON.parse(readFileSync(RUTA, 'utf8'))
const B = 'https://www.buscatool.com/wp-content/uploads'
const S = 'https://jiudqbusyknubonpedde.supabase.co/storage/v1/object/public/catalogo-publico'

// Foto por tipo, por categoría (foto de un producto real del tipo).
const TIPOS = {
  'puntas-y-tubos': {
    Embocadura: `${S}/apex/13mm03-d-apex-3-8-square-drive-socket-metric-standard-length.jpg`,
    'Extensión': `${S}/apex/ex-504-apex-1-2-square-drive-extension.jpg`,
    Adaptador: `${S}/speedrill/speedrill-s2960c-adaptador-taladro-pasante-1-1.jpg`,
    Allen: `${S}/speedrill/speedrill-s23-em5-100-hexagonal-1.jpg`,
    Torx: `${S}/speedrill/speedrill-vptx10p-50-torx-1.jpg`,
    Phillips: `${S}/speedrill/speedrill-vpph3-70-phillips.jpg`,
    'Cardánico': `${S}/apex/apu56-apex-1-2-square-drive-6-piece-universal-wrench-set-standard-length-sae.jpg`,
    Plana: `${S}/speedrill/speedrill-vppl5.5-50-plana-1.jpg`,
    Nutsetter: `${S}/apex/m6n-0810-5-apex-1-4-power-drive-nutsetter-sae-magnetic.jpg`,
    'Holder Bit': `${S}/apex/490-6-apex-1-4-hex-power-drive-bit-holder-for-1-4-hex-insert-bits.jpg`,
    'Torq-Set': `${S}/apex/170-8A-Apex-5-16-Torq-Set-8-Hex-Power-Drive-Bits.jpg`,
    'Bi-hexagonal': `${S}/speedrill/speedrill-s23-bh10-100-bi-hexagonal-4.jpg`,
    Pozidrive: `${S}/speedrill/speedrill-vppzd3-50-pozidriv.jpg`,
    'Torx Plus': `${S}/speedrill/speedrill-vpip10-50-torx-plus-1-1.jpg`,
    Cuadrado: `${S}/speedrill/speedrill-vpem8-50-hexagonal-1.jpg`,
    Hexagonal: `${S}/speedrill/speedrill-20-5-16vpc-embocadura.jpg`,
    'Tri-Wing': `${S}/apex/TWE-5-Apex-5-16-Tri-Wing-5-Hex-Insert-Bits.jpg`,
    'Torx Plus (IP)': `${S}/speedrill/speedrill-ip40p-ip.jpg`,
    'Imán': `${S}/speedrill/speedrill-spcopmgr.jpg`,
  },
  accesorios: {
    'Anillo de retención': `${S}/apex/10034s-apex-plastic-ret-ring-socket-retaining-ring-with-steel-insert.jpg`,
    Casquillo: `${B}/2026/01/FEIN_30501352020_NARANJA.jpg`,
    'Cabezal angular': `${B}/2025/11/FEIN_ASW18-6_ASW18-12_90102021020-2.jpeg`,
    Funda: `${B}/2025/11/FEIN_FUNDA_PROTECTORA_ACCUTEC_31420120010-1.jpeg`,
    'Batería': `${B}/2025/11/FEIN_BATERIA_92604182020-4.jpeg`,
    'Protector cabezal angular': `${B}/2026/01/FEIN-PROTECTOR-CABEZAL-ANGULAR-HASTA-12-NM.jpg`,
    'Adaptador programación': `${B}/2024/06/FEIN_92604163020-1.jpeg`,
    'Cabezal recto': `${B}/2026/01/FEIN_90106001020_CABEZAL_RECTO.jpg`,
    Cargador: `${B}/2024/06/FEIN_ALG_80_92604180010-3.jpeg`,
    'Herramienta ajuste': `${B}/2024/06/FEIN_32123002006.jpeg`,
    'Llave tuercas ranuradas': `${B}/2026/01/FEIN-LLAVE-PARA-TUERCAS-RANURADAS.jpg`,
    Prolongador: `${B}/2026/01/FEIN-PROLONGACION-ASW-18.jpg`,
    Soporte: `${B}/2026/01/FEIN-SOPORTE-DE-MAQUINA-ASM_ASW.jpg`,
  },
  atornilladores: {
    'Atornillador Pistola': `${B}/2026/02/TORERO-OBN-30PD-DE-0.7-NM-A-0.2-NM-Photoroom.jpg`,
    'Atornillador Recto Neumático': `${B}/2025/08/atornillador-recto-torero-control-torque-digital.png`,
    Gatillo: `${B}/2026/06/DUROFIX-RV2054-3-U8-Herramienta-de-precision.jpg`,
    'Atornillador Angular Neumático': `${B}/2026/02/OBN-50SC-Photoroom.jpg`,
    'Atornillador Angular': `${B}/2024/06/FEIN_ASW18-60_71126460000.jpeg`,
  },
  balanceadores: {
    Balanceador: `${B}/2025/12/Tecna_food_industry_9401RL.jpg`,
  },
  'llaves-de-impacto': {
    Gatillo: `${B}/2026/06/DUROFIX-RI20126-Llave-de-impacto-ETC.webp`,
  },
  remachadoras: {
    Gatillo: `${B}/2026/06/DUROFIX-RV20103-Remachadora-de-tuercas-Rivet-Nut.jpg`,
  },
}

// Foto por GRUPO (sólo Puntas y tubos tiene paso de grupo): un tipo representativo.
const GRUPOS = {
  'puntas-y-tubos': {
    puntas: TIPOS['puntas-y-tubos'].Allen,
    tubos: TIPOS['puntas-y-tubos'].Embocadura,
    conexion: TIPOS['puntas-y-tubos']['Extensión'],
    accesorios: TIPOS.accesorios['Anillo de retención'],
  },
}

for (const [slug, tipos] of Object.entries(TIPOS)) {
  fotos[slug] = { ...(fotos[slug] ?? {}), tipo: { ...(fotos[slug]?.tipo ?? {}), ...tipos } }
}
for (const [slug, grupos] of Object.entries(GRUPOS)) {
  fotos[slug] = { ...(fotos[slug] ?? {}), grupo: { ...(fotos[slug]?.grupo ?? {}), ...grupos } }
}

writeFileSync(RUTA, JSON.stringify(fotos, null, 2) + '\n')
for (const slug of Object.keys(fotos)) {
  const f = fotos[slug]
  console.log(`[95b] ${slug}: tipos ${f.tipo ? Object.keys(f.tipo).length : 0} · grupos ${f.grupo ? Object.keys(f.grupo).length : 0} · portada ${f.portada ? 'sí' : '—'}`)
}
