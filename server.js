const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { inserirCompra, verificarPoltrona, listarPoltronasOcupadas } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

// ── Segurança ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

// Rate limiting — máx. 100 requests por minuto por IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Tente novamente em 1 minuto.' },
});
app.use(limiter);

// Rate limiting mais rígido para compras — máx. 5 por minuto
const compraLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { erro: 'Limite de compras atingido. Tente novamente em 1 minuto.' },
});

// ── Performance ────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));

// ── Validação & Sanitização ────────────────────────────────
function sanitizar(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, (char) => {
    const map = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;' };
    return map[char];
  }).trim().slice(0, 200);
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarCompra(body) {
  const erros = [];
  const camposObrigatorios = ['nome', 'email', 'filme', 'horario', 'poltrona', 'tipo_ingresso', 'metodo_pagamento'];

  for (const campo of camposObrigatorios) {
    if (!body[campo] || typeof body[campo] !== 'string' || body[campo].trim() === '') {
      erros.push(`Campo "${campo}" é obrigatório.`);
    }
  }

  if (body.email && !validarEmail(body.email)) {
    erros.push('E-mail inválido.');
  }

  const horariosValidos = ['10:00', '14:00', '18:00', '20:00'];
  if (body.horario && !horariosValidos.includes(body.horario)) {
    erros.push('Horário inválido.');
  }

  if (body.tipo_ingresso && !['inteira', 'meia'].includes(body.tipo_ingresso)) {
    erros.push('Tipo de ingresso inválido.');
  }

  if (body.metodo_pagamento && !['cartao', 'pix'].includes(body.metodo_pagamento)) {
    erros.push('Método de pagamento inválido.');
  }

  if (body.tipo_ingresso === 'meia' && (!body.carteira_estudante || body.carteira_estudante.trim() === '')) {
    erros.push('Carteira de estudante é obrigatória para meia-entrada.');
  }

  return erros;
}

// ── Rotas ──────────────────────────────────────────────────

// Rota para comprar ingressos (com validação e rate limiting)
app.post('/comprar', compraLimiter, async (req, res) => {
  try {
    const erros = validarCompra(req.body);
    if (erros.length > 0) {
      return res.status(400).json({ sucesso: false, erros });
    }

    const { nome, email, filme, horario, poltrona, tipo_ingresso, metodo_pagamento, carteira_estudante } = req.body;

    // Verificar se a poltrona já está ocupada
    const ocupada = await verificarPoltrona(filme, horario, poltrona);
    if (ocupada) {
      return res.status(409).json({
        sucesso: false,
        erros: ['Esta poltrona já está ocupada para este horário.'],
      });
    }

    const valor = tipo_ingresso === 'inteira' ? 25.00 : 12.50;

    const resultado = await inserirCompra({
      nome: sanitizar(nome),
      email: sanitizar(email),
      filme: sanitizar(filme),
      horario,
      poltrona: sanitizar(poltrona),
      tipo_ingresso,
      valor,
      metodo_pagamento,
      carteira_estudante: carteira_estudante ? sanitizar(carteira_estudante) : null,
    });

    console.log(`[COMPRA] ID: ${resultado.id} | ${nome} | ${filme} | Poltrona ${poltrona} | ${horario}`);

    res.status(201).json({
      sucesso: true,
      mensagem: 'Compra realizada com sucesso!',
      compra_id: resultado.id,
    });
  } catch (error) {
    console.error('[ERRO] Falha ao processar compra:', error);
    res.status(500).json({ sucesso: false, erros: ['Erro interno do servidor.'] });
  }
});

// Rota para verificar poltronas ocupadas
app.get('/poltronas/:filme/:horario', async (req, res) => {
  try {
    const { filme, horario } = req.params;
    const ocupadas = await listarPoltronasOcupadas(decodeURIComponent(filme), horario);
    res.json({ ocupadas });
  } catch (error) {
    console.error('[ERRO] Falha ao listar poltronas:', error);
    res.status(500).json({ erro: 'Erro ao buscar poltronas.' });
  }
});

// ── Fila via WebSocket ─────────────────────────────────────
const filas = {};

io.on('connection', (socket) => {
  socket.on('entrarNaFila', (data) => {
    const filme = typeof data === 'string' ? data : data?.filme;
    if (!filme || typeof filme !== 'string') return;

    const filmeClean = sanitizar(filme);
    if (!filas[filmeClean]) filas[filmeClean] = [];

    filas[filmeClean].push({ socketId: socket.id, timestamp: Date.now() });
    console.log(`[FILA] ${socket.id} entrou na fila para ${filmeClean}`);

    io.emit('filaAtualizada', { filme: filmeClean, tamanho: filas[filmeClean].length });
  });

  socket.on('disconnect', () => {
    for (const filme in filas) {
      filas[filme] = filas[filme].filter((u) => u.socketId !== socket.id);
    }
  });
});

// ── Tratamento de erros global ─────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERRO GLOBAL]', err.stack);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// ── Iniciar servidor ───────────────────────────────────────
server.listen(port, () => {
  console.log(`✅ Servidor rodando em http://localhost:${port}`);
});
