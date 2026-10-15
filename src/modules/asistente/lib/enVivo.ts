import type { AvisoEnVivo } from '../services/asistente'

/**
 * Cómo se cuenta en castellano lo que el asistente está haciendo (Fase 65).
 *
 * POR QUÉ UN DICCIONARIO Y NO EL NOMBRE CRUDO. La traza de abajo de cada
 * respuesta se sacó justamente porque decía «Catálogo usó buscar_productos»:
 * nombra piezas internas que no le significan nada a quien pregunta. Mientras
 * se espera sí conviene decir algo —es lo único que hay para mostrar— pero
 * tiene que estar en las palabras de quien mira, no en las del código.
 *
 * Una herramienta que no esté acá cae en una frase genérica en vez de filtrar
 * su identificador a la pantalla: agregar una herramienta nueva y olvidarse
 * de esta tabla no puede terminar en «ejecutando asistente_ranking».
 */
const FRASE_HERRAMIENTA: Record<string, string> = {
  buscar_productos: 'Buscando en el catálogo',
  ficha_producto: 'Abriendo la ficha del producto',
  resumen_catalogo: 'Contando el catálogo',
  stock_actual: 'Mirando el stock',
  buscar_cliente: 'Buscando el cliente',
  historial_del_cliente: 'Revisando lo que se le vendió',
  precios_del_cliente: 'Buscando qué precio se le hizo',
  buscar_documentos: 'Buscando documentos',
  ver_documento: 'Abriendo el documento',
  ranking_comercial: 'Armando el ranking',
  preparar_cotizacion: 'Armando el borrador de la cotización',
  ultimo_costo: 'Buscando el último costo',
  buscar_emails: 'Buscando en el correo',
}

/** Lo que se dice cuando no hay nada más preciso que decir. */
export const FRASE_GENERICA = 'Buscando en el ERP'

/** Antes del primer paso no hay nada que contar todavía. */
export const FRASE_INICIAL = 'Pensando'

/** Un paso, en lo poco que la pantalla necesita de él. */
export interface PasoEnVivo {
  clase: 'herramienta' | 'consulta'
  nombre: string
}

/** Lo que la pantalla muestra mientras espera. */
export interface EstadoEnVivo {
  /**
   * El último paso, CRUDO. La frase se arma al dibujar, no al recibirlo.
   *
   * Guardar la frase ya hecha parecía más simple y tenía un error: para
   * traducir «catalogo» a «Catálogo» hace falta la lista de agentes, que la
   * manda el servidor y puede no haber llegado todavía cuando alguien abre el
   * panel y pregunta de una. Ahí la frase quedaba congelada en la genérica
   * aunque la lista llegara un segundo después. Lo encontró un test.
   */
  paso: PasoEnVivo | null
  /** Lo que el modelo lleva escrito del turno en curso. */
  texto: string
  /** Cuántos pasos reales se vieron. Es lo único que mueve la barra. */
  pasos: number
  /**
   * Cuánto lleva la barra, de 0 a 1 (Fase 69).
   *
   * VIVE EN EL ESTADO Y NO SE CALCULA AL DIBUJAR, por una sola razón: así no
   * puede retroceder. Un agente que empieza a redactar y después usa una
   * herramienta vuelve a un paso anterior —es lo que pasa de verdad—, y una
   * barra que da marcha atrás se lee como que algo se rompió. Se guarda el
   * máximo alcanzado, que es lo que ya se vio.
   */
  avance: number
}

export const EN_VIVO_INICIAL: EstadoEnVivo = { paso: null, texto: '', pasos: 0, avance: 0 }

/**
 * Hasta dónde llega la barra con lo que pasó hasta ahora.
 *
 * ── Por qué una barra, después de haber sacado una ──────────────────────────
 *
 * La Fase 65 sacó una barra que avanzaba SOLA, con un temporizador, acercándose
 * al 92 % sin llegar nunca. Esa fingía saber cuánto faltaba. Ésta no avanza si
 * no pasa nada: cada tramo es un hecho —un agente consultado, una herramienta
 * usada, la respuesta empezando a escribirse— y entre hecho y hecho se queda
 * quieta, aunque la espera se haga larga. Quedarse quieta ES la información:
 * dice que todavía está en lo mismo.
 *
 * ── Por qué cada paso avanza menos que el anterior ──────────────────────────
 *
 * Porque no sabemos cuántos pasos faltan. Una consulta se resuelve en uno y
 * otra encadena seis. Repartiendo en partes iguales, la de seis llegaría al
 * final en el tercero y tendría que esperar ahí, llena, la mitad del tiempo:
 * exactamente la mentira que se sacó. Acortando lo que falta cada vez, la
 * barra siempre tiene a dónde ir y nunca promete el final.
 */
const ARRANQUE = 0.06
const PRIMER_PASO = 0.25
/** Escribiendo la respuesta: lo último que pasa antes de terminar. */
const ESCRIBIENDO = 0.9

export function avanceDe(pasos: number, escribiendo: boolean): number {
  if (escribiendo) return ESCRIBIENDO
  if (pasos <= 0) return ARRANQUE
  return ESCRIBIENDO - (ESCRIBIENDO - PRIMER_PASO) * 0.62 ** (pasos - 1)
}

/**
 * La frase de un paso.
 *
 * `titulo` traduce el id de un agente a como se lo nombra en pantalla
 * —«catalogo» a «Catálogo»—. Viene de afuera porque la lista de agentes la
 * manda el servidor: tener una copia acá es tener una que se desincroniza.
 */
export function fraseDelPaso(paso: PasoEnVivo | null, titulo: (id: string) => string): string {
  if (paso === null) return FRASE_INICIAL
  if (paso.clase === 'consulta') {
    const t = titulo(paso.nombre).trim()
    return t === '' ? FRASE_GENERICA : `Consultando a ${t}`
  }
  return FRASE_HERRAMIENTA[paso.nombre] ?? FRASE_GENERICA
}

/**
 * El estado nuevo después de un aviso.
 *
 * ES UNA FUNCIÓN PURA Y POR ESO SE PUEDE PROBAR. Lo que hay que verificar acá
 * no es que se dibuje algo, sino que `turno` BORRE lo escrito: un agente que
 * empieza a redactar y después decide usar una herramienta dejaría medio
 * párrafo colgado que nunca fue la respuesta, y quien mira no tendría cómo
 * saber que eso se descartó.
 */
export function aplicar(estado: EstadoEnVivo, aviso: AvisoEnVivo): EstadoEnVivo {
  /* La barra se queda con lo más lejos que llegó. Ver `avance`. */
  const hasta = (pasos: number, escribiendo: boolean) => ({
    pasos,
    avance: Math.max(estado.avance, avanceDe(pasos, escribiendo)),
  })

  switch (aviso.tipo) {
    case 'turno':
      // Vuelta nueva: lo de antes no era la respuesta. El paso se conserva
      // —sigue haciendo lo mismo— y lo escrito se tira.
      return { paso: estado.paso, texto: '', ...hasta(estado.pasos, false) }
    case 'paso':
      // Un paso nuevo arranca una espera nueva: lo escrito antes del paso era
      // del turno que acaba de pedirlo, no de la respuesta.
      return {
        paso: { clase: aviso.clase, nombre: aviso.nombre },
        texto: '',
        ...hasta(estado.pasos + 1, false),
      }
    case 'delta':
      return {
        paso: estado.paso,
        texto: estado.texto + aviso.texto,
        ...hasta(estado.pasos, true),
      }
  }
}
