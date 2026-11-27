/**
 * Módulos por empresa (2026-11-27) — Fase 1 de distribuidores.
 *
 * Una empresa tiene SIEMPRE lo básico: inicio, catálogo, clientes,
 * cotizaciones y configuración. Lo demás se habilita por empresa en
 * `companies.modulos`: `null` es «todos» (Buscatools, Torquetools… no cambian)
 * y una lista es «sólo éstos». Un distribuidor arranca con `PRESET_DISTRIBUIDOR`.
 *
 * Esconder el menú y la pantalla es una cortesía: lo que de verdad impide usar
 * un módulo es la base (disparador `exigir_modulo` en las tablas principales,
 * migración 20261127163506). Las claves tienen que coincidir con las del
 * CHECK `companies_modulos_validos`.
 */

export const MODULOS = [
  { clave: 'pedidos', etiqueta: 'Pedidos y entregas', descripcion: 'Pedidos de venta, notas de entrega y pendiente de entregar.' },
  { clave: 'facturacion', etiqueta: 'Facturación', descripcion: 'Facturas de venta.' },
  { clave: 'precios', etiqueta: 'Listas de precios', descripcion: 'Listas de precios propias de la empresa.' },
  { clave: 'informes', etiqueta: 'Informes', descripcion: 'Actividad comercial y pipeline de la propia empresa.' },
  { clave: 'compras', etiqueta: 'Compras', descripcion: 'Proveedores, pedidos a proveedor, recepciones y facturas de proveedor.' },
  { clave: 'mantenimiento', etiqueta: 'Mantenimiento', descripcion: 'Equipos, órdenes de servicio y lotes.' },
  { clave: 'emails', etiqueta: 'Emails', descripcion: 'Casillas de correo conectadas.' },
  { clave: 'whatsapp', etiqueta: 'WhatsApp', descripcion: 'Conversaciones de WhatsApp Business.' },
  { clave: 'chat', etiqueta: 'Chat interno', descripcion: 'Chat entre los usuarios de la empresa.' },
  { clave: 'asistente', etiqueta: 'Asistente digital', descripcion: 'El asistente con IA del encabezado.' },
  { clave: 'web', etiqueta: 'Sitio web', descripcion: 'Métricas, consultas y visibilidad del sitio público.' },
] as const

export type ClaveModulo = (typeof MODULOS)[number]['clave']

/** Lo que trae un distribuidor nuevo, además de lo básico. */
export const PRESET_DISTRIBUIDOR: readonly ClaveModulo[] = ['precios', 'informes']

/** `null`/`undefined` = la empresa tiene todos los módulos. */
export function tieneModulo(modulos: readonly string[] | null | undefined, clave: ClaveModulo): boolean {
  return modulos == null || modulos.includes(clave)
}

/**
 * El módulo al que pertenece una ruta, o `null` si es de lo básico.
 * El orden importa: el prefijo más específico va primero.
 */
const RUTAS: readonly (readonly [string, ClaveModulo])[] = [
  ['/ventas/pedidos', 'pedidos'],
  ['/ventas/entregas', 'pedidos'],
  ['/ventas/pendiente-entregar', 'pedidos'],
  ['/ventas/facturas', 'facturacion'],
  ['/precios', 'precios'],
  ['/configuracion/listas-precios', 'precios'],
  ['/configuracion/whatsapp-ia', 'whatsapp'],
  ['/informes', 'informes'],
  ['/compras', 'compras'],
  ['/mantenimiento', 'mantenimiento'],
  ['/emails', 'emails'],
  ['/whatsapp', 'whatsapp'],
  ['/chat', 'chat'],
  ['/web', 'web'],
]

export function moduloDeRuta(pathname: string): ClaveModulo | null {
  for (const [prefijo, clave] of RUTAS) {
    if (pathname === prefijo || pathname.startsWith(`${prefijo}/`)) return clave
  }
  return null
}

/** ¿Se puede entrar a esta ruta con estos módulos? */
export function rutaHabilitada(pathname: string, modulos: readonly string[] | null | undefined): boolean {
  const clave = moduloDeRuta(pathname)
  return clave === null || tieneModulo(modulos, clave)
}
