# W|E WhatsApp Bot

Bot de atención al cliente para **W|E Educación Ejecutiva** via WhatsApp Business API.
Atiende consultas académicas de forma automatizada con transfer a agentes humanos via Chatwoot.

---

## Requisitos previos

- Node.js 20+
- Docker + Docker Compose (para producción)
- Red Docker externa `red_publica` ya existente en el VPS
- Contenedor PostgreSQL `crm-postgres` corriendo en esa red
- Cuenta Meta for Developers con WhatsApp Business API habilitada
- Instancia de Chatwoot con inbox de WhatsApp configurado
- API Key de Anthropic

---

## 1. Configurar el `.env`

```bash
cp .env.example .env
```

Completar cada variable:

| Variable | Descripción |
|---|---|
| `WHATSAPP_TOKEN` | Token de acceso de Meta (permanente o temporal) |
| `WHATSAPP_PHONE_ID` | ID del número de teléfono en Meta Developers |
| `WHATSAPP_VERIFY_TOKEN` | Token secreto para verificar el webhook (lo defines tú) |
| `CHATWOOT_API_URL` | URL base de tu instancia Chatwoot (ej: `https://chatwoot.tudominio.com`) |
| `CHATWOOT_API_TOKEN` | Token de API de un agente Chatwoot |
| `CHATWOOT_INBOX_ID` | ID del inbox de WhatsApp en Chatwoot |
| `DB_HOST` | Nombre del contenedor PostgreSQL (default: `crm-postgres`) |
| `DB_PORT` | Puerto PostgreSQL (default: `5432`) |
| `DB_NAME` | Nombre de la base de datos (default: `neondb`) |
| `DB_USER` | Usuario PostgreSQL (default: `postgres`) |
| `DB_PASSWORD` | Contraseña PostgreSQL |
| `ANTHROPIC_API_KEY` | API Key de Anthropic |
| `PORT` | Puerto del bot (default: `3006`) |

---

## 2. Crear la tabla en PostgreSQL

Conectarse al contenedor PostgreSQL y ejecutar:

```sql
CREATE TABLE IF NOT EXISTS bot_email_enrollment (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  full_name  VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

O desde el host Docker:

```bash
docker exec -i crm-postgres psql -U postgres -d neondb << 'EOF'
CREATE TABLE IF NOT EXISTS bot_email_enrollment (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  full_name  VARCHAR(255) NOT NULL,
  phone      VARCHAR(20),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
EOF
```

Para cargar alumnos de prueba:

```sql
INSERT INTO bot_email_enrollment (email, full_name, phone, is_active)
VALUES
  ('alumno@ejemplo.com', 'Juan Pérez', '5491112345678', true),
  ('maria@empresa.com',  'María García', '5491187654321', true);
```

---

## 3. Desarrollo local

```bash
# Instalar dependencias
npm install

# Copiar y completar variables de entorno
cp .env.example .env

# Correr en modo desarrollo (con hot-reload)
npm run dev
```

Para exponer el webhook local a internet (necesario para Meta), usar [ngrok](https://ngrok.com/):

```bash
ngrok http 3006
```

Copiar la URL HTTPS de ngrok para configurar en Meta Developers.

---

## 4. Desplegar en VPS con Docker

```bash
# En el VPS, clonar/subir el proyecto
cd /opt/we-whatsapp-bot

# Crear el .env con los valores de producción
cp .env.example .env
nano .env

# Construir y levantar
docker compose up -d --build

# Ver logs
docker compose logs -f
```

Para actualizar:

```bash
git pull
docker compose up -d --build
```

---

## 5. Configurar el webhook en Meta Developers

1. Ir a [Meta Developers](https://developers.facebook.com/) → Tu App → WhatsApp → Configuración
2. En **Webhook**, hacer clic en **Editar**:
   - **URL de callback**: `https://tudominio.com/webhook`
   - **Token de verificación**: el valor de `WHATSAPP_VERIFY_TOKEN` en tu `.env`
3. Hacer clic en **Verificar y guardar**
4. Suscribirse al campo **messages**

---

## 6. Configurar Caddy como reverse proxy

En el `Caddyfile` del VPS (donde ya corre el CRM):

```caddyfile
bot.tudominio.com {
    reverse_proxy we-whatsapp-bot:3006
}
```

O si el bot comparte dominio con path:

```caddyfile
tudominio.com {
    # CRM existente
    reverse_proxy /app* crm-app:3000

    # Bot WhatsApp
    reverse_proxy /webhook* we-whatsapp-bot:3006
    reverse_proxy /health* we-whatsapp-bot:3006
}
```

Recargar Caddy:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## Arquitectura de flujos

```
Mensaje entrante
     │
     ▼
[Anti-duplicado] ── duplicado → ignorar
     │
     ▼
[Sesión] ── sin sesión / expirada → inicio
     │
     ▼
[Router por estado]
     ├─ inicio              → pide correo
     ├─ esperando_correo    → verifica en DB
     │    ├─ encontrado     → showMenu
     │    └─ no encontrado  → botones (reintentar | asesor)
     ├─ menu                → handleMenuOption / RAG (texto libre)
     ├─ flow_campus         → instrucciones + botones
     ├─ flow_cert_*         → tipo de certificado + tiempos
     ├─ flow_justificacion  → captura datos → transfer Chatwoot
     ├─ flow_materiales     → link campus
     ├─ flow_instaladores   → SAP / Office / otro
     ├─ flow_grupo_datos    → captura programa → transfer Chatwoot
     └─ transferido         → ignorar (agente humano activo)
```

---

## Health check

```bash
curl https://tudominio.com/health
# {"status":"ok"}
```
