import { useCallback, useEffect, useState } from 'react'
import {
  CLAVE_CARRITO,
  cantidadDe,
  escribirCarrito,
  leerCarrito,
  ponerCantidad,
  restar,
  sumar,
  unidades,
  type Carrito,
} from '../lib/carrito'

/**
 * El carrito, compartido por toda la pestaña.
 *
 * El legacy lo guarda en `localStorage` y lo relee en cada render, así que
 * sobrevive a cambiar de filtro, de página, de sección y a recargar. Acá pasa
 * lo mismo, con dos agregados que el legacy no necesitaba porque redibujaba
 * todo a mano:
 *
 *  1. un conjunto de suscriptores en memoria, para que el `+` de una fila
 *     actualice la barra de abajo sin volver a leer `localStorage`;
 *  2. el evento `storage`, para que dos pestañas abiertas no se pisen el
 *     carrito.
 *
 * `localStorage` puede fallar —ventana privada, permisos, cuota— y en ese
 * caso el carrito sigue funcionando en memoria hasta que se cierre la
 * pestaña. Un carrito que se pierde es molesto; una pantalla que no carga
 * porque no pudo leer una preferencia es peor.
 */
let memoria: Carrito = leerCarrito(leerSeguro())
const suscriptores = new Set<(c: Carrito) => void>()

function leerSeguro(): string | null {
  try {
    return localStorage.getItem(CLAVE_CARRITO)
  } catch {
    return null
  }
}

function guardar(c: Carrito) {
  memoria = c
  try {
    localStorage.setItem(CLAVE_CARRITO, escribirCarrito(c))
  } catch {
    /* sin persistencia: el carrito vive hasta cerrar la pestaña */
  }
  for (const avisar of suscriptores) avisar(c)
}

/** Para que otra pantalla lo consuma sin ser un componente (Ventas). */
export function carritoActual(): Carrito {
  return memoria
}

export function vaciarCarrito() {
  guardar([])
}

export function useCarrito() {
  const [carrito, setCarrito] = useState<Carrito>(memoria)

  useEffect(() => {
    suscriptores.add(setCarrito)
    // Otra pestaña lo cambió: `storage` sólo llega a las OTRAS pestañas.
    const desdeOtraPestana = (e: StorageEvent) => {
      if (e.key !== CLAVE_CARRITO) return
      memoria = leerCarrito(e.newValue)
      for (const avisar of suscriptores) avisar(memoria)
    }
    window.addEventListener('storage', desdeOtraPestana)
    return () => {
      suscriptores.delete(setCarrito)
      window.removeEventListener('storage', desdeOtraPestana)
    }
  }, [])

  const producto = useCallback(
    (p: { id: string; sku: string; nombre: string }) => ({
      cantidad: cantidadDe(carrito, p.id),
      sumar: () => guardar(sumar(memoria, p)),
      restar: () => guardar(restar(memoria, p)),
      poner: (n: number) => guardar(ponerCantidad(memoria, p, n)),
    }),
    [carrito],
  )

  return {
    carrito,
    unidades: unidades(carrito),
    producto,
    vaciar: () => guardar([]),
    cantidadDe: (id: string) => cantidadDe(carrito, id),
  }
}
