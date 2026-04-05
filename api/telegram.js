const https = require('https')
const sessions = new Map()

module.exports.config = { api: { bodyParser: false } }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end()

  let body = ''
  await new Promise(resolve => {
    req.on('data', c => body += c)
    req.on('end', resolve)
  })

  let update
  try { update = JSON.parse(body) } catch { return res.status(400).end() }

  const message = update.message || update.edited_message
  if (!message) return res.status(200).json({ ok: true })

  const chatId = message.chat.id
  const text = message.text || ''

  // Simple echo for now
  await sendMessage(chatId, 'Working! Send /start to begin.')
  res.status(200).json({ ok: true })
}

function sendMessage(chatId, text) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const payload = JSON.stringify({ chat_id: chatId, text })
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(JSON.parse(data)))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}
