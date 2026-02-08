# Discord Bot Básico (TypeScript)

Proyecto mínimo de bot para Discord usando TypeScript, `discord.js` y `dotenv`. El bot solo inicia sesión y muestra un mensaje en consola cuando está listo.

## Requisitos
- Node.js 18+ (recomendado)
- npm

## Instalación
```bash
npm install
```

## Configuración
1. Crea un archivo `.env` a partir del ejemplo:
   ```bash
   cp .env.example .env
   ```
2. Abre `.env` y coloca tu token:
   ```env
   DISCORD_TOKEN=tu_token_aqui
   ```

## Desarrollo
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Producción
```bash
npm run start
```

## Validación rápida
1. `npm install`
2. Crea `.env` desde `.env.example`
3. `npm run dev` y verifica el mensaje en consola:
   ```
   Logged in as <botname>
   ```
