const {execSync} = require('child_process')

let commitHash = ''

try {
  commitHash = execSync('git rev-parse HEAD').toString().trim()
} catch (e) {}

module.exports = commitHash
