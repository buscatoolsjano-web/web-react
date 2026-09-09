# ADR-019 — Los tests de lógica pura no dependen de `.env`

Fecha: 2026-09-09 · Estado: **aceptado**

## Contexto

En Fase 1 se decidió que `parseEnv` fuera una función pura y que `getEnv`
estuviera memoizado detrás de una función, en vez de ser una constante de
módulo. El motivo: importar `src/lib/env.ts` no debe tener efectos
secundarios, y los tests no deben necesitar un `.env`.

Esa decisión **se rompió sin que nadie lo notara** durante la Fase 3.5.

### Qué pasó

Se escribió una función pura, `filtrarAtributosDeCategoria`, y se la puso
en `src/modules/catalogo/services/facetas.ts`. Ese módulo importa el
cliente de Supabase, que en su primera línea útil hace:

```ts
const env = getEnv()   // src/services/supabase/client.ts
```

El test de esa función importaba `facetas.ts` y, con él, toda la cadena.
Resultado: **el test pasó a exigir `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY`.**

En local pasaba, porque hay un `.env`. En CI el paso de tests **no recibe
los secrets** —sólo `npm run build` los recibe— y el deploy se cayó con:

```
Error: Configuración de entorno inválida.
  · VITE_SUPABASE_URL: Invalid input: expected string, received undefined
❯ src/services/supabase/client.ts:19:13
❯ src/modules/catalogo/services/facetas.ts:1:1
```

El error no fue de conocimiento sino de verificación: correr `npm test` con
un `.env` presente **no prueba** que la suite sea independiente del
entorno.

## Decisión

**1. La lógica pura vive en `lib/`, no en `services/`.**

| Carpeta | Qué contiene | ¿Puede importar el cliente Supabase? |
|---|---|---|
| `modules/<x>/lib/` | Lógica pura, testeable sin red | **No** |
| `modules/<x>/services/` | Acceso a datos | Sí, es su función |
| `modules/<x>/hooks/` | TanStack Query | A través de `services/` |

Un test que necesite `.env` es la señal de que la función está en el lugar
equivocado.

**2. Existe una suite aislada explícita.**

```bash
npm run test:isolated
```

Usa `vitest.aislado.config.ts`, que apunta `envDir` a una carpeta sin
archivos `.env`. Vite no inyecta ninguna variable `VITE_*`, así que
cualquier test que dependa de ellas falla — que es justamente lo que
queremos.

No renombra ni borra archivos: funciona igual en Windows, Linux y CI.

**3. CI corre las dos.**

`npm test` y `npm run test:isolated`. La primera ya corría sin secrets en
CI, pero eso era **implícito** y por eso el bug pasó desapercibido en
local. La segunda lo vuelve explícito y reproducible en cualquier máquina.

**4. Antes de pushear, correr la aislada.**

Es la regla operativa. `npm test` con `.env` presente no prueba nada sobre
la independencia del entorno.

## Alternativas descartadas

**Renombrar `.env` temporalmente en un script.** Frágil: si el proceso se
interrumpe, el `.env` queda renombrado. Y hace falta lógica distinta por
sistema operativo.

**Mockear el cliente de Supabase en los tests.** Esconde el problema en vez
de resolverlo: la función pura seguiría viviendo donde no corresponde, y el
mock habría que mantenerlo. Además no impide que mañana otro test importe
otro módulo de `services/`.

**Hacer `getEnv()` perezoso también en `client.ts`.** Volvería el cliente
un `Proxy` o una función, complicando cada uso para tapar un problema de
ubicación de código.

## Verificación

La suite aislada detecta el bug. Comprobado reintroduciéndolo con un test
canario que importa `services/facetas.ts`:

```
FAIL  src/canary.test.ts
Error: Configuración de entorno inválida.
Test Files  1 failed | 8 passed (9)
```

Sin el canario: **54 tests en verde con `.env` presente pero ignorado**.

## Consecuencias

- Un test que necesite red o entorno tiene que declararlo explícitamente;
  hoy no hay ninguno.
- La separación `lib/` ↔ `services/` deja de ser una convención y pasa a
  estar verificada por el CI.
- Los tests siguen corriendo con `environment: 'node'`, sin jsdom.
