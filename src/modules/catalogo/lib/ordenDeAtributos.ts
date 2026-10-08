/**
 * El orden de los atributos que vuelven de `catalog_facets` (Fase 43).
 *
 * **El orden de un objeto jsonb no existe.** Postgres normaliza las claves por
 * LARGO y después por bytes, así que `{max_kg, medida, min_kg}` volvía siempre
 * en ese orden —las tres de seis letras, en alfabético— y en Balanceadores se
 * leía «Cap. máx. · Medida · Cap. mín.», que no es un orden que alguien haya
 * elegido.
 *
 * Lo peor es que la función YA traía un `ORDER BY d.position`, tres líneas
 * debajo del `jsonb_object_agg` que lo tiraba. Un ORDER BY que no hace nada y
 * no avisa.
 *
 * Por eso la RPC pasó a devolver un ARRAY, donde el orden es parte de la
 * estructura y no puede volver a perderse en silencio.
 *
 * Vive en `lib/` y no en `services/` a propósito: es lógica pura, sin red, así
 * que su test corre sin `.env` y sin arrastrar el cliente de Supabase.
 */

/** Un atributo tal como lo devuelve la RPC. */
export interface AtributoCrudo {
  key: string
  label: string
  unit: string | null
  /** Desde la Fase 43. Ausente mientras la base no tenga la migración. */
  position?: number
  values: { value: string; count: number }[]
}

/** Lo que devuelve la RPC en `attributes`: array desde la Fase 43, objeto antes. */
export type AtributosCrudos = AtributoCrudo[] | Record<string, Omit<AtributoCrudo, 'key'>>

/**
 * Los atributos, en el orden en que se leen.
 *
 * Se aceptan las DOS formas a propósito. La base y el frontend se despliegan
 * por separado: entre un deploy y el otro una de las dos versiones va a estar
 * vieja, y soportando una sola el catálogo quedaría sin filtros ni columnas
 * ese rato. Cuando las dos estén desplegadas, la rama del objeto sobra.
 *
 * El `sort` no es redundante con el `ORDER BY` de la RPC: es lo que ordena la
 * forma vieja cuando igual trae `position`, y lo que impide que un cambio de
 * agregación en el servidor vuelva a perder el orden sin que nadie lo note.
 *
 * Si NADIE trae `position` —la base todavía sin migrar— se devuelve tal cual
 * vino. Ordenar por clave ahí sería cambiar un orden malo por otro distinto e
 * igual de arbitrario, justo en el rato que hay entre los dos deploys, y
 * encima parecería intencional. Lo que no se puede ordenar bien no se toca.
 */
export function atributosEnOrden(bruto: AtributosCrudos | null | undefined): AtributoCrudo[] {
  const lista = Array.isArray(bruto)
    ? [...bruto]
    : bruto && typeof bruto === 'object'
      ? Object.entries(bruto).map(([key, a]) => ({ key, ...a }))
      : []
  if (!lista.some((a) => a.position !== undefined)) return lista
  return lista.sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.key.localeCompare(b.key, 'es'),
  )
}
