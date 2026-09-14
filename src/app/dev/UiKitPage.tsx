import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select, Switch, Textarea } from '@/components/forms/controls'
import { Dialog } from '@/components/modals/Dialog'
import { ConfirmDialog } from '@/components/modals/ConfirmDialog'
import { Pagination } from '@/components/tables/Pagination'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Icon } from '@/components/icons/Icon'
import { ICON_NAMES } from '@/components/icons/iconPaths'
import styles from './UiKitPage.module.css'

/**
 * Pantalla controlada para validar las primitivas de la Fase 13 (sólo en
 * desarrollo: la ruta no existe en el build de producción).
 *
 * Sin datos reales, sin llamadas a Supabase.
 */
const ESTADOS: [string, BadgeTone, boolean?][] = [
  ['Borrador', 'neutral'],
  ['Enviada', 'info'],
  ['Confirmado', 'brand'],
  ['En revisión', 'warning'],
  ['Entregado', 'success'],
  ['Cancelado', 'danger', true],
  ['Activo', 'success'],
  ['Inactivo', 'neutral'],
]

const COLORES = [
  '--color-brand-500', '--color-primary', '--color-primary-hover', '--color-primary-soft', '--color-bg', '--color-surface', '--color-surface-alt',
  '--color-border', '--color-border-strong', '--color-text', '--color-text-soft', '--color-text-muted',
  '--color-success', '--color-warning', '--color-danger', '--color-info',
]

export function UiKitPage() {
  const [formAbierto, setFormAbierto] = useState(false)
  const [confirmAbierto, setConfirmAbierto] = useState(false)
  const [infoAbierto, setInfoAbierto] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [offset, setOffset] = useState(0)
  const [nombre, setNombre] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [ultimo, setUltimo] = useState('—')

  const errorNombre = enviado && !nombre.trim() ? 'Escribí un nombre.' : undefined

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Buscatools ERP · primitivas</h1>
        <p className={styles.sub}>Fase 13 · E1. Pantalla de desarrollo sin datos reales.</p>
      </header>

      <section className={styles.seccion} aria-labelledby="s-botones">
        <h2 id="s-botones" className={styles.h2}>Botones</h2>
        <div className={styles.fila}>
          <Button>Guardar</Button>
          <Button variant="secondary">Secundaria</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Eliminar</Button>
          <Button icon={<Icon name="plus" size={16} />}>Nuevo pedido</Button>
        </div>
        <div className={styles.fila}>
          <Button size="sm">Chico</Button>
          <Button size="md">Mediano</Button>
          <Button size="lg">Grande</Button>
          <Button disabled>Deshabilitado</Button>
          <Button variant="secondary" disabled>Deshabilitado</Button>
          <Button loading>Guardando</Button>
          <Button variant="secondary" loading>Cargando</Button>
        </div>
        <div className={styles.fila}>
          <IconButton icon="more-horizontal" aria-label="Más acciones" />
          <IconButton icon="edit" aria-label="Editar" variant="secondary" />
          <IconButton icon="trash" aria-label="Eliminar" variant="danger" />
          <IconButton icon="x" aria-label="Cerrar" size="sm" />
          <IconButton icon="printer" aria-label="Imprimir" disabled />
        </div>
      </section>

      <section className={styles.seccion} aria-labelledby="s-estados">
        <h2 id="s-estados" className={styles.h2}>Estados (Badge)</h2>
        <div className={styles.fila}>
          {ESTADOS.map(([texto, tono, outline]) => (
            <Badge key={texto} tone={tono} outline={outline}>
              {texto}
            </Badge>
          ))}
        </div>
        <div className={styles.fila}>
          <Badge tone="warning" dot>Parcial</Badge>
          <Badge tone="neutral" outline>Pendiente</Badge>
          <Badge tone="info" dot>3 sin leer</Badge>
        </div>
      </section>

      <section className={styles.seccion} aria-labelledby="s-form">
        <h2 id="s-form" className={styles.h2}>Formularios</h2>
        <form
          className={styles.grilla}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setEnviado(true)
          }}
        >
          <Field label="Razón social" error={errorNombre} help="Como figura en la constancia de CUIT." required>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Industrias ZZ SA" />
          </Field>
          <Field label="Moneda">
            <Select defaultValue="USD">
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD)</option>
            </Select>
          </Field>
          <Field label="Referencia" optional>
            <Input />
          </Field>
          <Field label="Número (lo asigna la numeración)">
            <Input readOnly value="COTI-00020" />
          </Field>
          <Field label="Fecha" help="dd/mm/aaaa">
            <Input type="date" />
          </Field>
          <Field label="Deshabilitado">
            <Input disabled value="No editable" />
          </Field>
          <Field label="Notas" optional className={styles.ancho}>
            <Textarea placeholder="Condiciones, plazos…" />
          </Field>
          <div className={styles.ancho}>
            <Checkbox label="Incluir IVA en el total" help="Se muestra discriminado en la impresión." />
            <Switch label="Enviar copia al vendedor" defaultChecked />
            <Switch label="Opción bloqueada" disabled />
          </div>
          <div className={styles.fila}>
            <Button type="submit">Validar</Button>
            <Button variant="secondary" type="reset" onClick={() => { setNombre(''); setEnviado(false) }}>
              Limpiar
            </Button>
          </div>
        </form>
      </section>

      <section className={styles.seccion} aria-labelledby="s-dialogos">
        <h2 id="s-dialogos" className={styles.h2}>Diálogos</h2>
        <div className={styles.fila}>
          <Button variant="secondary" onClick={() => setFormAbierto(true)}>Abrir formulario</Button>
          <Button variant="danger" onClick={() => setConfirmAbierto(true)}>Eliminar documento</Button>
          <Button variant="ghost" onClick={() => setInfoAbierto(true)}>Ver información</Button>
        </div>
        <p className={styles.sub} aria-live="polite">Última acción: {ultimo}</p>
      </section>

      <section className={styles.seccion} aria-labelledby="s-tablas">
        <h2 id="s-tablas" className={styles.h2}>Paginación, vacíos, carga y error</h2>
        <div className={styles.tarjeta}>
          <Pagination offset={offset} pageSize={50} total={1234} noun={{ singular: 'pedido', plural: 'pedidos' }} onChange={setOffset} />
          <Pagination offset={0} pageSize={50} total={1} noun={{ singular: 'evento', plural: 'eventos' }} onChange={() => undefined} label="Paginación de eventos" />
        </div>
        <div className={styles.dos}>
          <div className={styles.tarjeta}>
            <EmptyState icon="inbox" title="Todavía no hay pedidos" description="Cuando confirmes una cotización, el pedido aparece acá." action={<Button icon={<Icon name="plus" size={16} />}>Nuevo pedido</Button>} />
          </div>
          <div className={styles.tarjeta}>
            <EmptyState icon="search" title="Sin resultados para estos filtros" description="Probá con otra fecha o cliente." action={<Button variant="secondary">Limpiar filtros</Button>} />
          </div>
          <div className={styles.tarjeta}>
            <ErrorState title="No se pudo leer el listado." description="Revisá la conexión y volvé a intentar." onRetry={() => setUltimo('reintentar')} />
          </div>
          <div className={styles.tarjeta}>
            <SkeletonRows rows={4} columns={4} label="Cargando pedidos…" />
            <div className={styles.fila}>
              <Spinner label="Cargando" />
              <Skeleton width="8rem" height="0.875rem" />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.seccion} aria-labelledby="s-iconos">
        <h2 id="s-iconos" className={styles.h2}>Íconos ({ICON_NAMES.length})</h2>
        <ul className={styles.iconos}>
          {ICON_NAMES.map((n) => (
            <li key={n}>
              <Icon name={n} size={24} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.seccion} aria-labelledby="s-colores">
        <h2 id="s-colores" className={styles.h2}>Paleta</h2>
        <ul className={styles.colores}>
          {COLORES.map((c) => (
            <li key={c}>
              <span className={styles.muestra} style={{ background: `var(${c})` }} />
              <code>{c}</code>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={formAbierto}
        onClose={() => setFormAbierto(false)}
        title="Nueva marca"
        description="El nombre se usa en el catálogo y en los documentos."
        closeOnOverlay={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormAbierto(false)}>Cancelar</Button>
            <Button onClick={() => { setUltimo('marca guardada'); setFormAbierto(false) }}>Guardar</Button>
          </>
        }
      >
        <div className={styles.grilla}>
          <Field label="Nombre">
            <Input placeholder="ZZ Torero" />
          </Field>
          <Field label="Estado">
            <Select defaultValue="activa">
              <option value="activa">Activa</option>
              <option value="inactiva">Inactiva</option>
            </Select>
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmAbierto}
        tone="danger"
        title="¿Eliminar COTI-00020?"
        description="El borrador se elimina y no se puede deshacer."
        confirmLabel="Eliminar"
        busy={borrando}
        onCancel={() => setConfirmAbierto(false)}
        onConfirm={() => {
          setBorrando(true)
          setTimeout(() => {
            setBorrando(false)
            setConfirmAbierto(false)
            setUltimo('eliminado (simulado)')
          }, 900)
        }}
      />

      <Dialog
        open={infoAbierto}
        onClose={() => setInfoAbierto(false)}
        title="Numeración STEL"
        size="sm"
        footer={<Button onClick={() => setInfoAbierto(false)}>Entendido</Button>}
      >
        <p className={styles.parrafo}>Las cotizaciones de esta empresa las numera STEL. El ERP no emite números nuevos.</p>
      </Dialog>
    </main>
  )
}
