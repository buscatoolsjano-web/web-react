/**
 * Un valor de característica escrito a mano, contra los que ya existen. PURO.
 *
 * «Que no pase que uno ponga 1/4 Hex y otro 1/4 HEX y ya se rompa la base.»
 * Antes cada característica era un texto libre y así se juntaron cinco
 * maneras de escribir el mismo encastre. Ahora se elige de una lista, y si
 * hace falta uno nuevo se escribe, pero ANTES de guardarlo se compara con los
 * que ya hay: si es el mismo escrito distinto (mayúsculas, espacios, acentos,
 * comillas), se usa el que ya existe.
 */

/** La forma de comparar: sin mayúsculas, acentos, espacios ni comillas raras. */
export function claveDeComparacion(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[″“”]/g, '"')
    .replace(/[’‘´`]/g, "'")
    .replace(/''/g, '"')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .toLowerCase()
}

/** Espacios de más fuera; el resto como lo escribió la persona. */
export function limpiarValor(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim()
}

export interface ValorResuelto {
  /** Lo que se guarda. */
  valor: string
  /** Si es uno que ya existía (aunque se haya escrito distinto). */
  existente: boolean
  /** Si se escribió distinto del que existía: para avisarlo. */
  corregido: boolean
}

/** El valor que se guarda: el existente si es «el mismo», si no el escrito, limpio. */
export function resolverValor(escrito: string, existentes: readonly string[]): ValorResuelto {
  const limpio = limpiarValor(escrito)
  const clave = claveDeComparacion(limpio)
  const igual = existentes.find((e) => claveDeComparacion(e) === clave)
  if (igual !== undefined) return { valor: igual, existente: true, corregido: igual !== limpio }
  return { valor: limpio, existente: false, corregido: false }
}

/**
 * Las opciones de la lista de una característica: lo que ya usa el rubro (con
 * cuántos productos) más las opciones definidas a mano que nadie usa todavía.
 */
export function opcionesDeAtributo(
  def: { key: string; opciones?: readonly string[] },
  delRubro: ReadonlyMap<string, readonly { valor: string; cantidad: number }[]> | undefined,
): { valor: string; cantidad?: number }[] {
  const usadas = delRubro?.get(def.key) ?? []
  const vistas = new Set(usadas.map((o) => claveDeComparacion(o.valor)))
  const definidas = (def.opciones ?? [])
    .filter((v) => !vistas.has(claveDeComparacion(v)))
    .map((valor) => ({ valor }))
  return [...usadas.map((o) => ({ valor: o.valor, cantidad: o.cantidad })), ...definidas]
}

/** ¿Son todos números? (largo, torque…): ahí conviene un campo numérico, no una lista. */
export function sonTodosNumeros(valores: readonly string[]): boolean {
  return valores.length > 0 && valores.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))
}
