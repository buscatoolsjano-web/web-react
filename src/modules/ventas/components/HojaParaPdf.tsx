import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useDatosDeProductos } from '../hooks/useDatosDeProductos'
import { construirImprimible, type EmpresaImpresion, type OpcionesImpresion } from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import { VistaImpresion } from './VistaImpresion'
import type { DocumentoDetalle, LineaDocumento } from '../types'

export interface HojaParaPdfProps {
  doc: DocumentoDetalle
  lineas: readonly LineaDocumento[]
  opciones: OpcionesImpresion
  /** Se llama UNA vez, con la hoja ya dibujada y sus datos completos. */
  onLista: (nodo: HTMLElement) => void
  /** Si los datos no llegan, para no esperar para siempre. */
  onFallo: (mensaje: string) => void
}

/**
 * La hoja dibujada aparte, a tamaño real, sólo para sacarle la foto (Fase 84).
 *
 * No se ve: vive corrida fuera de la pantalla. **Corrida y no escondida**: con
 * `display: none` o `visibility: hidden` el navegador no la dibuja y la foto
 * sale vacía; con `opacity: 0` tampoco se puede confiar.
 *
 * Por qué una copia aparte y no la hoja que ya está en la pantalla: la de la
 * pantalla está escalada con `transform` para entrar al lado del editor, y una
 * hoja escalada se fotografía borrosa. Ésta sale a 210 mm, que es lo que mide
 * el papel.
 *
 * Es el MISMO `VistaImpresion` con los MISMOS datos: no hay una hoja para la
 * pantalla, otra para el papel y una tercera para el PDF.
 */
export function HojaParaPdf({ doc, lineas, opciones, onLista, onFallo }: HojaParaPdfProps) {
  const { activa } = useEmpresa()
  const nodo = useRef<HTMLDivElement>(null)
  const avisado = useRef(false)

  // La misma consulta y la misma clave que la hoja de la pantalla: si ya se
  // miró el documento, los datos de la empresa están en caché y no hay viaje.
  const empresaDb = useQuery({
    queryKey: ['ventas', activa?.companyId, 'empresa-impresion'],
    queryFn: () => datosDeEmpresa(activa!.companyId),
    enabled: activa?.companyId !== undefined,
    staleTime: 10 * 60_000,
  })

  // Las fotos y los atributos de cada producto. Sin esperarlos, la foto saldría
  // con los huecos vacíos: el PDF tiene que llevar lo mismo que el papel.
  const productos = useDatosDeProductos(lineas)

  const empresa: EmpresaImpresion = empresaDb.data ?? {
    nombre: activa?.companyName ?? 'Empresa',
    razonSocial: null,
    cuit: null,
    direccion: null,
    telefono: null,
    email: null,
    web: null,
    color: '#1f2937',
  }

  const listo = !empresaDb.isPending && !productos.cargando
  const fallo = empresaDb.isError

  useEffect(() => {
    if (avisado.current) return
    if (fallo) {
      avisado.current = true
      onFallo('No se pudieron leer los datos de la empresa.')
      return
    }
    if (!listo || !nodo.current) return
    avisado.current = true
    onLista(nodo.current)
  }, [listo, fallo, onLista, onFallo])

  return (
    <div ref={nodo} aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 0 }}>
      <VistaImpresion
        doc={construirImprimible({ ...doc, lineas: [...lineas] }, opciones, productos.datos, productos.definiciones)}
        empresa={empresa}
        opciones={opciones}
      />
    </div>
  )
}
