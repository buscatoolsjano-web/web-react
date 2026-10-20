import { useCallback, useEffect, useState } from 'react'
import {
  CLAVE_CARRITO_PUBLICO,
  cantidadDe,
  escribirCarrito,
  leerCarrito,
  ponerCantidad,
  quitar,
  restar,
  sumar,
  unidades,
  type CarritoPublico,
  type ItemPublico,
} from '../lib/carritoPublico'

/**
 * El carrito público, compartido por toda la pestaña (Fase 87 · E3).
 *
 * Misma forma que el del ERP y por los mismos motivos: un conjunto de
 * suscriptores en memoria para que el `+` de una tarjeta actualice el globito
 * del encabezado sin releer `localStorage`, y el evento `storage` para que
 * dos pestañas abiertas no se pisen la lista.
 *
 * `localStorage` puede fallar —ventana privada, permisos, cuota— y ahí el
 * carrito sigue andando en memoria hasta que se cierre la pestaña. Un carrito
 * que se pierde es molesto; una pantalla que no carga porque no pudo leer una
 * preferencia es peor, y acá además esa pantalla es la portada de la empresa.
 */
let memoria: CarritoPublico = leerCarrito(leerSeguro())
const suscriptores = new Set<(c: CarritoPublico) => void>()

function leerSeguro(): string | null {
  try {
    return localStorage.getItem(CLAVE_CARRITO_PUBLICO)
  } catch {
    return null
  }
}

function guardar(c: CarritoPublico) {
  memoria = c
  try {
    localStorage.setItem(CLAVE_CARRITO_PUBLICO, escribirCarrito(c))
  } catch {
    /* sin almacenamiento: vale para esta pestaña */
  }
  for (const avisar of suscriptores) avisar(c)
}

export interface CarritoEnUso {
  items: CarritoPublico
  /** Cuántas unidades en total: el número del globito. */
  unidades: number
  cantidadDe: (sku: string) => number
  agregar: (producto: Omit<ItemPublico, 'cantidad'>, cuantos?: number) => void
  sacar: (sku: string, cuantos?: number) => void
  poner: (producto: Omit<ItemPublico, 'cantidad'>, cantidad: number) => void
  quitar: (sku: string) => void
  vaciar: () => void
}

export function useCarritoPublico(): CarritoEnUso {
  const [items, setItems] = useState<CarritoPublico>(memoria)

  useEffect(() => {
    suscriptores.add(setItems)
    /*
     * Otra pestaña tocó el carrito. `storage` sólo llega a las OTRAS
     * pestañas, así que acá se actualiza la memoria y se avisa a TODOS los
     * suscriptores de ésta —el globito del encabezado y la página del
     * carrito, que pueden estar los dos montados—, y no sólo a este
     * componente.
     */
    const deOtraPestana = (e: StorageEvent) => {
      if (e.key !== CLAVE_CARRITO_PUBLICO) return
      memoria = leerCarrito(e.newValue)
      for (const avisar of suscriptores) avisar(memoria)
    }
    window.addEventListener('storage', deOtraPestana)
    return () => {
      suscriptores.delete(setItems)
      window.removeEventListener('storage', deOtraPestana)
    }
  }, [])

  return {
    items,
    unidades: unidades(items),
    cantidadDe: useCallback((sku: string) => cantidadDe(memoria, sku), []),
    agregar: useCallback((p, cuantos = 1) => guardar(sumar(memoria, p, cuantos)), []),
    sacar: useCallback((sku, cuantos = 1) => guardar(restar(memoria, sku, cuantos)), []),
    poner: useCallback((p, cantidad) => guardar(ponerCantidad(memoria, p, cantidad)), []),
    quitar: useCallback((sku) => guardar(quitar(memoria, sku)), []),
    vaciar: useCallback(() => guardar([]), []),
  }
}
