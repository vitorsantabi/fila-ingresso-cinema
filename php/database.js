const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cinema.db');

// Criação da tabela de usuários se não existir
db.serialize(() => {
   db.run(`CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL,
      metodo_pagamento TEXT NOT NULL,
      filme TEXT NOT NULL,
      poltrona TEXT NOT NULL
   )`);
});

module.exports = db;
