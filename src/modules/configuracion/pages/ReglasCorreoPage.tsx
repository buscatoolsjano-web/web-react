import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Alert } from '@/components/feedback/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { AplicarRegla } from '../components/AplicarRegla'
import { Dialogo } from '../components/Dialogo'
import { FormularioRegla } from '../components/FormularioRegla'
import {
  useAccionesReglas,
  useAsignablesCorreo,
  useEtiquetasCorreo,
  useReglasCorreo,
} from '../hooks/useReglasCorreo'
import { describirRegla, type ReglaCorreo } from '../lib/reglasCorreo'
import { mensajeDeRegla } from '../services/reglasCorreo'
import styles from '../components/ReglasCorreo.module.css'
import config from '../components/Configuracion.module.css'

type Abierto =
  | { que: 'editar'; regla: ReglaCorreo | null }
  | { que: 'aplicar'; regla: ReglaCorreo }
  | { que: 'borrar'; regla: ReglaCorreo }

/**
 * Configuración → Reglas de correo (Fase 70 · E2).
 *
 * «Las etiquetas, que sean como en Gmail, que les puedas agregar filtros.»
 *
 * ── Qué se ve, y por qué así ────────────────────────────────────────────────
 *
 * Cada regla se muestra LEÍDA EN VOZ ALTA: «Si el remitente contiene
 * «stelorder.com», ponerle «Avisos» y darlo por resuelto». No con las
 * condiciones desarmadas en columnas. Una lista de reglas que hay que abrir
 * para entender es una lista que nadie revisa, y las reglas que nadie revisa
 * son las que un día etiquetan mal media bandeja sin que nadie se entere.
 *
 * ── Pausar en vez de borrar ─────────────────────────────────────────────────
 *
 * Una regla pausada queda en la lista, apagada. Es lo que se quiere la mayoría
 * de las veces que uno piensa «borrala»: ver si el correo se ordena igual sin
 * ella, y poder volver atrás sin reescribirla.
 */
export function ReglasCorreoPage() {
  const reglas = useReglasCorreo()
  const etiquetas = useEtiquetasCorreo()
  const personas = useAsignablesCorreo()
  const acciones = useAccionesReglas()

  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tono: Tono; titulo: string } | null>(null)

  const nombres = {
    etiquetas: new Map((etiquetas.data ?? []).map((e) => [e.id, e.nombre])),
    personas: new Map((personas.data ?? []).map((p) => [p.id, p.nombre])),
  }

  const abrir = (a: Abierto) => {
    setErrorDialogo(null)
    setAviso(null)
    setAbierto(a)
  }

  async function guardar(r: Omit<ReglaCorreo, 'id'> & { id: string | null }) {
    try {
      await acciones.guardar.mutateAsync(r)
      setAbierto(null)
      setAviso({ tono: 'ok', titulo: `Regla «${r.nombre}» guardada.` })
    } catch (e) {
      setErrorDialogo(mensajeDeRegla(e))
    }
  }

  async function alternar(regla: ReglaCorreo) {
    setAviso(null)
    try {
      await acciones.guardar.mutateAsync({ ...regla, activa: !regla.activa })
      setAviso({
        tono: 'ok',
        titulo: regla.activa ? `«${regla.nombre}» quedó pausada.` : `«${regla.nombre}» está activa.`,
      })
    } catch (e) {
      setAviso({ tono: 'error', titulo: mensajeDeRegla(e) })
    }
  }

  async function borrar(regla: ReglaCorreo) {
    try {
      await acciones.borrar.mutateAsync(regla.id)
      setAbierto(null)
      setAviso({ tono: 'ok', titulo: `Regla «${regla.nombre}» borrada.` })
    } catch (e) {
      setErrorDialogo(mensajeDeRegla(e))
    }
  }

  const lista = reglas.data ?? []

  return (
    <div className={config.page}>
      <PageHeader
        title="Reglas de correo"
        actions={
          <Button icon={<Icon name="plus" size={16} />} onClick={() => abrir({ que: 'editar', regla: null })}>
            Nueva regla
          </Button>
        }
      />

      <Alert tone="info" role="note">
        <p>
          Las reglas corren cuando llega un correo nuevo, y son de toda la empresa. Lo que ya tocó una
          persona no se pisa: no cambian el asignado si ya tiene uno, ni el estado si alguien lo movió.
        </p>
      </Alert>

      {aviso ? <StatusMessage tono={aviso.tono} titulo={aviso.titulo} /> : null}

      {reglas.isPending ? <SkeletonRows rows={3} columns={2} label="Cargando reglas…" /> : null}
      {reglas.isError ? (
        <Alert tone="danger" role="alert" title="No se pudieron traer las reglas">
          <p>{mensajeDeRegla(reglas.error)}</p>
        </Alert>
      ) : null}

      {!reglas.isPending && lista.length === 0 ? (
        <EmptyState
          icon="filter"
          title="Todavía no hay reglas"
          description="Una regla mira cada correo que llega y, si cumple lo que vos digas, le pone una etiqueta, se lo asigna a alguien, lo da por resuelto o lo saca de la bandeja."
        />
      ) : null}

      <ul className={styles.lista}>
        {lista.map((r) => (
          <li key={r.id} className={r.activa ? styles.regla : `${styles.regla} ${styles.pausada}`}>
            <div className={styles.cabecera}>
              <h3 className={styles.nombre}>{r.nombre}</h3>
              {r.activa ? <Badge tone="success">Activa</Badge> : <Badge tone="neutral">Pausada</Badge>}
            </div>
            <p className={styles.frase}>{describirRegla(r, nombres)}</p>
            <div className={styles.acciones}>
              <Button variant="secondary" size="sm" icon={<Icon name="edit" size={16} />} onClick={() => abrir({ que: 'editar', regla: r })}>
                Editar
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="refresh" size={16} />}
                onClick={() => abrir({ que: 'aplicar', regla: r })}
              >
                Aplicar a los que ya están
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void alternar(r)}>
                {r.activa ? 'Pausar' : 'Activar'}
              </Button>
              <Button variant="ghost" size="sm" icon={<Icon name="trash" size={16} />} onClick={() => abrir({ que: 'borrar', regla: r })}>
                Borrar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {abierto?.que === 'editar' ? (
        <Dialogo
          titulo={abierto.regla ? `Editar «${abierto.regla.nombre}»` : 'Nueva regla'}
          bloqueado={acciones.guardar.isPending}
          onCerrar={() => setAbierto(null)}
          pie={null}
        >
          <FormularioRegla
            inicial={abierto.regla}
            etiquetas={etiquetas.data ?? []}
            personas={personas.data ?? []}
            onCrearEtiqueta={(n) => acciones.crearEtiqueta.mutateAsync(n)}
            onGuardar={(r) => void guardar(r)}
            guardando={acciones.guardar.isPending}
            error={errorDialogo}
          />
        </Dialogo>
      ) : null}

      {abierto?.que === 'aplicar' ? (
        <AplicarRegla
          regla={abierto.regla}
          onCerrar={() => setAbierto(null)}
          onAplicada={() => setAviso({ tono: 'ok', titulo: 'Listo: las reglas se aplicaron al correo que ya estaba.' })}
        />
      ) : null}

      {abierto?.que === 'borrar' ? (
        <Dialogo
          titulo={`Borrar «${abierto.regla.nombre}»`}
          bloqueado={acciones.borrar.isPending}
          onCerrar={() => setAbierto(null)}
          pie={
            <>
              <Button variant="secondary" onClick={() => setAbierto(null)} disabled={acciones.borrar.isPending}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => void borrar(abierto.regla)} disabled={acciones.borrar.isPending}>
                Borrar la regla
              </Button>
            </>
          }
        >
          {/* Lo que la regla ya hizo no se deshace, y conviene decirlo: alguien
              puede estar borrándola creyendo que así saca las etiquetas que
              puso. Las etiquetas se sacan desde la bandeja. */}
          <p>
            La regla deja de correr. Lo que ya hizo —etiquetas puestas, correos asignados o resueltos—
            queda como está.
          </p>
          {errorDialogo ? <p className={styles.error}>{errorDialogo}</p> : null}
        </Dialogo>
      ) : null}
    </div>
  )
}
