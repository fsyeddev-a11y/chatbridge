const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const EMPTY = null
const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

export const INITIAL_FEN = START_FEN

function cloneBoard(board) {
  return board.slice()
}

function cloneGame(game) {
  return {
    board: cloneBoard(game.board),
    turn: game.turn,
    castling: game.castling,
    enPassant: game.enPassant,
    halfmoveClock: game.halfmoveClock,
    fullmoveNumber: game.fullmoveNumber,
    history: game.history.map((entry) => ({ ...entry })),
  }
}

function colorOf(piece) {
  if (!piece) {
    return null
  }
  return piece === piece.toUpperCase() ? 'w' : 'b'
}

function typeOf(piece) {
  return piece ? piece.toLowerCase() : null
}

function fileOf(index) {
  return index % 8
}

function rankOf(index) {
  return Math.floor(index / 8)
}

function insideBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8
}

function toIndex(file, rank) {
  return rank * 8 + file
}

export function squareToAlgebraic(index) {
  return `${FILES[fileOf(index)]}${8 - rankOf(index)}`
}

export function algebraicToSquare(square) {
  if (typeof square !== 'string' || !/^[a-h][1-8]$/.test(square)) {
    return null
  }

  const file = FILES.indexOf(square[0])
  const rank = 8 - Number(square[1])
  return toIndex(file, rank)
}

export function parseFEN(fen) {
  if (typeof fen !== 'string') {
    throw new Error('FEN must be a string')
  }

  const [boardPart, turnPart, castlingPart = '-', enPassantPart = '-', halfmovePart = '0', fullmovePart = '1'] = fen
    .trim()
    .split(/\s+/)

  if (!boardPart || !turnPart) {
    throw new Error('Invalid FEN')
  }

  const ranks = boardPart.split('/')
  if (ranks.length !== 8) {
    throw new Error('FEN must contain 8 ranks')
  }

  const board = []
  for (const rankText of ranks) {
    let file = 0
    for (const char of rankText) {
      if (/\d/.test(char)) {
        file += Number(char)
      } else if (/[prnbqkPRNBQK]/.test(char)) {
        board.push(char)
        file += 1
      } else {
        throw new Error('Invalid FEN piece data')
      }
    }
    if (file !== 8) {
      throw new Error('Each FEN rank must contain 8 files')
    }
    while (board.length % 8 !== 0) {
      board.push(EMPTY)
    }
  }

  const normalizedBoard = []
  let pointer = 0
  for (const rankText of ranks) {
    for (const char of rankText) {
      if (/\d/.test(char)) {
        for (let i = 0; i < Number(char); i += 1) {
          normalizedBoard.push(EMPTY)
        }
      } else {
        normalizedBoard.push(char)
      }
      pointer += 1
    }
  }

  if (normalizedBoard.length !== 64) {
    throw new Error('FEN board must produce 64 squares')
  }

  const turn = turnPart === 'w' || turnPart === 'b' ? turnPart : null
  if (!turn) {
    throw new Error('Invalid FEN turn')
  }

  const castling = castlingPart === '-' ? '' : castlingPart
  const enPassant = enPassantPart === '-' ? null : enPassantPart
  const halfmoveClock = Number(halfmovePart)
  const fullmoveNumber = Number(fullmovePart)

  if (!Number.isInteger(halfmoveClock) || !Number.isInteger(fullmoveNumber)) {
    throw new Error('Invalid FEN clocks')
  }

  return {
    board: normalizedBoard,
    turn,
    castling,
    enPassant,
    halfmoveClock,
    fullmoveNumber,
    history: [],
  }
}

export function serializeFEN(game) {
  const ranks = []
  for (let rank = 0; rank < 8; rank += 1) {
    let rankText = ''
    let emptyCount = 0
    for (let file = 0; file < 8; file += 1) {
      const piece = game.board[toIndex(file, rank)]
      if (!piece) {
        emptyCount += 1
      } else {
        if (emptyCount) {
          rankText += String(emptyCount)
          emptyCount = 0
        }
        rankText += piece
      }
    }
    if (emptyCount) {
      rankText += String(emptyCount)
    }
    ranks.push(rankText)
  }

  return [
    ranks.join('/'),
    game.turn,
    game.castling || '-',
    game.enPassant || '-',
    String(game.halfmoveClock),
    String(game.fullmoveNumber),
  ].join(' ')
}

export function createInitialGame() {
  return parseFEN(START_FEN)
}

function slidingMoves(game, index, deltas, color) {
  const moves = []
  for (const [df, dr] of deltas) {
    let file = fileOf(index) + df
    let rank = rankOf(index) + dr
    while (insideBoard(file, rank)) {
      const target = toIndex(file, rank)
      const occupant = game.board[target]
      if (!occupant) {
        moves.push({ from: index, to: target })
      } else {
        if (colorOf(occupant) !== color) {
          moves.push({ from: index, to: target, captured: occupant })
        }
        break
      }
      file += df
      rank += dr
    }
  }
  return moves
}

export function findKing(game, color) {
  const kingPiece = color === 'w' ? 'K' : 'k'
  return game.board.findIndex((piece) => piece === kingPiece)
}

export function isSquareAttacked(game, square, byColor) {
  const file = fileOf(square)
  const rank = rankOf(square)
  const pawnDirections = byColor === 'w' ? [[-1, -1], [1, -1]] : [[-1, 1], [1, 1]]
  for (const [df, dr] of pawnDirections) {
    const nextFile = file + df
    const nextRank = rank + dr
    if (!insideBoard(nextFile, nextRank)) {
      continue
    }
    const piece = game.board[toIndex(nextFile, nextRank)]
    if (piece && colorOf(piece) === byColor && typeOf(piece) === 'p') {
      return true
    }
  }

  const knightOffsets = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ]
  for (const [df, dr] of knightOffsets) {
    const nextFile = file + df
    const nextRank = rank + dr
    if (!insideBoard(nextFile, nextRank)) {
      continue
    }
    const piece = game.board[toIndex(nextFile, nextRank)]
    if (piece && colorOf(piece) === byColor && typeOf(piece) === 'n') {
      return true
    }
  }

  const bishopLike = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]
  const rookLike = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  for (const [df, dr] of bishopLike) {
    let nextFile = file + df
    let nextRank = rank + dr
    while (insideBoard(nextFile, nextRank)) {
      const piece = game.board[toIndex(nextFile, nextRank)]
      if (piece) {
        if (colorOf(piece) === byColor) {
          const type = typeOf(piece)
          if (type === 'b' || type === 'q') {
            return true
          }
          if (Math.abs(nextFile - file) === 1 && Math.abs(nextRank - rank) === 1 && type === 'k') {
            return true
          }
        }
        break
      }
      nextFile += df
      nextRank += dr
    }
  }

  for (const [df, dr] of rookLike) {
    let nextFile = file + df
    let nextRank = rank + dr
    while (insideBoard(nextFile, nextRank)) {
      const piece = game.board[toIndex(nextFile, nextRank)]
      if (piece) {
        if (colorOf(piece) === byColor) {
          const type = typeOf(piece)
          if (type === 'r' || type === 'q') {
            return true
          }
          if (Math.abs(nextFile - file) + Math.abs(nextRank - rank) === 1 && type === 'k') {
            return true
          }
        }
        break
      }
      nextFile += df
      nextRank += dr
    }
  }

  return false
}

export function isInCheck(game, color = game.turn) {
  const kingSquare = findKing(game, color)
  if (kingSquare < 0) {
    return false
  }
  return isSquareAttacked(game, kingSquare, color === 'w' ? 'b' : 'w')
}

function generatePseudoLegalMoves(game, fromSquare) {
  const moves = []
  for (let index = 0; index < 64; index += 1) {
    if (fromSquare !== undefined && index !== fromSquare) {
      continue
    }
    const piece = game.board[index]
    if (!piece || colorOf(piece) !== game.turn) {
      continue
    }

    const type = typeOf(piece)
    const file = fileOf(index)
    const rank = rankOf(index)

    if (type === 'p') {
      const forward = game.turn === 'w' ? -1 : 1
      const startRank = game.turn === 'w' ? 6 : 1
      const promotionRank = game.turn === 'w' ? 0 : 7

      const oneForwardRank = rank + forward
      if (insideBoard(file, oneForwardRank)) {
        const oneForwardIndex = toIndex(file, oneForwardRank)
        if (!game.board[oneForwardIndex]) {
          if (oneForwardRank === promotionRank) {
            for (const promotion of ['q', 'r', 'b', 'n']) {
              moves.push({ from: index, to: oneForwardIndex, promotion })
            }
          } else {
            moves.push({ from: index, to: oneForwardIndex })
          }

          const twoForwardRank = rank + forward * 2
          const twoForwardIndex = insideBoard(file, twoForwardRank) ? toIndex(file, twoForwardRank) : null
          if (rank === startRank && twoForwardIndex !== null && !game.board[twoForwardIndex]) {
            moves.push({ from: index, to: twoForwardIndex, isDoublePawnPush: true })
          }
        }
      }

      for (const deltaFile of [-1, 1]) {
        const captureFile = file + deltaFile
        const captureRank = rank + forward
        if (!insideBoard(captureFile, captureRank)) {
          continue
        }
        const target = toIndex(captureFile, captureRank)
        const occupant = game.board[target]
        if (occupant && colorOf(occupant) !== game.turn) {
          if (captureRank === promotionRank) {
            for (const promotion of ['q', 'r', 'b', 'n']) {
              moves.push({ from: index, to: target, captured: occupant, promotion })
            }
          } else {
            moves.push({ from: index, to: target, captured: occupant })
          }
        }

        if (game.enPassant && squareToAlgebraic(target) === game.enPassant) {
          const capturedPawnSquare = toIndex(captureFile, rank)
          moves.push({
            from: index,
            to: target,
            isEnPassant: true,
            captured: game.board[capturedPawnSquare],
            capturedSquare: capturedPawnSquare,
          })
        }
      }
      continue
    }

    if (type === 'n') {
      const offsets = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ]
      for (const [df, dr] of offsets) {
        const nextFile = file + df
        const nextRank = rank + dr
        if (!insideBoard(nextFile, nextRank)) {
          continue
        }
        const target = toIndex(nextFile, nextRank)
        const occupant = game.board[target]
        if (!occupant || colorOf(occupant) !== game.turn) {
          moves.push({ from: index, to: target, captured: occupant || undefined })
        }
      }
      continue
    }

    if (type === 'b') {
      moves.push(...slidingMoves(game, index, [[-1, -1], [-1, 1], [1, -1], [1, 1]], game.turn))
      continue
    }

    if (type === 'r') {
      moves.push(...slidingMoves(game, index, [[-1, 0], [1, 0], [0, -1], [0, 1]], game.turn))
      continue
    }

    if (type === 'q') {
      moves.push(
        ...slidingMoves(
          game,
          index,
          [
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ],
          game.turn
        )
      )
      continue
    }

    if (type === 'k') {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let df = -1; df <= 1; df += 1) {
          if (df === 0 && dr === 0) {
            continue
          }
          const nextFile = file + df
          const nextRank = rank + dr
          if (!insideBoard(nextFile, nextRank)) {
            continue
          }
          const target = toIndex(nextFile, nextRank)
          const occupant = game.board[target]
          if (!occupant || colorOf(occupant) !== game.turn) {
            moves.push({ from: index, to: target, captured: occupant || undefined })
          }
        }
      }

      const enemy = game.turn === 'w' ? 'b' : 'w'
      if (game.turn === 'w' && rank === 7 && file === 4) {
        if (
          game.castling.includes('K') &&
          !game.board[toIndex(5, 7)] &&
          !game.board[toIndex(6, 7)] &&
          !isSquareAttacked(game, index, enemy) &&
          !isSquareAttacked(game, toIndex(5, 7), enemy) &&
          !isSquareAttacked(game, toIndex(6, 7), enemy)
        ) {
          moves.push({ from: index, to: toIndex(6, 7), isCastle: true, castleSide: 'king' })
        }
        if (
          game.castling.includes('Q') &&
          !game.board[toIndex(3, 7)] &&
          !game.board[toIndex(2, 7)] &&
          !game.board[toIndex(1, 7)] &&
          !isSquareAttacked(game, index, enemy) &&
          !isSquareAttacked(game, toIndex(3, 7), enemy) &&
          !isSquareAttacked(game, toIndex(2, 7), enemy)
        ) {
          moves.push({ from: index, to: toIndex(2, 7), isCastle: true, castleSide: 'queen' })
        }
      }
      if (game.turn === 'b' && rank === 0 && file === 4) {
        if (
          game.castling.includes('k') &&
          !game.board[toIndex(5, 0)] &&
          !game.board[toIndex(6, 0)] &&
          !isSquareAttacked(game, index, enemy) &&
          !isSquareAttacked(game, toIndex(5, 0), enemy) &&
          !isSquareAttacked(game, toIndex(6, 0), enemy)
        ) {
          moves.push({ from: index, to: toIndex(6, 0), isCastle: true, castleSide: 'king' })
        }
        if (
          game.castling.includes('q') &&
          !game.board[toIndex(3, 0)] &&
          !game.board[toIndex(2, 0)] &&
          !game.board[toIndex(1, 0)] &&
          !isSquareAttacked(game, index, enemy) &&
          !isSquareAttacked(game, toIndex(3, 0), enemy) &&
          !isSquareAttacked(game, toIndex(2, 0), enemy)
        ) {
          moves.push({ from: index, to: toIndex(2, 0), isCastle: true, castleSide: 'queen' })
        }
      }
    }
  }

  return moves
}

function removeCastlingRights(castling, rights) {
  return castling
    .split('')
    .filter((item) => !rights.includes(item))
    .join('')
}

function applyMoveToGame(game, move) {
  const next = cloneGame(game)
  const piece = next.board[move.from]
  const pieceType = typeOf(piece)
  const enemy = game.turn === 'w' ? 'b' : 'w'
  const fromSquare = squareToAlgebraic(move.from)
  const toSquare = squareToAlgebraic(move.to)
  let capturedPiece = move.captured

  next.board[move.from] = EMPTY

  if (move.isEnPassant) {
    next.board[move.capturedSquare] = EMPTY
    capturedPiece = capturedPiece || (game.turn === 'w' ? 'p' : 'P')
  }

  if (move.isCastle) {
    if (move.castleSide === 'king') {
      if (game.turn === 'w') {
        next.board[toIndex(5, 7)] = 'R'
        next.board[toIndex(7, 7)] = EMPTY
      } else {
        next.board[toIndex(5, 0)] = 'r'
        next.board[toIndex(7, 0)] = EMPTY
      }
    } else if (move.castleSide === 'queen') {
      if (game.turn === 'w') {
        next.board[toIndex(3, 7)] = 'R'
        next.board[toIndex(0, 7)] = EMPTY
      } else {
        next.board[toIndex(3, 0)] = 'r'
        next.board[toIndex(0, 0)] = EMPTY
      }
    }
  }

  const placedPiece =
    move.promotion ? (game.turn === 'w' ? move.promotion.toUpperCase() : move.promotion.toLowerCase()) : piece
  next.board[move.to] = placedPiece

  if (pieceType === 'k') {
    next.castling = removeCastlingRights(next.castling, game.turn === 'w' ? 'KQ' : 'kq')
  }

  if (pieceType === 'r') {
    if (fromSquare === 'a1') {
      next.castling = removeCastlingRights(next.castling, 'Q')
    } else if (fromSquare === 'h1') {
      next.castling = removeCastlingRights(next.castling, 'K')
    } else if (fromSquare === 'a8') {
      next.castling = removeCastlingRights(next.castling, 'q')
    } else if (fromSquare === 'h8') {
      next.castling = removeCastlingRights(next.castling, 'k')
    }
  }

  if (capturedPiece && typeOf(capturedPiece) === 'r') {
    if (toSquare === 'a1') {
      next.castling = removeCastlingRights(next.castling, 'Q')
    } else if (toSquare === 'h1') {
      next.castling = removeCastlingRights(next.castling, 'K')
    } else if (toSquare === 'a8') {
      next.castling = removeCastlingRights(next.castling, 'q')
    } else if (toSquare === 'h8') {
      next.castling = removeCastlingRights(next.castling, 'k')
    }
  }

  if (pieceType === 'p' && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
    const targetRank = (rankOf(move.to) + rankOf(move.from)) / 2
    next.enPassant = squareToAlgebraic(toIndex(fileOf(move.from), targetRank))
  } else {
    next.enPassant = null
  }

  if (pieceType === 'p' || capturedPiece) {
    next.halfmoveClock = 0
  } else {
    next.halfmoveClock += 1
  }

  if (game.turn === 'b') {
    next.fullmoveNumber += 1
  }

  next.turn = enemy
  next.history.push({
    uci: `${fromSquare}${toSquare}${move.promotion || ''}`,
    from: fromSquare,
    to: toSquare,
    piece,
    captured: capturedPiece || null,
    promotion: move.promotion || null,
  })

  return next
}

function isLegalMove(game, move) {
  const candidate = applyMoveToGame(game, move)
  return !isInCheck(candidate, game.turn)
}

export function generateLegalMoves(game, fromSquare) {
  return generatePseudoLegalMoves(game, fromSquare).filter((move) => isLegalMove(game, move))
}

export function canSelectSquare(game, square) {
  const piece = game.board[square]
  return Boolean(piece && colorOf(piece) === game.turn)
}

export function getMoveBySquares(game, from, to, promotion = 'q') {
  const legalMoves = generateLegalMoves(game, from)
  return (
    legalMoves.find((move) => move.to === to && (!move.promotion || move.promotion === promotion)) ||
    legalMoves.find((move) => move.to === to)
  )
}

function classifyPhase(game) {
  let material = 0
  for (const piece of game.board) {
    if (!piece) {
      continue
    }
    material += PIECE_VALUES[typeOf(piece)] || 0
  }
  if (material > 50) {
    return 'opening'
  }
  if (material > 20) {
    return 'middlegame'
  }
  return 'endgame'
}

function capturedPiecesFromBoardAndHistory(game) {
  const counts = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
  }

  for (const piece of game.board) {
    if (!piece) {
      continue
    }
    counts[colorOf(piece)][typeOf(piece)] -= 1
  }

  const whiteCaptured = []
  const blackCaptured = []
  for (const [pieceType, total] of Object.entries(counts.b)) {
    for (let i = 0; i < total; i += 1) {
      whiteCaptured.push(pieceType)
    }
  }
  for (const [pieceType, total] of Object.entries(counts.w)) {
    for (let i = 0; i < total; i += 1) {
      blackCaptured.push(pieceType)
    }
  }
  return {
    capturedWhite: whiteCaptured,
    capturedBlack: blackCaptured,
  }
}

export function getGameResult(game) {
  const whiteKingSquare = findKing(game, 'w')
  const blackKingSquare = findKing(game, 'b')

  if (whiteKingSquare < 0 && blackKingSquare < 0) {
    return {
      status: 'complete',
      result: 'draw',
      winner: null,
      terminationReason: 'invalid_position',
      check: false,
      checkmate: false,
      stalemate: false,
    }
  }

  if (whiteKingSquare < 0) {
    return {
      status: 'complete',
      result: 'black_win',
      winner: 'black',
      terminationReason: 'king_captured',
      check: false,
      checkmate: false,
      stalemate: false,
    }
  }

  if (blackKingSquare < 0) {
    return {
      status: 'complete',
      result: 'white_win',
      winner: 'white',
      terminationReason: 'king_captured',
      check: false,
      checkmate: false,
      stalemate: false,
    }
  }

  const legalMoves = generateLegalMoves(game)
  const inCheck = isInCheck(game, game.turn)
  if (!legalMoves.length) {
    if (inCheck) {
      return {
        status: 'complete',
        result: game.turn === 'w' ? 'black_win' : 'white_win',
        winner: game.turn === 'w' ? 'black' : 'white',
        terminationReason: 'checkmate',
        check: true,
        checkmate: true,
        stalemate: false,
      }
    }
    return {
      status: 'complete',
      result: 'draw',
      winner: null,
      terminationReason: 'stalemate',
      check: false,
      checkmate: false,
      stalemate: true,
    }
  }

  return {
    status: 'in_progress',
    result: null,
    winner: null,
    terminationReason: null,
    check: inCheck,
    checkmate: false,
    stalemate: false,
  }
}

export function describeMove(move) {
  if (!move) {
    return null
  }
  return `${move.from}${move.to}${move.promotion || ''}`
}

export function getSerializableState(game, options = {}) {
  const result = getGameResult(game)
  const lastMove = game.history.at(-1)
  const captures = capturedPiecesFromBoardAndHistory(game)

  return {
    fen: serializeFEN(game),
    phase: classifyPhase(game),
    sideToMove: game.turn === 'w' ? 'white' : 'black',
    moveCount: game.history.length,
    lastMove: lastMove ? describeMove(lastMove) : null,
    status: result.status,
    result: result.result,
    winner: result.winner,
    terminationReason: result.terminationReason,
    check: result.check,
    checkmate: result.checkmate,
    stalemate: result.stalemate,
    playerColor: options.playerColor || 'white',
    opponentMode: options.opponentMode || 'human',
    aiThinking: Boolean(options.aiThinking),
    lastError: options.lastError || null,
    moveHistory: game.history.map((entry, index) => ({
      index: index + 1,
      uci: entry.uci,
      from: entry.from,
      to: entry.to,
      piece: entry.piece,
      captured: entry.captured,
      promotion: entry.promotion,
    })),
    ...captures,
  }
}

export function restoreGameFromState(state) {
  if (!state || typeof state !== 'object' || typeof state.fen !== 'string') {
    throw new Error('Recoverable state requires a FEN string')
  }

  const game = parseFEN(state.fen)
  if (Array.isArray(state.moveHistory)) {
    game.history = state.moveHistory
      .filter((entry) => entry && typeof entry.from === 'string' && typeof entry.to === 'string')
      .map((entry) => ({
        uci: typeof entry.uci === 'string' ? entry.uci : `${entry.from}${entry.to}${entry.promotion || ''}`,
        from: entry.from,
        to: entry.to,
        piece: entry.piece || null,
        captured: entry.captured || null,
        promotion: entry.promotion || null,
      }))
  }
  return game
}

export function makeMove(game, from, to, promotion = 'q') {
  const piece = game.board[from]
  if (!piece) {
    return {
      ok: false,
      error: 'There is no piece on that square.',
    }
  }
  if (colorOf(piece) !== game.turn) {
    return {
      ok: false,
      error: `It is ${game.turn === 'w' ? 'White' : 'Black'} to move.`,
    }
  }

  const move = getMoveBySquares(game, from, to, promotion)
  if (!move) {
    return {
      ok: false,
      error: 'That move is not legal in the current position.',
    }
  }

  const nextGame = applyMoveToGame(game, move)
  return {
    ok: true,
    game: nextGame,
    move: nextGame.history.at(-1),
  }
}

export function getLegalDestinations(game, from) {
  return generateLegalMoves(game, from).map((move) => move.to)
}

export function getPieceAt(game, square) {
  return game.board[square]
}

export function pieceToSymbol(piece) {
  const symbols = {
    P: '♙',
    N: '♘',
    B: '♗',
    R: '♖',
    Q: '♕',
    K: '♔',
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
    k: '♚',
  }
  return piece ? symbols[piece] : ''
}
