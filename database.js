const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'cinema.db');
const db = new sqlite3.Database(dbPath);

// Habilitar WAL mode para melhor performance de leitura/escrita concorrente
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA foreign_keys = ON');

// Criação das tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS compras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    filme TEXT NOT NULL,
    horario TEXT NOT NULL,
    poltrona TEXT NOT NULL,
    tipo_ingresso TEXT NOT NULL CHECK(tipo_ingresso IN ('inteira', 'meia')),
    valor REAL NOT NULL,
    metodo_pagamento TEXT NOT NULL CHECK(metodo_pagamento IN ('cartao', 'pix')),
    carteira_estudante TEXT,
    data_compra DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS poltronas_ocupadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filme TEXT NOT NULL,
    horario TEXT NOT NULL,
    poltrona TEXT NOT NULL,
    compra_id INTEGER,
    UNIQUE(filme, horario, poltrona),
    FOREIGN KEY (compra_id) REFERENCES compras(id)
  )`);
});

/**
 * Inserir uma compra no banco de dados (prepared statement para evitar SQL injection)
 */
function inserirCompra(dados) {
  return new Promise((resolve, reject) => {
    const { nome, email, filme, horario, poltrona, tipo_ingresso, valor, metodo_pagamento, carteira_estudante } = dados;

    db.run(
      `INSERT INTO compras (nome, email, filme, horario, poltrona, tipo_ingresso, valor, metodo_pagamento, carteira_estudante)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nome, email, filme, horario, poltrona, tipo_ingresso, valor, metodo_pagamento, carteira_estudante || null],
      function (err) {
        if (err) return reject(err);

        const compraId = this.lastID;

        // Marcar poltrona como ocupada
        db.run(
          `INSERT INTO poltronas_ocupadas (filme, horario, poltrona, compra_id) VALUES (?, ?, ?, ?)`,
          [filme, horario, poltrona, compraId],
          function (err) {
            if (err) return reject(err);
            resolve({ id: compraId });
          }
        );
      }
    );
  });
}

/**
 * Verificar se uma poltrona está ocupada
 */
function verificarPoltrona(filme, horario, poltrona) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM poltronas_ocupadas WHERE filme = ? AND horario = ? AND poltrona = ?`,
      [filme, horario, poltrona],
      (err, row) => {
        if (err) return reject(err);
        resolve(!!row);
      }
    );
  });
}

/**
 * Listar poltronas ocupadas para um filme/horário
 */
function listarPoltronasOcupadas(filme, horario) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT poltrona FROM poltronas_ocupadas WHERE filme = ? AND horario = ?`,
      [filme, horario],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows ? rows.map(r => r.poltrona) : []);
      }
    );
  });
}

module.exports = { db, inserirCompra, verificarPoltrona, listarPoltronasOcupadas };
