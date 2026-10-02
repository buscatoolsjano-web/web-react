/**
 * Por qué falló una herramienta, y qué conviene que el modelo haga (Fase 39). PURO.
 *
 * ── El problema que esto resuelve ───────────────────────────────────────────
 *
 * Hasta acá, cualquier fallo de una RPC le llegaba al modelo con el mismo
 * texto: «La consulta falló. Revisá los parámetros que mandaste y probá de
 * otra forma». La intención era buena —no filtrarle nombres de tablas al
 * modelo— pero convertía TODO en una sugerencia de reintentar.
 *
 * Y se pagó caro. `asistente_ver_documento` apuntaba a dos columnas que no
 * existen, así que fallaba para cualquier documento. El agente leía «probá de
 * otra forma», probaba de otra forma, volvía a fallar, y así SEIS veces hasta
 * quedarse sin vueltas. Terminó contestando a medias una pregunta que tenía
 * respuesta, y encima tardando 46 segundos en no contestarla.
 *
 * Un error de parámetros y una función rota piden conductas opuestas:
 * reintentar con otros argumentos sirve en el primer caso y sólo quema
 * presupuesto en el segundo. Decirle al modelo «reintentá» cuando la
 * herramienta está rota es mandarlo a golpear una puerta tapiada.
 *
 * ── Lo que NO cambia ────────────────────────────────────────────────────────
 *
 * El modelo sigue sin ver el mensaje de Postgres: nombres de tablas y de
 * columnas no le sirven para nada y son información de adentro. Lo que cambia
 * es que ahora recibe una INSTRUCCIÓN distinta según el tipo de fallo, y el
 * mensaje crudo se registra del lado del servidor, que es donde se arregla.
 */

/** Qué clase de fallo fue, en las categorías que cambian la conducta. */
export type ClaseDeFallo = 'parametros' | 'rota' | 'permiso' | 'demora' | 'desconocido'

/**
 * La herramienta está rota: el problema no es lo que mandó el modelo.
 *
 * Son errores de DEFINICIÓN —una columna, una tabla o una función que no
 * existe, tipos que no cierran, sintaxis mal escrita—. Ninguno se arregla
 * cambiando los argumentos, así que reintentar es tiempo y plata tirados.
 */
const ROTA = new Set([
  '42703', // undefined_column
  '42883', // undefined_function
  '42P01', // undefined_table
  '42P02', // undefined_parameter
  '42804', // datatype_mismatch
  '42846', // cannot_coerce
  '42601', // syntax_error
  '42723', // duplicate_function — hay dos sobrecargas y no se puede elegir
])

/**
 * Lo que mandó el modelo no tiene la forma esperada.
 *
 * Acá reintentar SÍ sirve: una fecha escrita «15/09/2026» en vez de
 * «2026-09-15», un texto donde iba un número, un identificador mal copiado.
 */
const PARAMETROS = new Set([
  '22P02', // invalid_text_representation — el caso típico: un uuid o una fecha mal escritos
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22003', // numeric_value_out_of_range
  '22023', // invalid_parameter_value
  'P0001', // raise_exception: la función se quejó a propósito de lo que recibió
])

/** Clasifica por el código de Postgres. Sin código, no se adivina. */
export function clasificarFallo(codigo: string | null | undefined): ClaseDeFallo {
  const c = (codigo ?? '').trim().toUpperCase()
  if (c === '') return 'desconocido'
  if (ROTA.has(c)) return 'rota'
  if (PARAMETROS.has(c)) return 'parametros'
  if (c === '42501') return 'permiso' // insufficient_privilege
  if (c === '57014') return 'demora' // query_canceled: se pasó del tiempo
  return 'desconocido'
}

/**
 * Qué se le dice al modelo, que es lo que decide si reintenta o no.
 *
 * Los textos son imperativos a propósito. Un modelo que lee «no la vuelvas a
 * llamar» deja de llamarla; uno que lee «hubo un problema» la llama igual,
 * porque llamar de nuevo es lo más parecido a hacer algo.
 *
 * Y cuando la herramienta está rota se le dice que SIGA con otra cosa, no que
 * se rinda: la pregunta puede tener respuesta por otro camino, y quien
 * pregunta prefiere media respuesta explicada a un «no pude».
 */
export function instruccionParaElModelo(clase: ClaseDeFallo, herramienta: string): string {
  switch (clase) {
    case 'rota':
      return (
        `La herramienta «${herramienta}» está fallando por un problema del sistema, ` +
        'NO por lo que mandaste: con otros argumentos va a fallar igual. ' +
        'No la vuelvas a llamar. Seguí con otra herramienta, o contestá lo que sí ' +
        'averiguaste y aclará qué parte no pudiste consultar.'
      )
    case 'permiso':
      return (
        'No tenés permiso para leer esto. No reintentes ni pruebes con otros ' +
        'argumentos: decí que ese dato no te corresponde verlo.'
      )
    case 'demora':
      return (
        'La consulta tardó demasiado y se cortó. Probá de nuevo UNA vez pidiendo ' +
        'menos: menos filas, un período más corto o una búsqueda más acotada.'
      )
    case 'parametros':
      return (
        'Los datos que mandaste no tienen la forma que esperaba la consulta. ' +
        'Revisá el formato —las fechas van AAAA-MM-DD— y probá de nuevo.'
      )
    default:
      return 'La consulta falló. Revisá los parámetros que mandaste y probá de otra forma.'
  }
}
