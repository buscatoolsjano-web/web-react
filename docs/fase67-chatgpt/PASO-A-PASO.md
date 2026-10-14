# Conectar ChatGPT al ERP — paso a paso

Lo que ya está hecho y desplegado:

| Pieza | Dónde | Estado |
|---|---|---|
| Servidor MCP | `https://jiudqbusyknubonpedde.supabase.co/functions/v1/erp-mcp` | desplegado, 14 pruebas pasando |
| API REST (opcional, para clientes que no hablen MCP) | `…/functions/v1/erp-api` | desplegada, 15 pruebas pasando |
| Pantalla de consentimiento | `/#/oauth/consent` | escrita y probada, **falta publicarla** |

Lo que falta es todo configuración, y va en este orden porque cada paso
necesita un dato del anterior.

---

## 1 · Publicar la web (si no, el paso 4 falla)

La pantalla de consentimiento existe en el repo pero no en producción. Supabase
va a mandar a la gente ahí, así que tiene que estar publicada **antes** de
conectar nada.

Decime y hago el commit y el push; el workflow de GitHub publica solo. O lo
hacés vos. Para comprobar que quedó, esta URL tiene que mostrar la tarjeta del
ERP y no un 404:

```
https://app.buscatools.com/#/oauth/consent
```

(Sin `authorization_id` va a decir «no hay nada que aprobar». Eso está bien: es
la pantalla andando.)

---

## 2 · Habilitar el servidor OAuth en Supabase

Dashboard → **Authentication** → **OAuth Apps**.

1. Habilitar el servidor OAuth 2.1.
2. **Dejar el registro dinámico de clientes (DCR) APAGADO.**

   No es un detalle. Con el registro dinámico encendido, cualquiera que llegue
   al endpoint puede registrar un cliente OAuth —Supabase lo advierte en su
   propia documentación—. Combinado con el riesgo de origen compartido que ya
   tenemos documentado, alguien que consiguiera un token de sesión podría
   registrarse un cliente, aprobarse el acceso a sí mismo y quedarse con un
   permiso **que sobrevive a que el token venza**. Hoy un token robado dura una
   hora; con eso, duraría hasta que alguien lo revoque a mano.

   Se puede dejar apagado porque ChatGPT permite pre-registrar el cliente: en
   su configuración hay **Advanced OAuth settings → cliente definido por el
   usuario**, que es el camino del paso 4.
3. **Site URL**: `https://app.buscatools.com`
4. **Authorization Path**: `/#/oauth/consent`

   Probá esa primero. Si el campo no acepta el `#`, poné `/oauth/consent`: dejé
   un `404.html` que traduce una cosa en la otra. **Aviso honesto**: la forma
   con `#` está probada de punta a punta; la lisa depende de ese fallback, que
   no se puede probar sin publicar en GitHub Pages. Si tenés que usar la lisa,
   decime y lo verifico en cuanto esté arriba.

Cuando termines esto, **avisame**: corro un chequeo de tres cosas que deciden si
hace falta escribir código de autenticación o no.

- si anuncia `offline_access` (sin eso ChatGPT pierde el acceso cuando vence el
  token y hay que reconectar a mano),
- si acepta el parámetro `resource` (el protocolo obliga al cliente a mandarlo,
  y hay un bug reportado que devuelve 400 justo con eso),
- si deja pre-registrar clientes confidenciales.

---

## 3 · Habilitar developer mode en ChatGPT

Sos admin del workspace, así que te toca a vos y no se puede delegar.

**Workspace Settings → Permissions & Roles → Connected Data → Developer mode**

En plan Business cada admin lo tiene que habilitar para sí mismo: el toggle no
se aplica a todos.

---

## 4 · Crear la app MCP y sacar su callback

**Workspace settings → Apps → Create**

1. **Endpoint del servidor MCP**:
   ```
   https://jiudqbusyknubonpedde.supabase.co/functions/v1/erp-mcp
   ```
2. Nombre: algo como «ERP Buscatools».
3. Autenticación: **OAuth**.
4. Abrir **Advanced OAuth settings** y elegir **cliente definido por el
   usuario** (no el registro dinámico).
5. **Copiar la URL de callback que te muestra ahí.** Va a ser parecida a
   `https://chatgpt.com/connector/oauth/<algo>`.

   Ojo: **esa URL es distinta para cada conector**. No sirve una de otro
   tutorial ni la de otra app; tiene que ser la que te muestre a vos, en esta
   pantalla. Si después da un error de `redirect_uri`, es casi siempre esto.
6. **No le des «Scan Tools» todavía**: primero el paso 5.

---

## 5 · Registrar el cliente en Supabase

Dashboard → **Authentication** → **OAuth Apps** → **Add a new client**

| Campo | Valor |
|---|---|
| Nombre | ERP Buscatools (ChatGPT) |
| Redirect URI | la que copiaste en el paso 4.5, **exacta** |
| Tipo de cliente | **Confidential** |

Guardar, y copiar el **client ID** y el **client secret**.

El secret se muestra una sola vez. No me lo pegues en el chat: va directo de
ahí al campo de ChatGPT.

---

## 6 · Terminar en ChatGPT

De vuelta en la pantalla del paso 4:

1. Pegar **client ID** y **client secret**.
2. **Registration URL: dejarla vacía.** Eso es lo que le dice que no use
   registro dinámico.
3. Alcance (`scope`): `erp`
4. **Scan Tools**.
   - Se abre la autorización → te lleva a `app.buscatools.com`, te logueás si
     hace falta, y aparece la pantalla de consentimiento.
   - Mirá el destino que muestra: tiene que ser la URL de ChatGPT del paso 4.5.
     Para eso está.
   - **Conectar** → vuelve a ChatGPT y escanea las herramientas.
5. Si el escaneo anda, tienen que aparecer **13 herramientas**.
6. **Create**.

---

## 7 · Probarla antes de publicarla

Queda como borrador en **Workspace Settings → Apps → Drafts**. Probala en un
chat con la etiqueta `Dev` antes de darle Publish.

Tres preguntas que valen más que diez:

1. **«¿Quién soy y en qué empresa estoy?»** Tiene que decir tu nombre y tu
   empresa. Si dice el de otra persona, la resolución de empresa está mal y
   nada de lo demás es confiable.
2. **«¿Qué le cotizamos a Mirgor?»** Comparalo con lo que contesta el asistente
   de la web. Tienen que coincidir: es la misma base, las mismas funciones y
   los mismos permisos.
3. **Una búsqueda de un cliente con la razón social completa.** Tiene que
   volver a buscar con menos palabras antes de decir que no hay. Si dice «no
   hay» de una, el prompt de la skill no está haciendo su trabajo.

---

## 8 · Publicar para el equipo

**Workspace settings → Apps → Drafts → Publish**

Cada persona la va a ver en su configuración de Apps y, la primera vez que la
use, le va a pedir conectar **su** cuenta del ERP. Ahí cada uno pasa por la
pantalla de consentimiento con su usuario.

**No hace falta una app por persona.** Es una sola, y la identidad la pone
OAuth: ChatGPT guarda el token de cada uno por separado, y la RLS hace el resto.
Siete apps serían siete configuraciones de OAuth y siete lugares donde corregir
el mismo prompt.

---

## Lo que todavía no está, y conviene tener presente

- **La skill con los prompts.** Hoy el servidor manda unas instrucciones
  mínimas en el `initialize`. Los prompts buenos —los cinco especialistas de
  `agentes.ts`— están en [INSTRUCCIONES.md](INSTRUCCIONES.md) y hay que
  volcarlos como skill del plugin.
- **Escribir.** Las trece herramientas de hoy leen. Crear cotizaciones desde
  ChatGPT es la etapa siguiente: una RPC nueva que re-resuelve el borrador del
  lado del servidor —así lo que se crea es lo que se mostró— con idempotencia
  para que un reintento no deje dos cotizaciones.
- **`mi_contexto`.** Para que el agente sepa de entrada en qué anda cada uno
  (sus clientes, sus pendientes, sus marcas) sin tener que aprenderlo. El ERP ya
  tiene el dato en `created_by`, con la limitación conocida: sólo ve lo que
  nació en el ERP, no lo que vino de STEL.
