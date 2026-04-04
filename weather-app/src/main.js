import { createBridge } from './bridge.js'
import { buildRecoveredWeatherSummary, isRecoverableWeatherState, lookupWeather } from './weather.js'

const appId = 'weather'

const bridgeStatus = document.getElementById('bridge-status')
const currentLocation = document.getElementById('current-location')
const weatherForm = document.getElementById('weather-form')
const locationInput = document.getElementById('location-input')
const messageBanner = document.getElementById('message-banner')
const forecastCard = document.getElementById('forecast-card')
const conditionText = document.getElementById('condition-text')
const temperatureText = document.getElementById('temperature-text')
const highText = document.getElementById('high-text')
const lowText = document.getElementById('low-text')
const windText = document.getElementById('wind-text')
const completeButton = document.getElementById('complete-btn')

let latestState

function setBanner(message, type = 'info') {
  if (!message) {
    messageBanner.textContent = ''
    messageBanner.className = 'message-banner hidden'
    return
  }

  messageBanner.textContent = message
  messageBanner.className = `message-banner${type === 'warning' ? ' warning' : ''}`
}

function renderForecast(state) {
  currentLocation.textContent = state.location
  conditionText.textContent = state.conditions
  temperatureText.textContent = `${state.temperatureF}F`
  highText.textContent = state.highF !== undefined ? `${state.highF}F` : 'N/A'
  lowText.textContent = state.lowF !== undefined ? `${state.lowF}F` : 'N/A'
  windText.textContent = state.windMph !== undefined ? `${state.windMph} mph` : 'N/A'
  forecastCard.classList.remove('hidden')
}

const bridge = createBridge({
  appId,
  onInit(payload) {
    bridgeStatus.textContent = `INIT received for ${payload?.classId || 'unknown class'}`
    if (isRecoverableWeatherState(payload?.previousState)) {
      latestState = payload.previousState
      locationInput.value = payload.previousState.location
      renderForecast(payload.previousState)
      setBanner(buildRecoveredWeatherSummary(payload.previousState))
      bridge.sendReady(`Weather Dashboard restored ${payload.previousState.location}.`)
      return
    }

    bridge.sendReady('Weather Dashboard is ready to look up locations.')
  },
  onPing() {
    bridgeStatus.textContent = 'TutorMeAI heartbeat check received.'
  },
  onTerminate(payload) {
    bridgeStatus.textContent = `Session ended by TutorMeAI (${payload?.reason || 'terminated'}).`
    setBanner('TutorMeAI ended this weather session.', 'warning')
  },
})

weatherForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const locationQuery = locationInput.value.trim()
  if (!locationQuery) {
    return
  }

  bridgeStatus.textContent = 'Looking up live weather...'
  setBanner('Fetching live weather from Open-Meteo...')
  locationInput.disabled = true

  try {
    const result = await lookupWeather(locationQuery)
    latestState = result.state
    renderForecast(result.state)
    bridge.sendStateUpdate(result.summary, result.state)
    bridgeStatus.textContent = 'Weather lookup sent to TutorMeAI.'
    setBanner(result.summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Weather lookup failed'
    bridge.sendError(message)
    bridgeStatus.textContent = 'Lookup failed.'
    setBanner(message, 'warning')
  } finally {
    locationInput.disabled = false
  }
})

completeButton.addEventListener('click', () => {
  if (!latestState) {
    return
  }

  bridge.sendComplete(`Weather lookup completed for ${latestState.location}.`, latestState)
  bridgeStatus.textContent = 'Completion event sent to TutorMeAI.'
  setBanner(`Completed weather lookup for ${latestState.location}.`)
})

window.addEventListener('beforeunload', () => {
  bridge.destroy()
})
