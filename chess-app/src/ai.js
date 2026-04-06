const AI_LEVELS = {
  easy: {
    skill: 0,
    depth: 4,
    moveTime: 120,
    label: 'Easy AI',
  },
  medium: {
    skill: 6,
    depth: 8,
    moveTime: 260,
    label: 'Medium AI',
  },
  hard: {
    skill: 12,
    depth: 12,
    moveTime: 450,
    label: 'Hard AI',
  },
}

function createEngineUrl() {
  return new URL('../node_modules/stockfish/bin/stockfish-18-asm.js', import.meta.url)
}

export function getAILevelConfig(level) {
  return AI_LEVELS[level] || AI_LEVELS.easy
}

export class StockfishAI {
  constructor() {
    this.worker = null
    this.ready = false
    this.uciReady = false
    this.pendingResolver = null
    this.pendingRejector = null
    this.pendingCommand = null
    this.initPromise = null
    this.pendingTimer = null
  }

  ensureWorker() {
    if (this.worker) {
      return
    }

    this.worker = new Worker(createEngineUrl())
    this.worker.addEventListener('message', (event) => {
      const line = typeof event.data === 'string' ? event.data.trim() : ''
      if (!line) {
        return
      }

      if (line === 'uciok') {
        this.uciReady = true
        this.worker.postMessage('isready')
        return
      }

      if (line === 'readyok') {
        this.ready = true
        if (this.pendingCommand === 'init') {
          this.clearPendingTimer()
          this.pendingCommand = null
          this.pendingResolver?.()
          this.pendingResolver = null
          this.pendingRejector = null
        }
        return
      }

      if (line.startsWith('bestmove')) {
        const parts = line.split(/\s+/)
        const move = parts[1]
        if (this.pendingCommand === 'move') {
          this.clearPendingTimer()
          this.pendingCommand = null
          this.pendingResolver?.(move)
          this.pendingResolver = null
          this.pendingRejector = null
        }
      }
    })

    this.worker.addEventListener('error', (error) => {
      this.clearPendingTimer()
      if (this.pendingRejector) {
        this.pendingRejector(error)
      }
      this.pendingCommand = null
      this.pendingResolver = null
      this.pendingRejector = null
    })
  }

  async initialize() {
    if (this.ready) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }

    this.ensureWorker()
    this.initPromise = new Promise((resolve, reject) => {
      this.pendingCommand = 'init'
      this.pendingResolver = resolve
      this.pendingRejector = reject
      this.worker.postMessage('uci')
    })

    return this.initPromise
  }

  async requestMove(fen, level) {
    await this.initialize()
    const config = getAILevelConfig(level)

    return new Promise((resolve, reject) => {
      this.pendingCommand = 'move'
      this.pendingResolver = resolve
      this.pendingRejector = reject
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null
        this.pendingCommand = null
        this.pendingResolver = null
        this.pendingRejector = null
        reject(new Error('The AI engine timed out while choosing a move.'))
      }, Math.max(4000, config.moveTime * 10))

      this.worker.postMessage('stop')
      this.worker.postMessage('ucinewgame')
      this.worker.postMessage(`setoption name Skill Level value ${config.skill}`)
      this.worker.postMessage(`position fen ${fen}`)
      this.worker.postMessage(`go movetime ${config.moveTime}`)
    })
  }

  clearPendingTimer() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
  }

  destroy() {
    if (!this.worker) {
      return
    }
    this.clearPendingTimer()
    try {
      this.worker.postMessage('quit')
      this.worker.terminate()
    } catch {
      // ignore teardown errors from the engine worker
    }
    this.worker = null
    this.ready = false
    this.uciReady = false
    this.pendingResolver = null
    this.pendingRejector = null
    this.pendingCommand = null
    this.initPromise = null
  }
}
