import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useAccionesEmpresa, useUrlLogo } from '../hooks/useEmpresaConfig'
import { LOGO_TIPOS, mensajeErrorEmpresa, validarLogo } from '../lib/empresa'
import { ErrorEmpresa } from '../services/empresa'
import { Dialogo } from './Dialogo'
import styles from './Configuracion.module.css'

export interface LogoEmpresaProps {
  logoPath: string | null
  version: string
  puedeEditar: boolean
  /** Otra operación en curso (p. ej. guardando datos). */
  ocupado: boolean
  onCambio: (r: { logoPath: string | null; version: string; mensaje: string }) => void
}

/**
 * Logo de la empresa: vista previa, subir/reemplazar y quitar.
 *
 * El navegador revisa tipo, tamaño y los primeros bytes para avisar rápido; la
 * Edge Function lo vuelve a validar sobre el archivo completo y es la única que
 * escribe en el bucket. No se acepta SVG.
 */
export function LogoEmpresa({ logoPath, version, puedeEditar, ocupado, onCambio }: LogoEmpresaProps) {
  const idInput = useId()
  const idAyuda = useId()
  const url = useUrlLogo(logoPath)
  const acciones = useAccionesEmpresa()
  const [elegido, setElegido] = useState<{ archivo: File; vista: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const trabajando = acciones.subirLogo.isPending || acciones.quitarLogo.isPending

  // La vista previa local es un object URL: se libera al cambiarla o al salir.
  useEffect(() => () => { if (elegido) URL.revokeObjectURL(elegido.vista) }, [elegido])

  async function elegir(archivo: File | undefined) {
    setError(null)
    if (!archivo) return
    const cabecera = new Uint8Array(await archivo.slice(0, 16).arrayBuffer())
    const invalido = validarLogo(archivo.type, archivo.size, cabecera)
    if (invalido) {
      setError(mensajeErrorEmpresa(invalido))
      setElegido(null)
      return
    }
    setElegido({ archivo, vista: URL.createObjectURL(archivo) })
  }

  async function guardar() {
    if (!elegido) return
    setError(null)
    try {
      const r = await acciones.subirLogo.mutateAsync({ version, archivo: elegido.archivo })
      setElegido(null)
      onCambio({ ...r, mensaje: logoPath ? 'Logo reemplazado.' : 'Logo guardado.' })
    } catch (e) {
      setError(mensajeErrorEmpresa(e instanceof ErrorEmpresa ? e.codigo : 'desconocido'))
    }
  }

  async function quitar() {
    setError(null)
    try {
      const r = await acciones.quitarLogo.mutateAsync({ version })
      setConfirmarQuitar(false)
      onCambio({ ...r, mensaje: 'Logo quitado.' })
    } catch (e) {
      setConfirmarQuitar(false)
      setError(mensajeErrorEmpresa(e instanceof ErrorEmpresa ? e.codigo : 'desconocido'))
    }
  }

  const vista = elegido?.vista ?? url.data ?? null
  return (
    <div className={styles.logo}>
      <div className={styles.logoMarco} aria-live="polite">
        {vista ? (
          <img src={vista} alt={elegido ? 'Vista previa del logo nuevo' : 'Logo actual de la empresa'} className={styles.logoImagen} />
        ) : logoPath && url.isPending ? (
          <span className={styles.nota}>Cargando logo…</span>
        ) : logoPath && url.isError ? (
          <span className={styles.nota}>No se pudo cargar el logo.</span>
        ) : (
          <span className={styles.nota}>Sin logo</span>
        )}
      </div>

      <div className={styles.logoAcciones}>
        <p id={idAyuda} className={styles.nota}>
          PNG, JPEG o WEBP, hasta 2 MB. Hoy la impresión de documentos todavía no usa el logo.
        </p>
        {puedeEditar && !elegido && (
          <div className={styles.barra}>
            <label htmlFor={idInput} className={styles.botonArchivo} aria-disabled={ocupado || trabajando}>
              {logoPath ? 'Reemplazar logo' : 'Subir logo'}
            </label>
            <input
              id={idInput}
              type="file"
              accept={LOGO_TIPOS.join(',')}
              className={styles.inputArchivo}
              aria-describedby={idAyuda}
              disabled={ocupado || trabajando}
              onChange={(e) => {
                void elegir(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {logoPath && (
              <Button variant="ghost" onClick={() => setConfirmarQuitar(true)} disabled={ocupado || trabajando}>
                Quitar logo
              </Button>
            )}
          </div>
        )}
        {puedeEditar && elegido && (
          <div className={styles.barra}>
            <Button onClick={() => void guardar()} disabled={ocupado || trabajando}>
              {trabajando ? 'Guardando…' : 'Guardar logo'}
            </Button>
            <Button variant="secondary" onClick={() => setElegido(null)} disabled={trabajando}>
              Cancelar
            </Button>
          </div>
        )}
        {error && <StatusMessage tono="error" titulo={error} />}
      </div>

      {confirmarQuitar && (
        <Dialogo
          titulo="Quitar logo"
          onCerrar={() => setConfirmarQuitar(false)}
          bloqueado={trabajando}
          pie={
            <>
              <Button variant="secondary" onClick={() => setConfirmarQuitar(false)} disabled={trabajando}>
                Cancelar
              </Button>
              <Button className={styles.peligro} onClick={() => void quitar()} disabled={trabajando}>
                {trabajando ? 'Quitando…' : 'Quitar logo'}
              </Button>
            </>
          }
        >
          <p className={styles.dialogoTexto}>
            Se borra la imagen guardada. Cuando la impresión de documentos use el logo, los documentos quedarán sin él hasta que
            se suba otro.
          </p>
        </Dialogo>
      )}
    </div>
  )
}
