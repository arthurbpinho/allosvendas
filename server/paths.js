// Caminhos compartilhados entre módulos do servidor.
//
// DATA_DIR: volume persistente (Railway, via env DATA_DIR=/data) ou server/data em dev.
// Os prompts também moram aqui (DATA_DIR/prompts), nunca no repositório.
const path = require('path');

const SEED_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : SEED_DATA_DIR;

module.exports = { SEED_DATA_DIR, DATA_DIR };
