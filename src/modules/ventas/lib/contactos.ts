import type { OpcionContacto } from '../services/opciones'

/**
 * Buscar un contacto dentro de un cliente (Fase 40).
 *
 * El filtro es EN MEMORIA y no contra el servidor, y eso es una decisión, no
 * una simplificación: los contactos de un cliente ya están cargados —vienen
 * todos juntos con el documento— y son pocos. En el maestro real: 87 contactos
 * entre 30 clientes, promedio 2,9, y el más poblado tiene 22. Pedirle al
 * servidor una búsqueda sobre una lista de tres filas que ya está en la
 * pantalla sería agregar latencia para no ganar nada.
 *
 * Los 22 de ese cliente son, igual, el motivo de todo esto: un `<select>` con
 * 22 nombres se recorre a ciegas.
 */

/** Sin tildes y en minúscula: «Pérez» tiene que encontrarse escribiendo «perez». */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Qué contactos se ofrecen, y en qué orden.
 *
 * Un contacto desactivado no se ofrece… salvo que el documento ya lo nombre.
 * En ese caso se muestra, marcado: esconderlo dejaría el campo en blanco y
 * guardar borraría el dato sin que nadie lo pidiera.
 */
export function contactosOfrecidos(
  contactos: readonly OpcionContacto[],
  elegido: string | null,
): OpcionContacto[] {
  return contactos.filter((c) => c.activo || c.id === elegido)
}

/**
 * Los que coinciden con el texto.
 *
 * Se busca por nombre, cargo, email y teléfono. El teléfono se compara por
 * dígitos: nadie recuerda si lo cargaron con guiones, paréntesis o espacios.
 */
export function filtrarContactos(
  contactos: readonly OpcionContacto[],
  texto: string,
): OpcionContacto[] {
  const q = normalizar(texto)
  if (q === '') return [...contactos]
  const soloDigitos = q.replace(/\D/g, '')

  return contactos.filter((c) => {
    const campos = [c.nombre, c.rol ?? '', c.email ?? ''].map(normalizar)
    if (campos.some((x) => x.includes(q))) return true
    if (soloDigitos.length >= 3 && c.telefono) {
      return c.telefono.replace(/\D/g, '').includes(soloDigitos)
    }
    return false
  })
}

/** «Compras · ana@acme.com»: lo que distingue a dos personas con el mismo nombre. */
export function detalleDeContacto(c: OpcionContacto): string {
  return [c.rol, c.email].filter((x): x is string => !!x && x.trim() !== '').join(' · ')
}

/** Cómo se lee el contacto elegido cuando el buscador está cerrado. */
export function etiquetaDeContacto(c: OpcionContacto | undefined): string {
  if (!c) return 'Sin contacto'
  return c.rol ? `${c.nombre} · ${c.rol}` : c.nombre
}
