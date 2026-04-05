// 在 webpack.config.base.ts 的 webpack.EnvironmentPlugin 中注册的变量，
// 在编译时 webpack 会根据环境变量替换掉 process.env.XXX

export const CHATBOX_BUILD_TARGET = (process.env.CHATBOX_BUILD_TARGET || 'unknown') as 'unknown' | 'mobile_app'
export const CHATBOX_BUILD_PLATFORM = (process.env.CHATBOX_BUILD_PLATFORM || 'unknown') as
  | 'unknown'
  | 'ios'
  | 'android'
  | 'web'

// api.chatboxai.app
export const USE_LOCAL_API = process.env.USE_LOCAL_API || ''
export const USE_BETA_API = process.env.USE_BETA_API || ''

// chatboxai.app
export const USE_LOCAL_CHATBOX = process.env.USE_LOCAL_CHATBOX || ''
export const USE_BETA_CHATBOX = process.env.USE_BETA_CHATBOX || ''

export const NODE_ENV = process.env.NODE_ENV || 'development'

export const DISABLE_CHATBOX_CLOUD =
  process.env.CHATBRIDGE_DISABLE_CHATBOX_CLOUD === 'true' ||
  (process.env.CHATBRIDGE_DISABLE_CHATBOX_CLOUD !== 'false' && CHATBOX_BUILD_PLATFORM === 'web')

export const USE_CHATBRIDGE_BACKEND_CHAT =
  CHATBOX_BUILD_PLATFORM === 'web' && Boolean(process.env.CHATBRIDGE_API_ORIGIN)

export const USE_CHATBRIDGE_BACKEND_SESSIONS = USE_CHATBRIDGE_BACKEND_CHAT
