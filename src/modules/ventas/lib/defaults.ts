import type { Borrador, CampoCabecera } from './borrador'

/**
 * Los defaults comerciales del cliente, aplicados a un documento NUEVO
 * (Fase 17 · E2).
 *
 * La regla, que es la que sostiene todo lo demás:
 *
 *   **el cliente SUGIERE, el documento CONGELA.**
 *
 * Un default entra sólo en un borrador que todavía no se guardó, y sólo en un
 * campo que la persona no tocó. Una vez guardado, el documento tiene sus
 * propios valores y cambiar la ficha del cliente no los mueve: por eso
 * cotizar en marzo con la tarifa vieja sigue diciendo lo mismo en diciembre.
 *
 * Prioridad, de mayor a menor:
 *
 *   1. lo que eligió la persona;
 *   2. el default del cliente;
 *   3. lo que ya traía el borrador nuevo (la forma de pago habitual).
 *
 * Y una salvedad que importa: **un valor inválido no se conserva por haber
 * sido manual**. Si la tarifa elegida no existe en la empresa o quedó en otra
 * moneda, se limpia y se dice por qué.
 */

export interface DefaultsComerciales {
  vendedorId: string | null
  tarifaId: string | null
  formaPago: string | null
  moneda: string | null
}

/** Los cuatro campos que el cliente puede sugerir. */
export type CampoSugerible = Extract<
  CampoCabecera,
  'vendedorId' | 'listaPrecioId' | 'formaPago' | 'moneda'
>

export const CAMPOS_SUGERIBLES: CampoSugerible[] = [
  'vendedorId',
  'listaPrecioId',
  'formaPago',
  'moneda',
]

export interface OpcionesValidas {
  /** Las tarifas de la empresa, con su moneda. */
  tarifas: readonly { id: string; nombre: string; moneda: string }[]
  /** Los usuarios que pueden vender en la empresa. */
  vendedores: readonly { id: string; nombre: string }[]
}

export interface ResultadoDefaults {
  borrador: Borrador
  /** Qué campos se completaron con el default del cliente. */
  aplicados: CampoSugerible[]
  /** Qué se limpió o no se pudo aplicar, dicho en castellano. */
  avisos: string[]
}

const VACIO: DefaultsComerciales = {
  vendedorId: null,
  tarifaId: null,
  formaPago: null,
  moneda: null,
}

/**
 * Aplica los defaults del cliente sobre el borrador.
 *
 * Se llama al elegir un cliente y también al cambiar la moneda: una tarifa que
 * no se pudo sugerir porque el documento todavía no tenía moneda, se sugiere
 * cuando la moneda aparece.
 */
export function aplicarDefaults(
  b: Borrador,
  defaults: DefaultsComerciales | null,
  tocados: ReadonlySet<CampoSugerible>,
  opciones: OpcionesValidas,
): ResultadoDefaults {
  const d = defaults ?? VACIO
  const cabecera = { ...b.cabecera }
  const aplicados: CampoSugerible[] = []
  const avisos: string[] = []

  // ── 1 · Moneda. Va primero porque decide qué tarifas son válidas.
  if (!tocados.has('moneda') && d.moneda && cabecera.moneda !== d.moneda) {
    cabecera.moneda = d.moneda
    aplicados.push('moneda')
  }

  // ── 2 · Vendedor. El default viejo de un cliente puede apuntar a alguien
  //       que ya no está: no se aplica y se dice, pero no frena el alta.
  const vendedorValido = (id: string) => opciones.vendedores.some((v) => v.id === id)

  if (tocados.has('vendedorId')) {
    if (cabecera.vendedorId !== '' && !vendedorValido(cabecera.vendedorId)) {
      cabecera.vendedorId = ''
      avisos.push('El vendedor que habías elegido ya no está disponible: se quitó.')
    }
  } else if (d.vendedorId) {
    if (vendedorValido(d.vendedorId)) {
      if (cabecera.vendedorId !== d.vendedorId) {
        cabecera.vendedorId = d.vendedorId
        aplicados.push('vendedorId')
      }
    } else {
      if (cabecera.vendedorId !== '') cabecera.vendedorId = ''
      avisos.push('El vendedor predeterminado del cliente ya no está disponible.')
    }
  } else if (cabecera.vendedorId !== '') {
    // El cliente nuevo no tiene vendedor y el anterior lo había puesto: se
    // quita, porque venía del cliente que ya no es.
    cabecera.vendedorId = ''
  }

  // ── 3 · Tarifa, contra la moneda que quedó.
  const tarifaDe = (id: string) => opciones.tarifas.find((t) => t.id === id) ?? null
  const moneda = cabecera.moneda

  if (tocados.has('listaPrecioId')) {
    const elegida = cabecera.listaPrecioId === '' ? null : tarifaDe(cabecera.listaPrecioId)
    if (cabecera.listaPrecioId !== '' && elegida === null) {
      cabecera.listaPrecioId = ''
      avisos.push('La tarifa que habías elegido no es de esta empresa: se quitó.')
    } else if (elegida && moneda !== '' && elegida.moneda !== moneda) {
      cabecera.listaPrecioId = ''
      avisos.push(`La tarifa que habías elegido está en ${elegida.moneda} y el documento en ${moneda}: se quitó.`)
    }
  } else if (d.tarifaId) {
    const sugerida = tarifaDe(d.tarifaId)
    if (!sugerida) {
      if (cabecera.listaPrecioId !== '') cabecera.listaPrecioId = ''
      avisos.push('La tarifa predeterminada del cliente no es de esta empresa: no se aplicó.')
    } else if (moneda === '') {
      // Todavía no hay moneda: no se inventa ninguna. Cuando se elija, esta
      // misma función vuelve a correr y la tarifa entra si es compatible.
      if (cabecera.listaPrecioId !== '') cabecera.listaPrecioId = ''
    } else if (sugerida.moneda !== moneda) {
      if (cabecera.listaPrecioId !== '') cabecera.listaPrecioId = ''
      avisos.push(
        `La tarifa predeterminada del cliente (${sugerida.nombre}) está en ${sugerida.moneda} y el documento en ${moneda}: no se aplicó.`,
      )
    } else if (cabecera.listaPrecioId !== sugerida.id) {
      cabecera.listaPrecioId = sugerida.id
      aplicados.push('listaPrecioId')
    }
  } else if (cabecera.listaPrecioId !== '') {
    cabecera.listaPrecioId = ''
  }

  // ── 4 · Forma de pago. Es texto libre: no hay nada que validar.
  if (!tocados.has('formaPago') && d.formaPago && cabecera.formaPago !== d.formaPago) {
    cabecera.formaPago = d.formaPago
    aplicados.push('formaPago')
  }

  return { borrador: { ...b, cabecera }, aplicados, avisos }
}
