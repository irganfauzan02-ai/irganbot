const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadMediaMessage,
  DisconnectReason
} = require("@whiskeysockets/baileys")

const pino = require("pino")
const fs = require("fs")
const { exec } = require("child_process")


const https = require("https")
const BASE_URL = "deep-seek.ai"

const querystring = require("querystring")
const TEMP_BASE_URL = "api.tempamail.com"

async function getCsrfToken() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE_URL,
      path: "/",
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" }
    }, (res) => {
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        const meta = data.match(/<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)
        const js = data.match(/X-CSRF-TOKEN["']?\s*[:=]\s*["']([^"']+)["']/i)
        const token = meta?.[1] || js?.[1]
        token ? resolve(token) : reject(new Error("CSRF token gagal"))
      })
    })

    req.on("error", reject)
    req.end()
  })
}

async function deepSeekChat(prompt) {
  const csrfToken = await getCsrfToken()

  const payload = JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }]
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE_URL,
      path: "/api/chat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": csrfToken,
        "User-Agent": "Mozilla/5.0",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        let response = ""

        for (const line of data.split("\n")) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const json = JSON.parse(line.slice(6))
              const content = json.choices?.[0]?.delta?.content
              if (content) response += content
            } catch {}
          }
        }

        resolve(response || "AI tidak memberi jawaban.")
      })
    })

    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

const ownerNumber = "6283178115390"
const botName = "IRGAN BOT"

let publicMode = true
let autoRead = false
let autoReact = false
let antiSpam = true
let badword = true
let antiDelete = true
let userSpam = {}

const badwords = ["anjing", "kontol", "memek", "bangsat"]

function getText(msg) {
  return msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || ""
}

function isOwner(sender) {
  return sender.includes(ownerNumber)
}

async function isAdmin(sock, groupId, sender) {
  try {
    const meta = await sock.groupMetadata(groupId)
    const p = meta.participants.find(x => x.id === sender)
    return p?.admin === "admin" || p?.admin === "superadmin"
  } catch (e) {
    console.log("Gagal ambil metadata grup:", e.message)
    return false
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session")

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(`✅ ${botName} AKTIF`)
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      if (statusCode !== DisconnectReason.loggedOut) startBot()
    }
  })

  if (!sock.authState.creds.registered) {

  setTimeout(async () => {
  try {
    const code = await sock.requestPairingCode(ownerNumber)
    console.log("PAIRING CODE:", code)
  } catch (err) {
    console.log("Gagal ambil pairing code:", err.message)
  }
}, 5000)

}

  sock.ev.on("group-participants.update", async (u) => {
  const participants = Array.isArray(u.participants)
    ? u.participants
    : [u.participants]

  for (const user of participants) {
    const userId = typeof user === "string" ? user : user.id
    if (!userId) continue

    if (u.action === "add") {
      await sock.sendMessage(u.id, {
        text: `👋 Selamat datang @${userId.split("@")[0]}`,
        mentions: [userId]
      })
    }

    if (u.action === "remove") {
      await sock.sendMessage(u.id, {
        text: `👋 @${userId.split("@")[0]} keluar dari grup`,
        mentions: [userId]
      })
    }
  }
})

  sock.ev.on("messages.update", async (updates) => {
    if (!antiDelete) return
    for (const u of updates) {
      if (u.update?.message === null) {
        console.log("Pesan dihapus terdeteksi.")
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {

const msg = messages[0]

if (!msg.message) return

const from = msg.key.remoteJid
const sender = msg.key.participant || from

const text =
msg.message?.conversation ||
msg.message?.extendedTextMessage?.text ||
msg.message?.imageMessage?.caption ||
msg.message?.videoMessage?.caption || ""

const isGroup = from.endsWith("@g.us")

console.log("PESAN MASUK:", text)


if (text.startsWith(".tempmail")) {
  const uuid = await getUUID()
  const alias = text.split(" ")[1] || Math.random().toString(36).slice(2, 10)

  const mail = await createEmail(alias, uuid)

  global.tempMail = global.tempMail || {}
  global.tempMail[from] = {
    uuid,
    emailId: mail.email_id
  }

  return sock.sendMessage(from, {
    text:
`📩 TEMPMAIL BERHASIL DIBUAT

📧 Email:
${mail.email}

🆔 ID:
${mail.email_id}

📥 Cek inbox:
.inbox`
  })
}

if (text === ".inbox") {
  global.tempMail = global.tempMail || {}

  if (!global.tempMail[from]) {
    return sock.sendMessage(from, {
      text: "Belum bikin tempmail. Ketik .tempmail dulu"
    })
  }

  const data = global.tempMail[from]

  const inbox = await checkInbox(data.emailId, data.uuid)

  if (!inbox.messages.length) {
    return sock.sendMessage(from, {
      text: "📭 Inbox kosong."
    })
  }

  let hasil = "📥 INBOX TEMPMAIL\n\n"

  for (const msg of inbox.messages) {
    hasil +=
`📨 From: ${msg.from}
📌 Subject: ${msg.subject}

${msg.body}

─────────────────

`
  }

  sock.sendMessage(from, { text: hasil })
}

    if (autoRead) await sock.readMessages([msg.key])

    if (!publicMode && !isOwner(sender)) return

    if (antiSpam && !isOwner(sender)) {
      const now = Date.now()
      userSpam[sender] = userSpam[sender] || []
      userSpam[sender] = userSpam[sender].filter(t => now - t < 5000)
      userSpam[sender].push(now)

      if (userSpam[sender].length >= 6) {
        return sock.sendMessage(from, { text: "⚠️ Jangan spam command." })
      }
    }

    if (badword && isGroup && badwords.some(w => text.toLowerCase().includes(w))) {
      return sock.sendMessage(from, {
        text: `⚠️ Kata kasar terdeteksi @${sender.split("@")[0]}`,
        mentions: [sender]
      })
    }

    if (isGroup && text.includes("chat.whatsapp.com")) {
      const admin = await isAdmin(sock, from, sender)

      if (!admin) {
        await sock.sendMessage(from, {
          text: `🚫 Anti link aktif! @${sender.split("@")[0]} dikeluarkan.`,
          mentions: [sender]
        })

        return sock.groupParticipantsUpdate(from, [sender], "remove")
      }
    }

    if (text === ".menu") {
      const caption = `
╭━━━〔 🤖 *IRGAN BOT* 🤖 〕━━━⬣
┃ 👑 Owner : Irgann
┃ ⚡ Status : Online
┃ 📡 Mode : ${publicMode ? "Public" : "Self"}
╰━━━━━━━━━━━━━━━━⬣

╭━━〔 📥 DOWNLOADER 〕━━⬣
┃ 🎵 .tt
┃ 📸 .ig
┃ 🎧 .ytmp3
┃ 🎬 .ytmp4
╰━━━━━━━━━━━━━━━━⬣

╭━━〔 👥 GROUP MENU 〕━━⬣
┃ 📢 .tagall
┃ 🙈 .hidetag
┃ 🔓 .open
┃ 🔒 .close
┃ ❌ .kick
┃ ⬆️ .promote
┃ ⬇️ .demote
╰━━━━━━━━━━━━━━━━⬣

╭━━〔 🛠 TOOLS 〕━━⬣
┃ 🖼 .sticker
┃ 🎶 .tomp3
┃ 🤖 .ai
┃ 📩 .tempmail
┃ 📥 .inbox
┃ 🎮 .game
┃ 🎯 .tebak angka
║ 🧠 .iq
║ 📝 .iqjawab A
║ 🏆 .hasiliq
┃ 📶 .ping
┃ ℹ️ .info
╰━━━━━━━━━━━━━━━━⬣

╭━━〔 ⚙️ OWNER MENU 〕━━⬣
┃ 🌐 .public
┃ 🔐 .self
┃ 👀 .autoread on/off
┃ 🚫 .badword on/off
┃ 🛡 .antispam on/off
╰━━━━━━━━━━━━━━━━⬣
`

      if (fs.existsSync("./menu.jpg")) {
        return safeSend(sock, from, {
          image: fs.readFileSync("./menu.jpg"),
          caption
        })
      }

      return safeSend(sock, from, { text: caption })
    }

    if (text === ".ping") return sock.sendMessage(from, { text: "pong ✅" })
    if (text === ".owner") return sock.sendMessage(from, { text: "Owner: Irgan mau sewa bot yang premium?chat 083178115390" })
    if (text === ".info") return sock.sendMessage(from, { text: "Bot penjaga grup aktif ✅" })

    if (text === ".public" && isOwner(sender)) {
      publicMode = true
      return sock.sendMessage(from, { text: "Mode public aktif ✅" })
    }

    if (text === ".self" && isOwner(sender)) {
      publicMode = false
      return sock.sendMessage(from, { text: "Mode self aktif ✅" })
    }

    if (text === ".autoread on" && isOwner(sender)) {
      autoRead = true
      return sock.sendMessage(from, { text: "Auto read ON ✅" })
    }

    if (text === ".autoread off" && isOwner(sender)) {
      autoRead = false
      return sock.sendMessage(from, { text: "Auto read OFF ✅" })
    }

    if (text === ".badword on") {
      badword = true
      return sock.sendMessage(from, { text: "Badword detector ON ✅" })
    }

    if (text === ".badword off") {
      badword = false
      return sock.sendMessage(from, { text: "Badword detector OFF ✅" })
    }

    if (text === ".antispam on") {
      antiSpam = true
      return sock.sendMessage(from, { text: "Anti spam ON ✅" })
    }

    if (text === ".antispam off") {
      antiSpam = false
      return sock.sendMessage(from, { text: "Anti spam OFF ✅" })
    }

    if (text === ".open" && isGroup) {
      await sock.groupSettingUpdate(from, "not_announcement")
      return sock.sendMessage(from, { text: "Grup dibuka ✅" })
    }

    if (text === ".close" && isGroup) {
      await sock.groupSettingUpdate(from, "announcement")
      return sock.sendMessage(from, { text: "Grup ditutup ✅" })
    }

    if (text === ".tagall" && isGroup) {
      const meta = await sock.groupMetadata(from)
      const members = meta.participants.map(p => p.id)
      const teks = members.map(x => `@${x.split("@")[0]}`).join("\n")
      return sock.sendMessage(from, { text: teks, mentions: members })
    }

    if (text.startsWith(".hidetag ") && isGroup) {
      const meta = await sock.groupMetadata(from)
      const members = meta.participants.map(p => p.id)
      return sock.sendMessage(from, {
        text: text.replace(".hidetag ", ""),
        mentions: members
      })
    }

    if ((text === ".kick" || text === ".promote" || text === ".demote") && isGroup) {
      const quoted = msg.message.extendedTextMessage?.contextInfo?.participant
      if (!quoted) return sock.sendMessage(from, { text: "Reply orangnya dulu." })

      if (text === ".kick") await sock.groupParticipantsUpdate(from, [quoted], "remove")
      if (text === ".promote") await sock.groupParticipantsUpdate(from, [quoted], "promote")
      if (text === ".demote") await sock.groupParticipantsUpdate(from, [quoted], "demote")

      return sock.sendMessage(from, { text: "Berhasil ✅" })
    }

    if (text.startsWith(".tt ")) {
      const url = text.split(" ")[1]
      exec(`yt-dlp -f mp4 -o "tt.mp4" "${url}"`, async (err) => {
        if (err) return sock.sendMessage(from, { text: "Gagal download TikTok." })
        await sock.sendMessage(from, {
          video: fs.readFileSync("tt.mp4"),
          caption: "TikTok ✅"
        })
        fs.unlinkSync("tt.mp4")
      })
    }

    if (text.startsWith(".ig ")) {
      const url = text.split(" ")[1]
      exec(`yt-dlp -f mp4 -o "ig.mp4" "${url}"`, async (err) => {
        if (err) return sock.sendMessage(from, { text: "Gagal download IG/Reels." })
        await sock.sendMessage(from, {
          video: fs.readFileSync("ig.mp4"),
          caption: "Instagram ✅"
        })
        fs.unlinkSync("ig.mp4")
      })
    }

    if (text.startsWith(".ytmp3 ")) {
      const url = text.split(" ")[1]
      exec(`yt-dlp -x --audio-format mp3 -o "yt.mp3" "${url}"`, async (err) => {
        if (err) return sock.sendMessage(from, { text: "Gagal download YouTube MP3." })
        await sock.sendMessage(from, {
          audio: fs.readFileSync("yt.mp3"),
          mimetype: "audio/mpeg"
        })
        fs.unlinkSync("yt.mp3")
      })
    }

    if (text.startsWith(".ytmp4 ")) {
      const url = text.split(" ")[1]
      exec(`yt-dlp -f mp4 -o "yt.mp4" "${url}"`, async (err) => {
        if (err) return sock.sendMessage(from, { text: "Gagal download YouTube MP4." })
        await sock.sendMessage(from, {
          video: fs.readFileSync("yt.mp4"),
          caption: "YouTube MP4 ✅"
        })
        fs.unlinkSync("yt.mp4")
      })
    }

    if (text.startsWith(".sticker")) {
  const stickerText = text.replace(".sticker", "").trim()

  let mediaMsg = msg.message.imageMessage ? msg : null
  const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage

  if (!mediaMsg && quoted?.imageMessage) {
    mediaMsg = { key: msg.key, message: quoted }
  }

  if (!mediaMsg) {
    return sock.sendMessage(from, {
      text: "Kirim/reply foto lalu ketik .sticker teks"
    })
  }

  const buffer = await downloadMediaMessage(mediaMsg, "buffer", {}, {
    logger: pino({ level: "silent" })
  })

  const inputFile = `input_${Date.now()}.jpg`
  const outputFile = `sticker_${Date.now()}.webp`

  fs.writeFileSync(inputFile, buffer)

  const safeText = stickerText.replace(/"/g, '\\"')

  const cmd = stickerText
  ? `convert "${inputFile}" -resize 512x512\\> -gravity south -fill white -stroke black -strokewidth 2 -pointsize 42 -annotate +0+15 "${safeText}" "${outputFile}"`
  : `convert "${inputFile}" -resize 512x512\\> "${outputFile}"`	

  exec(cmd, async (err) => {
    if (err) {
      if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile)
      if (fs.existsSync("temp.png")) fs.unlinkSync("temp.png")
      return sock.sendMessage(from, { text: "Gagal bikin stiker." })
    }

    await sock.sendMessage(from, {
      sticker: fs.readFileSync(outputFile)
    })

    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile)
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
    if (fs.existsSync("temp.png")) fs.unlinkSync("temp.png")
  })

  return
}

    if (text === ".tomp3") {
  let mediaMsg = msg.message.videoMessage ? msg : null
  const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage

    if (!mediaMsg && quoted?.videoMessage) {
    mediaMsg = { key: msg.key, message: quoted }
  }

  if (!mediaMsg) {
    return sock.sendMessage(from, {
      text: "Kirim video dengan caption .tomp3 atau reply video lalu ketik .tomp3"
    })
  }

  const buffer = await downloadMediaMessage(mediaMsg, "buffer", {}, {
    logger: pino({ level: "silent" })
  })

  const videoFile = `video_${Date.now()}.mp4`
  const audioFile = `audio_${Date.now()}.mp3`

  fs.writeFileSync(videoFile, buffer)

  exec(`ffmpeg -y -i "${videoFile}" -vn -ar 44100 -ac 2 -b:a 128k "${audioFile}"`, async (err) => {
    if (err) {
      if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile)
      return sock.sendMessage(from, { text: "Gagal ubah video jadi audio. Pastikan ffmpeg sudah terinstall." })
    }

    await sock.sendMessage(from, {
      audio: fs.readFileSync(audioFile),
      mimetype: "audio/mpeg"
    })

    fs.unlinkSync(videoFile)
    fs.unlinkSync(audioFile)
  })
}

    if (text.startsWith(".ai ")) {
  const q = text.replace(".ai ", "").trim()

  if (!q) {
    return sock.sendMessage(from, {
      text: "Contoh: .ai halo"
    })
  }

  await sock.sendMessage(from, {
    text: "🤖 AI lagi mikir..."
  })

  try {
    const jawaban = await deepSeekChat(q)

    await sock.sendMessage(from, {
      text: jawaban
    })

  } catch (e) {
    console.log(e)

    await sock.sendMessage(from, {
      text: "AI error."
    })
  }
}

    if (text === ".game") {
      const angka = Math.floor(Math.random() * 10) + 1

      global.tebakAngka = global.tebakAngka || {}
      global.tebakAngka[from] = angka

      return sock.sendMessage(from, {
        text:
`🎮 GAME TEBAK ANGKA

Aku sudah pilih angka 1-10.
Tebak pakai:

.tebak angka

Contoh:
.tebak 5`
      })
    }

    if (text.startsWith(".tebak ")) {
      global.tebakAngka = global.tebakAngka || {}

      if (!global.tebakAngka[from]) {
        return sock.sendMessage(from, {
          text: "Belum ada game. Ketik .game dulu."
        })
      }

      const jawaban = parseInt(text.split(" ")[1])
      const angkaBenar = global.tebakAngka[from]

      if (isNaN(jawaban)) {
        return sock.sendMessage(from, {
          text: "Masukin angka yang bener. Contoh: .tebak 5"
        })
      }

      if (jawaban === angkaBenar) {
        delete global.tebakAngka[from]

        return sock.sendMessage(from, {
          text: "🎉 Benar! Kamu menang ✅"
        })
      }

      return sock.sendMessage(from, {
        text: jawaban > angkaBenar
          ? "❌ Salah, angkanya lebih kecil."
          : "❌ Salah, angkanya lebih besar."
      })
    }
  })
}

if (text === ".iq") {
  global.iqSession = global.iqSession || {}

  const soal = iqQuestions[Math.floor(Math.random() * iqQuestions.length)]

  global.iqSession[from] = global.iqSession[from] || {
    benar: 0,
    salah: 0,
    total: 0
  }

  global.iqSession[from].current = soal

  return sock.sendMessage(from, {
    text:
`🧠 *IQ TEST*

${soal.question}

A. ${soal.options[0]}
B. ${soal.options[1]}
C. ${soal.options[2]}
D. ${soal.options[3]}

Jawab:
.iqjawab A

Lihat hasil:
.hasiliq`
  })
}

if (text.startsWith(".iqjawab ")) {
  global.iqSession = global.iqSession || {}

  const sesi = global.iqSession[from]

  if (!sesi || !sesi.current) {
    return sock.sendMessage(from, {
      text: "Belum ada soal. Ketik .iq dulu."
    })
  }

  const jawab = text.split(" ")[1]?.toUpperCase()
  const map = { A: 0, B: 1, C: 2, D: 3 }
  const pilihan = sesi.current.options[map[jawab]]

  if (!pilihan) {
    return sock.sendMessage(from, {
      text: "Jawab pakai A/B/C/D. Contoh: .iqjawab A"
    })
  }

  sesi.total++

  if (pilihan === sesi.current.answer) {
    sesi.benar++
    sesi.current = null

    return sock.sendMessage(from, {
      text: "✅ Benar!\nKetik .iq buat soal berikutnya."
    })
  } else {
    sesi.salah++
    const benar = sesi.current.answer
    sesi.current = null

    return sock.sendMessage(from, {
      text: `❌ Salah!\nJawaban benar: ${benar}\nKetik .iq buat soal berikutnya.`
    })
  }
}

if (text === ".hasiliq") {
  global.iqSession = global.iqSession || {}

  const sesi = global.iqSession[from]

  if (!sesi || sesi.total === 0) {
    return sock.sendMessage(from, {
      text: "Belum ada hasil. Main dulu pakai .iq"
    })
  }

  const persen = sesi.benar / sesi.total
  const iq = Math.round(75 + persen * 65)
  const level = getIQLevel(iq)

  return sock.sendMessage(from, {
    text:
`🧠 *HASIL IQ TEST*

✅ Benar: ${sesi.benar}
❌ Salah: ${sesi.salah}
📌 Total: ${sesi.total}

🎯 Estimasi IQ:
*${iq} IQ*

🏆 Kategori:
${level}

Ketik .iq buat lanjut tes.`
  })
}

function getUUID() {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "tempamail.com",
      path: "/",
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0" }
    }, (res) => {
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        const match = data.match(/uuid["']?\s*[:=]\s*["']([a-f0-9-]+)["']/i)
        resolve(match?.[1] || "1ccbf8ff-1ad7-426f-b00e-bc4db79dd558")
      })
    })

    req.on("error", () => resolve("1ccbf8ff-1ad7-426f-b00e-bc4db79dd558"))
    req.end()
  })
}

function createEmail(alias, uuid) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      uuid,
      alias,
      domain_id: 2
    })

    const req = https.request({
      hostname: TEMP_BASE_URL,
      path: "/webapp/email/custom",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": "Mozilla/5.0"
      }
    }, (res) => {
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        try {
          const json = JSON.parse(data)
          resolve({
            email_id: json.email.id,
            email: json.email.address
          })
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on("error", reject)
    req.write(postData)
    req.end()
  })
}

function checkInbox(emailId, uuid) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      uuid,
      selected_email_id: emailId,
      known_message_id: 0
    })

    const req = https.request({
      hostname: TEMP_BASE_URL,
      path: "/webapp/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": "Mozilla/5.0"
      }
    }, (res) => {
      let data = ""
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        try {
          const json = JSON.parse(data)
          const messages = (json.messages || [])
            .filter(msg => msg.email_id === parseInt(emailId))
            .map(msg => ({
              from: msg.from,
              subject: msg.subject,
              body: String(msg.body || "").replace(/<[^>]*>/g, "").trim()
            }))

          resolve({ messages })
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on("error", reject)
    req.write(postData)
    req.end()
  })
}

async function safeSend(sock, jid, content) {
  try {
    return await sock.sendMessage(jid, content)
  } catch (e) {
    console.log("Gagal kirim pesan:", e.message)
  }
}

const iqQuestions = [
  {
    question: "2, 4, 8, 16, ?",
    options: ["18", "24", "32", "64"],
    answer: "32"
  },
  {
    question: "Jika semua Bloops adalah Razzies, dan semua Razzies adalah Lazzies, maka semua Bloops adalah?",
    options: ["Razzies", "Lazzies", "Bukan apa-apa", "Tidak bisa ditentukan"],
    answer: "Lazzies"
  },
  {
    question: "1, 1, 2, 3, 5, 8, ?",
    options: ["10", "11", "13", "15"],
    answer: "13"
  },
  {
    question: "Mana yang berbeda? Kucing, Anjing, Burung, Mobil",
    options: ["Kucing", "Anjing", "Burung", "Mobil"],
    answer: "Mobil"
  },
  {
    question: "5 + 3 × 2 = ?",
    options: ["16", "11", "13", "10"],
    answer: "11"
  }
]

function getIQLevel(iq) {
  if (iq >= 140) return "Monster Otak 😭"
  if (iq >= 120) return "Genius 🔥"
  if (iq >= 100) return "Pintar 🧠"
  if (iq >= 80) return "Lumayan 😎"
  return "Perlu latihan lagi 💪"
}

console.log("BOT MULAI")

startBot()

