const https = require('https')

const GIST_ID = '6bbb6aab80a506aefa4516c9a2c162cb'

function getSessions() {
  var GITHUB_TOKEN = process.env.GITHUB_TOKEN
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.github.com',
      path: '/gists/' + GIST_ID,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'User-Agent': 'MzansiProsBot' }
    }
    https.get(options, function(res) {
      var data = ''
      res.on('data', function(c) { data += c })
      res.on('end', function() {
        try {
          var gist = JSON.parse(data)
          var content = gist.files['sessions.json'].content
          resolve(JSON.parse(content))
        } catch(e) { resolve({}) }
      })
    }).on('error', function() { resolve({}) })
  })
}

function saveSessions(sessions) {
  var GITHUB_TOKEN = process.env.GITHUB_TOKEN
  var payload = JSON.stringify({ files: { 'sessions.json': { content: JSON.stringify(sessions) } } })
  return new Promise(function(resolve) {
    var options = {
      hostname: 'api.github.com',
      path: '/gists/' + GIST_ID,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'MzansiProsBot'
      }
    }
    var req = https.request(options, function(res) {
      res.on('data', function() {})
      res.on('end', resolve)
    })
    req.on('error', resolve)
    req.write(payload)
    req.end()
  })
}

function sendMessage(chatId, text, extra) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const body = Object.assign({ chat_id: chatId, text, parse_mode: 'HTML' }, extra || {})
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }
    const req = https.request(options, function(res) {
      var data = ''
      res.on('data', function(c) { data += c })
      res.on('end', function() {
        try { resolve(JSON.parse(data)) } catch(e) { resolve({}) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function getFile(fileId) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/getFile?file_id=' + fileId,
      method: 'GET'
    }
    https.get(options, function(res) {
      var data = ''
      res.on('data', function(c) { data += c })
      res.on('end', function() {
        try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
      })
    }).on('error', reject)
  })
}

function downloadBuffer(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject)
      }
      var chunks = []
      res.on('data', function(c) { chunks.push(c) })
      res.on('end', function() { resolve(Buffer.concat(chunks)) })
    }).on('error', reject)
  })
}

function fetchText(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject)
      }
      var data = ''
      res.on('data', function(c) { data += c })
      res.on('end', function() { resolve(data) })
    }).on('error', reject)
  })
}

function uploadToGitHub(buf, filename) {
  var GITHUB_TOKEN = process.env.GITHUB_TOKEN
  var content = buf.toString('base64')
  var payload = JSON.stringify({ message: 'upload: ' + filename, content: content, branch: 'main' })
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.github.com',
      path: '/repos/freddiestyle-hue/Mzansi/contents/uploads/' + filename,
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'MzansiProsBot'
      }
    }
    var req = https.request(options, function(res) {
      var data = ''
      res.on('data', function(c) { data += c })
      res.on('end', function() {
        resolve('https://raw.githubusercontent.com/freddiestyle-hue/Mzansi/main/uploads/' + filename)
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function fillTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, function(_, key) {
    return (data[key] || '').toString().replace(/\\/g, '\\\\')
  })
}

function deployToVercel(clientData) {
  var VERCEL_TOKEN = process.env.VERCEL_TOKEN
  var projectName = 'mzansi-' + slugify(clientData.business_name)
  return fetchText('https://raw.githubusercontent.com/freddiestyle-hue/Mzansi/main/index.html')
    .then(function(template) {
      var html = fillTemplate(template, clientData)
      var body = JSON.stringify({
        name: projectName,
        files: [{ file: 'index.html', data: Buffer.from(html).toString('base64'), encoding: 'base64' }],
        projectSettings: { framework: null },
        target: 'production'
      })
      return new Promise(function(resolve, reject) {
        var options = {
          hostname: 'api.vercel.com',
          path: '/v13/deployments',
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + VERCEL_TOKEN,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        }
        var req = https.request(options, function(res) {
          var data = ''
          res.on('data', function(c) { data += c })
          res.on('end', function() {
            try { resolve(JSON.parse(data)) } catch(e) { resolve({}) }
          })
        })
        req.on('error', reject)
        req.write(body)
        req.end()
      })
    })
}

// Language messages
var LANG = {
  en: {
    q1: 'Welcome to <b>Mzansi Pros</b>!\n\nLet\'s get your professional website ready.\n\n<b>What is your business name and trade?</b>\n\n<i>e.g. Benny Painting, Sipho Plumbing</i>',
    q2: function(s) { return 'Got it - <b>' + s.name + '</b>\n\n<b>Which area do you serve?</b>\n\n<i>e.g. Mitchells Plain Cape Town, Khayelitsha</i>' },
    q3: '<b>What is your phone number for customers?</b>\n\n<i>e.g. 0821234567</i>',
    q4: '<b>Send us one photo of your work.</b>\n\n<i>A clear photo of a completed job works best.</i>',
    q5: 'Almost done! <b>What services do you offer?</b>\n\nList one per line:\n<i>Interior painting\nExterior painting\nRoof painting</i>',
    uploading: 'Uploading photo...',
    building: 'Building your website... About 30 seconds.',
    done: function(url) { return 'Your website is live!\n\n<b>' + url + '</b>\n\nShare this with your customers. Welcome to Mzansi Pros!' },
    err_photo: 'Could not upload photo. Please try again.',
    err_deploy: 'Could not build website. Please try again.',
    send_photo: 'Please send a photo. Tap the attachment icon.',
    send_text: 'Please send a text reply.'
  },
  af: {
    q1: 'Welkom by <b>Mzansi Pros</b>!\n\nKom ons kry jou webwerf gereed.\n\n<b>Wat is jou besigheidsnaam en ambag?</b>\n\n<i>bv. Benny Skilder, Sipho Loodgieter</i>',
    q2: function(s) { return 'Goed - <b>' + s.name + '</b>\n\n<b>Watter area bedien jy?</b>\n\n<i>bv. Mitchells Plain Kaapstad</i>' },
    q3: '<b>Wat is jou foonnommer vir kliente?</b>\n\n<i>bv. 0821234567</i>',
    q4: '<b>Stuur \'n foto van jou werk.</b>\n\n<i>\'n Duidelike foto werk die beste.</i>',
    q5: 'Amper klaar! <b>Watter dienste bied jy aan?</b>\n\nLys een per reel:\n<i>Binneskilder\nBuiteskilder\nDakskilder</i>',
    uploading: 'Foto word opgelaai...',
    building: 'Webwerf word gebou... Sowat 30 sekondes.',
    done: function(url) { return 'Jou webwerf is lewendig!\n\n<b>' + url + '</b>\n\nDeel dit met jou kliente. Welkom by Mzansi Pros!' },
    err_photo: 'Kon nie foto oplaai nie. Probeer asseblief weer.',
    err_deploy: 'Kon nie webwerf bou nie. Probeer asseblief weer.',
    send_photo: 'Stuur asseblief \'n foto.',
    send_text: 'Stuur asseblief \'n teksboodskap.'
  },
  zu: {
    q1: 'Siyakwamukela ku-<b>Mzansi Pros</b>!\n\nAsikheni iwebhusayithi yakho.\n\n<b>Yiliphi igama lebhizinisi lakho nomsebenzi?</b>\n\n<i>isb. Benny Ukupenda, Sipho Izicoci</i>',
    q2: function(s) { return 'Kulungile - <b>' + s.name + '</b>\n\n<b>Yisiphi isigodi osebenza kuso?</b>\n\n<i>isb. Mitchells Plain eKapa</i>' },
    q3: '<b>Yini inombolo yakho yefoni?</b>\n\n<i>isb. 0821234567</i>',
    q4: '<b>Thumela isithombe somsebenzi wakho.</b>\n\n<i>Isithombe esisobala sisebenza kahle.</i>',
    q5: 'Siyaqeda! <b>Yimiphi imisebenzi oyenzayo?</b>\n\nBhala eyodwa ngomugqa ngamunye:\n<i>Ukupenda ngaphakathi\nUkupenda ngaphandle</i>',
    uploading: 'Iyalayisha isithombe...',
    building: 'Yakha iwebhusayithi... Imizuzwana engu-30.',
    done: function(url) { return 'Iwebhusayithi yakho iphila!\n\n<b>' + url + '</b>\n\nSiyakwamukela ku-Mzansi Pros!' },
    err_photo: 'Akukhonanga ukulayisha isithombe. Zama futhi.',
    err_deploy: 'Akukhonanga ukwakha iwebhusayithi. Zama futhi.',
    send_photo: 'Thumela isithombe.',
    send_text: 'Thumela umlayezo wombhalo.'
  },
  xh: {
    q1: 'Wamkelekile ku-<b>Mzansi Pros</b>!\n\nAsikheni iwebhusayithi yakho.\n\n<b>Ngubani igama lebhizinisi lakho?</b>\n\n<i>umz. Benny Ukupenda, Sipho Izicoci</i>',
    q2: function(s) { return 'Kulungile - <b>' + s.name + '</b>\n\n<b>Yeyiphi indawo osebenza kuyo?</b>\n\n<i>umz. Mitchells Plain eKapa</i>' },
    q3: '<b>Yintoni inombolo yakho yomnxeba?</b>\n\n<i>umz. 0821234567</i>',
    q4: '<b>Thumela umfanekiso womsebenzi wakho.</b>\n\n<i>Umfanekiso ocacileyo usebenza kakuhle.</i>',
    q5: 'Siyaphela! <b>Yimiphi imisebenzi oyenzayo?</b>\n\nBhala enye ngomgca ngamnye:\n<i>Ukupenda ngaphakathi\nUkupenda ngaphandle</i>',
    uploading: 'Iyalayisha umfanekiso...',
    building: 'Yakha iwebhusayithi ngoku... Imizuzu engama-30.',
    done: function(url) { return 'Iwebhusayithi yakho iphilile!\n\n<b>' + url + '</b>\n\nWamkelekile ku-Mzansi Pros!' },
    err_photo: 'Akukwazanga ukulayisha umfanekiso. Zama kwakhona.',
    err_deploy: 'Akukwazanga ukwakha iwebhusayithi. Zama kwakhona.',
    send_photo: 'Thumela umfanekiso.',
    send_text: 'Thumela umlayezo wombhalo.'
  }
}

function m(session) {
  return LANG[session.lang] || LANG.en
}

async function handleMessage(chatId, message, sessions) {
  var session = sessions[chatId] || { step: -1, lang: 'en', data: {} }

  if (message.text && (message.text === '/start' || message.text === '/restart')) {
    sessions[chatId] = { step: -1, lang: 'en', data: {} }
    await sendMessage(chatId,
      'Welcome to <b>Mzansi Pros</b>!\n\nChoose your language / Kies jou taal:\n\n1. English\n2. Afrikaans\n3. Zulu\n4. Xhosa',
      { reply_markup: { keyboard: [[{text:'1. English'},{text:'2. Afrikaans'}],[{text:'3. Zulu'},{text:'4. Xhosa'}]], one_time_keyboard: true, resize_keyboard: true } }
    )
    return
  }

  // Language selection
  if (session.step === -1) {
    var t = (message.text || '').toLowerCase()
    var lang = 'en'
    if (t.includes('afrikaans') || t.startsWith('2')) lang = 'af'
    else if (t.includes('zulu') || t.startsWith('3')) lang = 'zu'
    else if (t.includes('xhosa') || t.startsWith('4')) lang = 'xh'
    session.lang = lang
    session.step = 0
    sessions[chatId] = session
    await sendMessage(chatId, m(session).q1, { reply_markup: { remove_keyboard: true } })
    return
  }

  var msg = m(session)

  // Step 0: name
  if (session.step === 0) {
    if (!message.text) { await sendMessage(chatId, msg.send_text); return }
    session.data.name = message.text.trim()
    session.step = 1
    sessions[chatId] = session
    await sendMessage(chatId, msg.q2(session.data))
    return
  }

  // Step 1: area
  if (session.step === 1) {
    if (!message.text) { await sendMessage(chatId, msg.send_text); return }
    session.data.area = message.text.trim()
    session.step = 2
    sessions[chatId] = session
    await sendMessage(chatId, msg.q3)
    return
  }

  // Step 2: phone
  if (session.step === 2) {
    if (!message.text) { await sendMessage(chatId, msg.send_text); return }
    session.data.phone = message.text.trim().replace(/\s/g, '')
    session.step = 3
    sessions[chatId] = session
    await sendMessage(chatId, msg.q4)
    return
  }

  // Step 3: photo
  if (session.step === 3) {
    if (!message.photo && !message.document) {
      await sendMessage(chatId, msg.send_photo)
      return
    }
    await sendMessage(chatId, msg.uploading)
    try {
      var BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
      var photo = message.photo ? message.photo[message.photo.length - 1] : message.document
      var fileInfo = await getFile(photo.file_id)
      var filePath = fileInfo.result.file_path
      var ext = filePath.split('.').pop() || 'jpg'
      var buf = await downloadBuffer('https://api.telegram.org/file/bot' + BOT_TOKEN + '/' + filePath)
      var filename = slugify(session.data.name) + '-' + Date.now() + '.' + ext
      session.data.photoUrl = await uploadToGitHub(buf, filename)
      session.step = 4
      sessions[chatId] = session
      await sendMessage(chatId, msg.q5)
    } catch(e) {
      console.error('photo error', e)
      await sendMessage(chatId, msg.err_photo)
    }
    return
  }

  // Step 4: services - deploy
  if (session.step === 4) {
    if (!message.text) { await sendMessage(chatId, msg.send_text); return }
    session.data.services = message.text.trim()
    sessions[chatId] = session
    await sendMessage(chatId, msg.building)

    try {
      var lines = session.data.services.split('\n').filter(Boolean)
      var phone = session.data.phone
      var wa = '27' + phone.replace(/^0/, '')
      var clientData = {
        business_name: session.data.name,
        tagline: 'Professional services in ' + session.data.area,
        service_description: session.data.services,
        location_area: session.data.area,
        phone_number: phone,
        whatsapp_number: wa,
        hero_image_url: session.data.photoUrl || 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800',
        service_1: lines[0] || '', service_1_desc: '', service_1_price: '',
        service_2: lines[1] || '', service_2_desc: '', service_2_price: '',
        service_3: lines[2] || '', service_3_desc: '', service_3_price: '',
        service_4: lines[3] || '', service_4_desc: '', service_4_price: '',
        service_5: lines[4] || '', service_5_desc: '', service_5_price: '',
        gallery_1: session.data.photoUrl || '', gallery_2: '', gallery_3: '',
        gallery_4: '', gallery_5: '', gallery_6: '',
        testimonial_text: '', testimonial_name: '', testimonial_suburb: '',
        operating_hours: 'Mon-Sat, 7am-6pm'
      }

      var result = await deployToVercel(clientData)
      if (result.url) {
        var siteUrl = 'https://' + result.url
        await sendMessage(chatId, msg.done(siteUrl))
        delete sessions[chatId]
      } else {
        throw new Error(JSON.stringify(result))
      }
    } catch(e) {
      console.error('deploy error', e)
      await sendMessage(chatId, msg.err_deploy)
    }
    return
  }
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  var update
  try {
    update = typeof req.body === 'object' ? req.body : JSON.parse(req.body)
  } catch(e) {
    return res.status(400).end()
  }

  var message = update.message || update.edited_message
  if (!message) return res.status(200).json({ ok: true })

  try {
    var sessions = await getSessions()
    await handleMessage(message.chat.id, message, sessions)
    await saveSessions(sessions)
  } catch(e) {
    console.error('handler error', e)
  }

  res.status(200).json({ ok: true })
}

module.exports = handler
