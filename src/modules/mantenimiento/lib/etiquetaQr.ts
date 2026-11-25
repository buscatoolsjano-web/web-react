import qrcode from 'qrcode-generator'

/**
 * La etiqueta QR de un equipo (2026-11). PURO.
 *
 * Se pega en la herramienta; al escanearla con el celular abre la ficha del
 * equipo en el ERP —historial, próximo preventivo, «Nueva orden»—. El QR
 * lleva sólo el link: nada del cliente ni del equipo viaja en el código, así
 * que una etiqueta fotografiada no expone datos a quien no tenga usuario.
 */

export function urlDeEquipo(origen: string, id: string): string {
  return `${origen.replace(/\/+$/, '')}/mantenimiento/activos/${id}`
}

/**
 * Los módulos del QR: `true` = cuadradito negro. Corrección «M» (15 %): una
 * etiqueta en un taller se raya, y con M se sigue leyendo sin que el código
 * crezca tanto como con Q o H.
 */
export function matrizQr(texto: string): boolean[][] {
  const qr = qrcode(0, 'M')
  qr.addData(texto)
  qr.make()
  const n = qr.getModuleCount()
  return Array.from({ length: n }, (_, f) => Array.from({ length: n }, (_, c) => qr.isDark(f, c)))
}

/** El renglón de modelo: «Chicago Pneumatic CP7406», sin repetir la marca. */
export function modeloDeEtiqueta(marca: string | null, modelo: string | null): string | null {
  if (!marca) return modelo
  if (!modelo) return marca
  return modelo.toLowerCase().startsWith(marca.toLowerCase()) ? modelo : `${marca} ${modelo}`
}
