const COLORS = {
  bgTop: "#030706",
  bgBottom: "#0a1512",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.62)",
  mutedFaint: "rgba(255,255,255,0.4)",
  border: "rgba(255,255,255,0.16)",
  red: "#ef4444",
  redSoft: "rgba(239,68,68,0.14)",
  redLine: "rgba(239,68,68,0.35)",
  gold: "#facc15",
  goldSoft: "rgba(250,204,21,0.14)",
  goldLine: "rgba(250,204,21,0.35)",
  green: "#10b981",
  formDraw: "rgba(255,255,255,0.35)",
  formHollow: "rgba(255,255,255,0.28)",
};

export type FormResult = "win" | "draw" | "loss" | "none";

type TeamImagePlayer = { name: string; isGoalkeeper: boolean; points: number; form: FormResult[] };

export type TeamsImageInput = {
  matchLabel: string;
  location: string;
  teamAName: string;
  teamBName: string;
  teamAPlayers: TeamImagePlayer[];
  teamBPlayers: TeamImagePlayer[];
  pointsA: number;
  pointsB: number;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function drawTeamPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
  accentSoft: string,
  accentLine: string,
  name: string,
  players: TeamImagePlayer[],
  points: number,
  rowHeight: number,
) {
  const pad = 36;

  roundRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = accentSoft;
  ctx.fill();
  ctx.strokeStyle = `${accent}55`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.font = "800 30px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(truncateText(ctx, name.toUpperCase(), w - pad * 2), x + w / 2, y + 58);

  ctx.fillStyle = COLORS.white;
  ctx.font = "900 92px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(String(players.length), x + w / 2, y + 158);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 24px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`jugadores · ${points} pts`, x + w / 2, y + 196);

  ctx.strokeStyle = accentLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + pad, y + 226);
  ctx.lineTo(x + w - pad, y + 226);
  ctx.stroke();

  const dotRadius = 5;
  const dotSpacing = 16;
  const dotsRightEdge = x + w - pad;
  const dotsBlockWidth = 4 * dotSpacing + dotRadius * 2;
  const pointsRightEdge = dotsRightEdge - dotsBlockWidth - 16;
  const nameLeft = x + pad + 24;
  const nameMaxWidth = pointsRightEdge - 50 - nameLeft;

  const listTop = y + 226 + 40;
  players.forEach((player, index) => {
    const rowY = listTop + index * rowHeight;

    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x + pad + 6, rowY - 9, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.font = "700 28px 'Segoe UI', Arial, sans-serif";
    const label = player.isGoalkeeper ? `${player.name}  🧤` : player.name;
    ctx.fillText(truncateText(ctx, label, nameMaxWidth), nameLeft, rowY);

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.muted;
    ctx.font = "800 24px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(`${player.points} pts`, pointsRightEdge, rowY);

    player.form.forEach((res, i) => {
      const centerX = dotsRightEdge - dotRadius - (player.form.length - 1 - i) * dotSpacing;
      const centerY = rowY - 9;
      if (res === "none") {
        ctx.strokeStyle = COLORS.formHollow;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      ctx.fillStyle = res === "win" ? COLORS.green : res === "loss" ? COLORS.red : COLORS.formDraw;
      ctx.beginPath();
      ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function buildCanvas(input: TeamsImageInput): HTMLCanvasElement {
  const width = 1600;
  const panelTop = 190;
  const panelWidth = 700;
  const panelGap = 160;
  const rowHeight = 46;
  const maxPlayers = Math.max(input.teamAPlayers.length, input.teamBPlayers.length, 1);
  const panelHeaderHeight = 226 + 40;
  const panelHeight = panelHeaderHeight + maxPlayers * rowHeight + 36;
  const height = panelTop + panelHeight + 90;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, COLORS.bgTop);
  bg.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.muted;
  ctx.font = "800 26px 'Segoe UI', Arial, sans-serif";
  ctx.fillText("SIFUP · FUTBOL", width / 2, 62);

  ctx.fillStyle = COLORS.white;
  ctx.font = "900 46px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(truncateText(ctx, input.matchLabel, width - 160), width / 2, 116);

  ctx.fillStyle = COLORS.mutedFaint;
  ctx.font = "600 24px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(truncateText(ctx, input.location, width - 160), width / 2, 152);

  const leftX = width / 2 - panelGap / 2 - panelWidth;
  const rightX = width / 2 + panelGap / 2;

  drawTeamPanel(ctx, leftX, panelTop, panelWidth, panelHeight, COLORS.red, COLORS.redSoft, COLORS.redLine, input.teamAName, input.teamAPlayers, input.pointsA, rowHeight);
  drawTeamPanel(ctx, rightX, panelTop, panelWidth, panelHeight, COLORS.gold, COLORS.goldSoft, COLORS.goldLine, input.teamBName, input.teamBPlayers, input.pointsB, rowHeight);

  const vsY = panelTop + panelHeight / 2;
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2, panelTop + 10);
  ctx.lineTo(width / 2, panelTop + panelHeight - 10);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(width / 2, vsY, 50, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.bgBottom;
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.white;
  ctx.font = "900 34px 'Segoe UI', Arial, sans-serif";
  ctx.fillText("VS", width / 2, vsY + 2);
  ctx.textBaseline = "alphabetic";

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.mutedFaint;
  ctx.font = "600 22px 'Segoe UI', Arial, sans-serif";
  ctx.fillText("sifup.vercel.app", width / 2, height - 32);

  return canvas;
}

export async function downloadTeamsChallengeImage(input: TeamsImageInput, fileName: string) {
  const canvas = buildCanvas(input);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("No se pudo generar la imagen.");

  const file = new File([blob], fileName, { type: "image/jpeg" });
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: "SIFUP - Equipos" });
      return;
    } catch {
      // User cancelled the native share sheet or it failed silently; fall back to a direct download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
