function countPieces(board, color, predicate) {
  return board.filter((piece) => piece && (color ? (color === 'white' ? piece === piece.toUpperCase() : piece === piece.toLowerCase()) : true) && predicate(piece)).length
}

export function buildHint(state) {
  if (!state || typeof state !== 'object') {
    return 'Develop your pieces and look for safe moves.'
  }

  const moveCount = typeof state.moveCount === 'number' ? state.moveCount : 0
  const phase = state.phase || 'opening'
  const sideToMove = state.sideToMove || 'white'
  const check = Boolean(state.check)
  const capturedWhite = Array.isArray(state.capturedWhite) ? state.capturedWhite.length : 0
  const capturedBlack = Array.isArray(state.capturedBlack) ? state.capturedBlack.length : 0

  if (check) {
    return `${capitalize(sideToMove)} is in check. Start by finding legal escapes that keep the king safe.`
  }

  if (phase === 'opening') {
    if (moveCount < 2) {
      return 'Fight for the center with a pawn or knight, then develop your minor pieces.'
    }
    if (moveCount < 8) {
      return 'Keep developing and avoid moving the same piece repeatedly unless it wins material or prevents a threat.'
    }
    return 'Check whether your king is ready to castle and whether your least-developed piece can improve.'
  }

  if (phase === 'middlegame') {
    if (capturedWhite !== capturedBlack) {
      const ahead = capturedWhite > capturedBlack ? 'white' : 'black'
      if (ahead === sideToMove) {
        return 'You are ahead in material. Simplify safely and avoid tactical blunders.'
      }
      return 'You are down material. Look for active piece play, tactics, and chances to create threats.'
    }
    return 'Look for checks, captures, and threats, then compare your opponent’s best reply before committing.'
  }

  return 'In the endgame, activate your king, improve pawn structure, and push any passed pawn carefully.'
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function buildBoardFacts(state) {
  const moveCount = typeof state.moveCount === 'number' ? state.moveCount : 0
  const lastMove = state.lastMove || 'none'
  const sideToMove = state.sideToMove || 'white'
  const phase = state.phase || 'opening'

  return {
    moveCount,
    lastMove,
    sideToMove,
    phase,
    hint: buildHint(state),
  }
}
