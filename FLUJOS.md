# Documentación de Flujos — W|E Bot WhatsApp

> Arquitectura: Chatwoot Agent Bot
> Última actualización: 2026-03-18

---

## Índice

1. [Arquitectura general](#1-arquitectura-general)
2. [Estados de sesión](#2-estados-de-sesión)
3. [Mapa de transiciones](#3-mapa-de-transiciones)
4. [Flujo 1 — Identificación por correo](#4-flujo-1--identificación-por-correo)
5. [Flujo 2 — Menú principal](#5-flujo-2--menú-principal)
6. [Flujo 3 — Campus Virtual](#6-flujo-3--campus-virtual)
7. [Flujo 4 — Certificados](#7-flujo-4--certificados)
8. [Flujo 5 — Justificaciones](#8-flujo-5--justificaciones)
9. [Flujo 6 — Materiales y Video Clases](#9-flujo-6--materiales-y-video-clases)
10. [Flujo 7 — Instaladores](#10-flujo-7--instaladores)
11. [Flujo 8 — Grupo WhatsApp](#11-flujo-8--grupo-whatsapp)
12. [Flujo 9 — IA / RAG (texto libre)](#12-flujo-9--ia--rag-texto-libre)
13. [Flujo 10 — Transfer a agente humano](#13-flujo-10--transfer-a-agente-humano)
14. [Opciones de transfer directo](#14-opciones-de-transfer-directo)
15. [Reglas del estado "transferido"](#15-reglas-del-estado-transferido)
16. [Sesión — ciclo de vida](#16-sesión--ciclo-de-vida)
17. [Tabla resumen de archivos por flujo](#17-tabla-resumen-de-archivos-por-flujo)

---

## 1. Arquitectura general

```
Alumno (WhatsApp)
      │
      ▼
  Chatwoot          ← recibe TODOS los mensajes, los agentes los ven en tiempo real
      │  Agent Bot webhook
      ▼
  server.js         ← POST /webhook/chatwoot
      │
      ▼
   bot.js           ← extrae phone + conversationId, router por estado de sesión
      │
      ├─► flows/    ← lógica de cada flujo
      ├─► services/whatsapp.js
      │     ├─► sendText()       → Chatwoot API
      │     ├─► sendButtons()    → Meta API directa + nota privada Chatwoot
      │     └─► sendList()       → Meta API directa + nota privada Chatwoot
      ├─► services/ai.js         → Claude API (RAG)
      └─► services/database.js   → PostgreSQL (verificar alumno)
```

---

## 2. Estados de sesión

Cada número de teléfono tiene una sesión en memoria con un campo `estado`.
El estado determina qué hace el bot con el próximo mensaje recibido.

| Estado | Descripción | Archivo que lo setea |
|---|---|---|
| `inicio` | Sesión nueva o expirada. Saluda y pide correo. | `session.js` (createSession) |
| `esperando_correo` | Espera que el alumno escriba su email. | `identificacion.js` |
| `correo_no_encontrado` | Email no encontrado. Muestra botones de acción. | `identificacion.js` |
| `menu` | Alumno verificado. Espera selección del menú o texto libre. | `identificacion.js` / múltiples flows |
| `flow_campus` | Dentro del flujo Campus Virtual. | `campus.js` |
| `flow_cert_tipo` | Eligiendo tipo de certificado (Curso vs Programa). | `certificados.js` |
| `flow_cert_info` | Mostrando info del certificado. Espera confirmación. | `certificados.js` |
| `flow_justificacion_datos` | Esperando nombre del curso/programa para la justificación. | `justificaciones.js` |
| `flow_materiales` | Dentro del flujo Materiales/Video Clases. | `materiales.js` |
| `flow_instaladores` | Eligiendo instalador. | `instaladores.js` |
| `flow_grupo_datos` | Esperando nombre del programa para enviar link de grupo. | `bot.js` |
| `transferido` | Agente humano en control. Bot responde máx. 2 veces más. | `transfer.js` |

---

## 3. Mapa de transiciones

```
[cualquier mensaje]
       │
       ▼
  ┌─────────┐    correo correcto     ┌──────┐
  │  inicio │ ──────────────────────►│ menu │◄──────────────────────────────┐
  └─────────┘                        └──────┘                               │
       │                               │  │                                 │
  pide correo                          │  └─► opción menú ─────────────────►│
       │                               │                                    │
       ▼                               ▼                                    │
  [esperando_correo]        texto libre (RAG)                               │
       │                               │                                    │
  email encontrado                     ▼                                    │
       │                        [respuesta IA]                              │
  email no encontrado                  │                                    │
       │                        TRANSFER? ──►[transfer] ──► [transferido]   │
       ▼                                                                    │
  [correo_no_encontrado]                                                    │
       ├─ "Intentar otro correo" ──► [esperando_correo]                    │
       └─ "Hablar con asesor"   ──► [transfer] ──► [transferido]           │
                                                                           │
  Flows individuales:                                                      │
  campus_virtual    ──► [flow_campus]    ──► ok? ──────────────────────────┘
                                         └─► no ──► [transfer]
                                                                           │
  certificacion     ──► [flow_cert_tipo] ──► [flow_cert_info] ──── ok ────┘
                                                                └─ asesor ─► [transfer]
                                                                           │
  justificaciones   ──► [flow_justif_datos] ──► [transfer]                │
                                                                           │
  materiales        ──► [flow_materiales] ──► ok ───────────────────────── ┘
  video_clases                             └─► no accede ──► [flow_campus]
                                                                           │
  instaladores      ──► [flow_instaladores] ──► SAP ────────────────────── ┘
                                               └─► Office ─────────────────┘
                                               └─► Otro  ──► [transfer]
                                                                           │
  grupo_whatsapp    ──► [flow_grupo_datos] ──► [transfer]                 │
                                                                           │
  cursos_online     ──► texto + botón "Gracias" ─────────────────────────── ┘
                                                                           │
  Transfer directo:                                                        │
  alumno_flex / funciones_docente / examenes_int / cronograma / hablar_asesor
        └─────────────────────────────────► [transfer] ──► [transferido]
```

---

## 4. Flujo 1 — Identificación por correo

**Archivo:** `src/flows/identificacion.js`
**Se activa cuando:** sesión en estado `inicio` (primer mensaje o sesión expirada)

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Cualquier mensaje con sesión `inicio` | Envía mensaje de bienvenida y pide correo | `esperando_correo` |
| 2a | Alumno escribe su email → **encontrado** en DB con `is_active=true` | Saluda por nombre + muestra Menú Principal | `menu` |
| 2b | Alumno escribe su email → **no encontrado** o `is_active=false` | Muestra botones: "Intentar otro correo" / "Hablar con asesor" | `correo_no_encontrado` |
| 3a | Elige "Intentar otro correo" | Pide el correo nuevamente | `esperando_correo` |
| 3b | Elige "Hablar con asesor" | Ejecuta Transfer | `transferido` |

**Datos que se guardan en sesión:**
- `nombre` — nombre completo del alumno
- `correo` — email verificado

**Query DB:**
```sql
SELECT id, full_name, email, phone, is_active
FROM bot_email_enrollment
WHERE LOWER(email) = LOWER($1) AND is_active = true
```

---

## 5. Flujo 2 — Menú principal

**Archivo:** `src/flows/menu.js`
**Se activa cuando:** estado `menu` y llega una selección de lista interactiva

Mensaje tipo: Lista interactiva de WhatsApp (4 secciones, 13 opciones)

| ID de opción | Sección | Texto visible | Acción |
|---|---|---|---|
| `video_clases` | 📚 Académico | 🎬 Video Clases | → Flujo Materiales |
| `materiales` | 📚 Académico | 📁 Materiales | → Flujo Materiales |
| `cronograma` | 📚 Académico | 📅 Cronograma | → Transfer directo |
| `examenes_int` | 📚 Académico | 📝 Exámenes Int. | → Transfer directo |
| `campus_virtual` | 🎓 Gestión | 🖥️ Campus Virtual | → Flujo Campus |
| `certificacion` | 🎓 Gestión | 🏅 Certificación | → Flujo Certificados |
| `justificaciones` | 🎓 Gestión | 📄 Justificaciones | → Flujo Justificaciones |
| `alumno_flex` | 🎓 Gestión | ⚡ Alumno Flex | → Transfer directo |
| `instaladores` | 🛠️ Soporte | 💻 Instaladores | → Flujo Instaladores |
| `grupo_whatsapp` | 🛠️ Soporte | 💬 Grupo WhatsApp | → Flujo Grupo |
| `funciones_docente` | 🛠️ Soporte | 👨‍🏫 Func. Docente | → Transfer directo |
| `cursos_online` | 🛠️ Soporte | 🎁 Cursos Online | → Respuesta con link |
| `hablar_asesor` | 👤 Asesor | 💬 Hablar con asesor | → Transfer directo |

---

## 6. Flujo 3 — Campus Virtual

**Archivo:** `src/flows/campus.js`
**Se activa cuando:** opción `campus_virtual` del menú O desde flujo Materiales cuando no puede acceder

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `campus_virtual` | Envía link + credenciales por defecto (usuario=email, pass=1234567) | `flow_campus` |
| 2a | Botón "✅ Sí, gracias" | Vuelve al Menú Principal | `menu` |
| 2b | Botón "❌ No pude ingresar" | Ejecuta Transfer con etiqueta `campus_virtual` | `transferido` |

**Información enviada:**
- URL: `https://intranet.we-educacion.com/`
- Usuario: correo de inscripción
- Contraseña inicial: `1234567`
- Origen del correo de confirmación: `pagos@we-educacion.com`

---

## 7. Flujo 4 — Certificados

**Archivo:** `src/flows/certificados.js`
**Se activa cuando:** opción `certificacion` del menú

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `certificacion` | Pregunta tipo: botones "📘 Curso" / "📗 Programa/Diplomado" | `flow_cert_tipo` |
| 2a | Botón "📘 Curso" | Informa: **7 días hábiles** después del cierre de notas. Lo recibe en el campus virtual. | `flow_cert_info` |
| 2b | Botón "📗 Programa/Diplomado" | Informa: **30 días hábiles** después de recibir certificación del último módulo. Lo recibe en el correo. | `flow_cert_info` |
| 3a | Botón "✅ Entendido" | Vuelve al Menú Principal | `menu` |
| 3b | Botón "❓ Tengo otra duda" | Vuelve al Menú Principal | `menu` |
| 3c | Botón "💬 Hablar con asesor" | Ejecuta Transfer con etiqueta `certificacion` | `transferido` |

**Regla de negocio:** Los días hábiles no cuentan fines de semana ni feriados.

---

## 8. Flujo 5 — Justificaciones

**Archivo:** `src/flows/justificaciones.js`
**Se activa cuando:** opción `justificaciones` del menú

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `justificaciones` | Pide: nombre del curso/programa y edición (texto libre) | `flow_justificacion_datos` |
| 2 | Alumno escribe el nombre | Transfer a Chatwoot con etiqueta `justificaciones` + nota interna con el dato ingresado | `transferido` |

**Dato capturado:** se guarda como `extraNote` en la nota privada de Chatwoot para que el agente tenga el contexto.

---

## 9. Flujo 6 — Materiales y Video Clases

**Archivo:** `src/flows/materiales.js`
**Se activa cuando:** opción `materiales` o `video_clases` del menú

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `materiales` o `video_clases` | Informa que todo está en el campus virtual con el link | `flow_materiales` |
| 2a | Botón "✅ Ya tengo acceso" | Vuelve al Menú Principal | `menu` |
| 2b | Botón "❌ No puedo ingresar" | Redirige al **Flujo Campus Virtual** (paso 1) | `flow_campus` |

---

## 10. Flujo 7 — Instaladores

**Archivo:** `src/flows/instaladores.js`
**Se activa cuando:** opción `instaladores` del menú

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `instaladores` | Muestra botones: "SAP" / "Office 365" / "Otro" | `flow_instaladores` |
| 2a | Botón "SAP" | Instrucciones: solicitar instalador al docente/coordinador | `menu` |
| 2b | Botón "Office 365" | Envía link de descarga: `https://bit.ly/3XVfTea` | `menu` |
| 2c | Botón "Otro" | Transfer con etiqueta `instaladores` | `transferido` |

---

## 11. Flujo 8 — Grupo WhatsApp

**Ubicación de la lógica:** `src/bot.js` (handleMenuOption + case flow_grupo_datos)
**Se activa cuando:** opción `grupo_whatsapp` del menú

| Paso | Trigger | Acción del bot | Estado resultante |
|---|---|---|---|
| 1 | Selección `grupo_whatsapp` | Pide: nombre del programa y edición (texto libre) | `flow_grupo_datos` |
| 2 | Alumno escribe el nombre | Transfer a Chatwoot con etiqueta `grupo_whatsapp` + dato como nota | `transferido` |

---

## 12. Flujo 9 — IA / RAG (texto libre)

**Archivo:** `src/services/ai.js`
**Se activa cuando:** estado `menu` y el alumno escribe texto libre (no selecciona del menú)

| Paso | Trigger | Acción | Estado resultante |
|---|---|---|---|
| 1 | Texto libre con sesión en `menu` | Consulta Claude API con contexto de `knowledge_base.txt` + historial | — |
| 2a | Claude responde con texto | Envía respuesta al alumno + botones "Ver menú" / "Hablar con asesor" | `menu` |
| 2b | Claude responde exactamente `TRANSFER` | Ejecuta Transfer a Chatwoot | `transferido` |
| 2c | Error en llamada a Claude | Ejecuta Transfer a Chatwoot (fallback seguro) | `transferido` |

**Modelo:** `claude-sonnet-4-20250514`
**Contexto inyectado:** contenido de `src/data/knowledge_base.txt`
**Historial:** últimos 10 mensajes de la sesión
**Instrucción al modelo:** responder solo sobre temas académicos de W|E. Si no sabe con certeza → responder exactamente `TRANSFER`.

---

## 13. Flujo 10 — Transfer a agente humano

**Archivo:** `src/flows/transfer.js`
**Se activa desde:** múltiples flujos (ver tabla en sección 14)

| Paso | Acción | API utilizada |
|---|---|---|
| 1 | Envía mensaje de despedida al alumno (tiempo estimado 15 min) | `whatsapp.sendText` → Chatwoot API |
| 2 | Agrega nota privada a la conversación existente en Chatwoot | `chatwoot.addPrivateNote` |
| 3 | Marca sesión como `transferido`, `transfer_replies=0` | Memoria |

**Contenido de la nota privada:**
```
📋 Datos del alumno
• Nombre: [nombre]
• Correo: [correo]
• Último tema: [ultimoTema]

📝 Dato adicional: [extraNote si existe]

💬 Historial del bot:
🤖 Bot: [mensaje]
👤 Alumno: [mensaje]
...
```

> La conversación ya existe en Chatwoot desde el inicio. El transfer NO crea nada nuevo — solo agrega contexto y detiene las respuestas automáticas.

---

## 14. Opciones de transfer directo

Estas opciones del menú van directamente a transfer sin flujo intermedio:

| ID de opción | Etiqueta en Chatwoot | Motivo |
|---|---|---|
| `cronograma` | `cronograma` | Requiere acceso a datos específicos del programa |
| `examenes_int` | `examenes_int` | Proceso de inscripción gestionado por área académica |
| `alumno_flex` | `alumno_flex` | Modalidad especial que requiere atención personalizada |
| `funciones_docente` | `funciones_docente` | Destinado a docentes, no a alumnos regulares |
| `hablar_asesor` | según `ultimoTema` | El alumno lo pide explícitamente |

---

## 15. Reglas del estado "transferido"

Una vez que la sesión queda en estado `transferido`, el agente humano toma el control en Chatwoot.

| Mensaje recibido (Nº) | Respuesta del bot | Campo en sesión |
|---|---|---|
| 1° mensaje post-transfer | "Ya hemos notificado a un asesor 💙..." | `transfer_replies` = 1 |
| 2° mensaje post-transfer | "Ya hemos notificado a un asesor 💙..." | `transfer_replies` = 2 |
| 3° mensaje en adelante | **Silencio total** | `transfer_replies` permanece en 2 |

> El agente ve TODOS los mensajes del alumno en tiempo real en Chatwoot. El silencio del bot no significa que los mensajes se pierdan.

---

## 16. Sesión — ciclo de vida

```
Primer mensaje del número
        │
        ▼
  createSession()   ←──────────────────────────┐
  estado = 'inicio'                            │ sesión expirada
  conversationId = null                        │ (>24 horas)
        │                                      │
        ▼                                 getSession()
  bot.js actualiza:                       retorna null
  conversationId = Chatwoot conv ID            │
                                               │
  Cada mensaje:  ultimaInteraccion = now       │
                                               │
  A las 24 horas sin actividad: ──────────────►┘
  sesión eliminada (setInterval cada 1 hora)
```

**Campos de la sesión:**

| Campo | Tipo | Descripción |
|---|---|---|
| `conversationId` | string/number | ID de la conversación en Chatwoot |
| `nombre` | string | Nombre del alumno (post-verificación) |
| `correo` | string | Email verificado |
| `estado` | string | Estado actual del flujo |
| `ultimoTema` | string | Última opción del menú seleccionada |
| `pendingData` | any | Datos temporales entre pasos de un flow |
| `transfer_replies` | number | Contador de respuestas post-transfer (máx. 2) |
| `historial` | array | Últimos 10 mensajes `{role, content}` para RAG |
| `ultimaInteraccion` | timestamp | Para calcular expiración |

---

## 17. Tabla resumen de archivos por flujo

| Archivo | Responsabilidad |
|---|---|
| `src/server.js` | Recibe webhook de Chatwoot, extrae phone + conversationId |
| `src/bot.js` | Router principal por estado de sesión, anti-duplicado |
| `src/flows/identificacion.js` | Verificación por correo, manejo de no encontrado |
| `src/flows/menu.js` | Render del menú principal (lista interactiva 4 secciones) |
| `src/flows/campus.js` | Instrucciones acceso campus + escalamiento |
| `src/flows/certificados.js` | Tiempos de certificado por tipo (curso/programa) |
| `src/flows/justificaciones.js` | Captura datos + transfer con nota |
| `src/flows/materiales.js` | Link campus + redirect a flow_campus |
| `src/flows/instaladores.js` | SAP / Office 365 / Otro |
| `src/flows/transfer.js` | Mensaje despedida + nota privada Chatwoot |
| `src/services/whatsapp.js` | sendText→Chatwoot / sendButtons+sendList→Meta API + nota |
| `src/services/chatwoot.js` | postMessage + addPrivateNote |
| `src/services/session.js` | Map en memoria, TTL 24h, cleanup cada hora |
| `src/services/ai.js` | Claude API + RAG sobre knowledge_base.txt |
| `src/services/database.js` | Verificación alumno en bot_email_enrollment |
| `src/data/knowledge_base.txt` | Base de conocimiento para el RAG |
| `src/simulator.js` | Simulación local sin llamadas HTTP reales |
