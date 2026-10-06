import type { IconName } from '@/components/icons/Icon'
import type { ContactoCliente } from '../types'

/**
 * Cómo se miran los contactos de un cliente (Fase 40).
 *
 * Dos formas, porque son dos usos distintos:
 *
 *  · **Tarjetas** para leer una ficha: el nombre grande, el mail clickeable,
 *    las notas enteras. Es lo que servía cuando el cliente tiene dos o tres.
 *  · **Lista** para encontrar a alguien entre muchos: una fila por persona,
 *    todas las columnas alineadas, el ojo baja en vertical. El cliente más
 *    poblado del maestro tiene 22 contactos y en tarjetas ocupan tres
 *    pantallas.
 */
export type VistaContactos = 'tarjetas' | 'lista'

/** Las dos formas, con su icono, para el selector. */
export const VISTAS: { valor: VistaContactos; etiqueta: string; icono: IconName }[] = [
  { valor: 'tarjetas', etiqueta: 'Tarjetas', icono: 'package' },
  { valor: 'lista', etiqueta: 'Lista', icono: 'menu' },
]

/**
 * A partir de cuántos contactos aparece el buscador.
 *
 * Con tres, un campo de búsqueda es un control de más que hay que mirar y
 * descartar. El número sale de los datos: el promedio real es 2,9 y sólo cinco
 * clientes pasan de cinco contactos.
 */
export const DESDE_CUANTOS_SE_BUSCA = 6

const CLAVE = 'bt-vista-contactos'

/**
 * La preferencia se guarda, porque es una preferencia.
 *
 * Quien trabaja con el cliente de 22 contactos quiere la lista siempre, y
 * volver a elegirla en cada ficha es exactamente la clase de fricción que hace
 * que nadie use la función. Es sólo comodidad de interfaz: si el storage está
 * bloqueado, se usa el modo por defecto y listo.
 */
export function leerVistaContactos(): VistaContactos {
  try {
    return localStorage.getItem(CLAVE) === 'lista' ? 'lista' : 'tarjetas'
  } catch {
    return 'tarjetas'
  }
}

export function guardarVistaContactos(v: VistaContactos): void {
  try {
    localStorage.setItem(CLAVE, v)
  } catch {
    /* sin persistencia; la pantalla funciona igual */
  }
}

/** Sin tildes y en minúscula: «Pérez» se encuentra escribiendo «perez». */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Los contactos que coinciden con el texto.
 *
 * Por nombre, cargo, email y teléfono. El teléfono se compara por dígitos:
 * nadie se acuerda de si lo cargaron con guiones, paréntesis o espacios.
 */
export function filtrarContactosDelCliente(
  contactos: readonly ContactoCliente[],
  texto: string,
): ContactoCliente[] {
  const q = normalizar(texto)
  if (q === '') return [...contactos]
  const soloDigitos = q.replace(/\D/g, '')

  return contactos.filter((c) => {
    const campos = [c.nombre, c.cargo ?? '', c.email ?? ''].map(normalizar)
    if (campos.some((x) => x.includes(q))) return true
    if (soloDigitos.length >= 3 && c.telefono) {
      return c.telefono.replace(/\D/g, '').includes(soloDigitos)
    }
    return false
  })
}
