const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Array para gerenciar a fila
let fila = [];

// Rota para comprar ingressos
app.post('/comprar', (req, res) => {
   const { nome, email, metodo_pagamento, filme, poltrona } = req.body;

   // Aqui você pode salvar os dados no banco de dados
   console.log(`Compra realizada: ${nome}, ${email}, ${metodo_pagamento}, ${filme}, Poltrona ${poltrona}`);
   
   // Resposta para o cliente
   res.send(`Ingressos comprados para ${filme}, Poltrona ${poltrona}.`);
});


// Socket para gerenciar a fila
io.on('connection', (socket) => {
    socket.on('entrarNaFila', (filme) => {
        fila.push({ socketId: socket.id, filme });
        console.log(`${socket.id} entrou na fila para ${filme}.`);
    });
});

// Iniciar o servidor
server.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
