import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useCuentas } from '../hooks/useEmails'
import { ErrorContenido, mensajeDeError } from '../lib/errores'
import { puedeUsarEmails } from '../lib/permisos'
import { hiloIndexado, listarBorradores } from '../services/redactar'
import type { ResumenBorradorGmail } from '../types'
import styles from '../components/Emails.module.css'

const ETIQUETA_MODO: Record<string, string> = {
  nuevo: 'Nuevo',
  responder: 'Respuesta',
  responder_todos: 'Respuesta a todos',
  reenviar: 'Reenvío',
}

/**
 * Los borradores del buzón, leídos de Gmail. No hay copia local: si alguien
 * crea uno desde Gmail, aparece acá también.
 */
export function EmailBorradoresPage() {
  const { activa } = useEmpresa()
  if (!puedeUsarEmails(activa?.rol)) {
    return (
      <div className={styles.page}>
        <h1 className={styles.titulo}>Borradores</h1>
        <p className={styles.vacio}>Tu rol en esta empresa no tiene acceso a la bandeja de correo.</p>
      </div>
    )
  }
  return <Borradores />
}

function Borradores() {
  const cuentas = useCuentas()
  const cuenta = cuentas.data?.[0] ?? null
  const navigate = useNavigate()
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const borradores = useQuery({
    queryKey: ['emails-borradores', cuenta?.id],
    queryFn: () => listarBorradores(cuenta!.id, null),
    enabled: !!cuenta,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  const abrir = async (b: ResumenBorradorGmail) => {
    if (!cuenta) return
    setAbriendo(b.draft_id)
    // Una respuesta se retoma dentro de su hilo, si el hilo ya está en la bandeja.
    if (b.modo && b.modo !== 'nuevo') {
      const id = await hiloIndexado(cuenta.id, b.thread_id).catch(() => null)
      if (id) {
        void navigate(`/emails/${id}?componer=${b.modo}&borrador=${encodeURIComponent(b.draft_id)}`)
        return
      }
    }
    void navigate(`/emails/redactar?borrador=${encodeURIComponent(b.draft_id)}`)
  }

  const error = borradores.error
  return (
    <div className={styles.page}>
      <Link to="/emails" className={styles.volver}>
        ← Volver a la bandeja
      </Link>
      <header className={styles.encabezado}>
        <div>
          <h1 className={styles.titulo}>Borradores</h1>
          <p className={styles.subtitulo}>Guardados en Gmail{cuenta ? ` · ${cuenta.direccion}` : ''}</p>
        </div>
        <Link to="/emails/redactar" className={styles.botonPrimario}>
          Nuevo email
        </Link>
      </header>

      {borradores.isPending && cuenta ? (
        <p className={styles.nota}>Leyendo los borradores de Gmail…</p>
      ) : error ? (
        <div className={styles.error} role="alert">
          <span>{mensajeDeError(error instanceof ErrorContenido ? error.codigo : 'desconocido')}</span>
          <button type="button" className={styles.boton} onClick={() => void borradores.refetch()}>
            Reintentar
          </button>
        </div>
      ) : (borradores.data ?? []).length === 0 ? (
        <div className={styles.vacio}>
          <p>No hay borradores.</p>
        </div>
      ) : (
        <ul className={styles.lista} aria-label="Borradores">
          {(borradores.data ?? []).map((b) => (
            <li key={b.draft_id}>
              <button type="button" className={styles.filaBoton} onClick={() => void abrir(b)} disabled={abriendo !== null}>
                <span className={styles.remitente}>{b.para.length ? `Para: ${b.para.join(', ')}` : '(sin destinatarios)'}</span>
                <span className={styles.centro}>
                  <span className={styles.asunto}>{b.asunto || '(sin asunto)'}</span>
                  <span className={styles.meta}>
                    {b.modo ? <span className={styles.chip}>{ETIQUETA_MODO[b.modo]}</span> : null}
                    {b.fecha ? <span>{new Date(b.fecha).toLocaleString('es-AR')}</span> : null}
                  </span>
                </span>
                <span className={styles.derecha}>{abriendo === b.draft_id ? 'Abriendo…' : 'Abrir'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
