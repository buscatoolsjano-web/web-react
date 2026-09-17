# FASE 16 · WHATSAPP — GROUPS API: PREPARACIÓN

> Auditoría **de sólo lectura**. No se creó ningún grupo, no se tocó Meta, no se pidió OBA ni
> verificación de empresa, no se llamó a Graph API. Fuente: la documentación pública de Meta,
> leída el 2026-09-17 (enlaces al pie). 2026-09-17.

---

## 1. Conclusión

```
GROUPS_READY = BLOCKED_BY_META
```

El ERP quedó **preparado** para conversaciones grupales (schema, análisis, RLS), pero la
integración no puede habilitarse hasta cumplir un requisito que depende de Meta: la **Official
Business Account (OBA)**. Mientras tanto, producción sigue sólo con conversaciones 1:1.

La única vía oficial es la **Groups API de Cloud API**. No se evaluó —ni se va a evaluar—
ninguna alternativa no oficial (Baileys, whatsapp-web.js, automatización de WhatsApp Web,
sesiones por QR, scraping).

---

## 2. Qué dice la documentación de Meta

### 2.1 Requisitos

| Requisito | Detalle | Estado Buscatools |
|---|---|---|
| **Official Business Account (OBA)** | «To qualify for groups features, your business must be an Official Business Account». Sin OBA no hay acceso a la API. | **No verificado.** No hay constancia en el repositorio ni se consultó Meta (fuera de alcance). |
| Número en Cloud API | Los números de la app WhatsApp Business y los de *Multi-solution Conversations* están excluidos. | El número `+54 9 11 2186-6133` (Phone Number ID `1267748423093872`) está en Cloud API. ✔ |
| Permiso | `whatsapp_business_messaging`. | El token del system user ya lo tiene. ✔ |
| Webhook | Servidor de webhooks de Cloud API configurado. | Existe y funciona (`whatsapp-webhook`). ✔ |
| Campos de webhook | `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`. | **No suscriptos.** Suscribirlos es un paso en Meta, fuera de esta entrega. |

La verificación de empresa (business verification) suele ser condición previa del OBA; la
página de grupos no la nombra por separado. Hay que confirmarlo en el trámite de OBA.

### 2.2 Límites

| Límite | Valor documentado |
|---|---|
| Participantes por grupo | **8** |
| Grupos por número de empresa | **10.000** |
| Empresas de Cloud API por grupo | **1** |
| Mensajes fijados | 3, sólo administradores |

El tope de **8 participantes** es bajo y condiciona el caso de uso: sirve para un grupo de
trabajo chico con un cliente (compras + ingeniería + nuestro vendedor), **no** para listas de
difusión ni grupos grandes. Conviene reconfirmarlo al momento de implementar: es el tipo de
número que Meta ajusta.

### 2.3 Grupo creado por API vs. grupo existente

- Los grupos **se crean por API**: el endpoint *Create Group* del número de la empresa.
- La documentación **no describe** ninguna forma de conectar un grupo que ya existe en la app de
  WhatsApp. Se asume que **no es posible**: los grupos actuales de la empresa en el teléfono no
  pasan al ERP.
- Tampoco se puede agregar gente directamente: el grupo es **por invitación**.

### 2.4 Flujo de invitación

1. La empresa crea el grupo por API.
2. Obtiene el **enlace de invitación** (se puede leer y resetear por API).
3. Lo manda al cliente — hay una plantilla específica, *Group Invite Link Template*.
4. Cada participante decide si entra. Hay manejo de **solicitudes de ingreso** y de **remoción**.

### 2.5 Mensajes

| | |
|---|---|
| Enviar | `POST /<PHONE_NUMBER_ID>/messages` con `recipient_type: "group"` y `to: <group_id>`. |
| Recibir | El mensaje trae `group_id`; `from` es el **participante** que escribió y `contacts[].wa_id` coincide con `from`. |
| Tipos soportados | Texto, media, plantillas de texto y de media. |
| No soportado | Llamadas, mensajes temporales, «ver una vez», autenticación, comercio, interactivos; tampoco editar ni borrar mensajes. Error `130501` para tipos no soportados. |
| Estados | Por el campo `messages`, igual que 1:1 (`sent`, `delivered`). |
| Precio | Por mensaje. Las métricas de rendimiento de plantillas no están disponibles para plantillas de grupos. |

La página de mensajería de grupos **no aclara** si aplica la ventana de atención de 24 h. No se
asume ni una cosa ni la otra: se verifica antes de implementar.

---

## 3. Qué dejó preparado la Entrega 2

| Pieza | Estado |
|---|---|
| `whatsapp_conversations.conversation_type` | `individual` \| `group`. Default `individual`; las filas existentes se rellenaron solas al agregar la columna. |
| `provider_group_id`, `group_name` | Nullable. Un check exige: individual ⇒ los dos en NULL; grupo ⇒ `provider_group_id` obligatorio. |
| Unicidad | Un grupo usa `provider_contact_id = 'group:' \|\| provider_group_id`. El índice único existente `(account_id, provider_contact_id)` sigue valiendo para los dos tipos **sin tocarlo**, y un `wa_id` de persona no puede chocar con un id de grupo. |
| `whatsapp_messages.sender_wa_id`, `sender_name` | Nullable. En un grupo, `from` del webhook es el participante: ahí va. En 1:1 quedan en NULL. |
| Análisis de IA | La salida ya tiene `actor: company \| contact \| unknown` y **no infiere personas**. `analizarConversacion` responde `no_soportado` para grupos: no se analiza un grupo hasta que el prompt sepa distinguir participantes. |
| RLS | Las tablas de IA derivan el permiso de `conversation_id`: un grupo hereda las mismas reglas que una conversación 1:1. |

### Lo que NO se creó, a propósito

**`whatsapp_conversation_participants`.** Con la documentación actual, los participantes de un
grupo llegan por los webhooks `group_participants_update` y por `from`/`contacts` en cada
mensaje. Crear la tabla hoy sería diseñarla sin haber visto un payload real, y quedaría vacía.
Diseño propuesto para cuando haga falta:

```
whatsapp_conversation_participants
  conversation_id  uuid  → whatsapp_conversations (on delete cascade)
  company_id       uuid
  wa_id            text
  display_name     text  null
  role             text  null   -- admin | member, según lo que mande Meta
  joined_at        timestamptz null
  left_at          timestamptz null
  unique (conversation_id, wa_id)
  RLS: app.puede_ver_conversacion_wa(conversation_id)
```

---

## 4. Qué falta para habilitar grupos (fuera de E2)

1. **OBA** para el número de la empresa (trámite en Meta, decisión de negocio).
2. Suscribir los cuatro campos `group_*` del webhook.
3. Webhook: normalizar `group_id`, `from` y los eventos `group_*`; crear la conversación de tipo
   `group` y registrar participantes.
4. Crear la tabla de participantes (diseño de §3) con un payload real a la vista.
5. Envío: `recipient_type: "group"` en `whatsapp-send-message`, y confirmar la regla de ventana.
6. Análisis: pasar el autor de cada mensaje al prompt y habilitar `conversation_type = 'group'`.
7. UI: nombre del grupo, participantes y autor por burbuja.
8. Revalidar el límite de 8 participantes y el precio por mensaje antes de prometer el caso de uso.

---

## 5. Fuentes

- [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
- [Get started with Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/get-started)
- [Group messaging](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/)
- [Groups Participants API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/groups/groups-participants-api)
