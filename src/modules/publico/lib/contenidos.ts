/**
 * Los textos del sitio público que no salen de la base: las marcas, las guías
 * «cómo elegir» de cada categoría y las páginas institucionales.
 *
 * Viven en un módulo PURO (sin React ni Supabase) porque los usan dos lados:
 * las páginas, y el prerender (`scripts/fase88-prerender.mjs`), que escribe el
 * mismo texto en el HTML para que el buscador lea lo que ve una persona.
 *
 * Regla para las marcas: sólo se afirma lo que se puede sostener. Las marcas
 * sin texto propio se describen con lo que dice el catálogo (cuántos
 * productos y de qué categorías), sin inventarles origen ni historia.
 */

/** Una marca que no es marca («Genérico»): no se ofrece, no se cuenta, no tiene página. */
export const esGenerica = (nombre: string): boolean => /^gen[eé]ric[oa]s?$/i.test(nombre.trim())

export interface TextoDeMarca {
  /** Una línea: qué es la marca. */
  bajada: string
  /** Uno o dos párrafos. */
  parrafos: readonly string[]
}

export const MARCAS: Readonly<Record<string, TextoDeMarca>> = {
  tecna: {
    bajada: 'Balanceadores de herramientas fabricados en Italia.',
    parrafos: [
      'TECNA diseña y fabrica en Italia balanceadores para colgar y equilibrar herramientas en el puesto de trabajo: el operario trabaja sin cargar el peso y la herramienta vuelve sola a su lugar.',
      'La línea cubre desde fracciones de kilo, para atornilladores livianos, hasta decenas de kilos para equipos pesados. Te ayudamos a elegir el modelo según el peso de la herramienta y el recorrido del cable.',
    ],
  },
  'ingersoll-rand': {
    bajada: 'Herramientas industriales neumáticas y eléctricas, y balanceadores.',
    parrafos: [
      'Ingersoll Rand es una de las marcas de referencia en herramientas para la industria: atornilladores, llaves de impacto y balanceadores pensados para trabajo continuo en planta.',
      'En el catálogo vas a encontrar sus balanceadores por rango de carga y herramientas de ajuste. Si tenés un modelo en uso, te buscamos el reemplazo o el equivalente.',
    ],
  },
  'chicago-pneumatic': {
    bajada: 'Herramientas neumáticas y balanceadores para la industria.',
    parrafos: [
      'Chicago Pneumatic fabrica herramientas neumáticas para producción y mantenimiento, y balanceadores para el puesto de trabajo.',
      'Consultanos por el rango de carga o la herramienta que necesitás y te recomendamos el modelo.',
    ],
  },
  fein: {
    bajada: 'Herramientas eléctricas alemanas; atornilladores a batería con control de torque.',
    parrafos: [
      'FEIN es un fabricante alemán de herramientas eléctricas profesionales. Para montaje industrial, su línea AccuTec de atornilladores a batería controla el torque en cada ajuste y deja registro del trabajo.',
      'Te ayudamos a elegir el modelo según el rango de torque y el tipo de unión, y a sumar las puntas y accesorios que hacen falta.',
    ],
  },
  tohnichi: {
    bajada: 'Herramientas de torque fabricadas en Japón.',
    parrafos: [
      'TOHNICHI es un fabricante japonés especializado en herramientas de torque: llaves dinamométricas, destornilladores dinamométricos y equipos para medir y verificar el ajuste.',
      'Es la marca con más modelos en nuestra categoría de llaves dinamométricas. Contanos el rango de torque y el encastre y te indicamos el modelo.',
    ],
  },
  apex: {
    bajada: 'Puntas, tubos y embocaduras para atornillado industrial.',
    parrafos: [
      'APEX es una marca de Apex Tool Group especializada en puntas, tubos, embocaduras y adaptadores para atornilladores y llaves de impacto en líneas de producción.',
      'Tenemos miles de referencias por encastre, medida y largo. Si tenés el código del fabricante, buscalo directamente en el catálogo.',
    ],
  },
  fiam: {
    bajada: 'Atornilladores neumáticos y eléctricos para montaje, fabricados en Italia.',
    parrafos: [
      'FIAM es un fabricante italiano de atornilladores y sistemas de atornillado para montaje industrial, neumáticos y eléctricos, con control de torque.',
      'En el catálogo están sus herramientas y una gran cantidad de repuestos. Si necesitás un repuesto puntual, buscalo por el código de FIAM.',
    ],
  },
  speedrill: {
    bajada: 'Puntas, embocaduras y tubos para atornillado industrial.',
    parrafos: [
      'SPEEDRILL fabrica puntas, embocaduras, tubos y adaptadores para atornilladores y llaves de impacto, en encastres hexagonales y cuadrados.',
      'Es la marca con más referencias del catálogo. Filtrá por encastre, medida y largo para encontrar la que necesitás.',
    ],
  },
  torero: {
    bajada: 'Atornilladores eléctricos con control de torque.',
    parrafos: [
      'TORERO ofrece atornilladores eléctricos con control de torque para líneas de ensamble, en distintos rangos y formatos.',
      'Te ayudamos a elegir el modelo según el torque de la unión y el puesto de trabajo.',
    ],
  },
}

/**
 * El texto de una marca: el propio o uno armado con el catálogo.
 * `categorias` son las categorías donde tiene productos, de más a menos.
 */
export function textoDeMarca(
  slug: string,
  nombre: string,
  cuantos: number,
  categorias: readonly string[],
): TextoDeMarca {
  const propio = MARCAS[slug]
  if (propio) return propio
  const enQue =
    categorias.length === 0
      ? ''
      : ` en ${categorias.length === 1 ? categorias[0] : `${categorias.slice(0, -1).join(', ')} y ${categorias[categorias.length - 1]}`}`
  return {
    bajada: `${cuantos.toLocaleString('es-AR')} productos de ${nombre}${enQue}.`,
    parrafos: [
      `Trabajamos con productos originales de ${nombre}. Abajo están los que tenemos en el catálogo; si buscás un modelo o un repuesto que no aparece, consultanos y lo buscamos.`,
    ],
  }
}

// ── Guías «cómo elegir» de cada categoría ────────────────────────────────────

export interface GuiaDeCategoria {
  titulo: string
  intro: string
  /** Los criterios para elegir: título corto y explicación. */
  criterios: readonly { titulo: string; texto: string }[]
  preguntas: readonly { pregunta: string; respuesta: string }[]
}

export const GUIAS: Readonly<Record<string, GuiaDeCategoria>> = {
  'puntas-y-tubos': {
    titulo: 'Cómo elegir puntas, tubos y embocaduras',
    intro:
      'La punta o el tubo es la parte que toca el tornillo: si no es la correcta, la unión se daña y la herramienta pierde precisión. Antes de elegir, mirá estas cuatro cosas.',
    criterios: [
      { titulo: 'Encastre', texto: 'Tiene que coincidir con la herramienta: hexagonal de 1/4" para atornilladores, cuadrado de 1/4", 3/8", 1/2" o 3/4" para llaves y tubos.' },
      { titulo: 'Perfil y medida', texto: 'Phillips, Pozidriv, Torx, hexagonal, plana: el perfil y el número tienen que ser los del tornillo. Una medida de más o de menos redondea la cabeza.' },
      { titulo: 'Largo', texto: 'El necesario para llegar al tornillo sin forzar. Un largo de más agrega vibración y quita precisión.' },
      { titulo: 'Uso con impacto', texto: 'Si la herramienta es de impacto, usá puntas y tubos preparados para impacto: los comunes se quiebran.' },
    ],
    preguntas: [
      { pregunta: '¿Qué diferencia hay entre una punta y una embocadura?', respuesta: 'La punta va directo en el encastre de la herramienta. La embocadura (o porta puntas) es un adaptador que sostiene la punta o el tubo y permite cambiarlos rápido.' },
      { pregunta: '¿Tienen puntas magnéticas?', respuesta: 'Sí, hay modelos magnéticos que sostienen el tornillo mientras se acerca a la pieza. En el catálogo podés filtrar por tipo.' },
    ],
  },
  repuestos: {
    titulo: 'Cómo encontrar el repuesto correcto',
    intro:
      'Un repuesto equivocado es una herramienta parada más tiempo. Para encontrar el correcto, lo más seguro es buscar por el código del fabricante.',
    criterios: [
      { titulo: 'Código del fabricante', texto: 'Está en el despiece o el manual de la herramienta. Buscalo tal cual en el catálogo: es la forma más precisa.' },
      { titulo: 'Modelo de la herramienta', texto: 'Si no tenés el código, con la marca y el modelo exacto de la herramienta te ayudamos a identificar la pieza.' },
      { titulo: 'Kits de mantenimiento', texto: 'Para herramientas de uso intensivo conviene tener a mano los kits de juntas y piezas de desgaste.' },
    ],
    preguntas: [
      { pregunta: '¿Y si el repuesto no aparece en el catálogo?', respuesta: 'Consultanos con la marca, el modelo y una foto de la pieza. Lo buscamos con el fabricante.' },
    ],
  },
  'llaves-dinamometricas': {
    titulo: 'Cómo elegir una llave dinamométrica',
    intro:
      'La llave dinamométrica asegura que cada unión quede con el torque especificado: ni floja ni pasada. Para elegirla, partí del torque que tenés que aplicar.',
    criterios: [
      { titulo: 'Rango de torque', texto: 'Elegí una llave cuyo rango cubra tu torque con margen: lo ideal es trabajar en la zona media del rango, no en los extremos.' },
      { titulo: 'Tipo', texto: 'De click (se destraba al llegar al valor), de lectura (con escala o dial) o fija (preseteada para un único valor, ideal para producción).' },
      { titulo: 'Encastre', texto: 'Cuadrado de 1/4", 3/8", 1/2" o 3/4", o cabeza intercambiable para llaves fijas y de corona.' },
      { titulo: 'Unidad', texto: 'Verificá que la escala esté en la unidad que usa tu plano: N·m, kgf·cm o lbf·in.' },
    ],
    preguntas: [
      { pregunta: '¿Cada cuánto hay que calibrar una llave dinamométrica?', respuesta: 'Depende del uso; como referencia se recomienda verificarla al menos una vez por año o cada cierta cantidad de ciclos, según el procedimiento de calidad de tu planta.' },
      { pregunta: '¿Qué es una llave fija o preseteada?', respuesta: 'Es una llave regulada para un único valor de torque. Evita errores en producción porque el operario no puede cambiar el valor.' },
    ],
  },
  balanceadores: {
    titulo: 'Cómo elegir un balanceador',
    intro:
      'El balanceador sostiene la herramienta y le saca el peso al operario. Elegirlo bien es sencillo si sabés dos datos: cuánto pesa lo que vas a colgar y cuánto recorrido necesitás.',
    criterios: [
      { titulo: 'Capacidad', texto: 'Sumá el peso de la herramienta, la manguera o el cable y los accesorios. Elegí el balanceador cuyo rango incluya ese peso, idealmente no en el extremo.' },
      { titulo: 'Recorrido del cable', texto: 'La distancia que tiene que bajar la herramienta desde el punto de amarre hasta la posición de trabajo.' },
      { titulo: 'Seguridad', texto: 'Para cargas altas, usá un cable o cadena de seguridad adicional entre el balanceador y la estructura.' },
    ],
    preguntas: [
      { pregunta: '¿Qué pasa si elijo uno de más capacidad?', respuesta: 'La herramienta tiende a subir sola y el operario tiene que hacer fuerza para bajarla. Conviene que el peso real caiga dentro del rango.' },
      { pregunta: '¿Se puede regular?', respuesta: 'Sí, dentro de su rango el balanceador se regula para equilibrar exactamente el peso colgado.' },
    ],
  },
  atornilladores: {
    titulo: 'Cómo elegir un atornillador industrial',
    intro:
      'En una línea de ensamble el atornillador define la calidad de cada unión y el cansancio del operario. Estos son los criterios para elegir el modelo.',
    criterios: [
      { titulo: 'Rango de torque', texto: 'Partí del torque especificado en el plano y elegí un modelo que lo cubra con margen.' },
      { titulo: 'Formato', texto: 'Recto para trabajar en vertical o espacios chicos, tipo pistola para uniones horizontales, angular para torques más altos o accesos difíciles.' },
      { titulo: 'Alimentación', texto: 'Neumática (robusta y liviana), eléctrica con cable o a batería (sin manguera, más libertad de movimiento).' },
      { titulo: 'Control de torque', texto: 'Desde embrague mecánico hasta control electrónico con registro de cada ajuste, según lo que pida tu proceso de calidad.' },
    ],
    preguntas: [
      { pregunta: '¿Neumático o eléctrico?', respuesta: 'Los neumáticos son simples y resistentes si ya tenés aire comprimido. Los eléctricos y a batería dan mejor control y trazabilidad del torque.' },
      { pregunta: '¿Necesito además un balanceador?', respuesta: 'En puestos fijos con mucha repetición conviene: el operario no carga el peso y la herramienta queda siempre a mano.' },
    ],
  },
  epp: {
    titulo: 'Cómo elegir elementos de protección personal',
    intro:
      'El elemento de protección correcto depende del riesgo de cada puesto. Antes de elegir, identificá a qué está expuesto el operario.',
    criterios: [
      { titulo: 'Riesgo', texto: 'Corte, impacto, químicos, ruido, partículas: cada riesgo pide una protección distinta.' },
      { titulo: 'Talle y comodidad', texto: 'Un EPP que incomoda se termina sacando. Elegí el talle correcto y modelos pensados para uso prolongado.' },
      { titulo: 'Normas', texto: 'Verificá que el elemento cumpla la norma que exige tu planta para ese puesto.' },
    ],
    preguntas: [
      { pregunta: '¿Venden por cantidad para toda la planta?', respuesta: 'Sí. Consultanos con las cantidades y los talles y te cotizamos el conjunto.' },
    ],
  },
  accesorios: {
    titulo: 'Accesorios para herramientas industriales',
    intro:
      'Los accesorios completan la herramienta: adaptadores, extensiones, soportes y todo lo que hace falta para que trabaje en tu puesto.',
    criterios: [
      { titulo: 'Compatibilidad', texto: 'Revisá el encastre y el modelo de herramienta con el que tiene que funcionar cada accesorio.' },
      { titulo: 'Uso', texto: 'Contanos para qué lo necesitás y te recomendamos la combinación correcta.' },
    ],
    preguntas: [
      { pregunta: '¿Cómo sé si un accesorio sirve para mi herramienta?', respuesta: 'Escribinos con la marca y el modelo de tu herramienta y te confirmamos la compatibilidad antes de comprar.' },
    ],
  },
  'herramientas-manuales': {
    titulo: 'Herramientas manuales para la industria',
    intro:
      'Herramientas de mano de uso profesional, pensadas para el trabajo diario de mantenimiento y montaje.',
    criterios: [
      { titulo: 'Calidad del acero', texto: 'En uso industrial conviene una herramienta que no se deforme ni se desgaste con el uso intensivo.' },
      { titulo: 'Medida y encastre', texto: 'Verificá la medida exacta y, en llaves y tubos, el encastre de tu juego de herramientas.' },
    ],
    preguntas: [
      { pregunta: '¿Arman juegos o kits?', respuesta: 'Consultanos qué necesitás tener en el puesto y te armamos la cotización con todas las piezas.' },
    ],
  },
  'llaves-de-impacto': {
    titulo: 'Cómo elegir una llave de impacto',
    intro:
      'La llave de impacto entrega mucho torque con poco esfuerzo, ideal para aflojar y ajustar uniones grandes. Para elegirla, mirá estos puntos.',
    criterios: [
      { titulo: 'Torque', texto: 'Elegí según el torque de las uniones que vas a trabajar, con margen para aflojar las que están trabadas.' },
      { titulo: 'Encastre', texto: 'Cuadrado de 1/2", 3/4" o 1", según el tamaño de los tubos que uses.' },
      { titulo: 'Alimentación', texto: 'Neumática o a batería, según el puesto y la disponibilidad de aire comprimido.' },
      { titulo: 'Tubos de impacto', texto: 'Usá siempre tubos preparados para impacto: los comunes se pueden quebrar.' },
    ],
    preguntas: [
      { pregunta: '¿Sirve para ajustar con un torque exacto?', respuesta: 'No: la llave de impacto no controla el torque final con precisión. Para el ajuste final usá una llave dinamométrica o un atornillador con control de torque.' },
    ],
  },
  remachadoras: {
    titulo: 'Cómo elegir una remachadora',
    intro:
      'La remachadora une piezas desde un solo lado con remaches ciegos o tuercas remachables. Para elegirla, partí del remache que vas a usar.',
    criterios: [
      { titulo: 'Tipo de remache', texto: 'Remache ciego (pop) o tuerca remachable: cada uno necesita su herramienta y sus boquillas.' },
      { titulo: 'Diámetro y material', texto: 'Verificá que la remachadora acepte el diámetro y el material del remache (aluminio, acero, inoxidable).' },
      { titulo: 'Volumen de trabajo', texto: 'Para pocas uniones alcanza una manual; para producción, neumática o a batería.' },
    ],
    preguntas: [
      { pregunta: '¿Venden también los remaches y boquillas?', respuesta: 'Consultanos qué remache usás y te cotizamos la herramienta con las boquillas y los consumibles.' },
    ],
  },
}

// ── Páginas institucionales ──────────────────────────────────────────────────

export const NOSOTROS = {
  titulo: 'Sobre Buscatools',
  bajada: 'Herramientas industriales de montaje y torque, con asesoramiento técnico, para plantas de todo el país.',
  secciones: [
    {
      titulo: 'Qué hacemos',
      texto:
        'Importamos y distribuimos herramientas para líneas de montaje y mantenimiento: atornilladores, balanceadores, puntas y tubos, llaves dinamométricas y de impacto, repuestos y protección personal. Trabajamos con las marcas que usa la industria y con productos originales.',
    },
    {
      titulo: 'Cómo trabajamos',
      texto:
        'No vendemos sólo una herramienta: te ayudamos a definir la correcta para tu aplicación —el modelo, el encastre, los accesorios— y si ya usás otra marca, te buscamos el equivalente. Cotizamos con factura A o B y enviamos a cualquier punto del país.',
    },
    {
      titulo: 'Para quién trabajamos',
      texto:
        'Plantas automotrices y de autopartes, fabricantes de electrodomésticos y electrónica, talleres de mantenimiento e industria general: equipos que necesitan que cada unión quede bien hecha y que la herramienta esté disponible cuando se necesita.',
    },
  ],
} as const

export const SERVICIOS: readonly { titulo: string; texto: string }[] = [
  {
    titulo: 'Asesoramiento técnico',
    texto:
      'Con el torque, el tipo de unión y el puesto de trabajo te recomendamos la herramienta y los accesorios. Si tenés un modelo en uso, buscamos el equivalente en otras marcas.',
  },
  {
    titulo: 'Compatibilidad de encastres y accesorios',
    texto:
      'Verificamos que puntas, tubos, embocaduras y adaptadores sean compatibles con tu herramienta antes de que compres, para que funcione desde el primer día.',
  },
  {
    titulo: 'Repuestos',
    texto:
      'Buscamos el repuesto por el código del fabricante o por el modelo de la herramienta, para que el equipo vuelva a trabajar lo antes posible.',
  },
  {
    titulo: 'Compras programadas',
    texto:
      'Para consumibles de uso continuo —puntas, tubos, EPP— coordinamos entregas periódicas para que no te quedes sin stock en la línea.',
  },
  {
    titulo: 'Envíos a todo el país',
    texto:
      'Despachamos a cualquier provincia por transporte o correo y coordinamos la entrega con tu planta. Cotizamos con factura A o B.',
  },
]
