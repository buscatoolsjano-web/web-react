/**
 * Un equipo del documento: alguien principal y quienes lo acompañan (Fase 40).
 *
 * Las mismas tres operaciones sirven para los contactos del cliente y para los
 * vendedores de la casa. Viven acá y no en cada componente porque las reglas
 * que importan son sutiles y no se pueden escribir dos veces esperando que
 * salgan iguales:
 *
 *  · el primero que entra es el principal,
 *  · ascender es un intercambio y no dos pasos,
 *  · sacar al principal asciende al primero que lo acompañaba.
 *
 * Es puro: no sabe de React, de la base ni de si son personas del cliente o de
 * la empresa. Lo único que maneja son ids.
 */
export interface Equipo {
  /** `''` cuando el documento no tiene a nadie. */
  principal: string
  /** Los demás, en el orden en que se muestran y se imprimen. */
  acompanan: string[]
}

/** Todos, con el principal primero. Vacíos afuera. */
export function integrantes(e: Equipo): string[] {
  return [e.principal, ...e.acompanan].filter((id) => id !== '')
}

/**
 * Agregar a alguien.
 *
 * El primero que entra es el PRINCIPAL. Un documento con acompañantes y sin
 * principal es una cabecera que se imprime sin nadie, y eso no lo quiso nadie:
 * lo quiso quien agregó al primero de la lista.
 *
 * Agregar a alguien que ya está no hace nada. No es un error que valga la pena
 * devolver: es un doble clic.
 */
export function agregarAlEquipo(e: Equipo, id: string): Equipo {
  if (id === '' || integrantes(e).includes(id)) return e
  if (e.principal === '') return { principal: id, acompanan: [...e.acompanan] }
  return { principal: e.principal, acompanan: [...e.acompanan, id] }
}

/**
 * Hacer principal: un intercambio, no dos pasos.
 *
 * El que estaba baja a la lista, al final. Hacerlo en una sola operación no es
 * cosmético: quien guarda manda los dos valores juntos, y la base rechaza el
 * estado intermedio —el principal figurando además como acompañante—.
 */
export function hacerPrincipal(e: Equipo, id: string): Equipo {
  if (id === '' || id === e.principal) return e
  const resto = e.acompanan.filter((x) => x !== id)
  return { principal: id, acompanan: e.principal === '' ? resto : [...resto, e.principal] }
}

/**
 * Sacar a alguien.
 *
 * Si es el principal, asciende el primero que lo acompañaba: dejar el
 * documento con acompañantes y sin principal sería dejarlo peor de como
 * estaba.
 */
export function quitarDelEquipo(e: Equipo, id: string): Equipo {
  if (id !== e.principal) {
    return { principal: e.principal, acompanan: e.acompanan.filter((x) => x !== id) }
  }
  const [primero, ...resto] = e.acompanan
  return { principal: primero ?? '', acompanan: resto }
}
