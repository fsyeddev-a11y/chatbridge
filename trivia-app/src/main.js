import { createBridge } from './bridge.js'
import { fetchQuestions, CATEGORIES } from './trivia.js'

const appId = 'trivia'

// DOM elements
const banner = document.getElementById('message-banner')
const categorySelect = document.getElementById('category-select')
const difficultySelect = document.getElementById('difficulty-select')
const startBtn = document.getElementById('start-btn')
const quizArea = document.getElementById('quiz-area')
const setupArea = document.getElementById('setup-area')
const questionText = document.getElementById('question-text')
const answersContainer = document.getElementById('answers')
const progressText = document.getElementById('progress')
const scoreText = document.getElementById('score-text')
const endBtn = document.getElementById('end-btn')

let questions = []
let currentIndex = 0
let score = 0
let totalAnswered = 0
let selectedAnswer = null
let quizActive = false

function setBanner(text, type) {
  banner.textContent = text
  banner.className = 'banner' + (type === 'warning' ? ' warning' : type === 'success' ? ' success' : '')
}

function getState() {
  return {
    score,
    totalAnswered,
    totalQuestions: questions.length,
    category: categorySelect.value,
    difficulty: difficultySelect.value,
    currentIndex,
    quizActive,
  }
}

function getSummary() {
  if (!quizActive && totalAnswered === 0) {
    return 'Ready to start a science trivia quiz.'
  }
  if (!quizActive) {
    return `Quiz complete. Score: ${score}/${totalAnswered}.`
  }
  return `Question ${currentIndex + 1}/${questions.length}. Score: ${score}/${totalAnswered}.`
}

function renderQuestion() {
  if (currentIndex >= questions.length) {
    finishQuiz()
    return
  }

  const q = questions[currentIndex]
  questionText.textContent = q.question
  progressText.textContent = `Question ${currentIndex + 1} of ${questions.length}`
  scoreText.textContent = `Score: ${score}/${totalAnswered}`
  answersContainer.innerHTML = ''
  selectedAnswer = null

  q.answers.forEach((answer) => {
    const btn = document.createElement('button')
    btn.className = 'answer-btn'
    btn.textContent = answer
    btn.addEventListener('click', () => selectAnswer(answer, q.correct, btn))
    answersContainer.appendChild(btn)
  })
}

function selectAnswer(answer, correct, btn) {
  if (selectedAnswer !== null) return
  selectedAnswer = answer
  totalAnswered++

  const isCorrect = answer === correct
  if (isCorrect) {
    score++
    btn.classList.add('correct')
    setBanner('Correct!', 'success')
  } else {
    btn.classList.add('wrong')
    setBanner(`Wrong! The answer was: ${correct}`, 'warning')
    // Highlight correct answer
    for (const child of answersContainer.children) {
      if (child.textContent === correct) {
        child.classList.add('correct')
      }
    }
  }

  scoreText.textContent = `Score: ${score}/${totalAnswered}`
  bridge.sendStateUpdate(getSummary(), getState())

  setTimeout(() => {
    currentIndex++
    renderQuestion()
  }, 1500)
}

function finishQuiz() {
  quizActive = false
  quizArea.classList.add('hidden')
  setupArea.classList.remove('hidden')
  startBtn.textContent = 'Play Again'
  setBanner(`Quiz complete! Final score: ${score}/${totalAnswered}`, 'success')
  bridge.sendComplete(getSummary(), getState())
}

async function startQuiz() {
  const category = parseInt(categorySelect.value, 10)
  const difficulty = difficultySelect.value

  setBanner('Loading questions...', '')
  startBtn.disabled = true

  try {
    questions = await fetchQuestions(5, category, difficulty)
    currentIndex = 0
    score = 0
    totalAnswered = 0
    quizActive = true
    selectedAnswer = null

    setupArea.classList.add('hidden')
    quizArea.classList.remove('hidden')
    setBanner(`${questions[0].category} - ${difficulty} difficulty`, '')
    renderQuestion()
    bridge.sendStateUpdate(getSummary(), getState())
  } catch (err) {
    setBanner('Failed to load questions. Try again.', 'warning')
    bridge.sendError(err.message)
  } finally {
    startBtn.disabled = false
  }
}

function restoreFromState(previousState) {
  if (!previousState || !previousState.quizActive) return false
  score = previousState.score || 0
  totalAnswered = previousState.totalAnswered || 0
  categorySelect.value = previousState.category || '17'
  difficultySelect.value = previousState.difficulty || 'easy'
  return true
}

const bridge = createBridge({
  appId,
  onInit(payload) {
    const restored = restoreFromState(payload?.previousState)
    setBanner(restored ? 'Previous session restored. Start a new quiz!' : 'Choose a category and start your quiz!')
    bridge.sendReady(getSummary())
  },
  onPing() {},
  onTerminate() {
    quizActive = false
    setBanner('Session ended by TutorMeAI.', 'warning')
  },
})

// Populate category dropdown
CATEGORIES.forEach((cat) => {
  const opt = document.createElement('option')
  opt.value = cat.id
  opt.textContent = cat.name
  categorySelect.appendChild(opt)
})

startBtn.addEventListener('click', () => void startQuiz())
endBtn.addEventListener('click', () => {
  if (quizActive) {
    finishQuiz()
  } else {
    bridge.sendComplete(getSummary(), getState())
  }
})
