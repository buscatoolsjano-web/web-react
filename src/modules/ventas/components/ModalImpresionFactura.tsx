import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useModalAccesible } from '@/components/modals/useModalAccesible'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { etiquetaCondicionIva } from '@/modules/clientes/lib/condicionIva'
import styles from '@/modules/compras/components/ModalImpresionCompras.module.css'
import { datosDeEmpresa } from '../services/empresa'
import type { FacturaDetalle } from '../services/facturas'
import type { DocumentoImprimible, EmpresaImpresion } from '../lib/impresion'
import { formatearFecha } from '../lib/formato'
import { VistaImpresion } from './VistaImpresion'
import { HojaImpresa } from './HojaImpresa'

/**
 * La factura en la MISMA hoja que el resto de los documentos de Ventas.
 *
 * Mientras esté en borrador dice «no válida como factura»: el comprobante
 * fiscal lo emite AFIP por Tango, y esto no puede pasar por uno.
 */
function aHoja(f: FacturaDetalle): DocumentoImprimible {
  const borrador = f.estado === 'draft'
  const datos: { etiqueta: string; valor: string; lado?: 'contraparte' }[] = []
  const cond = etiquetaCondicionIva(f.clienteCondicionIva)
  if (cond) datos.push({ etiqueta: 'Condición IVA', valor: cond, lado: 'contraparte' })
  if (f.vencimiento) datos.push({ etiqueta: 'Vencimiento', valor: formatearFecha(f.vencimiento) })
  if (f.numeroInterno) datos.push({ etiqueta: 'Nº interno', valor: f.numeroInterno })
  return {
    // El tipo de Ventas sólo decide etiquetas; acá se reemplazan con `rotulos`.
    tipo: 'pedido',
    titulo: borrador ? 'FACTURA · BORRADOR (no válida como factura)' : 'FACTURA',
    subtitulo: null,
    numero: f.numero,
    fecha: f.fecha,
    cliente: f.cliente,
    clienteCuit: f.clienteCuit,
    contacto: null,
    moneda: f.moneda,
    formaPago: f.formaPago,
    vendedor: null,
    domicilioEntrega: null,
    transporte: null,
    seguimiento: null,
    notas: null,
    lineas: f.lineas.map((l, i) => ({
      id: l.id,
      esCapitulo: false,
      numero: i + 1,
      sku: l.sku,
      nombre: l.nombre,
      descripcion: null,
      cantidad: l.cantidad,
      precio: l.precioUnitario,
      descuentoPct: l.descuentoPct,
      subtotal: l.cantidad * l.precioUnitario * (1 - l.descuentoPct / 100),
      impuestoPct: l.tasaImpuesto,
      foto: null,
      partes: [],
    })),
    subtotal: f.subtotal,
    impuesto: f.impuestos,
    total: f.total,
    origen: f.pedidoNumero ? `Pedido ${f.pedidoNumero}` : null,
    esHistorico: false,
    rotulos: {
      bloqueDatos: 'Datos de la factura',
      bloqueContraparte: 'Datos del cliente',
      contraparte: 'Cliente',
      identificador: f.clienteCuit ? 'CUIT' : null,
    },
    datosExtra: datos,
  }
}

export function ModalImpresionFactura({ factura, onCerrar }: { factura: FacturaDetalle; onCerrar: () => void }) {
  const { activa } = useEmpresa()
  const [papel, setPapel] = useState<'A4' | 'carta'>('A4')

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

  // La hoja que va al papel la dibuja `HojaImpresa`, sola, en el beforeprint.
  const imprimir = () => window.print()

  const caja = useRef<HTMLDivElement>(null)
  const idTitulo = useId()
  useModalAccesible(caja, { onClose: onCerrar })

  return (
    <div className={styles.fondo}>
      <HojaImpresa prioridad="modal" papel={papel}>
        {() => (
          <VistaImpresion
            doc={aHoja(factura)}
            empresa={empresa}
            opciones={{ formato: 'valorado', preciosConImpuestos: false, papel, conFotos: false }}
          />
        )}
      </HojaImpresa>
      <div ref={caja} className={styles.caja} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <header className={styles.cabecera}>
          <h2 id={idTitulo} className={styles.titulo}>
            Vista previa <span className={styles.ref}>{factura.numero}</span>
          </h2>
          <IconButton icon="x" aria-label="Cerrar" onClick={onCerrar} />
        </header>
        <div className={styles.cuerpo}>
          <aside className={styles.opciones}>
            <label className={styles.campo}>
              <span>Papel</span>
              <select className={styles.control} value={papel} onChange={(e) => setPapel(e.target.value as 'A4' | 'carta')}>
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="carta">Carta (216 × 279 mm)</option>
              </select>
            </label>
            <Button icon={<Icon name="printer" size={16} />} onClick={imprimir}>
              Imprimir
            </Button>
            <p className={styles.ayuda}>
              Para guardar un PDF, elegí «Guardar como PDF» en el diálogo del navegador.
            </p>
          </aside>
          <div className={styles.previa}>
            <VistaImpresion
              doc={aHoja(factura)}
              empresa={empresa}
              opciones={{ formato: 'valorado', preciosConImpuestos: false, papel, conFotos: false }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
