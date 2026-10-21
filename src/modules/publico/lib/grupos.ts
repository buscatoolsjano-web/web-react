/*
 * Grupos del filtro guiado (Fase 92). PURO.
 *
 * «Cuando entrás a Puntas y tubos, que la primera pregunta sea punta o tubo. Y
 * según lo que elijas, se desglosa.»
 *
 * Los 20 `product_type` son demasiados para la primera pregunta. Se juntan en
 * cuatro grupos que una persona reconoce de una: puntas (lo que atornilla),
 * tubos (lo que agarra una tuerca), conexión (lo que une máquina y herramienta)
 * y accesorios. Elegís el grupo y recién ahí aparecen SUS tipos.
 *
 * Es contenido editorial —cómo piensa el que compra—, no un dato del catálogo,
 * así que vive acá y se corrige leyéndolo. El grupo NO filtra solo: es un
 * desglose; lo que filtra es el tipo que elegís adentro.
 */

export interface Grupo {
  clave: string
  label: string
  pista: string
}

/** El orden es el de la pregunta. */
export const GRUPOS: readonly Grupo[] = [
  { clave: 'puntas', label: 'Puntas', pista: 'para atornillar' },
  { clave: 'tubos', label: 'Tubos y embocaduras', pista: 'para tuercas y bulones' },
  { clave: 'conexion', label: 'Conexión', pista: 'extensiones, adaptadores, cardánicos' },
  { clave: 'accesorios', label: 'Accesorios', pista: 'repuestos y complementos' },
]

const DE_TIPO: Record<string, string> = {
  // ── Puntas (la forma de la punta que atornilla) ────────────────────────────
  Allen: 'puntas',
  Torx: 'puntas',
  'Torx Plus': 'puntas',
  'Torx Plus (IP)': 'puntas',
  Phillips: 'puntas',
  Pozidrive: 'puntas',
  Plana: 'puntas',
  Cuadrado: 'puntas',
  'Tri-Wing': 'puntas',
  'Bi-hexagonal': 'puntas',
  Hexagonal: 'puntas',
  'Torq-Set': 'puntas',
  Punta: 'puntas',
  'Destornillador Manual': 'puntas',
  // ── Tubos / embocaduras (agarran la tuerca) ────────────────────────────────
  Embocadura: 'tubos',
  Nutsetter: 'tubos',
  // ── Conexión (une la máquina con la herramienta) ───────────────────────────
  Extensión: 'conexion',
  Adaptador: 'conexion',
  Cardánico: 'conexion',
  'Holder Bit': 'conexion',
  Portapuntas: 'conexion',
  Husillo: 'conexion',
  // ── Accesorios ─────────────────────────────────────────────────────────────
  'Anillo de retención': 'accesorios',
  Accesorio: 'accesorios',
  Imán: 'accesorios',
}

/** El grupo de un tipo. Lo que no está mapeado cae en «accesorios». */
export function grupoDe(tipo: string): string {
  return DE_TIPO[tipo] ?? 'accesorios'
}
