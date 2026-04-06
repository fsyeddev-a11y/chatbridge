import { StockfishAI, getAILevelConfig } from './ai.js'
import { createBridge } from './bridge.js'
import {
  algebraicToSquare,
  canSelectSquare,
  createInitialGame,
  getGameResult,
  getLegalDestinations,
  getPieceAt,
  getSerializableState,
  INITIAL_FEN,
  makeMove,
  pieceToSymbol,
  restoreGameFromState,
  squareToAlgebraic,
} from './chess.js'
import { buildBoardFacts } from './hints.js'
import {
  buildBridgeState,
  buildCompletionSummary,
  buildPositionSummary,
  buildReadySummary,
  buildStateUpdateSummary,
} from './state-summary.js'

const appId = 'chess'
const boardElement = document.getElementById('board')
const bridgeStatus = document.getElementById('bridge-status')
const gameStatus = document.getElementById('game-status')
const turnIndicator = document.getElementById('turn-indicator')
const sideToMoveText = document.getElementById('side-to-move')
const phaseText = document.getElementById('phase-text')
const lastMoveText = document.getElementById('last-move')
const positionSummaryText = document.getElementById('position-summary')
const capturedWhiteText = document.getElementById('captured-white')
const capturedBlackText = document.getElementById('captured-black')
const moveHistoryList = document.getElementById('move-history')
const messageBanner = document.getElementById('message-banner')
const opponentSelect = document.getElementById('opponent-select')
const opponentStatus = document.getElementById('opponent-status')
const newGameButton = document.getElementById('new-game-btn')
const resignButton = document.getElementById('resign-btn')
const endSessionButton = document.getElementById('end-session-btn')

let game = createInitialGame()
let selectedSquare = null
let legalDestinations = []
let terminated = false
let opponentMode = 'easy'
let aiThinking = false
const humanColor = 'white'
const ai = new StockfishAI()
let latestBridgeState = buildBridgeState(getSerializableState(game, buildStateOptions()))

function buildStateOptions(overrides = {}) {
  return {
    playerColor: humanColor,
    opponentMode,
    aiThinking,
    ...overrides,
  }
}

function isAIEnabled() {
  return opponentMode !== 'human'
}

function isHumanTurn() {
  return latestBridgeState.sideToMove === humanColor
}

function setBanner(message, type = 'info') {
  messageBanner.textContent = message || ''
  messageBanner.className = `message-banner${type === 'warning' ? ' warning' : ''}`
}

function renderBoard() {
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < 64; index += 1) {
    const square = document.createElement('button')
    const file = index % 8
    const rank = Math.floor(index / 8)
    const algebraic = squareToAlgebraic(index)
    const piece = getPieceAt(game, index)
    const light = (file + rank) % 2 === 0

    square.type = 'button'
    square.className = `square ${light ? 'light' : 'dark'}`
    if (selectedSquare === index) {
      square.classList.add('selected')
    }
    if (legalDestinations.includes(index)) {
      square.classList.add('legal')
    }
    square.dataset.square = algebraic
    square.setAttribute('aria-label', `${algebraic}${piece ? ` ${piece}` : ''}`)

    const pieceNode = document.createElement('span')
    pieceNode.className = `piece ${piece && piece === piece.toUpperCase() ? 'white' : 'black'}`
    pieceNode.textContent = pieceToSymbol(piece)

    const coordinate = document.createElement('span')
    coordinate.className = 'coordinates'
    coordinate.textContent = algebraic

    square.append(pieceNode, coordinate)
    square.addEventListener('click', () => {
      handleSquareClick(index)
    })
    fragment.append(square)
  }

  boardElement.replaceChildren(fragment)
}

function renderSidebar() {
  const state = latestBridgeState
  const boardFacts = buildBoardFacts(state)

  sideToMoveText.textContent = boardFacts.sideToMove === 'white' ? 'White' : 'Black'
  if (state.status === 'complete') {
    turnIndicator.textContent = buildCompletionSummary(state)
    turnIndicator.className = 'turn-indicator complete'
  } else if (aiThinking) {
    turnIndicator.textContent = `${capitalize(state.sideToMove)} thinking...`
    turnIndicator.className = `turn-indicator ${state.sideToMove === 'white' ? 'white' : 'black'}`
  } else {
    turnIndicator.textContent = `${boardFacts.sideToMove === 'white' ? 'White' : 'Black'} to move`
    turnIndicator.className = `turn-indicator ${boardFacts.sideToMove === 'white' ? 'white' : 'black'}`
  }
  phaseText.textContent = capitalize(boardFacts.phase)
  lastMoveText.textContent = boardFacts.lastMove === 'none' ? 'None' : boardFacts.lastMove
  positionSummaryText.textContent = `${state.positionSummary} ${boardFacts.hint}`.trim()
  capturedWhiteText.textContent = state.capturedWhite?.length ? state.capturedWhite.join(', ') : 'None'
  capturedBlackText.textContent = state.capturedBlack?.length ? state.capturedBlack.join(', ') : 'None'
  gameStatus.textContent = state.status === 'complete' ? buildCompletionSummary(state) : buildPositionSummary(state)
  opponentSelect.value = opponentMode
  opponentSelect.disabled = aiThinking
  if (isAIEnabled()) {
    opponentStatus.textContent = `${getAILevelConfig(opponentMode).label} is playing Black. TutorMeAI can still coach from the current board state.`
  } else {
    opponentStatus.textContent = 'Play locally against another human, or choose an AI opponent.'
  }

  const historyItems = state.moveHistory || []
  moveHistoryList.replaceChildren()
  for (const move of historyItems) {
    const item = document.createElement('li')
    item.textContent = `${move.index}. ${move.uci}`
    moveHistoryList.append(item)
  }
}

function render() {
  renderBoard()
  renderSidebar()
  const disabled = terminated || latestBridgeState.status === 'complete' || aiThinking
  newGameButton.disabled = terminated
  resignButton.disabled = disabled
  endSessionButton.disabled = terminated
}

function syncBridgeState(options = {}) {
  const mergedOptions = buildStateOptions(options)
  latestBridgeState = buildBridgeState(getSerializableState(game, mergedOptions), mergedOptions)
  render()
}

function startFreshGame(message = 'New game started.') {
  game = createInitialGame()
  selectedSquare = null
  legalDestinations = []
  aiThinking = false
  syncBridgeState({ lastError: null })
  setBanner(message)
  bridgeStatus.textContent = 'Game state updated for TutorMeAI.'
  bridge.sendStateUpdate(buildStateUpdateSummary(latestBridgeState), latestBridgeState)
  void maybeTriggerAIMove()
}

function finalizeCompletedGame() {
  aiThinking = false
  syncBridgeState({ lastError: null })
  const completion = buildCompletionSummary(latestBridgeState)
  bridge.sendComplete(completion, latestBridgeState)
  bridgeStatus.textContent = 'Completion event sent to TutorMeAI.'
  setBanner(completion)
}

async function maybeTriggerAIMove() {
  if (!isAIEnabled() || terminated || latestBridgeState.status === 'complete' || isHumanTurn()) {
    return
  }

  const gameResult = getGameResult(game)
  if (gameResult.status === 'complete') {
    finalizeCompletedGame()
    return
  }

  aiThinking = true
  syncBridgeState({ lastError: null })
  setBanner(`${getAILevelConfig(opponentMode).label} is thinking...`)
  bridgeStatus.textContent = 'AI opponent is choosing a move.'

  try {
    const bestMove = await ai.requestMove(latestBridgeState.fen, opponentMode)
    if (!bestMove || bestMove === '(none)') {
      finalizeCompletedGame()
      return
    }

    const from = algebraicToSquare(bestMove.slice(0, 2))
    const to = algebraicToSquare(bestMove.slice(2, 4))
    const promotion = bestMove.length > 4 ? bestMove[4] : 'q'
    const result = makeMove(game, from, to, promotion)

    aiThinking = false
    if (!result.ok) {
      syncBridgeState({ lastError: `AI move failed: ${result.error}` })
      setBanner(`AI move failed: ${result.error}`, 'warning')
      return
    }

    game = result.game
    selectedSquare = null
    legalDestinations = []
    syncBridgeState({ lastError: null })
    const summary = `${getAILevelConfig(opponentMode).label} played ${latestBridgeState.lastMove}. ${buildPositionSummary(latestBridgeState)}`
    setBanner(summary)
    bridgeStatus.textContent = 'AI move sent to TutorMeAI.'
    bridge.sendStateUpdate(summary, latestBridgeState)

    if (latestBridgeState.status === 'complete') {
      finalizeCompletedGame()
    }
  } catch (error) {
    aiThinking = false
    const message = error instanceof Error ? error.message : 'The AI engine failed to respond.'
    syncBridgeState({ lastError: message })
    setBanner(message, 'warning')
  }
}

function handleSquareClick(index) {
  if (terminated || latestBridgeState.status === 'complete') {
    return
  }
  if (aiThinking) {
    setBanner(`${getAILevelConfig(opponentMode).label} is thinking...`, 'warning')
    return
  }
  if (isAIEnabled() && !isHumanTurn()) {
    setBanner(`Wait for ${getAILevelConfig(opponentMode).label} to move.`, 'warning')
    return
  }

  if (selectedSquare === null) {
    if (!canSelectSquare(game, index)) {
      setBanner('Select one of the pieces whose turn it is.', 'warning')
      return
    }
    selectedSquare = index
    legalDestinations = getLegalDestinations(game, index)
    setBanner(`Selected ${squareToAlgebraic(index)}. Choose a legal destination.`)
    renderBoard()
    return
  }

  if (selectedSquare === index) {
    selectedSquare = null
    legalDestinations = []
    setBanner('')
    renderBoard()
    return
  }

  if (canSelectSquare(game, index)) {
    selectedSquare = index
    legalDestinations = getLegalDestinations(game, index)
    setBanner(`Selected ${squareToAlgebraic(index)}. Choose a legal destination.`)
    renderBoard()
    return
  }

  const result = makeMove(game, selectedSquare, index)
  if (!result.ok) {
    syncBridgeState({ lastError: result.error })
    setBanner(result.error, 'warning')
    return
  }

  game = result.game
  selectedSquare = null
  legalDestinations = []
  syncBridgeState({ lastError: null })
  setBanner(buildStateUpdateSummary(latestBridgeState))
  bridgeStatus.textContent = 'Move sent to TutorMeAI.'
  bridge.sendStateUpdate(buildStateUpdateSummary(latestBridgeState), latestBridgeState)

  if (latestBridgeState.status === 'complete') {
    bridge.sendComplete(buildCompletionSummary(latestBridgeState), latestBridgeState)
    bridgeStatus.textContent = 'Completion event sent to TutorMeAI.'
    setBanner(buildCompletionSummary(latestBridgeState))
    return
  }

  void maybeTriggerAIMove()
}

function finishGame(reason) {
  if (terminated) {
    return
  }

  aiThinking = false
  latestBridgeState = {
    ...buildBridgeState(getSerializableState(game, buildStateOptions())),
    status: 'complete',
    result: reason === 'resign' ? (game.turn === 'w' ? 'black_win' : 'white_win') : latestBridgeState.result,
    winner: reason === 'resign' ? (game.turn === 'w' ? 'black' : 'white') : latestBridgeState.winner,
    terminationReason: reason,
  }
  latestBridgeState.positionSummary = buildPositionSummary(latestBridgeState)
  render()
  const summary = buildCompletionSummary(latestBridgeState)
  setBanner(summary)
  bridgeStatus.textContent = 'Completion event sent to TutorMeAI.'
  bridge.sendComplete(summary, latestBridgeState)
}

function restoreFromState(previousState) {
  if (!previousState) {
    game = createInitialGame()
    opponentMode = 'easy'
    aiThinking = false
    return false
  }
  opponentMode = 'easy'
  aiThinking = false
  game = restoreGameFromState(previousState)
  return true
}

const bridge = createBridge({
  appId,
  onInit(payload) {
    terminated = false
    bridgeStatus.textContent = `INIT received for ${payload?.classId || 'unknown class'}.`
    try {
      const restored = restoreFromState(payload?.previousState)
      selectedSquare = null
      legalDestinations = []
      syncBridgeState({ lastError: null })
      const summary = buildReadySummary(latestBridgeState)
      setBanner(restored ? 'Recovered previous chess position.' : 'Ready to start a new chess game.')
      bridge.sendReady(summary)
      if (restored) {
        bridge.sendStateUpdate(buildStateUpdateSummary(latestBridgeState), latestBridgeState)
      }
      void maybeTriggerAIMove()
    } catch (error) {
      game = createInitialGame()
      opponentMode = 'easy'
      aiThinking = false
      syncBridgeState({ lastError: null })
      const message = error instanceof Error ? error.message : 'Failed to restore chess state.'
      setBanner(message, 'warning')
      bridge.sendError(message)
    }
  },
  onPing() {
    bridgeStatus.textContent = 'TutorMeAI heartbeat check received.'
  },
  onTerminate(payload) {
    terminated = true
    aiThinking = false
    bridgeStatus.textContent = `Session ended by TutorMeAI (${payload?.reason || 'terminated'}).`
    setBanner('TutorMeAI ended this chess session.', 'warning')
    render()
  },
})

newGameButton.addEventListener('click', () => {
  if (terminated) {
    return
  }
  startFreshGame('Started a fresh chess game.')
})

resignButton.addEventListener('click', () => {
  if (latestBridgeState.status === 'complete') {
    return
  }
  finishGame('resign')
})

endSessionButton.addEventListener('click', () => {
  finishGame('ended_by_user')
})

window.addEventListener('beforeunload', () => {
  ai.destroy()
  bridge.destroy()
})

syncBridgeState({ lastError: null })
render()

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
