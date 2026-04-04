const WEATHER_CODE_LABELS = {
  0: 'Clear sky',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Frequent rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
}

export function buildGeocodingUrl(locationQuery) {
  const params = new URLSearchParams({
    name: locationQuery,
    count: '1',
    language: 'en',
    format: 'json',
  })
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
}

export function buildForecastUrl({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    forecast_days: '1',
    timezone: 'auto',
  })

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`
}

export function normalizeWeatherResponse(locationName, forecast) {
  const current = forecast?.current
  const daily = forecast?.daily
  if (!current || !daily) {
    throw new Error('Incomplete weather response')
  }

  const conditions = WEATHER_CODE_LABELS[current.weather_code] || `Weather code ${current.weather_code}`
  const highF = daily.temperature_2m_max?.[0]
  const lowF = daily.temperature_2m_min?.[0]

  return {
    summary: `${locationName}: ${Math.round(current.temperature_2m)}F and ${conditions.toLowerCase()}.`,
    state: {
      location: locationName,
      temperatureF: Math.round(current.temperature_2m),
      conditions,
      highF: typeof highF === 'number' ? Math.round(highF) : undefined,
      lowF: typeof lowF === 'number' ? Math.round(lowF) : undefined,
      windMph: typeof current.wind_speed_10m === 'number' ? Math.round(current.wind_speed_10m) : undefined,
    },
  }
}

export function isRecoverableWeatherState(state) {
  return Boolean(
    state &&
      typeof state === 'object' &&
      typeof state.location === 'string' &&
      typeof state.conditions === 'string' &&
      typeof state.temperatureF === 'number'
  )
}

export function buildRecoveredWeatherSummary(state) {
  if (!isRecoverableWeatherState(state)) {
    return null
  }

  return `Restored last weather lookup for ${state.location}.`
}

export async function lookupWeather(locationQuery) {
  const geocodingResponse = await fetch(buildGeocodingUrl(locationQuery))
  if (!geocodingResponse.ok) {
    throw new Error(`Geocoding failed: ${geocodingResponse.status}`)
  }

  const geocoding = await geocodingResponse.json()
  const place = geocoding?.results?.[0]
  if (!place) {
    throw new Error('Location not found')
  }

  const forecastResponse = await fetch(
    buildForecastUrl({
      latitude: place.latitude,
      longitude: place.longitude,
    })
  )
  if (!forecastResponse.ok) {
    throw new Error(`Forecast failed: ${forecastResponse.status}`)
  }

  const forecast = await forecastResponse.json()
  const locationName = [place.name, place.admin1, place.country].filter(Boolean).join(', ')

  return normalizeWeatherResponse(locationName, forecast)
}
