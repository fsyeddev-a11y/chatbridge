import { createBridge } from './bridge.js'

const appId = 'google-classroom'

const banner = document.getElementById('message-banner')
const statusIcon = document.getElementById('status-icon')
const statusText = document.getElementById('status-text')
const statusDetail = document.getElementById('status-detail')
const courseList = document.getElementById('course-list')
const loadingEl = document.getElementById('loading')

let connected = false
let sessionId = null
let classroomData = null

function setBanner(text, type) {
  banner.textContent = text
  banner.className = 'banner' + (type === 'warning' ? ' warning' : type === 'success' ? ' success' : '')
}

function renderDisconnected() {
  statusIcon.textContent = '🔒'
  statusText.textContent = 'Not Connected'
  statusDetail.textContent = 'Click "Connect" in the app menu to authorize Google Classroom access.'
  courseList.innerHTML = ''
  loadingEl.classList.add('hidden')
}

function renderLoading() {
  statusIcon.textContent = '📚'
  statusText.textContent = 'Loading Classroom Data...'
  statusDetail.textContent = ''
  loadingEl.classList.remove('hidden')
  courseList.innerHTML = ''
}

function renderData(data) {
  classroomData = data
  loadingEl.classList.add('hidden')
  statusIcon.textContent = '🎓'
  statusText.textContent = `${data.courseCount} Course${data.courseCount !== 1 ? 's' : ''}`
  statusDetail.textContent = `${data.assignmentCount} assignment${data.assignmentCount !== 1 ? 's' : ''} found`

  let html = ''

  if (data.courses.length === 0) {
    html = '<div class="empty">No active courses found in your Google Classroom.</div>'
  } else {
    for (const course of data.courses) {
      const courseAssignments = data.assignments.filter(a => a.courseId === course.id)
      html += `<div class="course-card">
        <div class="course-name">${escapeHtml(course.name)}</div>
        ${course.section ? `<div class="course-section">${escapeHtml(course.section)}</div>` : ''}`

      if (courseAssignments.length > 0) {
        html += '<div class="assignments">'
        for (const a of courseAssignments) {
          const due = a.dueDate ? `Due: ${a.dueDate}` : 'No due date'
          html += `<div class="assignment">
            <span class="assignment-title">${escapeHtml(a.title)}</span>
            <span class="assignment-due">${due}</span>
          </div>`
        }
        html += '</div>'
      } else {
        html += '<div class="no-assignments">No assignments</div>'
      }

      html += '</div>'
    }
  }

  courseList.innerHTML = html

  const summary = `Connected. ${data.courseCount} courses, ${data.assignmentCount} assignments.`
  bridge.sendStateUpdate(summary, {
    connected: true,
    courseCount: data.courseCount,
    assignmentCount: data.assignmentCount,
    courses: data.courses.map(c => c.name),
  })
}

function renderError(msg) {
  loadingEl.classList.add('hidden')
  statusIcon.textContent = '⚠️'
  statusText.textContent = 'Error'
  statusDetail.textContent = msg
  courseList.innerHTML = ''
}

function escapeHtml(text) {
  const el = document.createElement('span')
  el.textContent = text
  return el.innerHTML
}

async function fetchClassroomData() {
  renderLoading()
  try {
    // The backend proxy endpoint uses the stored OAuth token
    const response = await fetch(`${getBackendOrigin()}/api/oauth/apps/google-classroom/classroom-data`, {
      headers: getAuthHeaders(),
    })

    if (response.status === 401) {
      connected = false
      renderDisconnected()
      setBanner('Authorization expired. Please reconnect.', 'warning')
      return
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      renderError(body.message || `Failed to load classroom data (${response.status})`)
      return
    }

    const data = await response.json()
    connected = true
    renderData(data)
    setBanner(`Loaded ${data.courseCount} courses and ${data.assignmentCount} assignments.`, 'success')
  } catch (err) {
    renderError(err.message || 'Network error')
  }
}

// Get the backend origin from the parent page
function getBackendOrigin() {
  // The iframe receives this via INIT payload or we can infer from referrer
  return window.__chatbridge_api_origin || ''
}

function getAuthHeaders() {
  // The iframe receives auth headers via INIT payload
  return window.__chatbridge_auth_headers || {}
}

const bridge = createBridge({
  appId,
  onInit(payload) {
    sessionId = payload?.sessionId

    // Store backend origin and auth info passed from host
    window.__chatbridge_api_origin = payload?.apiOrigin || ''
    window.__chatbridge_auth_headers = payload?.authHeaders || {}

    if (window.__chatbridge_api_origin) {
      // Try fetching data immediately — if connected, we'll show it
      setBanner('Checking Google Classroom connection...', '')
      void fetchClassroomData()
    } else {
      renderDisconnected()
      setBanner('Waiting for Google Classroom authorization.', '')
    }

    bridge.sendReady('Google Classroom app loaded.')
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
      setBanner('Connected! Loading your classroom data...', 'success')
      void fetchClassroomData()
    } else {
      connected = false
      setBanner(data.payload?.error || 'Authorization failed.', 'warning')
      renderDisconnected()
    }
  }
})

renderDisconnected()
