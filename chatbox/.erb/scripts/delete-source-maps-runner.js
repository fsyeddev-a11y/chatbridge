const fs = require('fs')
const path = require('path')

function removeMapFiles(dir) {
  if (!fs.existsSync(dir)) {
    return
  }

  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.js.map')) {
      fs.rmSync(path.join(dir, entry), { force: true })
    }
  }
}

const rootPath = path.join(__dirname, '../..')
const distMainPath = path.join(rootPath, 'release/app/dist/main')
const distRendererPath = path.join(rootPath, 'release/app/dist/renderer')

removeMapFiles(distMainPath)
removeMapFiles(distRendererPath)
