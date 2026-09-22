import { useMemo, useState } from 'react'
import type { FichaAbierta } from '../lib/ficha'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { ModalProducto } from '@/modules/catalogo/components/ModalProducto'
import { useDefinicionesDeAtributos, useListasDePrecios } from '@/modules/catalogo/hooks/useCatalogoFacetas'
import { PanelLateralCliente } from '@/modules/clientes/components/PanelLateralCliente'

/**
 * Abrir un cliente o un producto **sin perder el informe** (Fase 21 · E3).
 *
 * El ranking ya enlazaba a la ficha, pero enlazar era irse: volver costaba
 * re-elegir el mes, la dimensión, la medida, el período y la moneda, y
 * encontrar otra vez la fila que se estaba mirando. Un informe se lee
 * comparando filas; si mirar una fila destruye la comparación, no se mira
 * ninguna.
 *
 * No son fichas nuevas: son el cajón de Clientes y el modal de Catálogo, los
 * mismos que ya se usan en sus listados. Acá sólo se los alimenta con lo que
 * Informes tiene a mano.
 *
 * Lo que NO hace: quedarse con el click del navegador. Ctrl/Cmd/medio siguen
 * abriendo la ficha completa en otra pestaña, porque a veces lo que uno
 * quiere es justamente irse.
 */

/**
 * El overlay que corresponda, o nada.
 *
 * El modal de producto pide el contexto de precios del Catálogo. Informes no
 * elige lista —no es una pantalla de venta—, así que usa la lista por defecto
 * de la empresa, que es la misma con la que abre el Catálogo. Si la empresa no
 * tiene ninguna, `listaResuelta` igual va en `true` cuando terminó de buscar:
 * el modal tiene que poder decir «sin lista de precios» en vez de quedarse
 * cargando para siempre.
 */
export function FichaDesdeInforme({ ficha, onCerrar }: { ficha: FichaAbierta | null; onCerrar: () => void }) {
  const companyId = useEmpresa().activa?.companyId ?? null
  const { porDefecto, cargando } = useListasDePrecios(companyId)
  const { data: definiciones = [] } = useDefinicionesDeAtributos(companyId)
  // Saltar a un relacionado desde el modal: en el Catálogo eso vive en la URL,
  // acá alcanza con cambiar cuál está abierto.
  const [relacionado, setRelacionado] = useState<string | null>(null)
  const productoId = useMemo(
    () => (ficha?.tipo === 'producto' ? (relacionado ?? ficha.id) : null),
    [ficha, relacionado],
  )

  const cerrar = () => {
    setRelacionado(null)
    onCerrar()
  }

  if (ficha?.tipo === 'cliente') return <PanelLateralCliente clienteId={ficha.id} onCerrar={cerrar} />
  if (productoId === null) return null
  return (
    <ModalProducto
      productoId={productoId}
      priceListId={porDefecto?.id ?? null}
      listaResuelta={!cargando}
      moneda={porDefecto?.moneda ?? null}
      definiciones={definiciones}
      onCerrar={cerrar}
      onAbrirOtro={(id) => setRelacionado(id)}
    />
  )
}
