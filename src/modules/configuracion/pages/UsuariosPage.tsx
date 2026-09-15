import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { contar } from '@/components/tables/rango'
import { Icon } from '@/components/icons/Icon'
import { Button } from '@/components/ui/Button'
import { StatusMessage, type Tono } from '@/components/ui/StatusMessage'
import { ResponsiveTable } from '@/components/tables/ResponsiveTable'
import type { Column } from '@/components/tables/types'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { Dialogo } from '../components/Dialogo'
import { FormularioInvitacion } from '../components/FormularioInvitacion'
import { useAccionesUsuarios, useUsuarios } from '../hooks/useUsuarios'
import {
  ETIQUETA_ESTADO,
  esAutoDegradacion,
  estadoVisible,
  etiquetaRol,
  filtrarUsuarios,
  formatearFecha,
  mensajeError,
  puedeCambiarRol,
  puedeReenviar,
  puedeSuspender,
  rolesPermitidos,
  textoResultadoInvitacion,
} from '../lib/usuarios'
import { puedeAdministrarUsuarios } from '../lib/permisos'
import { ErrorUsuarios } from '../services/usuarios'
import type { UsuarioEmpresa } from '../types'
import styles from '../components/Configuracion.module.css'

type Pendiente =
  | { tipo: 'rol'; u: UsuarioEmpresa; rol: string }
  | { tipo: 'suspender' | 'reactivar' | 'reenviar'; u: UsuarioEmpresa }
  | { tipo: 'invitar' }

interface Aviso {
  tono: Tono
  titulo: string
  detalle?: string
}

const codigo = (e: unknown) => (e instanceof ErrorUsuarios ? e.codigo : 'desconocido')
const MIEMBROS = { singular: 'miembro', plural: 'miembros' }
const quien = (u: UsuarioEmpresa) => u.nombre || u.email

/**
 * Configuración → Usuarios: las membresías de la EMPRESA ACTIVA.
 *
 * Suspender quita el acceso a esta empresa y nada más: la cuenta de la persona
 * sigue existiendo y conserva sus otras empresas. No se banea la identidad
 * global desde acá.
 */
export function UsuariosPage() {
  const { activa } = useEmpresa()
  if (!puedeAdministrarUsuarios(activa?.rol)) {
    return (
      <>
        <PageHeader title="Usuarios" />
        <EmptyState icon="users" title="Sin acceso a Usuarios" description="Sólo un administrador puede ver y administrar los usuarios de la empresa." />
      </>
    )
  }
  return <UsuariosAdmin />
}

function UsuariosAdmin() {
  const { activa } = useEmpresa()
  const usuarios = useUsuarios()
  const acciones = useAccionesUsuarios()
  const [busqueda, setBusqueda] = useState('')
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  const lista = usuarios.data ?? []
  const visibles = filtrarUsuarios(lista, busqueda)
  const empresa = activa?.companyName ?? ''
  const ocupado = acciones.cambiarRol.isPending || acciones.cambiarEstado.isPending || acciones.invitar.isPending || acciones.reenviar.isPending

  const abrir = (p: Pendiente) => {
    setErrorDialogo(null)
    setAviso(null)
    setPendiente(p)
  }
  const cerrar = () => {
    if (!ocupado) setPendiente(null)
  }

  async function confirmar() {
    if (!pendiente || pendiente.tipo === 'invitar') return
    const { u } = pendiente
    try {
      if (pendiente.tipo === 'rol') {
        await acciones.cambiarRol.mutateAsync({ membershipId: u.membershipId, rol: pendiente.rol })
        setAviso({ tono: 'ok', titulo: `${quien(u)} ahora es ${etiquetaRol(pendiente.rol)}.` })
      } else if (pendiente.tipo === 'suspender' || pendiente.tipo === 'reactivar') {
        const estado = pendiente.tipo === 'suspender' ? 'suspended' : 'active'
        await acciones.cambiarEstado.mutateAsync({ membershipId: u.membershipId, estado })
        setAviso({ tono: 'ok', titulo: pendiente.tipo === 'suspender' ? `Acceso de ${quien(u)} suspendido.` : `Acceso de ${quien(u)} reactivado.` })
      } else {
        const r = await acciones.reenviar.mutateAsync(u.membershipId)
        setAviso(textoResultadoInvitacion(r, u.email))
      }
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeError(codigo(e)))
    }
  }

  async function invitar(d: { email: string; nombre: string | null; rol: string }) {
    setErrorDialogo(null)
    try {
      const r = await acciones.invitar.mutateAsync(d)
      setAviso(textoResultadoInvitacion(r, d.email))
      setPendiente(null)
    } catch (e) {
      setErrorDialogo(mensajeError(codigo(e)))
    }
  }

  const columnas: Column<UsuarioEmpresa>[] = [
    {
      key: 'persona',
      header: 'Persona',
      mobile: 'title',
      render: (u) => (
        <span className={styles.persona}>
          <span className={styles.nombre}>
            {u.nombre || '(sin nombre)'}
            {u.esPropia && (
              <Badge tone="brand" className={styles.propia}>
                vos
              </Badge>
            )}
          </span>
          <span className={styles.email}>{u.email}</span>
        </span>
      ),
    },
    { key: 'rol', header: 'Rol', width: '13rem', render: (u) => <SelectorRol u={u} lista={lista} deshabilitado={ocupado} onElegir={(rol) => abrir({ tipo: 'rol', u, rol })} /> },
    { key: 'estado', header: 'Estado', width: '11rem', render: (u) => <ChipEstado u={u} /> },
    { key: 'ingreso', header: 'Último ingreso', width: '8rem', render: (u) => (u.ultimoIngreso ? formatearFecha(u.ultimoIngreso) : 'Nunca') },
  ]

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle={`Quién tiene acceso a ${empresa} y con qué rol.`}
        actions={
          <Button icon={<Icon name="plus" size={16} />} onClick={() => abrir({ tipo: 'invitar' })} disabled={ocupado || usuarios.isError}>
            Invitar usuario
          </Button>
        }
      />

      {aviso && <StatusMessage tono={aviso.tono} titulo={aviso.titulo} {...(aviso.detalle ? { detalle: aviso.detalle } : {})} />}

      {usuarios.isError ? (
        <StatusMessage tono="error" titulo={mensajeError(codigo(usuarios.error))} />
      ) : (
        <>
          <div className={styles.barra}>
<Field label="Buscar usuarios" hideLabel className={styles.buscar}>
              <Input type="search" placeholder="Buscar por nombre, email o rol" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </Field>
            {usuarios.data && (
              <span className={styles.nota}>
                {visibles.length === lista.length ? contar(lista.length, MIEMBROS) : `${visibles.length} de ${lista.length}`}
              </span>
            )}
          </div>
          <ResponsiveTable
            columns={columnas}
            rows={visibles}
            rowKey={(u) => u.membershipId}
            isLoading={usuarios.isPending}
            emptyMessage={busqueda ? 'Nadie coincide con la búsqueda.' : 'Esta empresa todavía no tiene miembros.'}
            actions={(u) => <Acciones u={u} lista={lista} deshabilitado={ocupado} abrir={abrir} />}
            renderCard={(u) => (
              <article className={styles.card}>
                <div className={styles.cardCabecera}>
                  {columnas[0]!.render!(u)}
                  <ChipEstado u={u} />
                </div>
                <dl className={styles.cardDatos}>
                  <dt>Rol</dt>
                  <dd>
                    <SelectorRol u={u} lista={lista} deshabilitado={ocupado} onElegir={(rol) => abrir({ tipo: 'rol', u, rol })} />
                  </dd>
                  <dt>Último ingreso</dt>
                  <dd>{u.ultimoIngreso ? formatearFecha(u.ultimoIngreso) : 'Nunca'}</dd>
                </dl>
                <div className={styles.cardAcciones}>
                  <Acciones u={u} lista={lista} deshabilitado={ocupado} abrir={abrir} />
                </div>
              </article>
            )}
          />
        </>
      )}

      {pendiente?.tipo === 'invitar' && (
        <FormularioInvitacion empresa={empresa} enviando={acciones.invitar.isPending} error={errorDialogo} onEnviar={(d) => void invitar(d)} onCerrar={cerrar} />
      )}
      {pendiente && pendiente.tipo !== 'invitar' && (
        <Dialogo
          titulo={tituloConfirmacion(pendiente)}
          onCerrar={cerrar}
          bloqueado={ocupado}
          pie={
            <>
              <Button variant="secondary" onClick={cerrar} disabled={ocupado}>
                Cancelar
              </Button>
              <Button variant={pendiente.tipo === 'suspender' || esPeligrosa(pendiente) ? 'danger' : 'primary'} onClick={() => void confirmar()} disabled={ocupado}>
                {ocupado ? 'Guardando…' : textoBoton(pendiente)}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>{textoConfirmacion(pendiente, empresa)}</p>
          {errorDialogo && <StatusMessage tono="error" titulo={errorDialogo} />}
        </Dialogo>
      )}
    </>
  )
}

function SelectorRol({ u, lista, deshabilitado, onElegir }: { u: UsuarioEmpresa; lista: UsuarioEmpresa[]; deshabilitado: boolean; onElegir: (rol: string) => void }) {
  const opciones = rolesPermitidos(u, lista)
  const permitido = puedeCambiarRol(u, lista)
  if (opciones.length === 0) {
    return (
      <span title={permitido.motivo ?? undefined}>
        {etiquetaRol(u.rol)}
        {u.cliente ? ` · ${u.cliente}` : ''}
      </span>
    )
  }
  return (
    <select
      className={styles.selectRol}
      aria-label={`Rol de ${quien(u)}`}
      value={u.rol}
      disabled={deshabilitado || !permitido.ok}
      title={permitido.motivo ?? undefined}
      onChange={(e) => {
        if (e.target.value !== u.rol) onElegir(e.target.value)
      }}
    >
      {opciones.map((r) => (
        <option key={r} value={r}>
          {etiquetaRol(r)}
        </option>
      ))}
    </select>
  )
}

const TONO_ESTADO: Record<string, BadgeTone> = {
  activo: 'success',
  invitacion_pendiente: 'warning',
  sin_confirmar: 'warning',
  suspendido: 'danger',
  bloqueada: 'danger',
}

function ChipEstado({ u }: { u: UsuarioEmpresa }) {
  const e = estadoVisible(u)
  const tono = TONO_ESTADO[e] ?? 'neutral'
  return (
    <Badge tone={tono} dot={tono !== 'success'} outline={tono === 'danger'}>
      {ETIQUETA_ESTADO[e]}
    </Badge>
  )
}

function Acciones({ u, lista, deshabilitado, abrir }: { u: UsuarioEmpresa; lista: UsuarioEmpresa[]; deshabilitado: boolean; abrir: (p: Pendiente) => void }) {
  const suspender = puedeSuspender(u, lista)
  const reenviar = puedeReenviar(u)
  return (
    <span className={styles.acciones}>
      {!u.emailConfirmado && reenviar.ok && (
        <Button variant="secondary" onClick={() => abrir({ tipo: 'reenviar', u })} disabled={deshabilitado}>
          Reenviar invitación
        </Button>
      )}
      {u.estado === 'suspended' ? (
        <Button variant="secondary" onClick={() => abrir({ tipo: 'reactivar', u })} disabled={deshabilitado}>
          Reactivar
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => abrir({ tipo: 'suspender', u })} disabled={deshabilitado || !suspender.ok} title={suspender.motivo ?? undefined}>
          Suspender
        </Button>
      )}
    </span>
  )
}

function esPeligrosa(p: Pendiente): boolean {
  return p.tipo === 'rol' && esAutoDegradacion(p.u, p.rol)
}

function tituloConfirmacion(p: Exclude<Pendiente, { tipo: 'invitar' }>): string {
  switch (p.tipo) {
    case 'rol':
      return esAutoDegradacion(p.u, p.rol) ? 'Dejar de ser administrador' : 'Cambiar rol'
    case 'suspender':
      return 'Suspender acceso'
    case 'reactivar':
      return 'Reactivar acceso'
    case 'reenviar':
      return 'Reenviar invitación'
  }
}

function textoBoton(p: Exclude<Pendiente, { tipo: 'invitar' }>): string {
  return { rol: 'Cambiar rol', suspender: 'Suspender', reactivar: 'Reactivar', reenviar: 'Reenviar' }[p.tipo]
}

function textoConfirmacion(p: Exclude<Pendiente, { tipo: 'invitar' }>, empresa: string): string {
  const nombre = quien(p.u)
  switch (p.tipo) {
    case 'rol':
      return esAutoDegradacion(p.u, p.rol)
        ? `Vas a pasar a ${etiquetaRol(p.rol)} en ${empresa} y vas a perder el acceso a Configuración. Otro administrador tendría que devolvértelo.`
        : `${nombre} pasa de ${etiquetaRol(p.u.rol)} a ${etiquetaRol(p.rol)} en ${empresa}. Cambia lo que puede ver y hacer desde su próximo pedido.`
    case 'suspender':
      return `${nombre} no va a poder entrar a ${empresa}. Su cuenta y sus otras empresas no cambian, y se puede reactivar cuando quieras.`
    case 'reactivar':
      return `${nombre} vuelve a entrar a ${empresa} como ${etiquetaRol(p.u.rol)}.`
    case 'reenviar':
      return `Se manda un correo nuevo a ${p.u.email}. El enlace anterior deja de funcionar.`
  }
}
