# ADR-008 — Estilos, design tokens y estrategia responsive

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Fase:** 1

## Contexto

Dos requisitos que tiran en direcciones opuestas:

1. **Fidelidad visual**: la migración conserva el aspecto del legacy; el
   rediseño es una decisión aparte y explícita.
2. **Mobile-first de verdad**: no una versión de escritorio comprimida.

El CSS legacy tiene 1.232 reglas, **260 `!important`** y sólo **17
`@media`** — es esencialmente desktop-only. Pero también tiene algo
aprovechable: **27 custom properties** por tema, con temas claro y oscuro
ya definidos.

## Decisión

### 1. Tokens portados literalmente

Las 27 variables de `:root[data-theme]` están en `src/styles/tokens.css`
con **los valores exactos** del legacy. No se retocan sin aprobación: son
la garantía de que la v2 se ve como la v1.

Se agregan tokens nuevos (espaciado, radios, tipografía, z-index) que el
legacy resolvía con números sueltos repetidos.

### 2. CSS Modules, sin framework

Nada de Tailwind, MUI, Chakra ni shadcn.

Un framework de utilidades o de componentes traería su propio sistema
visual y forzaría un rediseño encubierto — justo lo que no queremos. CSS
Modules da alcance local sin capa de traducción, y permite copiar reglas
del legacy casi tal cual cuando hace falta paridad exacta.

Consecuencia deseada: **cero `!important` en el proyecto nuevo.** Los 260
del legacy son síntoma de CSS global peleando consigo mismo; con alcance
local no hacen falta.

### 3. Mobile-first literal

La regla base es la de celular. Los `@media (min-width: …)` **agregan**
complejidad para pantallas grandes; nunca al revés.

Ejemplo en `AppLayout.module.css`: el sidebar es un drawer `fixed` por
defecto, y recién a partir de 768px pasa a ser columna `sticky` de la
grilla.

### 4. Un solo breakpoint de referencia

`--bp-mobile: 768px` en CSS y `MOBILE_BREAKPOINT = 768` en
`useMediaQuery.ts`. Están comentados uno al otro: si cambia uno, cambia el
otro. Es el único punto de duplicación aceptado, y es inevitable porque
`ResponsiveTable` decide en JS qué renderizar.

### 5. El body nunca scrollea en horizontal

`overflow-x: hidden` en `body`, y el contenido ancho scrollea **dentro de
su propia caja** (`.scroll-x`, `.scroller` de ResponsiveTable).
Verificado en Fase 1 a 390px: `scrollWidth === clientWidth`.

### 6. ResponsiveTable: genérico con escape hatch

Tabla en escritorio, cards en celular, desde una sola definición de
columnas. Renderiza **una** de las dos vistas, no ambas ocultas con CSS.

Para no caer en sobre-ingeniería, la personalización tiene un límite claro:
si un módulo necesita una card muy propia, pasa `renderCard` y reemplaza la
card entera. **No** vamos a hacer el layout genérico cada vez más
configurable.

## Consecuencias

- Fidelidad visual verificable comparando contra el legacy.
- El patrón tabla→cards se define una vez y lo heredan los 19 módulos.
- Costo: escribir CSS a mano en vez de utilidades. Aceptado a cambio de
  controlar el resultado visual.

## Actualización — Fase 13 (rediseño aprobado, 2026-09-14)

La regla «tokens portados literalmente, no se retocan sin aprobación» se
levanta **con aprobación explícita** para el rediseño global (decisiones de
producto registradas en `docs/PHASE_13_REDISENO_ENTREGA_1_FUNDACIONES.md`):
marca `#f37021`, acción primaria `#c2410c`, sidebar clara con header oscuro,
densidad comfortable, dark mode fuera de la fase, sin librerías de UI.

Cómo convive con lo anterior:

1. `tokens.css` tiene ahora tres capas: paleta y escalas nuevas
   (`--color-*`, `--radius-md`, `--control-h-*`, `--z-*`…), **alias** con los
   nombres de Fase 1 que apuntan a la paleta nueva, y el tema oscuro legacy
   sin expandir. Los CSS Modules existentes no se editan: heredan el
   contraste corregido por los alias. Los alias se retiran en la entrega de
   cierre, cuando todos los módulos usen los nombres nuevos.
2. El punto 2 (CSS Modules, sin framework) sigue vigente. Las primitivas
   (`src/components/ui`, `forms`, `modals`, `tables`, `feedback`, `icons`)
   son propias; los íconos son SVG dibujados para el proyecto, sin paquete.
3. El punto 4 se amplía a cuatro breakpoints permitidos
   (`max-width: 767px`, `min-width: 768px`, `1024px`, `1440px`);
   `--bp-mobile` / `MOBILE_BREAKPOINT` siguen siendo la referencia de JS.
4. `src/styles/tokens.test.ts` falla si un CSS usa una variable no definida
   o si un par texto/fondo de la paleta baja de WCAG AA.
