/**
 * Mzansi Pros - Telegram Onboarding Bot
 * POST /api/telegram (Telegram webhook)
 *
 * Flow:
 * 1. Business name + trade
 * 2. Area
 * 3. Phone number
 * 4. Photo of work
 * 5. Services offered
 * -> Deploy site -> Send URL
 */

const https = require('https')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// In-memory session store (fine for MVP - upgrade to Upstash KV for production)
const sessions = new Map()

// ─── TELEGRAM HELPERS ────────────────────────────────────────────────────────

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function sendMessage(chatId, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra })
}

function getFile(fileId) {
  return tgRequest('getFile', { file_id: fileId })
}

function downloadFile(filePath) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
    https.get(url, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

// ─── GITHUB UPLOAD ────────────────────────────────────────────────────────────

async function uploadPhotoToGitHub(imageBuffer, filename) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set')
  const content = imageBuffer.toString('base64')
  const body = {
    message: `upload: pro photo ${filename}`,
    content,
    branch: 'main'
  }
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/freddiestyle-hue/Mzansi/contents/uploads/${filename}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'MzansiProsBot'
      }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          const rawUrl = `https://raw.githubusercontent.com/freddiestyle-hue/Mzansi/main/uploads/${filename}`
          resolve(rawUrl)
        } catch { reject(new Error(data)) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ─── VERCEL DEPLOY ────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function fillTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (data[key] || '').replace(/\\/g, '\\\\'))
}

async function deployToVercel(clientData) {
  const templateRes = await fetch('https://raw.githubusercontent.com/freddiestyle-hue/Mzansi/main/index.html')
  const template = await templateRes.text()
  const html = fillTemplate(template, clientData)
  const projectName = `mzansi-${slugify(clientData.business_name)}`

  const body = {
    name: projectName,
    files: [{ file: 'index.html', data: Buffer.from(html).toString('base64'), encoding: 'base64' }],
    projectSettings: { framework: null },
    target: 'production'
  }
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vercel.com',
      path: '/v13/deployments',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) } })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ─── CONVERSATION STEPS ───────────────────────────────────────────────────────

const STEPS = [
  {
    key: 'business_name',
    ask: () => `Welcome to <b>Mzansi Pros</b>! 👋\n\nLet's get your professional website up in a few minutes.\n\n<b>What is your business name and trade?</b>\n\n<i>e.g. Benny Painting, Sipho Plumbing, Thandi Electricals</i>`
  },
  {
    key: 'location_area',
    ask: (s) => `Got it - <b>${s.business_name}</b>\n\n<b>Which area do you serve?</b>\n\n<i>e.g. Mitchells Plain Cape Town, Khayelitsha, Soweto Johannesburg</i>`
  },
  {
    key: 'phone_number',
    ask: () => `<b>What is your phone number for customers?</b>\n\n<i>e.g. 0821234567</i>`
  },
  {
    key: 'photo',
    ask: () => `<b>Send us one photo of your work.</b> 📸\n\n<i>A clear photo of a completed job works best. This will be the main image on your website.</i>`
  },
  {
    key: 'services',
    ask: () => `Almost done! <b>What services do you offer?</b>\n\nList one per line:\n<i>Geyser repair\nLeak fix\nNew installation</i>`
  }
]

// ─── SESSION LOGIC ────────────────────────────────────────────────────────────

async function handleMessage(chatId, message) {
  let session = sessions.get(chatId) || { step: 0, data: {} }

  // /start or restart
  if (message.text && (message.text === '/start' || message.text === '/restart')) {
    session = { step: 0, data: {} }
    sessions.set(chatId, session)
    await sendMessage(chatId, STEPS[0].ask(session.data))
    return
  }

  const currentStep = STEPS[session.step]
  if (!currentStep) return

  // Handle photo step
  if (currentStep.key === 'photo') {
    if (!message.photo && !message.document) {
      await sendMessage(chatId, 'Please send a photo of your work. Tap the 📎 icon and choose a photo.')
      return
    }

    await sendMessage(chatId, 'Uploading your photo...')

    try {
      const photo = message.photo
        ? message.photo[message.photo.length - 1] // highest res
        : message.document

      const fileInfo = await getFile(photo.file_id)
      const imageBuffer = await downloadFile(fileInfo.result.file_path)
      const ext = fileInfo.result.file_path.split('.').pop() || 'jpg'
      const filename = `${slugify(session.data.business_name || 'pro')}-${Date.now()}.${ext}`
      const photoUrl = await uploadPhotoToGitHub(imageBuffer, filename)

      session.data.photo_url = photoUrl
      session.step++
      sessions.set(chatId, session)
      await sendMessage(chatId, STEPS[session.step - 1 + 1]
        ? STEPS[session.step].ask(session.data)
        : 'Done!')
    } catch (err) {
      console.error('Photo upload error:', err)
      await sendMessage(chatId, 'Sorry, there was an issue uploading your photo. Please try again.')
    }
    return
  }

  // Handle text steps
  if (!message.text) {
    await sendMessage(chatId, 'Please send a text message to answer this question.')
    return
  }

  session.data[currentStep.key] = message.text.trim()
  session.step++
  sessions.set(chatId, session)

  // More steps to go
  if (session.step < STEPS.length) {
    await sendMessage(chatId, STEPS[session.step].ask(session.data))
    return
  }

  // All done - deploy
  await sendMessage(chatId, 'Building your website now... This takes about 30 seconds.')

  try {
    const d = session.data
    const serviceLines = (d.services || '').split('\n').filter(Boolean)
    const phoneClean = (d.phone_number || '').replace(/\s/g, '')
    const waNumber = '27' + phoneClean.replace(/^0/, '')

    const clientData = {
      business_name: d.business_name || '',
      tagline: `Professional services in ${d.location_area || ''}`,
      service_description: d.services || '',
      location_area: d.location_area || '',
      phone_number: phoneClean,
      whatsapp_number: waNumber,
      hero_image_url: d.photo_url || 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80',
      service_1: serviceLines[0] || '',
      service_1_desc: '',
      service_1_price: '',
      service_2: serviceLines[1] || '',
      service_2_desc: '',
      service_2_price: '',
      service_3: serviceLines[2] || '',
      service_3_desc: '',
      service_3_price: '',
      service_4: serviceLines[3] || '',
      service_4_desc: '',
      service_4_price: '',
      service_5: serviceLines[4] || '',
      service_5_desc: '',
      service_5_price: '',
      gallery_1: d.photo_url || '',
      gallery_2: '',
      gallery_3: '',
      gallery_4: '',
      gallery_5: '',
      gallery_6: '',
      testimonial_text: '',
      testimonial_name: '',
      testimonial_suburb: '',
      operating_hours: 'Mon-Sat, 7am-6pm'
    }

    const result = await deployToVercel(clientData)

    if (result.url) {
      const siteUrl = `https://${result.url}`
      await sendMessage(chatId,
        `Your website is live! 🎉\n\n<b>${siteUrl}</b>\n\nShare this link with your customers. They can WhatsApp you directly from it.\n\nWelcome to Mzansi Pros!`
      )
      // Reset session
      sessions.delete(chatId)
    } else {
      throw new Error(JSON.stringify(result))
    }
  } catch (err) {
    console.error('Deploy error:', err)
    await sendMessage(chatId, 'Sorry, there was a problem building your website. We will try again shortly.')
    session.step = STEPS.length - 1 // stay on last step
    sessions.set(chatId, session)
  }
}

// ─── WEBHOOK HANDLER ──────────────────────────────────────────────────────────

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
  if (!message) return res.status(200).end()

  const chatId = message.chat.id
  await handleMessage(chatId, message)

  res.status(200).json({ ok: true })
}
