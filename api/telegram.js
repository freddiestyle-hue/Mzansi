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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject)
      }
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

async function deployToVercel(clientData) {
  const template = await fetchUrl('https://raw.githubusercontent.com/freddiestyle-hue/Mzansi/main/index.html')
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

const MESSAGES = {
  en: {
    welcome: `Welcome to <b>Mzansi Pros</b>!\n\nLet's get your professional website up in a few minutes.`,
    ask_name: `<b>What is your business name and trade?</b>\n\n<i>e.g. Benny Painting, Sipho Plumbing, Thandi Electricals</i>`,
    ask_area: (s) => `Got it - <b>${s.business_name}</b>\n\n<b>Which area do you serve?</b>\n\n<i>e.g. Mitchells Plain Cape Town, Khayelitsha, Soweto</i>`,
    ask_phone: `<b>What is your phone number for customers?</b>\n\n<i>e.g. 0821234567</i>`,
    ask_photo: `<b>Send us one photo of your work.</b>\n\n<i>A clear photo of a completed job works best. This will be the main image on your website.</i>`,
    ask_services: `Almost done! <b>What services do you offer?</b>\n\nList one per line:\n<i>Geyser repair\nLeak fix\nNew installation</i>`,
    uploading: 'Uploading your photo...',
    building: 'Building your website now... This takes about 30 seconds.',
    done: (url) => `Your website is live!\n\n<b>${url}</b>\n\nShare this link with your customers. They can WhatsApp you directly from it.\n\nWelcome to Mzansi Pros!`,
    photo_prompt: 'Please send a photo of your work. Tap the attachment icon and choose a photo.',
    text_prompt: 'Please send a text message to answer this question.',
    error_photo: 'Sorry, there was an issue uploading your photo. Please try again.',
    error_deploy: 'Sorry, there was a problem building your website. We will try again shortly.',
  },
  af: {
    welcome: `Welkom by <b>Mzansi Pros</b>!\n\nKom ons kry jou professionele webwerf binne 'n paar minute op.`,
    ask_name: `<b>Wat is jou besigheidsnaam en ambag?</b>\n\n<i>bv. Benny Skilder, Sipho Loodgieter, Thandi Elektrisiën</i>`,
    ask_area: (s) => `Goed - <b>${s.business_name}</b>\n\n<b>Watter area bedien jy?</b>\n\n<i>bv. Mitchells Plain Kaapstad, Soweto Johannesburg</i>`,
    ask_phone: `<b>Wat is jou foonnommer vir kliënte?</b>\n\n<i>bv. 0821234567</i>`,
    ask_photo: `<b>Stuur vir ons een foto van jou werk.</b>\n\n<i>'n Duidelike foto van 'n voltooide werk is die beste.</i>`,
    ask_services: `Amper klaar! <b>Watter dienste bied jy aan?</b>\n\nLys een per reël:\n<i>Geyser herstel\nLekkasie regmaak\nNuwe installasie</i>`,
    uploading: 'Laai jou foto op...',
    building: 'Bou nou jou webwerf... Dit neem sowat 30 sekondes.',
    done: (url) => `Jou webwerf is lewendig!\n\n<b>${url}</b>\n\nDeel hierdie skakel met jou kliënte.\n\nWelkom by Mzansi Pros!`,
    photo_prompt: 'Stuur asseblief \'n foto van jou werk.',
    text_prompt: 'Stuur asseblief \'n teksbooodskap om hierdie vraag te beantwoord.',
    error_photo: 'Jammer, daar was \'n probleem met die oplaai van jou foto. Probeer asseblief weer.',
    error_deploy: 'Jammer, daar was \'n probleem met die bou van jou webwerf. Ons sal binnekort weer probeer.',
  },
  zu: {
    welcome: `Siyakwamukela ku-<b>Mzansi Pros</b>!\n\nAsikheni iwebhusayithi yakho yomsebenzi ngomzuzu omfishane.`,
    ask_name: `<b>Yiliphi igama lebhizinisi lakho nomsebenzi owenzayo?</b>\n\n<i>isb. Benny Ukupenda, Sipho Isizamfanelo, Thandi Ugesi</i>`,
    ask_area: (s) => `Kulungile - <b>${s.business_name}</b>\n\n<b>Yisiphi isigodi osebenza kuso?</b>\n\n<i>isb. Mitchells Plain eKapa, Khayelitsha, Soweto eGoli</i>`,
    ask_phone: `<b>Yini inombolo yakho yefoni yamagcokama?</b>\n\n<i>isb. 0821234567</i>`,
    ask_photo: `<b>Thumela isithombe somsebenzi wakho.</b>\n\n<i>Isithombe esisobala somsebenzi oqediwe sisebenza kahle.</i>`,
    ask_services: `Siyaqeda! <b>Yimiphi imisebenzi oyenzayo?</b>\n\nBhala eyodwa ngomugqa ngamunye:\n<i>Ukulungisa ugesi\nUkulungisa ukuvuza\nUkufaka okusha</i>`,
    uploading: 'Iyalayisha isithombe sakho...',
    building: 'Yakha iwebhusayithi yakho manje... Kuthatha imizuzu engu-30.',
    done: (url) => `Iwebhusayithi yakho iphila!\n\n<b>${url}</b>\n\nAbiselana nalo mxholo namagcokama akho.\n\nSiyakwamukela ku-Mzansi Pros!`,
    photo_prompt: 'Sicela uthumele isithombe somsebenzi wakho.',
    text_prompt: 'Sicela uthumele umlayezo wombhalo ukuphendula lo mbuzo.',
    error_photo: 'Uxolo, kukhona inkinga nge-upload yesithombe sakho. Sicela uzame futhi.',
    error_deploy: 'Uxolo, kukhona inkinga ekwakhiweni kwewebhusayithi yakho. Sizazama futhi maduze.',
  },
  xh: {
    welcome: `Wamkelekile ku-<b>Mzansi Pros</b>!\n\nAsikheni iwebhusayithi yakho yomsebenzi ngomzuzu omfutshane.`,
    ask_name: `<b>Ngubani igama lebhizinisi lakho nomsebenzi owenzayo?</b>\n\n<i>umz. Benny Ukupenda, Sipho Izicoci, Thandi Umbane</i>`,
    ask_area: (s) => `Kulungile - <b>${s.business_name}</b>\n\n<b>Yeyiphi indawo osebenza kuyo?</b>\n\n<i>umz. Mitchells Plain eKapa, Khayelitsha, Soweto eGoli</i>`,
    ask_phone: `<b>Yintoni inombolo yakho yomnxeba yabantu abakuhlawulayo?</b>\n\n<i>umz. 0821234567</i>`,
    ask_photo: `<b>Thumela umfanekiso womsebenzi wakho.</b>\n\n<i>Umfanekiso ocacileyo womsebenzi ogqityiweyo usebenza kakuhle.</i>`,
    ask_services: `Siyaphela! <b>Yimiphi imisebenzi oyenzayo?</b>\n\nBhala enye ngomgca ngamnye:\n<i>Ukulungisa i-geyser\nUkulungisa ukuphalaza\nUkufaka okusha</i>`,
    uploading: 'Iyalayisha umfanekiso wakho...',
    building: 'Yakha iwebhusayithi yakho ngoku... Ithatha imizuzu engama-30.',
    done: (url) => `Iwebhusayithi yakho iphilile!\n\n<b>${url}</b>\n\nAba nomxholo nabantu abakuhlawulayo bakho.\n\nWamkelekile ku-Mzansi Pros!`,
    photo_prompt: 'Nceda uthumele umfanekiso womsebenzi wakho.',
    text_prompt: 'Nceda uthumele umlayezo wombhalo uphendule lo mbuzo.',
    error_photo: 'Uxolo, kukhona ingxaki ne-upload yomfanekiso wakho. Nceda uzame kwakhona.',
    error_deploy: 'Uxolo, kukhona ingxaki ekwakhiweni kwewebhusayithi yakho. Siza kuzama kwakhona kungekudala.',
  }
}

const LANGUAGE_STEP = {
  key: 'language',
  ask: () => `Welcome to <b>Mzansi Pros</b>!\n\nPlease choose your language / Kies jou taal / Khetha ulimi lwakho:\n\n1. English\n2. Afrikaans\n3. Zulu\n4. Xhosa`,
}

const STEPS = [
  { key: 'business_name', ask: (s, m) => `${m.welcome}\n\n${m.ask_name}` },
  { key: 'location_area', ask: (s, m) => m.ask_area(s) },
  { key: 'phone_number', ask: (s, m) => m.ask_phone },
  { key: 'photo', ask: (s, m) => m.ask_photo },
  { key: 'services', ask: (s, m) => m.ask_services },
]

// ─── SESSION LOGIC ────────────────────────────────────────────────────────────

function getLang(session) {
  return MESSAGES[session.data.language] || MESSAGES.en
}

async function handleMessage(chatId, message) {
  let session = sessions.get(chatId) || { step: -1, data: {} }

  // /start or restart
  if (message.text && (message.text === '/start' || message.text === '/restart')) {
    session = { step: -1, data: {} }
    sessions.set(chatId, session)
    await sendMessage(chatId, LANGUAGE_STEP.ask(), {
      reply_markup: {
        keyboard: [[{ text: '1. English' }, { text: '2. Afrikaans' }], [{ text: '3. Zulu' }, { text: '4. Xhosa' }]],
        one_time_keyboard: true,
        resize_keyboard: true
      }
    })
    return
  }

  // Language selection step
  if (session.step === -1) {
    if (!message.text) {
      await sendMessage(chatId, LANGUAGE_STEP.ask())
      return
    }
    const t = message.text.toLowerCase()
    let lang = 'en'
    if (t.includes('afrikaans') || t.includes('2')) lang = 'af'
    else if (t.includes('zulu') || t.includes('3')) lang = 'zu'
    else if (t.includes('xhosa') || t.includes('4')) lang = 'xh'
    session.data.language = lang
    session.step = 0
    sessions.set(chatId, session)
    const m = getLang(session)
    await sendMessage(chatId, STEPS[0].ask(session.data, m), { reply_markup: { remove_keyboard: true } })
    return
  }

  const currentStep = STEPS[session.step]
  if (!currentStep) return
  const m = getLang(session)

  // Handle photo step
  if (currentStep.key === 'photo') {
    if (!message.photo && !message.document) {
      await sendMessage(chatId, m.photo_prompt)
      return
    }

    await sendMessage(chatId, m.uploading)

    try {
      const photo = message.photo
        ? message.photo[message.photo.length - 1]
        : message.document

      const fileInfo = await getFile(photo.file_id)
      const imageBuffer = await downloadFile(fileInfo.result.file_path)
      const ext = fileInfo.result.file_path.split('.').pop() || 'jpg'
      const filename = `${slugify(session.data.business_name || 'pro')}-${Date.now()}.${ext}`
      const photoUrl = await uploadPhotoToGitHub(imageBuffer, filename)

      session.data.photo_url = photoUrl
      session.step++
      sessions.set(chatId, session)
      if (session.step < STEPS.length) {
        await sendMessage(chatId, STEPS[session.step].ask(session.data, m))
      }
    } catch (err) {
      console.error('Photo upload error:', err)
      await sendMessage(chatId, m.error_photo)
    }
    return
  }

  // Handle text steps
  if (!message.text) {
    await sendMessage(chatId, m.text_prompt)
    return
  }

  session.data[currentStep.key] = message.text.trim()
  session.step++
  sessions.set(chatId, session)

  // More steps to go
  if (session.step < STEPS.length) {
    await sendMessage(chatId, STEPS[session.step].ask(session.data, m))
    return
  }

  // All done - deploy
  await sendMessage(chatId, getLang(session).building)

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
      await sendMessage(chatId, m.done(siteUrl))
      // Reset session
      sessions.delete(chatId)
    } else {
      throw new Error(JSON.stringify(result))
    }
  } catch (err) {
    console.error('Deploy error:', err)
    await sendMessage(chatId, m.error_deploy)
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
