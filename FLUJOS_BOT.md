# 🤖 Bot WhatsApp — W|E Educación Ejecutiva
### Guía de flujos para el área académica

---

## ¿Qué hace el bot?

El bot atiende automáticamente los mensajes de WhatsApp de los alumnos, guiándolos paso a paso según su consulta. Cuando no puede resolver la situación, **transfiere al asesor humano** con toda la información del alumno ya cargada.

---

## 🔐 Paso 1 — Identificación del alumno

Cuando un alumno escribe por primera vez (o inicia una conversación), el bot le pide su correo de inscripción.

```
Alumno escribe cualquier mensaje
        │
        ▼
Bot pregunta: "¿Cuál es tu correo de inscripción?"
        │
        ├── Correo encontrado en el sistema
        │         └──▶ Saluda por su nombre y muestra el MENÚ PRINCIPAL
        │
        └── Correo NO encontrado
                  ├── [Intentar otro correo] ──▶ Vuelve a preguntar
                  └── [Hablar con asesor]   ──▶ Transfiere a un asesor
```

> El bot busca el correo en la base de datos de alumnos inscriptos. Si el alumno no figura, puede hablar directamente con un asesor.

---

## 📋 Menú Principal

Una vez identificado, el alumno ve este menú:

| Sección | Opciones disponibles |
|---|---|
| 📚 Académico | 🎬 Video Clases · 📁 Materiales · 📅 Cronograma · 📝 Exámenes Int. |
| 🎓 Gestión | 🖥️ Campus Virtual · 🏅 Certificación · 📄 Justificaciones · ⚡ Alumno Flex |
| 🛠️ Soporte | 💻 Instaladores · 💬 Grupo WhatsApp · 👨‍🏫 Func. Docente |
| 👤 Asesor | 💬 Hablar con asesor |

---

## 🖥️ Flujo — Campus Virtual

```
Alumno selecciona "Campus Virtual"
        │
        ▼
Bot envía: link al campus + usuario y contraseña inicial (1234567)
        │
        ├── [✅ Sí, gracias]   ──▶ Vuelve al menú
        │
        └── [❌ No pude ingresar]
                  │
                  ▼
                Bot pregunta: nombre completo y nombre del curso
                  │
                  ▼
                Alumno responde con sus datos
                  │
                  ▼
                ⚡ TRANSFIERE A ASESOR
                   (con los datos del alumno como nota interna)
```

---

## 📁 Flujo — Materiales / Video Clases

```
Alumno selecciona "Materiales" o "Video Clases"
        │
        ▼
Bot envía: link al campus virtual donde están todos los recursos
        │
        ├── [✅ Ya tengo acceso]           ──▶ Vuelve al menú
        │
        └── [❌ No encuentro mis materiales]
                  │
                  ▼
                Bot pregunta: nombre completo y nombre del curso
                  │
                  ▼
                Alumno responde con sus datos
                  │
                  ▼
                ⚡ TRANSFIERE A ASESOR
```

---

## 🏅 Flujo — Certificación

```
Alumno selecciona "Certificación"
        │
        ▼
PASO 1 — ¿Cómo es tu programa?
        ├── [🏫 Presencial / En vivo]
        └── [💻 Online]
        │
        ▼
PASO 2 — ¿De qué es el certificado?
        │
        ├── Si eligió Presencial/En vivo:
        │       ├── [📘 Curso]
        │       └── [📗 Especialización / Diplomado / PEE]
        │
        └── Si eligió Online:
                ├── [📘 Curso]
                └── [📗 Especialización]
        │
        ▼
PASO 3 — Bot informa el plazo estimado:

  ┌─────────────────────────────────┬──────────────┬────────────────────────────┐
  │ Modalidad + Tipo                │ Plazo        │ Dónde lo recibe            │
  ├─────────────────────────────────┼──────────────┼────────────────────────────┤
  │ Presencial o En vivo — Curso    │ 7 días háb.  │ Campus virtual             │
  │ Presencial o En vivo — Prog.    │ 30 días háb. │ Correo de inscripción      │
  │ Online — Curso                  │ 3 días háb.  │ Campus virtual             │
  │ Online — Especialización        │ 7 días háb.  │ Correo de inscripción      │
  └─────────────────────────────────┴──────────────┴────────────────────────────┘

  Luego pregunta: "¿Ya pasaron esos días hábiles y aún no tienes tu certificado?"
        │
        ├── [✅ No, aún estoy en el plazo]
        │       └──▶ Bot confirma dónde descargarlo (intranet → Mis Certificados)
        │
        └── [⚠️ Sí, ya pasó el plazo]
                  │
                  ▼
                Bot dice: "Lamentamos el inconveniente, vamos a revisar tu caso"
                Bot pregunta: nombre completo y nombre del curso
                  │
                  ▼
                ⚡ TRANSFIERE A ASESOR  (etiquetado como "reclamo_certificado")
```

> Los días hábiles **no** cuentan fines de semana ni feriados.

---

## 📄 Flujo — Justificaciones

```
Alumno selecciona "Justificaciones"
        │
        ▼
Bot pregunta: nombre del curso/programa y edición
        │
        ▼
Alumno responde con sus datos
        │
        ▼
⚡ TRANSFIERE A ASESOR  (con los datos ingresados como nota interna)
```

---

## 💻 Flujo — Instaladores

```
Alumno selecciona "Instaladores"
        │
        ▼
PASO 1 — ¿Qué programa necesitas?
        ├── SAP HANA
        ├── SAP R/3
        ├── Office 365
        └── Otro problema
```

### SAP HANA

```
        │
        ▼
¿Cuál es el problema?
        │
        ├── [🔑 No puedo ingresar / contraseña]
        │       │
        │       ▼
        │     Bot envía instrucciones:
        │     • Contraseña inicial: Clave12345 (C mayúscula)
        │     • Si pide nueva contraseña, escribir nuevamente: Clave12345
        │     • ⚠️ Nunca copiar y pegar — escribir manualmente
        │       │
        │       ├── [✅ Sí, ya pude]  ──▶ Mensaje de éxito + vuelve al menú
        │       └── [❌ No, sigue el problema]
        │                 └──▶ Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
        │
        ├── [⏳ Se queda cargando al ejecutar]
        │       │
        │       ▼
        │     Bot informa: SAP HANA no es compatible con laptops corporativas.
        │     Sugiere intentar desde laptop personal siguiendo el manual.
        │       │
        │       ├── [✅ Sí, ya pude]  ──▶ Mensaje de éxito + vuelve al menú
        │       └── [❌ No, sigue el problema]
        │                 └──▶ Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
        │
        └── [📥 No pude instalarlo]
                  └──▶ Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
```

### SAP R/3

```
        │
        ▼
¿Cuál es el problema?
        │
        ├── [🔑 No puedo ingresar / contraseña]
        │       │
        │       ▼
        │     Bot envía instrucciones:
        │     • Contraseña inicial: Clave12345 (C mayúscula)
        │     • Si pide nueva contraseña, escribir nuevamente: Clave12345
        │     • ⚠️ Nunca copiar y pegar — escribir manualmente
        │       │
        │       ├── [✅ Sí, ya pude]  ──▶ Mensaje de éxito + vuelve al menú
        │       └── [❌ No, sigue el problema]
        │                 └──▶ Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
        │
        └── [❓ Otro problema]
                  └──▶ Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
```

### Office 365

```
        │
        ▼
Bot avisa: "Un asesor te ayudará con tu cuenta de Office 365 en breve"
Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
```

### Otro problema

```
        │
        ▼
Pregunta tipo de laptop ──▶ TRANSFIERE A ASESOR
```

### Pregunta tipo de laptop (aplica a todos los transfers del flujo instaladores)

```
¿Usas laptop personal o corporativa?
        ├── [💻 Personal]    ──▶ ⚡ TRANSFIERE A ASESOR  (nota: "Laptop: Personal")
        └── [🏢 Corporativa] ──▶ ⚡ TRANSFIERE A ASESOR  (nota: "Laptop: Corporativa")
```

---

## 💬 Flujo — Grupo WhatsApp

```
Alumno selecciona "Grupo WhatsApp"
        │
        ▼
Bot pregunta: nombre del programa y edición
        │
        ▼
Alumno responde con sus datos
        │
        ▼
⚡ TRANSFIERE A ASESOR  (con los datos para enviar el enlace correcto)
```

---

## ⚡ Alumno Flex / Exámenes Int. / Cronograma / Func. Docente / Hablar con asesor

Estas opciones **transfieren directamente** a un asesor sin pasos intermedios.

---

## 🔄 ¿Qué pasa después de una transferencia?

```
Bot transfiere al alumno
        │
        ▼
Bot envía al alumno:
  "En breve un asesor del equipo académico te atenderá.
   Tiempo estimado: 15 minutos. Mantente atento a este chat."

El asesor recibe en Chatwoot una nota interna con:
  • Nombre del alumno
  • Correo de inscripción
  • Motivo / último tema consultado
  • Dato adicional (si lo ingresó, ej: "Laptop: Personal")
  • Historial de la conversación con el bot

Si el alumno sigue escribiendo después de ser transferido:
  → El bot responde máximo 2 veces: "Ya notificamos a un asesor, espera un momento 💙"
  → A partir del 3er mensaje: silencio total (el asesor ya está a cargo)
```

---

## 🗣️ Texto libre — Respuesta con IA

Si el alumno escribe un texto libre en lugar de seleccionar una opción del menú, el bot usa inteligencia artificial para responder con información de W|E. Si la IA no sabe la respuesta, transfiere directamente al asesor.

---

## 📌 Notas generales

- El bot recuerda al alumno durante **24 horas** desde su último mensaje (no es necesario volver a identificarse)
- Todas las transferencias llegan al equipo en **Chatwoot** con contexto completo
- Los botones e interacciones son propios de WhatsApp — el alumno no escribe, solo toca opciones
- El bot **no puede gestionar pagos, matrículas ni cambios de cursada** — esos casos siempre van al asesor
