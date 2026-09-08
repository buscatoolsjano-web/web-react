# ADR-002 — TanStack Query como única capa de estado servidor

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Fase:** 1

## Contexto

La auditoría del sistema legacy encontró estos patrones:

- `setInterval(_supaPoll, 30000)`: cada usuario descargaba **la base
  entera** cada 30 segundos, mirara lo que mirara.
- Realtime y polling corriendo **al mismo tiempo** en WhatsApp, donde
  cualquier evento disparaba un refetch completo.
- Requests duplicadas por falta de deduplicación.
- Estados de carga y error resueltos a mano en cada pantalla.

## Decisión

**TanStack Query** es la única capa de estado servidor. Defaults en
`src/lib/queryClient.ts`:

```ts
staleTime: 30_000
gcTime: 5 * 60_000
retry: 1
refetchOnWindowFocus: false
```

### Reglas

1. **Prohibido `refetchInterval` global.** El polling se justifica caso por
   caso y se documenta en el hook.
2. **Todo dato de servidor pasa por un hook** `useX()` que llama a un
   service. Nada de `useEffect` + `fetch`.
3. **Cada módulo ajusta su propio `staleTime`.** Valores de referencia:
   catálogo 5 min · documentos 30 s · datos con Realtime 0.
4. **Después de una mutación se invalida la query afectada**, no todo.
5. **Nada de estado servidor en `useState`.** Si viene de Supabase, es de
   Query.

## Consecuencias

- Se elimina de raíz la clase de bug del polling global.
- Loading y error quedan uniformes en toda la app.
- Costo: hay que aprender el modelo mental de invalidación de Query.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Redux / Zustand para datos de servidor | Resuelven estado de cliente; caché, dedupe e invalidación quedarían a mano |
| SWR | Equivalente, pero con menos herramientas para paginación y mutaciones |
| `useEffect` + `fetch` | Es exactamente el patrón que produjo los bugs del legacy |
