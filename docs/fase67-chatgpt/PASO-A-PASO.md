# Conectar ChatGPT al ERP — paso a paso

Lo que ya está hecho y desplegado:

| Pieza | Dónde | Estado |
|---|---|---|
| Servidor MCP | `https://jiudqbusyknubonpedde.supabase.co/functions/v1/erp-mcp` | desplegado, 14 pruebas pasando |
| La skill con los prompts | la sirve el MCP (`skills/list`) | desplegada; el import lo valida ChatGPT |
| Crear cotizaciones | RPC `asistente_crear_cotizacion` | aplicada; los caminos que se niegan, probados |
| API REST (opcional, para clientes que no hablen MCP) | `…/functions/v1/erp-api` | desplegada, 15 pruebas pasando |
| Pantalla de consentimiento | `https://app.buscatools.com/#/oauth/consent` | **publicada y verificada** |

Lo que falta es todo configuración, y va en este orden porque cada paso
necesita un dato del anterior.

---

## 1 · Publicar la web — ✅ hecho

Commiteado y publicado el 2026-10-14 (`678dd3f`). De paso se arregló la suite
aislada, que venía frenando el deploy desde `771eb86`: CI exige
`npm run test:isolated` antes de publicar y fallaba en cuatro archivos, así que
nada se estaba publicando. Ver ese commit.

Si querés comprobarlo con tus propios ojos, esta URL tiene que mostrar la
tarjeta del ERP (y, sin sesión, mandarte al login):

```
https://app.buscatools.com/#/oauth/consent
```

---

## 2 · Habilitar el servidor OAuth en Supabase

Dashboard → **Authentication** → **OAuth Server** (en la barra lateral). Ojo que
**no** es «OAuth Apps»: ésa es para registrar clientes y viene después, en el
paso 5.

Está en beta y es gratis durante la beta, en todos los planes.

1. Habilitar las capacidades del servidor OAuth 2.1.
2. **Dejar el registro dinámico de clientes (DCR) APAGADO.** El toggle está en
   esta misma pantalla.

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
3. **Authorization Path**: `/oauth/consent` o `/#/oauth/consent`, las dos
   andan. Está en esta misma pantalla, debajo del toggle.
4. **Site URL**: tiene que ser `https://app.buscatools.com`, y ese campo vive en
   otra pantalla: **Authentication** → **URL Configuration**. Supabase arma la
   URL del consentimiento pegando Site URL + Authorization Path, así que si el
   Site URL quedó apuntando a otra parte, la gente va a caer en otro lado.

   Verificado en producción el 2026-10-14: la forma lisa cae en el 404 de
   GitHub Pages, el `404.html` la traduce al hash, y el `authorization_id`
   sobrevive ese salto **y** el del login si la persona no tenía sesión. La
   cadena completa queda así:

   ```
   /oauth/consent?authorization_id=X
     → /#/oauth/consent?authorization_id=X
     → /#/auth/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3DX
     → (se loguea) → la pantalla de consentimiento, con el pedido intacto
   ```

### Hecho el 2026-10-14, y lo que dio

Cuatro chequeos contra el proyecto ya habilitado. No hizo falta escribir código
de autenticación: Supabase alcanza tal como viene.

| Chequeo | Resultado |
|---|---|
| ¿Anuncia `offline_access`? | ✅ sí — ChatGPT va a poder renovar el token sin que nadie reconecte a mano |
| ¿Acepta el parámetro `resource` (RFC 8707)? | ✅ sí — redirige al consentimiento igual que sin él. El bug reportado no afecta a este proyecto |
| ¿Deja pre-registrar clientes confidenciales? | ✅ sí — `client_secret_basic` y `client_secret_post`, PKCE con `S256`. No hace falta el registro dinámico |
| ¿Acepta `erp` como alcance? | ❌ **no** — `unsupported scope: erp` |

**El último rompía el flujo y se corrigió.** El servidor MCP pedía `scope="erp"`
en la cabecera `WWW-Authenticate`; los alcances que acepta Supabase son
`openid`, `profile`, `email`, `phone` y `offline_access`, y uno propio falla
antes de llegar a la pantalla de consentimiento. Ahora no declara ninguno: el
spec dice que si el recurso no publica alcances el cliente omite el parámetro, y
así la autorización pasa. Tampoco hacía falta ninguno, porque acá los permisos
no los decide el token: los decide la RLS, que filtra por la persona.

Cómo se midió: se registró un cliente OAuth público descartable, se probó el
`/authorize` con y sin `resource` y con cada alcance, y se borró. Quedaron **0
clientes** registrados.

### Una recomendación de Supabase que conviene leer antes de decidir

Supabase recomienda, para uso de OAuth, migrar la firma de los JWT de HS256
(simétrica) a una asimétrica como RS256. El motivo es bueno: los clientes
pueden validar los tokens con la clave pública del JWKS sin que haya que
compartirles el secreto.

**No es obligatorio para lo nuestro**, porque no pedimos el alcance `openid`.
Pero si alguna vez se pidiera, la generación del ID token **falla con HS256**,
así que ahí sí haría falta.

Lo dejo señalado y no lo hago: cambiar cómo se firman los tokens de producción
es una decisión con su propio riesgo y no corresponde meterla de contrabando en
este paso.

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
3. Alcance (`scope`): **dejalo vacío.** Nuestro servidor no pide ninguno a
   propósito —ver el chequeo del paso 2— y Supabase rechaza los que no conoce.
   Si el campo fuera obligatorio, poné `offline_access`, que es el único que
   sirve para algo acá: es el que habilita el refresh token.
4. **Scan Tools**.
   - Se abre la autorización → te lleva a `app.buscatools.com`, te logueás si
     hace falta, y aparece la pantalla de consentimiento.
   - Mirá el destino que muestra: tiene que ser la URL de ChatGPT del paso 4.5.
     Para eso está.
   - **Conectar** → vuelve a ChatGPT y escanea.
5. Tienen que aparecer **15 herramientas** (trece de lectura, `crear_cotizacion`
   y `quien_soy`) **y una skill**, `erp-buscatools`.

   **Fijate en la skill, no sólo en las herramientas.** Ahí viven los prompts:
   las reglas de no inventar, de insistir antes de decir que no hay, de no
   sumar monedas distintas. Si el import de la skill falla, ChatGPT **igual
   importa las herramientas** y no avisa de nada: el agente funciona y contesta
   peor. Es la falla que no se nota.

   Si no aparece, decime y lo miro: el servidor la sirve y hay pruebas, pero la
   validación del import la hace OpenAI de su lado.
6. **Create**.

> **Las skills son un snapshot, no algo vivo.** Si más adelante cambiamos el
> texto de los prompts y desplegamos, ChatGPT sigue usando el que importó: hay
> que volver a correr **Scan Tools**, revisar y publicar una versión nueva.

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

## Crear cotizaciones: cómo quedó

`crear_cotizacion` es la única herramienta que escribe, y hay tres cosas que
conviene saber antes de usarla.

**ChatGPT va a pedir confirmación cada vez.** Está marcada `readOnlyHint:
false`, que es lo que hace que no ofrezca «permitir siempre». La confirmación
ahora vive en ChatGPT y no en nuestra pantalla, así que es el único momento en
que alguien ve los datos antes de que la cotización exista. La skill además le
prohíbe crearla sin haber mostrado antes el borrador.

**El modelo no puede alterar lo que se crea.** Manda un nombre de cliente y una
lista de «producto, cantidad» —lo mismo que a `preparar_cotizacion`— y la RPC
vuelve a resolver el borrador del lado del servidor. Nunca manda un
identificador, ni un precio, ni un total.

**Un reintento no crea una segunda.** La idempotencia es por huella —empresa,
cliente, moneda, autor, subtotal y cantidad de renglones dentro de 10 minutos—
y no por una clave que mande el modelo, porque en un reintento el modelo
generaría otra clave y no serviría de nada. Ante la duda no crea: devuelve la
que ya existe con su número.

Y un límite que no es un error: **un rol `salesperson` no puede crear
cotizaciones**, porque `crear_cotizacion` del ERP exige `admin` o `employee`. La
herramienta lo dice con un mensaje claro en vez de fallar con un código, y en
ese caso el agente muestra el borrador y dice a quién pedírselo.

Lo que **no** está probado de punta a punta es la creación real: una prueba
automática dejaría un documento de verdad y consumiría un número de la
secuencia. Lo que sí está probado, como `authenticated` y no como `postgres`,
son los cuatro caminos que se niegan: empresa ajena, rol insuficiente, cliente
inexistente y renglón sin resolver. La primera creación conviene hacerla a mano
y mirarla.

---

## Lo que todavía no está, y conviene tener presente

- **`mi_contexto`.** Para que el agente sepa de entrada en qué anda cada uno
  (sus clientes, sus pendientes, sus marcas) sin tener que aprenderlo. El ERP ya
  tiene el dato en `created_by`, con la limitación conocida: sólo ve lo que
  nació en el ERP, no lo que vino de STEL.
