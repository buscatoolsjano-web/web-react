import { useId, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/feedback/ErrorState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { LogoEmpresa } from '../components/LogoEmpresa'
import { clavesEmpresa, useAccionesEmpresa, useDatosEmpresa } from '../hooks/useEmpresaConfig'
import {
  SECCIONES_EMPRESA,
  cambios,
  erroresDe,
  etiquetaCampo,
  formularioDesde,
  mensajeErrorEmpresa,
  type CampoEditable,
  type DatosEmpresa,
  type DefinicionCampo,
  type FormularioEmpresa,
} from '../lib/empresa'
import { ErrorEmpresa } from '../services/empresa'
import styles from '../components/Configuracion.module.css'

interface Estado {
  fuente: DatosEmpresa
  inicial: FormularioEmpresa
  form: FormularioEmpresa
}

/**
 * Configuración → Empresa.
 *
 * Guardado explícito (sin autosave). Se mandan sólo los campos que cambiaron,
 * con la versión (`updated_at`) que se leyó: si otro admin guardó antes, la base
 * responde `conflicto_version` y no se pisa nada.
 */
export function EmpresaPage() {
  const { activa } = useEmpresa()
  const datos = useDatosEmpresa()
  const acciones = useAccionesEmpresa()
  const qc = useQueryClient()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [descartar, setDescartar] = useState(false)
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; titulo: string; detalle?: string | undefined } | null>(null)
  const [conflicto, setConflicto] = useState(false)

  // Sincronización con el servidor, DURANTE el render (sin efecto): al cambiar
  // de empresa o al llegar datos nuevos. Si la persona tiene cambios sin guardar
  // y los datos editables no cambiaron (p. ej. sólo cambió el logo), se conservan.
  const d = datos.data
  if (d && d !== estado?.fuente) {
    const inicial = formularioDesde(d)
    const mismaEmpresa = estado?.fuente.id === d.id
    const sucio = !!estado && Object.keys(cambios(estado.inicial, estado.form)).length > 0
    setEstado({ fuente: d, inicial, form: mismaEmpresa && sucio && !descartar ? estado.form : inicial })
    if (descartar) setDescartar(false)
  }

  if (datos.isPending) {
    return (
      <>
        <PageHeader title="Empresa" />
        <SkeletonRows rows={6} columns={2} label="Cargando datos de la empresa…" />
      </>
    )
  }
  if (datos.isError || !estado) {
    const codigo = datos.error instanceof ErrorEmpresa ? datos.error.codigo : 'desconocido'
    return (
      <>
        <PageHeader title="Empresa" />
        <ErrorState title={codigo === 'sin_permiso' ? 'Tu rol no tiene acceso a los datos de la empresa.' : mensajeErrorEmpresa(codigo)} />
      </>
    )
  }

  const { fuente, inicial, form } = estado
  const puedeEditar = fuente.puede_editar
  const pendientes = cambios(inicial, form)
  const errores = erroresDe(inicial, form)
  const hayCambios = Object.keys(pendientes).length > 0
  const guardando = acciones.guardar.isPending

  const cambiar = (c: CampoEditable, v: string) => {
    setAviso(null)
    setEstado({ ...estado, form: { ...form, [c]: v } })
  }

  /** Aplica en caché la versión nueva sin pedir de nuevo al servidor. */
  const actualizarCache = (parcial: Partial<DatosEmpresa>) =>
    qc.setQueryData<DatosEmpresa>(clavesEmpresa.datos(activa?.companyId ?? null), (viejo) => (viejo ? { ...viejo, ...parcial } : viejo))

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!hayCambios || Object.keys(errores).length) return
    setAviso(null)
    setConflicto(false)
    try {
      const r = await acciones.guardar.mutateAsync({ version: fuente.updated_at, datos: pendientes })
      // Lo guardado pasa a ser el formulario, ya normalizado como lo dejó la base.
      setDescartar(true)
      actualizarCache({ ...(pendientes as Partial<DatosEmpresa>), updated_at: r.version })
      setAviso({ tono: 'ok', titulo: 'Cambios guardados.', detalle: r.campos.length ? `Campos: ${r.campos.map(etiquetaCampo).join(', ')}.` : undefined })
    } catch (err) {
      const codigo = err instanceof ErrorEmpresa ? err.codigo : 'desconocido'
      setConflicto(codigo === 'conflicto_version')
      setAviso({ tono: 'error', titulo: mensajeErrorEmpresa(codigo) })
    }
  }

  function recargar() {
    setConflicto(false)
    setAviso(null)
    setDescartar(true)
    void acciones.recargar()
  }

  return (
    <form onSubmit={(e) => void guardar(e)} noValidate className={styles.page}>
      <PageHeader
        title="Empresa"
        subtitle={`Datos de ${fuente.name} que usan los documentos impresos y el sistema.`}
        status={
          !puedeEditar ? (
            <Badge tone="neutral" outline>
              Sólo lectura
            </Badge>
          ) : hayCambios ? (
            <Badge tone="warning" dot>
              Cambios sin guardar
            </Badge>
          ) : undefined
        }
      />

      {!puedeEditar && <StatusMessage tono="pending" titulo="Sólo lectura" detalle="Sólo un administrador de la empresa puede editar estos datos." />}

      {SECCIONES_EMPRESA.map((seccion) => (
        <fieldset key={seccion.titulo} className={styles.fieldset} disabled={!puedeEditar || guardando}>
          <legend className={styles.legend}>{seccion.titulo}</legend>
          <div className={styles.grilla}>
            {seccion.campos.map((def) => (
              <Campo key={def.campo} def={def} valor={form[def.campo]} error={errores[def.campo]} onCambio={(v) => cambiar(def.campo, v)} />
            ))}
          </div>
          {seccion.titulo === 'Branding' && (
            <LogoEmpresa
              logoPath={fuente.logo_path}
              version={fuente.updated_at}
              puedeEditar={puedeEditar}
              ocupado={guardando}
              onCambio={(r) => {
                actualizarCache({ logo_path: r.logoPath, updated_at: r.version })
                setAviso({ tono: 'ok', titulo: r.mensaje })
              }}
            />
          )}
        </fieldset>
      ))}

      <fieldset className={styles.fieldset} disabled>
        <legend className={styles.legend}>Datos del sistema (no editables)</legend>
        <dl className={styles.cardDatos}>
          <dt>Clave interna</dt>
          <dd>{fuente.slug}</dd>
          <dt>Moneda base</dt>
          <dd>{fuente.default_currency}</dd>
          <dt>Estado</dt>
          <dd>{fuente.is_active ? 'Activa' : 'Inactiva'}</dd>
        </dl>
        <p className={styles.nota}>
          La clave, la moneda base y el estado cambian el comportamiento del sistema: no se editan desde acá.
        </p>
      </fieldset>

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} />}

      {puedeEditar && (
        <div className={styles.barraGuardar}>
          {conflicto && (
            <Button variant="secondary" onClick={recargar}>
              Descartar mis cambios y recargar
            </Button>
          )}
          {hayCambios && !conflicto && (
            <Button variant="ghost" onClick={() => setEstado({ ...estado, form: inicial })} disabled={guardando}>
              Deshacer cambios
            </Button>
          )}
          <Button type="submit" disabled={!hayCambios || guardando || Object.keys(errores).length > 0}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      )}
    </form>
  )
}

function Campo({ def, valor, error, onCambio }: { def: DefinicionCampo; valor: string; error: string | undefined; onCambio: (v: string) => void }) {
  const id = useId()
  const idAyuda = `${id}-ayuda`
  const idError = `${id}-error`
  const describedBy = [def.ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
  const comunes = {
    id,
    value: valor,
    maxLength: def.max,
    required: def.requerido,
    'aria-invalid': !!error,
    'aria-describedby': describedBy,
    onChange: (e: { target: { value: string } }) => onCambio(e.target.value),
  }
  return (
    <div className={def.multilinea ? `${styles.campo} ${styles.campoAncho}` : styles.campo}>
      <label htmlFor={id} className={styles.etiqueta}>
        {def.etiqueta}
        {def.requerido && <span aria-hidden="true"> *</span>}
      </label>
      {def.multilinea ? (
        <textarea {...comunes} rows={3} className={`${styles.control} ${styles.textarea}`} />
      ) : def.tipo === 'color' ? (
        <div className={styles.filaColor}>
          <input {...comunes} type="text" inputMode="text" className={styles.control} placeholder="#RRGGBB" />
          <span className={styles.muestraColor} style={{ background: /^#[0-9a-f]{6}$/i.test(valor.trim()) ? valor.trim() : 'transparent' }} aria-hidden="true" />
        </div>
      ) : (
        <input {...comunes} type={def.tipo ?? 'text'} autoComplete={def.autoComplete ?? 'off'} className={styles.control} />
      )}
      {def.ayuda && (
        <span id={idAyuda} className={styles.nota}>
          {def.ayuda}
        </span>
      )}
      {error && (
        <span id={idError} className={styles.errorCampo}>
          {error}
        </span>
      )}
    </div>
  )
}
