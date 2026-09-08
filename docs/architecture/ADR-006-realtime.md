# ADR-006 — Estrategia de Realtime

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Aplica desde:** Fase 7

## Contexto

El legacy implementa el protocolo Phoenix a mano sobre `WebSocket`, con
heartbeat y reconexión propios (`app.js`, ~línea 43767). Ante cualquier
`postgres_changes` llama a `refrescar(false)`, que es un **refetch
completo**. Además corre polling en paralelo, y un `setInterval` de 10 s
para el badge que se crea al entrar a la sección y **nunca se limpia**:
entrar cinco veces deja cinco intervalos vivos.

## Decisión

### 1. Realtime sólo donde aporta

| Módulo | Realtime | Por qué |
|---|---|---|
| WhatsApp | **Sí** | Conversaciones en vivo, varios operadores |
| Notificaciones | **Sí** | El valor es la inmediatez |
| Estados críticos compartidos | **Evaluar** | Sólo con colaboración simultánea real |
| Catálogo, informes, configuración | **No** | Cambian poco; la caché alcanza |

### 2. Si hay Realtime, no hay polling

Nunca los dos sobre el mismo dato. Sin excepciones.

### 3. El evento actualiza el registro, no recarga la lista

```ts
// Sí:
queryClient.setQueryData(['mensajes', conversacionId], (prev) => [...prev, nuevo])

// No:
queryClient.invalidateQueries({ queryKey: ['mensajes'] })  // refetch completo
```

Un mensaje nuevo transfiere un mensaje, no la conversación entera.

### 4. Usar el SDK, no WebSocket crudo

`supabase.channel()` ya resuelve reconexión, backoff y refresh de token.

### 5. Toda suscripción se limpia

Se crean dentro de `useEffect` con su `return () => channel.unsubscribe()`.
Nunca en el cuerpo de una función de render o de entrada a una sección.

## Consecuencias

- Menos tráfico y menos renders que en el legacy.
- Costo: hay que razonar la actualización incremental de la caché por cada
  tipo de evento. Es intencional: es lo que evita el refetch total.
