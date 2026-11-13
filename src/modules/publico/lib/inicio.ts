import type { IconName } from '@/components/icons/Icon'

/**
 * Los textos fijos de la portada del sitio público. Aparte del componente
 * para que la página quede legible y para poder cambiar un texto sin tocar la
 * maqueta. Las preguntas también van como datos estructurados (FAQPage).
 */

/** WhatsApp de la casa, con el mensaje prellenado para que llegue encaminado. */
export const WHATSAPP_INICIO =
  'https://wa.me/5491121693304?text=' +
  encodeURIComponent('Hola, estoy viendo su web y quería consultar por herramientas.')

export const PASOS: readonly { titulo: string; texto: string }[] = [
  {
    titulo: 'Contanos qué necesitás',
    texto:
      'Qué hay que ajustar, con qué torque y en qué puesto. Si tenés el modelo que usás hoy, mejor: buscamos el equivalente.',
  },
  {
    titulo: 'Te proponemos la herramienta',
    texto:
      'Elegimos el modelo, el encastre y los accesorios que hacen falta —puntas, tubos, balanceador— para que funcione desde el primer día.',
  },
  {
    titulo: 'Cotizamos y despachamos',
    texto:
      'Te pasamos la cotización con factura A o B y coordinamos el envío a tu planta, en cualquier punto del país.',
  },
]

export const INDUSTRIAS: readonly { titulo: string; texto: string; icono: IconName }[] = [
  {
    titulo: 'Automotriz y autopartes',
    texto: 'Ajuste con torque controlado en líneas de ensamble, subconjuntos y reparación.',
    icono: 'settings',
  },
  {
    titulo: 'Electrodomésticos y línea blanca',
    texto: 'Atornillado repetitivo de alta cadencia, con balanceadores para cuidar al operario.',
    icono: 'building',
  },
  {
    titulo: 'Electrónica y precisión',
    texto: 'Torques bajos y repetibles para placas, gabinetes y componentes delicados.',
    icono: 'sliders',
  },
  {
    titulo: 'Mantenimiento e industria general',
    texto: 'Llaves de impacto, dinamométricas y repuestos para el día a día de la planta.',
    icono: 'wrench',
  },
]

export const PREGUNTAS: readonly { pregunta: string; respuesta: string }[] = [
  {
    pregunta: '¿Por qué no hay precios publicados?',
    respuesta:
      'Porque una herramienta casi nunca va sola: el precio depende del modelo, el encastre, los accesorios y la cantidad. Armá tu lista de consulta en el catálogo o escribinos y te cotizamos el conjunto.',
  },
  {
    pregunta: '¿Cómo pido una cotización?',
    respuesta:
      'Sumá los productos a tu lista de consulta desde el catálogo y enviala, o escribinos por WhatsApp con el modelo, la cantidad y el nombre de tu empresa. Respondemos en el día hábil.',
  },
  {
    pregunta: '¿Hacen envíos a todo el país?',
    respuesta:
      'Sí. Despachamos a cualquier provincia por transporte o correo, y coordinamos la entrega con tu planta.',
  },
  {
    pregunta: '¿Las herramientas tienen garantía?',
    respuesta:
      'Sí. Trabajamos con productos originales de cada marca, con la garantía del fabricante.',
  },
  {
    pregunta: '¿Me ayudan a elegir la herramienta correcta?',
    respuesta:
      'Para eso estamos. Con el torque, el tipo de unión y el puesto de trabajo te recomendamos el modelo y los accesorios, y si ya usás otra marca te buscamos el equivalente.',
  },
]
