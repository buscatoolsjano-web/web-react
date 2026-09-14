import { useId, useRef, useState } from 'react'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Icon } from '@/components/icons/Icon'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import {
  construirImprimible,
  FORMATOS,
  OPCIONES_INICIALES,
  type EmpresaImpresion,
  type FormatoImpresion,
  type OpcionesImpresion,
} from '../lib/impresion'
import { datosDeEmpresa } from '../services/empresa'
import type { DocumentoDetalle } from '../types'
import { VistaImpresion } from './VistaImpresion'
import styles from './ModalImpresion.module.css'

export interface ModalImpresionProps {
  doc: DocumentoDetalle
  onCerrar: () => void
}

/**
 * Vista previa e impresión.
 *
 * Un solo camino para las dos cosas: lo que se ve en el panel es el mismo
 * componente que el navegador manda a la impresora. El legacy generaba un
 * string de HTML y lo escribía en un iframe, con una previsualización que
 * salía de un camino parecido pero no idéntico.
 *
 * Al imprimir se marca el `<body>`: la hoja de estilos global esconde todo lo
 * demás y deja sólo el documento.
 */
export function ModalImpresion({ doc, onCerrar }: ModalImpresionProps) {
  const { activa } = useEmpresa()
  const [opciones, setOpciones] = useState<OpcionesImpresion>(OPCIONES_INICIALES)
  const caja = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  // Fase 13: foco adentro, Escape y retorno del foco, sin cambiar la estructura
  // (la hoja de impresión depende de ella).
  useModalAccesible(caja, { onClose: onCerrar })

  const { data: empresaDb } = useQuery({
    queryKey: ['ventas', activa?.companyId, 'empresa-impresion'],
    queryFn: () => datosDeEmpresa(activa!.companyId),
    enabled: !!activa,
    staleTime: 10 * 60_000,
  })

  const empresa: EmpresaImpresion = empresaDb ?? {
    nombre: activa?.companyName ?? '',
    razonSocial: null, cuit: null, direccion: null,
    telefono: null, email: null, web: null, color: '#f37021',
  }

  const imprimible = construirImprimible(doc, opciones)

  const imprimir = () => {
    document.body.dataset['imprimiendo'] = 'si'
    const limpiar = () => {
      delete document.body.dataset['imprimiendo']
      window.removeEventListener('afterprint', limpiar)
    }
    window.addEventListener('afterprint', limpiar)
    window.print()
    // Safari en iOS no siempre dispara `afterprint`; el respaldo evita dejar
    // la aplicación entera oculta.
    setTimeout(limpiar, 3000)
  }

  return (
    <div className={styles.fondo}>
      <div ref={caja} className={styles.caja} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <header className={styles.cabecera} data-no-imprimir>
          <h2 id={idTitulo} className={styles.titulo}>
            Vista previa <span className={styles.ref}>{doc.numero}</span>
          </h2>
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>

        <div className={styles.cuerpo}>
          <aside className={styles.opciones} data-no-imprimir>
            <label className={styles.campo}>
              <span>Formato</span>
              <select
                className={styles.control}
                value={opciones.formato}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, formato: e.target.value as FormatoImpresion }))
                }
              >
                {FORMATOS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.etiqueta}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.check}>
              <input
                type="checkbox"
                checked={opciones.preciosConImpuestos}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, preciosConImpuestos: e.target.checked }))
                }
              />
              Precios con impuestos incluidos
            </label>

            <label className={styles.campo}>
              <span>Papel</span>
              <select
                className={styles.control}
                value={opciones.papel}
                disabled={opciones.formato === 'ticket'}
                onChange={(e) =>
                  setOpciones((o) => ({ ...o, papel: e.target.value as 'A4' | 'carta' }))
                }
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="carta">Carta (216 × 279 mm)</option>
              </select>
            </label>

            <Button icon={<Icon name="printer" size={16} />} onClick={imprimir}>
              Imprimir
            </Button>
            <p className={styles.ayuda}>
              Se imprime exactamente lo que se ve. Para guardar un PDF, elegí «Guardar como PDF»
              en el diálogo del navegador.
            </p>
          </aside>

          <div className={styles.previa} data-previa-impresion>
            <VistaImpresion doc={imprimible} empresa={empresa} opciones={opciones} />
          </div>
        </div>
      </div>
    </div>
  )
}
