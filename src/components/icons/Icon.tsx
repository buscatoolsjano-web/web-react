import type { SVGProps } from 'react'
import { TRAZOS, type IconName } from './iconPaths'

export type { IconName }

/**
 * Íconos propios del ERP. Geometría simple dibujada para este proyecto
 * (grilla 24×24, trazo 1.75, `currentColor`); sin paquetes externos.
 *
 * Son decorativos por defecto (`aria-hidden`). Un botón que sólo tiene ícono
 * lleva el nombre en el botón (`IconButton` lo exige), no en el SVG.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: 16 | 20 | 24 | 32
}

export function Icon({ name, size = 20, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={TRAZOS[name]} />
    </svg>
  )
}
