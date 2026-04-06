const API_BASE = 'https://opentdb.com'

export async function fetchQuestions(amount = 5, category = 17, difficulty = 'easy') {
  const url = `${API_BASE}/api.php?amount=${amount}&category=${category}&difficulty=${difficulty}&type=multiple`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Trivia API request failed: ${response.status}`)
  }

  const data = await response.json()

  if (data.response_code !== 0) {
    throw new Error(`Trivia API returned code ${data.response_code}`)
  }

  return data.results.map((q) => ({
    question: decodeHTML(q.question),
    correct: decodeHTML(q.correct_answer),
    answers: shuffle([q.correct_answer, ...q.incorrect_answers].map(decodeHTML)),
    category: decodeHTML(q.category),
    difficulty: q.difficulty,
  }))
}

// Open Trivia DB categories relevant to education
export const CATEGORIES = [
  { id: 17, name: 'Science & Nature' },
  { id: 18, name: 'Computers' },
  { id: 19, name: 'Mathematics' },
  { id: 22, name: 'Geography' },
  { id: 23, name: 'History' },
  { id: 9, name: 'General Knowledge' },
]

function decodeHTML(html) {
  const el = document.createElement('textarea')
  el.innerHTML = html
  return el.value
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
