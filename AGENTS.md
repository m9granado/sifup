<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SIFUP — guía para sesiones de Claude

Next.js sobre Vercel. Mantener este archivo corto y actualizado. (`CLAUDE.md` incluye este archivo vía `@AGENTS.md`.)

## Comandos

```
npm run dev           # dev server (usar dev:safe si hay procesos colgados)
npm run dev:doctor    # diagnóstico del entorno dev
npm run dev:stop      # matar procesos dev colgados
npm test              # tests
npm run build         # build producción
npm run lint          # ESLint
npm run db:setup      # schema + seed
```

## Entorno Windows — gotchas de shell

- `vercel` y `gh` **no existen en el bash** de Claude Code; correrlos vía PowerShell. `gh` no está instalado — usar `git` directo.
- **No hacer polling de deploys** con loops de `sleep` + `vercel ls`: usar una sola llamada `vercel inspect <url> --wait --timeout 5m`.
- **Grep/Glob siempre acotados** con `glob`/`type` y `head_limit` para evitar timeouts.
- Siempre `Read` antes de `Edit`.

## Build & Deploy

1. `npx tsc --noEmit`
2. eslint enfocado a los archivos tocados
3. `npm run build`
4. commit + push a `main` — Vercel auto-deploya; no correr `vercel deploy` manual
5. verificar con `vercel inspect --wait` + smoke test de la URL de producción

Pasos 1–3 y 5: delegar al agente `verificador` (Haiku).

## Política de agentes (ahorro de tokens)

El modelo principal se reserva para diseño, decisiones y edición. Delegar a subagentes en `.claude/agents/`:

- **`explorador` (Haiku)**: localizar código/archivos antes de editar; devuelve rutas+líneas, no dumps.
- **`verificador` (Haiku)**: tsc/eslint/build y verificación de deploy al cerrar cada cambio.
- **Higiene de sesión**: una tarea por sesión; al cambiar de tema, `/clear` o sesión nueva.
