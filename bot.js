import { Bot } from "grammy";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─────────────────────────────────────────
//  CONFIGURATION — à remplir
// ─────────────────────────────────────────
const BOT_TOKEN      = "8699467266:AAHoUqjkh1LQcA0MzC3SlyX3hGHKGVakjt8";
const ADMIN_ID       = 8427229478; // Ton Telegram ID (nombre, sans guillemets)
const OTS_EMAIL      = "teddy.ek.pro@gmail.com";
const OTS_API_KEY    = "0650499fc84d7d951885eb4cd879e79e4d864be1";

// ─────────────────────────────────────────
//  CHEMINS FICHIERS
// ─────────────────────────────────────────
const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const WHITELIST_PATH = path.join(__dirname, "whitelist.json");
const LOGS_PATH      = path.join(__dirname, "logs.json");

// ─────────────────────────────────────────
//  UTILITAIRES
// ─────────────────────────────────────────
const SECRET_CONTENT = fs.readFileSync(path.join(__dirname, "s_message.md"), "utf8"); // Texte que les membres recevront

function readWhitelist() {
  return JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf8")).emails;
}

function readLogs() {
  return JSON.parse(fs.readFileSync(LOGS_PATH, "utf8"));
}

function writeLog(entry) {
  const logs = readLogs();
  logs.push({ ...entry, timestamp: new Date().toISOString() });
  fs.writeFileSync(LOGS_PATH, JSON.stringify(logs, null, 2));
}

async function generateOTSLink(content) {
  const credentials = Buffer.from(`${OTS_EMAIL}:${OTS_API_KEY}`).toString("base64");
  const response = await fetch("https://onetimesecret.com/api/v1/share", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ secret: content, ttl: 604800 }), // TTL : 7 jours
  });
  const data = await response.json();
  if (!data.secret_key) throw new Error("Échec génération OTS");
  return `https://onetimesecret.com/secret/${data.secret_key}`;
}

// ─────────────────────────────────────────
//  BOT
// ─────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

// Gestionnaire d'erreurs global
bot.catch((err) => {
  console.error("Erreur bot:", err);
});

// /start
bot.command("start", (ctx) => {
  ctx.reply(
    "👋 Bienvenue sur le bot d'accès CapLanYetGPT.\n\n" +
    "Pour demander un accès, utilise la commande :\n`/auth ton.email@domaine.com`",
    { parse_mode: "Markdown" }
  );
});

// /logs (admin uniquement)
bot.command("logs", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply("⛔ Accès refusé.");
  }
  const logs = readLogs();
  if (logs.length === 0) return ctx.reply("Aucun log pour l'instant.");
  const last15 = logs.slice(-15).reverse();
  const text = last15.map((l) =>
    `[${l.timestamp}]\n👤 @${l.username || "inconnu"} (${l.telegramId})\n📧 ${l.email}\n📌 ${l.action}`
  ).join("\n\n");
  ctx.reply(`📋 *15 derniers logs :*\n\n${text}`, { parse_mode: "Markdown" });
});

// /clear_logs (admin uniquement)
bot.command("clear_logs", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) 
    return ctx.reply("⛔ Accès refusé.");
  
  fs.writeFileSync(LOGS_PATH, JSON.stringify([], null, 2));
  ctx.reply("✅ Logs réinitialisés.");
});

// /auth
bot.command("auth", async (ctx) => {
  const email = ctx.match?.trim().toLowerCase();
  const telegramId = ctx.from.id;
  const username = ctx.from.username || null;

  if (!email) {
    writeLog({ telegramId, username, email: null, action: "INVALID_COMMAND" });
    return ctx.reply("❌ Usage : `/auth ton.email@domaine.com`", { parse_mode: "Markdown" });
  }

  const whitelist = readWhitelist();

  // Email pas dans la whitelist
  if (!whitelist.includes(email)) {
    writeLog({ telegramId, username, email, action: "NOT_IN_WHITELIST" });
    return ctx.reply("⛔ Cet email n'est pas autorisé.");
  }

  const logs = readLogs();
  const allLinksSent = logs.filter((l) => l.action === "LINK_SENT");
  
  // Vérifier si cet email est déjà utilisé par un autre Telegram ID
  const usedByOther = allLinksSent.some((l) => l.email === email && l.telegramId !== telegramId);

  if (usedByOther) {
    writeLog({ telegramId, username, email, action: "EMAIL_BELONGS_TO_OTHER" });
    await bot.api.sendMessage(
      ADMIN_ID,
      `🚨 *Alerte :* L'email \`${email}\` appartient à un autre membre de la team mais @${username || telegramId} tente de l'utiliser.`,
      { parse_mode: "Markdown" }
    );
    return ctx.reply("🚨 Cet email est associé à un autre compte. L'admin a été notifié.");
  }

  // Vérifier si cet utilisateur a déjà reçu un lien avec un email différent
  const userExistingEmail = allLinksSent.find((l) => l.telegramId === telegramId);
  if (userExistingEmail && userExistingEmail.email !== email) {
    writeLog({ telegramId, username, email, action: "EMAIL_CHANGE_ATTEMPT" });
    await bot.api.sendMessage(
      ADMIN_ID,
      `🚨 *Alerte :* @${username || telegramId} tente d'utiliser \`${email}\` mais son email enregistré est \`${userExistingEmail.email}\`.`,
      { parse_mode: "Markdown" }
    );
    return ctx.reply("🚨 Tu ne peux pas utiliser un email différent de celui enregistré pour ton compte.");
  }

  // Vérifier si cet utilisateur a déjà reçu un lien pour CET email
  const alreadySentForThisEmail = allLinksSent.some((l) => l.email === email && l.telegramId === telegramId);
  
  // Si c'est la première demande pour cet utilisateur/email → lien OTS automatique
  if (!alreadySentForThisEmail) {
    try {
      const link = await generateOTSLink(SECRET_CONTENT);
      await ctx.reply(
        `✅ Accès approuvé !\n\nVoici ton lien sécurisé (usage unique) :\n${link}\n\n⚠️ Ce lien sera détruit après ouverture.`
      );
      writeLog({ telegramId, username, email, action: "LINK_SENT" });
    } catch (error) {
      console.error("Erreur génération OTS:", error);
      ctx.reply("❌ Erreur lors de la génération du lien. Contacte l'admin.");
    }
    return;
  }

  // Deuxième demande → notification admin avec boutons
  writeLog({ telegramId, username, email, action: "SECOND_REQUEST" });

  await bot.api.sendMessage(
    ADMIN_ID,
    `🔔 *Nouvelle demande d'accès (2ème fois)*\n\n👤 @${username || "inconnu"} (ID: ${telegramId})\n📧 ${email}\n\nApprouves-tu cette demande ?`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approuver", callback_data: `approve:${telegramId}:${email}` },
          { text: "❌ Refuser",   callback_data: `refuse:${telegramId}:${email}` },
        ]],
      },
    }
  );

  await ctx.reply("🔔 Ta demande a été transmise à l'admin. Tu recevras une réponse bientôt.");
});

// Callback boutons admin
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const adminId = ctx.from.id;

  if (adminId !== ADMIN_ID) {
    return ctx.answerCallbackQuery({ text: "⛔ Non autorisé." });
  }

  const [action, targetIdStr, email] = data.split(":");
  const targetId = parseInt(targetIdStr);

  if (action === "approve") {
    try {
      const link = await generateOTSLink(SECRET_CONTENT);
      await bot.api.sendMessage(
        targetId,
        `✅ Ta demande a été approuvée par l'admin !\n\nVoici ton lien sécurisé (usage unique) :\n${link}\n\n⚠️ Ce lien sera détruit après ouverture.`
      );
      writeLog({ telegramId: targetId, username: null, email, action: "LINK_SENT" });
      await ctx.editMessageText(`✅ Accès approuvé pour \`${email}\` (ID: ${targetId})`, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Erreur approbation:", error);
      await ctx.answerCallbackQuery({ text: "Erreur lors de la génération du lien OTS." });
    }
  } else if (action === "refuse") {
    await bot.api.sendMessage(
      targetId,
      "❌ Ta demande d'accès a été refusée par l'admin."
    );
    writeLog({ telegramId: targetId, username: null, email, action: "REFUSED_BY_ADMIN" });
    await ctx.editMessageText(`❌ Accès refusé pour \`${email}\` (ID: ${targetId})`, { parse_mode: "Markdown" });
  }

  await ctx.answerCallbackQuery();
});

// ─────────────────────────────────────────
//  MINI SERVEUR POUR RENDER (HEALTH CHECK)
// ─────────────────────────────────────────
import http from 'http';

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server running on port ${PORT}`);
});

// ─────────────────────────────────────────
//  DÉMARRAGE DU BOT TELEGRAM
// ─────────────────────────────────────────
bot.start();
console.log("✅ Bot démarré.");