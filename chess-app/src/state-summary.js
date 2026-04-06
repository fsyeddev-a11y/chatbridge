import { buildHint } from './hints.js'

function formatSide(sideToMove) {
  return sideToMove ? sideToMove.charAt(0).toUpperCase() + sideToMove.slice(1) : 'Unknown'
}

export function buildPositionSummary(state) {
  if (!state) {
    return 'New game. White to move.'
  }

  if (state.status === 'complete') {
    if (state.terminationReason === 'king_captured') {
      return `${formatSide(state.winner)} won by capturing the king.`
    }
    if (state.result === 'draw') {
      return `Game drawn by ${state.terminationReason || 'agreement'}.`
    }
    if (state.winner) {
      return `${formatSide(state.winner)} won by ${state.terminationReason || 'completion'} after ${state.moveCount || 0} moves.`
    }
    return 'Game completed.'
  }

  const moveText = state.moveCount ? `after ${state.moveCount} moves` : 'at the start of the game'
  const checkText = state.check ? ` ${formatSide(state.sideToMove)} is in check.` : ''
  return `${capitalize(state.phase || 'opening')} position ${moveText}. ${formatSide(state.sideToMove)} to move.${checkText}`.trim()
}

export function buildBridgeState(gameState, options = {}) {
  const positionSummary = buildPositionSummary(gameState)
  return {
    ...gameState,
    positionSummary,
    hint: buildHint({
      ...gameState,
      positionSummary,
    }),
    lastError: options.lastError ?? gameState.lastError ?? null,
  }
}

export function buildReadySummary(state) {
  if (state?.moveCount) {
    return `Chess Coach restored a ${state.phase || 'game'} position after ${state.moveCount} moves.`
  }
  return 'Chess Coach is ready. New game loaded.'
}

export function buildCompletionSummary(state) {
  if (state.terminationReason === 'king_captured' && state.winner) {
    return `${capitalize(state.winner)} won by capturing the king.`
  }
  if (state.result === 'draw') {
    return `Game drawn by ${state.terminationReason || 'stalemate'} after ${state.moveCount || 0} moves.`
  }
  if (state.winner) {
    return `${capitalize(state.winner)} won by ${state.terminationReason || 'completion'} after ${state.moveCount || 0} moves.`
  }
  return 'Chess session completed.'
}

export function buildStateUpdateSummary(state) {
  const movePrefix = state.lastMove ? `Last move ${state.lastMove}. ` : ''
  return `${movePrefix}${buildPositionSummary(state)}`
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
