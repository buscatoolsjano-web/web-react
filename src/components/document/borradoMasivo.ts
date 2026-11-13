export interface ElegidoParaBorrar {
  id: string
  numero: string
}

export interface ResultadoBorradoMasivo {
  borrados: string[]
  fallas: { numero: string; mensaje: string }[]
}

/** El texto del aviso al terminar un «Eliminar N». */
export function avisoDeBorradoMasivo(r: ResultadoBorradoMasivo, plural: string): string {
  const partes: string[] = []
  if (r.borrados.length > 0) {
    partes.push(
      r.borrados.length === 1
        ? 'Se eliminó 1. El motivo quedó en Configuración → Borrados.'
        : `Se eliminaron ${r.borrados.length} ${plural}. El motivo quedó en Configuración → Borrados.`,
    )
  }
  for (const f of r.fallas) partes.push(`${f.numero}: ${f.mensaje}`)
  return partes.join(' ')
}
