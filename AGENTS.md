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

## Gotchas descubiertos

- **`allowedDevOrigins` en `next.config.ts`**: si se entra al dev server por un host que no sea `localhost` (ej. `sifup.local`), Next 16 bloquea las Server Actions por CORS y **todos los botones dejan de funcionar sin error visible en pantalla**. Ya está seteado — si se agrega otro host, sumarlo ahí y reiniciar el dev server. Si "los botones no hacen nada" en varias páginas a la vez, sospechar esto primero.
- **`eslint-plugin-react-hooks` v5+ (viene con `eslint-config-next` en Next 16)**: `setState` dentro de un `useEffect` que solo espeja una prop, y llamar un hook después de un `return` condicional, son **errores de lint que rompen `npm run build`** (no warnings). Usar el patrón "ajustar estado durante el render" (guardar el valor previo en `useState` y comparar, sin `useEffect`) — ver `useSifupData` en `SifupWorkspace.tsx`.
- **`navigator.clipboard`/`navigator.share`** no existen en contexto no-seguro (http en un host que no sea `localhost`). Botones de copiar/exportar necesitan fallback (`document.execCommand("copy")`; descarga directa si `share`/`canShare` no están).
- **Generación de imágenes compartibles**: ya existe el patrón (Canvas nativo, sin librerías) en `src/lib/teams-image.ts` y en el `handleShare` de la página de Rankings — reusar ese estilo/paleta antes de inventar uno nuevo.
- **Claude in Chrome**: si el browser tool no responde en ninguna página (ni example.com), puede haber más de un Chrome conectado a la cuenta — usar `list_connected_browsers`/`switch_browser` antes de asumir que la herramienta está rota.

## Política de agentes (ahorro de tokens)

El modelo principal se reserva para diseño, decisiones y edición. Este repo **todavía no tiene `.claude/agents/`** (no existen `explorador`/`verificador`) — hasta crearlos, correr tsc/eslint/build/deploy directo con el modelo principal.

- **Higiene de sesión**: una tarea por sesión; al cambiar de tema, `/clear` o sesión nueva.
