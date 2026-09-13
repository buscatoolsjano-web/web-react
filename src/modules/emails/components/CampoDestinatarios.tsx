import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { partirEntrada } from '../lib/destinatarios'
import { autocompletar } from '../services/redactar'
import styles from './Composer.module.css'

export interface CampoDestinatariosProps {
  etiqueta: string
  valores: string[]
  onCambiar: (v: string[]) => void
  /** Texto a medio escribir que no es una dirección válida: bloquea el envío. */
  onPendiente?: (hayInvalido: boolean) => void
  deshabilitado?: boolean
}

/**
 * Destinatarios como chips. Enter, coma, punto y coma o salir del campo
 * confirman; lo inválido queda escrito y se marca, no se pierde.
 *
 * Las sugerencias vienen del CRM y del historial del índice. Una dirección que
 * aparece en varios clientes se muestra con ese contexto: nunca como un vínculo
 * verificado.
 */
export function CampoDestinatarios({ etiqueta, valores, onCambiar, onPendiente, deshabilitado = false }: CampoDestinatariosProps) {
  const id = useId()
  const companyId = useEmpresa().activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')
  const [invalido, setInvalido] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto.trim()), 250)
    return () => clearTimeout(t)
  }, [texto])

  const sugerencias = useQuery({
    queryKey: ['emails', companyId, 'autocompletar', consulta],
    queryFn: () => autocompletar(companyId!, consulta),
    enabled: companyId !== null && abierto && consulta.length >= 2 && !consulta.includes(','),
    staleTime: 60_000,
  })

  const confirmar = (entrada: string) => {
    const { validas, invalidas } = partirEntrada(entrada)
    const nuevas = validas.filter((d) => !valores.includes(d))
    if (nuevas.length) onCambiar([...valores, ...nuevas])
    const resto = invalidas.join(', ')
    setTexto(resto)
    setInvalido(resto ? `Dirección inválida: ${resto}` : null)
    onPendiente?.(resto !== '')
  }

  const quitar = (d: string) => onCambiar(valores.filter((x) => x !== d))
  const lista = (sugerencias.data ?? []).filter((s) => !valores.includes(s.direccion))

  return (
    <div className={styles.campo}>
      <label htmlFor={id} className={styles.etiqueta}>
        {etiqueta}
      </label>
      <div className={styles.chips}>
        {valores.map((d) => (
          <span key={d} className={styles.chip}>
            <span className={styles.chipTexto}>{d}</span>
            <button
              type="button"
              className={styles.chipQuitar}
              onClick={() => quitar(d)}
              disabled={deshabilitado}
              aria-label={`Quitar ${d} de ${etiqueta}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          multiple
          className={styles.entradaChip}
          value={texto}
          disabled={deshabilitado}
          autoComplete="off"
          inputMode="email"
          aria-invalid={invalido ? true : undefined}
          aria-describedby={invalido ? `${id}-error` : undefined}
          onFocus={() => setAbierto(true)}
          onChange={(e) => {
            const v = e.target.value
            if (/[,;\n]/.test(v)) confirmar(v)
            else {
              setTexto(v)
              if (invalido) {
                setInvalido(null)
                onPendiente?.(false)
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && texto.trim()) {
              e.preventDefault()
              confirmar(texto)
            } else if (e.key === 'Backspace' && texto === '' && valores.length) {
              quitar(valores[valores.length - 1]!)
            }
          }}
          onBlur={() => {
            if (texto.trim()) confirmar(texto)
            setTimeout(() => setAbierto(false), 150)
          }}
          onPaste={(e) => {
            const pegado = e.clipboardData.getData('text')
            if (/[,;\s]/.test(pegado.trim())) {
              e.preventDefault()
              confirmar(`${texto} ${pegado}`)
            }
          }}
        />
      </div>
      {invalido ? (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {invalido}
        </span>
      ) : null}
      {abierto && lista.length > 0 ? (
        <ul className={styles.sugerencias} aria-label={`Sugerencias para ${etiqueta}`}>
          {lista.map((s) => (
            <li key={s.direccion}>
              <button
                type="button"
                className={styles.sugerencia}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onCambiar([...valores, s.direccion])
                  setTexto('')
                  setInvalido(null)
                  onPendiente?.(false)
                }}
              >
                <span className={styles.sugerenciaDireccion}>{s.direccion}</span>
                <span className={styles.sugerenciaContexto}>
                  {[s.nombre, s.clienteNombre].filter(Boolean).join(' · ') || (s.fuente === 'historial' ? 'Del historial de la bandeja' : '')}
                  {s.clientes > 1 ? ` · figura en ${s.clientes} clientes` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
