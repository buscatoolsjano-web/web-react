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
}

export const EN_VIVO_INICIAL: EstadoEnVivo = { paso: null, texto: '' }

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
  switch (aviso.tipo) {
    case 'turno':
      // Vuelta nueva: lo de antes no era la respuesta. El paso se conserva
      // —sigue haciendo lo mismo— y lo escrito se tira.
      return { paso: estado.paso, texto: '' }
    case 'paso':
      // Un paso nuevo arranca una espera nueva: lo escrito antes del paso era
      // del turno que acaba de pedirlo, no de la respuesta.
      return { paso: { clase: aviso.clase, nombre: aviso.nombre }, texto: '' }
    case 'delta':
      return { paso: estado.paso, texto: estado.texto + aviso.texto }
  }
}
