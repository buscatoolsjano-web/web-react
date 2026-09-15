/**
 * Apariencia por usuario (Fase 14 · E0).
 *
 * Catálogo cerrado de opciones. Los colores NO viven acá: cada preset y cada
 * acento es un bloque de tokens en `src/styles/tokens.css`, medido con WCAG
 * AA en `tokens.test.ts`. Este módulo sólo sabe los ids, los nombres y cómo
 * se traducen a atributos del `<html>`.
 *
 * Los ids son los mismos que acepta la base (`app.apariencia_valida`, ver
 * docs/database/PHASE_14_ENTREGA_0_APARIENCIA.sql): un valor que no esté acá
 * se rechaza en el servidor y se ignora en el cliente.
 */

export type Modo = 'claro' | 'oscuro'

export const PRESETS = [
  { id: 'claro-naranja', nombre: 'Claro naranja', modo: 'claro' },
  { id: 'oscuro-naranja', nombre: 'Oscuro naranja', modo: 'oscuro' },
  { id: 'turquesa-marino', nombre: 'Turquesa marino', modo: 'claro' },
  { id: 'violeta-claro', nombre: 'Violeta claro', modo: 'claro' },
  { id: 'azul-marino', nombre: 'Azul marino', modo: 'claro' },
  { id: 'verde-menta-claro', nombre: 'Verde menta claro', modo: 'claro' },
  { id: 'azul-cielo-oscuro', nombre: 'Azul cielo oscuro', modo: 'oscuro' },
  { id: 'azul-noche', nombre: 'Azul noche', modo: 'oscuro' },
  { id: 'azul-corporativo', nombre: 'Azul corporativo', modo: 'claro' },
  { id: 'azul-corporativo-claro', nombre: 'Azul corporativo claro', modo: 'claro' },
  { id: 'gris-pizarra-oscuro', nombre: 'Gris pizarra oscuro', modo: 'oscuro' },
  { id: 'verde-esmeralda', nombre: 'Verde esmeralda', modo: 'oscuro' },
  { id: 'azul-electrico', nombre: 'Azul eléctrico', modo: 'claro' },
  { id: 'verde-industrial', nombre: 'Verde industrial', modo: 'oscuro' },
  { id: 'grafito', nombre: 'Grafito', modo: 'oscuro' },
  { id: 'naranja-oscuro', nombre: 'Naranja oscuro', modo: 'oscuro' },
  { id: 'cian-oscuro', nombre: 'Cian oscuro', modo: 'oscuro' },
] as const satisfies readonly { id: string; nombre: string; modo: Modo }[]

export type PresetId = (typeof PRESETS)[number]['id']

/** `tema` = el acento propio del preset elegido. */
export const ACENTOS = [
  { id: 'tema', nombre: 'Del tema' },
  { id: 'naranja', nombre: 'Naranja' },
  { id: 'azul', nombre: 'Azul' },
  { id: 'turquesa', nombre: 'Turquesa' },
  { id: 'verde', nombre: 'Verde' },
  { id: 'violeta', nombre: 'Violeta' },
  { id: 'rosa', nombre: 'Rosa' },
  { id: 'grafito', nombre: 'Grafito' },
] as const

export type AcentoId = (typeof ACENTOS)[number]['id']

/** Tamaños concretos: nada arbitrario que rompa el layout. */
export const TAMANOS = [
  { id: 'compacto', nombre: 'Compacto', detalle: 'Más información por pantalla' },
  { id: 'normal', nombre: 'Normal', detalle: 'El tamaño original' },
  { id: 'grande', nombre: 'Grande', detalle: 'Texto y controles más grandes' },
] as const

export type TamanoId = (typeof TAMANOS)[number]['id']

/** Sólo fuentes del sistema: no se descarga ninguna fuente externa. */
export const FUENTES = [
  { id: 'sistema', nombre: 'Sistema', detalle: 'La del sistema operativo' },
  { id: 'clasica', nombre: 'Clásica', detalle: 'Arial / Helvetica' },
  { id: 'serif', nombre: 'Serif', detalle: 'Georgia' },
] as const

export type FuenteId = (typeof FUENTES)[number]['id']

export interface Apariencia {
  version: 1
  preset: PresetId
  acento: AcentoId
  tamano: TamanoId
  fuente: FuenteId
}

/** El original oficial de Buscatools. */
export const APARIENCIA_ORIGINAL: Apariencia = {
  version: 1,
  preset: 'claro-naranja',
  acento: 'tema',
  tamano: 'normal',
  fuente: 'sistema',
}

const ids = <T extends { id: string }>(lista: readonly T[]) => new Set(lista.map((x) => x.id))
const PRESET_IDS = ids(PRESETS)
const ACENTO_IDS = ids(ACENTOS)
const TAMANO_IDS = ids(TAMANOS)
const FUENTE_IDS = ids(FUENTES)

export const esOriginal = (a: Apariencia) =>
  a.preset === APARIENCIA_ORIGINAL.preset &&
  a.acento === APARIENCIA_ORIGINAL.acento &&
  a.tamano === APARIENCIA_ORIGINAL.tamano &&
  a.fuente === APARIENCIA_ORIGINAL.fuente

/**
 * Valor guardado → apariencia válida.
 *
 * Lo que no se reconoce cae al original, campo por campo: un preset que se
 * retire en el futuro no deja la pantalla sin estilos ni rompe el resto de
 * la preferencia.
 */
export function normalizarApariencia(valor: unknown): Apariencia {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return APARIENCIA_ORIGINAL
  const v = valor as Record<string, unknown>
  const elegir = <T extends string>(x: unknown, validos: Set<string>, porDefecto: T): T =>
    typeof x === 'string' && validos.has(x) ? (x as T) : porDefecto
  return {
    version: 1,
    preset: elegir(v.preset, PRESET_IDS, APARIENCIA_ORIGINAL.preset),
    acento: elegir(v.acento, ACENTO_IDS, APARIENCIA_ORIGINAL.acento),
    tamano: elegir(v.tamano, TAMANO_IDS, APARIENCIA_ORIGINAL.tamano),
    fuente: elegir(v.fuente, FUENTE_IDS, APARIENCIA_ORIGINAL.fuente),
  }
}

export const modoDe = (preset: PresetId): Modo => PRESETS.find((p) => p.id === preset)?.modo ?? 'claro'

/**
 * Traduce la apariencia a atributos del elemento raíz. Los tokens de
 * `tokens.css` hacen el resto: nada se edita módulo por módulo.
 */
export function aplicarApariencia(a: Apariencia, raiz: HTMLElement = document.documentElement): void {
  raiz.dataset.theme = modoDe(a.preset) === 'oscuro' ? 'dark' : 'light'
  raiz.dataset.apariencia = a.preset
  raiz.dataset.tamano = a.tamano
  raiz.dataset.fuente = a.fuente
  if (a.acento === 'tema') delete raiz.dataset.acento
  else raiz.dataset.acento = a.acento
}

// ── Caché local ─────────────────────────────────────────────────────────────
// La fuente de verdad es `profiles.appearance`. La caché sólo evita el
// destello del tema original al recargar mientras llega el perfil.

const CLAVE = 'bt-apariencia'

export function leerAparienciaGuardada(userId: string): Apariencia | null {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return null
    const { usuario, apariencia } = JSON.parse(crudo) as { usuario?: unknown; apariencia?: unknown }
    return usuario === userId ? normalizarApariencia(apariencia) : null
  } catch {
    return null
  }
}

export function guardarAparienciaLocal(userId: string, a: Apariencia): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ usuario: userId, apariencia: a }))
  } catch {
    /* sin caché: la preferencia sigue en el servidor */
  }
}

export function olvidarAparienciaLocal(): void {
  try {
    localStorage.removeItem(CLAVE)
  } catch {
    /* nada que limpiar */
  }
}

/** Antes de montar React: aplica la última apariencia conocida si hay sesión guardada. */
export function aplicarAparienciaInicial(): void {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo || !localStorage.getItem('bt-auth')) return
    const { apariencia } = JSON.parse(crudo) as { apariencia?: unknown }
    aplicarApariencia(normalizarApariencia(apariencia))
  } catch {
    /* sin caché: arranca el original y el perfil lo corrige */
  }
}

// ── Identidad por módulo ────────────────────────────────────────────────────

export type ModuloConAcento = 'ventas' | 'compras' | 'mantenimiento'

/** Sólo los módulos operativos tienen color propio; el resto usa el acento global. */
export function moduloDeRuta(pathname: string): ModuloConAcento | null {
  const primero = pathname.split('/')[1]
  return primero === 'ventas' || primero === 'compras' || primero === 'mantenimiento' ? primero : null
}
