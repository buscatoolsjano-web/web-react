import type { ReactNode } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'

export interface DocumentHeaderProps {
  /** Enlace de vuelta al listado del tipo («← Cotizaciones»). */
  back: { to: string; label: string }
  /** El número del documento. Es el h1 de la página. */
  numero: ReactNode
  /** Chips de estado. Un documento puede tener más de uno (pedido: comercial + cumplimiento). */
  estados?: ReactNode | undefined
  /** De dónde salió el documento. Va en tono bajo: es contexto, no una alerta. */
  origen?: ReactNode | undefined
  /** Señal efímera junto al estado («Guardando…»). */
  aviso?: ReactNode | undefined
}

/**
 * Identidad de un documento: qué número es y en qué estado está. Nada más.
 *
 * Es la primera de las tres piezas fijas del documento (identidad, acciones,
 * pestañas) y sirve igual para cotización, pedido y remito: lo que cambia es
 * qué se le pasa, no su forma.
 *
 * Fase 28 · E3: antes también repetía el cliente, la fecha, el título y el
 * total. Los cuatro estaban ya en la hoja y en «Información del documento»,
 * dos renglones más abajo, así que lo único que hacían era empujar la barra de
 * acciones y las líneas fuera de la pantalla. Se fueron: la barra sube y se
 * gana una pantalla de alto en cada documento.
 *
 * Se apoya en `PageHeader` en vez de repetir su marcado: así el enlace de
 * vuelta, el único h1 y el comportamiento en mobile son los mismos que en el
 * resto del sistema.
 */
export function DocumentHeader({ back, numero, estados, origen, aviso }: DocumentHeaderProps) {
  return (
    <PageHeader
      back={back}
      title={numero}
      status={
        estados || origen || aviso ? (
          <>
            {estados}
            {origen}
            {aviso}
          </>
        ) : undefined
      }
    />
  )
}
