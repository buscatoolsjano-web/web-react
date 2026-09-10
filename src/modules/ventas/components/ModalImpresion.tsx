import { useState } from 'react'
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
    <div className={styles.fondo} role="dialog" aria-modal="true" aria-label="Vista previa">
      <div className={styles.caja}>
        <header className={styles.cabecera} data-no-imprimir>
          <h2 className={styles.titulo}>
            Vista previa <span className={styles.ref}>{doc.numero}</span>
          </h2>
          <button type="button" className={styles.cerrar} onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
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

            <button type="button" className={styles.primario} onClick={imprimir}>
              Imprimir
            </button>
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
