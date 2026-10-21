import type { ReactNode } from 'react'

/**
 * Íconos de forma para el filtro guiado (Fase 90).
 *
 * El tile de una opción muestra una FOTO real cuando la hay (ver
 * `fotosDeOpcion.generated.json`); cuando no, muestra uno de estos íconos, que
 * dibujan la FORMA —la huella de la punta, el encastre— mejor que una foto, en
 * la que el encastre casi no se distingue.
 *
 * Son trazos simples sobre `currentColor`: heredan el color del tile y andan en
 * claro y oscuro sin tocar nada. Nada de fotos inventadas: una forma geométrica
 * es una forma, no una afirmación sobre un producto.
 */

const svg = (hijos: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {hijos}
  </svg>
)

/** Sin acentos, minúscula: así se compara un `tipo` o un `encastre`. */
function normal(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const FORMAS: { prueba: RegExp; icono: ReactNode }[] = [
  // ── Huellas (la punta) ─────────────────────────────────────────────────────
  { prueba: /phillips|pozidriv|cruz/, icono: svg(<><path d="M12 4v16M4 12h16" /><circle cx="12" cy="12" r="2.3" /></>) },
  { prueba: /torx plus|torx|estrella/, icono: svg(<path d="M12 3l1.6 2.3 2.8-.5-.5 2.8L18 11l-2.1 1.9.5 2.8-2.8-.5L12 17.5 10.4 15l-2.8.5.5-2.8L6 11l2.1-1.9-.5-2.8 2.8.5z" />) },
  { prueba: /plana|ranurada|pala/, icono: svg(<path d="M12 3v18M9 12h6" />) },
  { prueba: /cuadrad|robertson|square/, icono: svg(<rect x="7" y="7" width="10" height="10" rx="1" />) },
  { prueba: /allen|hexagonal interior|hex interior/, icono: svg(<path d="M12 5l6 3.5v7L12 19l-6-3.5v-7z" />) },
  { prueba: /bi-?hexagonal|12 puntas|doble/, icono: svg(<><path d="M12 4l5 2.9v6.2L12 16l-5-2.9V6.9z" /><path d="M12 7l2.6 1.5v3L12 13l-2.6-1.5v-3z" /></>) },
  { prueba: /hexagonal|hexagono/, icono: svg(<path d="M12 4l7 4v8l-7 4-7-4V8z" />) },
  { prueba: /tri-?wing|tres alas/, icono: svg(<><path d="M12 12V5M12 12l6 3.5M12 12l-6 3.5" /><circle cx="12" cy="12" r="7" /></>) },
  { prueba: /torq-?set/, icono: svg(<path d="M12 5v14M5 12h14" strokeWidth={2.4} />) },
  // ── Piezas ─────────────────────────────────────────────────────────────────
  { prueba: /embocadura|tubo|dado|socket|vaso/, icono: svg(<><rect x="8.5" y="4" width="7" height="16" rx="1" /><path d="M9.5 8h5" /></>) },
  { prueba: /extension|alargue|prolongador/, icono: svg(<><rect x="10.5" y="3" width="3" height="18" rx="1" /><rect x="8.5" y="2.5" width="7" height="3" rx="1" /></>) },
  { prueba: /adaptador|reduccion|acople/, icono: svg(<><rect x="9" y="3" width="6" height="8" rx="1" /><rect x="10" y="12" width="4" height="9" rx="1" /></>) },
  { prueba: /cardanic|rotula|junta/, icono: svg(<><path d="M12 3v5M12 16v5" /><circle cx="12" cy="12" r="4" /></>) },
  { prueba: /holder|portapuntas|porta/, icono: svg(<><rect x="3" y="9.5" width="13" height="5" rx="1" /><rect x="16" y="10.5" width="5" height="3" /></>) },
  { prueba: /nutsetter|tuerca/, icono: svg(<><path d="M12 4l6 3.5v9L12 20l-6-3.5v-9z" /><circle cx="12" cy="12" r="2" /></>) },
  { prueba: /iman|magnetic/, icono: svg(<><path d="M7 5v7a5 5 0 0010 0V5" /><path d="M7 8h3M14 8h3" strokeWidth={2.2} /></>) },
]

const GENERICO = svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12h8" /></>)

/** El ícono de forma para un tipo o un encastre. Siempre devuelve algo. */
export function iconoDeForma(texto: string): ReactNode {
  const n = normal(texto)
  for (const f of FORMAS) if (f.prueba.test(n)) return f.icono
  return GENERICO
}

/**
 * El encastre se dibuja con su forma —cuadrado (SQ), hexágono (HEX)— más la
 * medida escrita, que es lo que de verdad lo distingue: `1/2 SQ` de `3/4 SQ`.
 */
export function iconoDeEncastre(encastre: string): ReactNode {
  const n = normal(encastre)
  const esHex = /hex/.test(n)
  const medida = (encastre.match(/^\s*([\d/.-]+)/)?.[1] ?? '').replace(/-/g, ' ')
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      {esHex ? <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" /> : <rect x="4" y="4" width="16" height="16" rx="1.5" />}
      <text x="12" y="14.5" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none">
        {medida}
      </text>
    </svg>
  )
}
