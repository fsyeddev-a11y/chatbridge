import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildForecastUrl,
  buildGeocodingUrl,
  buildRecoveredWeatherSummary,
  isRecoverableWeatherState,
  normalizeWeatherResponse,
} from '../src/weather.js'

describe('weather-app weather helpers', () => {
  it('builds the expected Open-Meteo geocoding and forecast URLs', () => {
    assert.match(buildGeocodingUrl('Chicago'), /geocoding-api\.open-meteo\.com/)
    assert.match(buildGeocodingUrl('Chicago'), /name=Chicago/)

    const forecastUrl = buildForecastUrl({
      latitude: 41.88,
      longitude: -87.63,
    })

    assert.match(forecastUrl, /api\.open-meteo\.com/)
    assert.match(forecastUrl, /latitude=41.88/)
    assert.match(forecastUrl, /longitude=-87.63/)
    assert.match(forecastUrl, /temperature_unit=fahrenheit/)
  })

  it('normalizes forecast payloads into Bridge-safe state', () => {
    const normalized = normalizeWeatherResponse('Chicago, Illinois, United States', {
      current: {
        temperature_2m: 72.4,
        weather_code: 1,
        wind_speed_10m: 10.2,
      },
      daily: {
        temperature_2m_max: [75.1],
        temperature_2m_min: [58.4],
      },
    })

    assert.equal(normalized.summary, 'Chicago, Illinois, United States: 72F and mostly clear.')
    assert.deepEqual(normalized.state, {
      location: 'Chicago, Illinois, United States',
      temperatureF: 72,
      conditions: 'Mostly clear',
      highF: 75,
      lowF: 58,
      windMph: 10,
    })
  })

  it('recognizes recoverable persisted weather state', () => {
    assert.equal(
      isRecoverableWeatherState({
        location: 'Austin, Texas, United States',
        temperatureF: 81,
        conditions: 'Clear sky',
      }),
      true
    )

    assert.equal(
      isRecoverableWeatherState({
        location: 'Austin',
      }),
      false
    )

    assert.equal(
      buildRecoveredWeatherSummary({
        location: 'Austin, Texas, United States',
        temperatureF: 81,
        conditions: 'Clear sky',
      }),
      'Restored last weather lookup for Austin, Texas, United States.'
    )
  })
})
