import { createBridge } from './bridge.js'

const appId = 'google-classroom'

const banner = document.getElementById('message-banner')
const statusIcon = document.getElementById('status-icon')
const statusText = document.getElementById('status-text')
const statusDetail = document.getElementById('status-detail')
const courseList = document.getElementById('course-list')

let connected = false
let sessionId = null

function setBanner(text, type) {
  banner.textContent = text
  banner.className = 'banner' + (type === 'warning' ? ' warning' : type === 'success' ? ' success' : '')
}

function updateUI() {
  if (connected) {
    statusIcon.textContent = '🔗'
    statusText.textContent = 'Connected to Google Classroom'
    statusDetail.textContent = 'Your Google account is authorized. TutorMeAI can now access your classroom data to help with assignments and coursework.'
    courseList.innerHTML = '<p class="hint">Ask TutorMeAI in chat: "What assignments do I have?" or "Show my courses"</p>'
  } else {
    statusIcon.textContent = '🔒'
    statusText.textContent = 'Not Connected'
    statusDetail.textContent = 'Click "Connect" in the app shelf to authorize Google Classroom access. TutorMeAI will be able to see your courses and upcoming assignments.'
    courseList.innerHTML = ''
  }
}

const bridge = createBridge({
  appId,
  onInit(payload) {
    sessionId = payload?.sessionId
    setBanner('Google Classroom app ready. Waiting for authorization.', '')
    updateUI()
    bridge.sendReady('Google Classroom app loaded. Waiting for OAuth authorization.')
  },
  onPing() {},
  onTerminate() {
    setBanner('Session ended.', 'warning')
  },
})

// Listen for AUTH_RESULT from host
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.source !== 'chatbridge-host' || data.appId !== appId) return

  if (data.type === 'AUTH_RESULT') {
    if (data.payload?.success) {
      connected = true
      setBanner('Successfully connected to Google Classroom!', 'success')
      updateUI()
      bridge.sendStateUpdate('Google Classroom connected and ready.', {
        connected: true,
        provider: data.payload.provider || 'google',
      })
    } else {
      connected = false
      setBanner(data.payload?.error || 'Authorization failed.', 'warning')
      updateUI()
    }
  }
})

updateUI()
