const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '.')));

// Database Setup
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados SQLite:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        initializeDatabase();
    }
});

// Relational Schema Initialization
function initializeDatabase() {
    db.serialize(() => {
        // Enable Foreign Keys
        db.run('PRAGMA foreign_keys = ON');

        // 1. Table Clients
        db.run(`
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT,
                doc TEXT,
                city TEXT,
                neighborhood TEXT,
                address TEXT,
                obs TEXT,
                created TEXT
            )
        `);

        // 2. Table Services
        db.run(`
            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                desc TEXT
            )
        `);

        // 3. Table Orders
        db.run(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                clientId TEXT NOT NULL,
                device TEXT NOT NULL,
                brand TEXT,
                serviceId TEXT NOT NULL,
                status TEXT DEFAULT 'recebido',
                value REAL DEFAULT 0,
                problem TEXT,
                solution TEXT,
                payStatus TEXT DEFAULT 'pendente',
                payMethod TEXT,
                dueDate TEXT,
                payDate TEXT,
                payObs TEXT,
                created TEXT,
                updated TEXT,
                FOREIGN KEY (clientId) REFERENCES clients (id),
                FOREIGN KEY (serviceId) REFERENCES services (id)
            )
        `);

        // 4. Table Users
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL
            )
        `);

        console.log('Tabelas relacionais SQLite inicializadas.');
        seedDatabase();
    });
}

// Seed Multi-Table Relational Data
function seedDatabase() {
    db.get('SELECT COUNT(*) as count FROM clients', [], (err, row) => {
        if (err) {
            console.error('Erro ao verificar sementes:', err.message);
            return;
        }

        if (row && row.count === 0) {
            console.log('Semeando dados iniciais no banco relacional...');

            db.serialize(() => {
                // Seed Users
                const stmtUser = db.prepare(`
                    INSERT OR IGNORE INTO users (username, password)
                    VALUES (?, ?)
                `);
                stmtUser.run(['admin', '123456']);
                stmtUser.finalize();
                // Seed Clients
                const stmtClient = db.prepare(`
                    INSERT INTO clients (id, name, phone, email, doc, city, neighborhood, address, obs, created)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const initialClients = [
                    ['c1', 'Joao Silva', '(13) 99765-4321', 'joao@email.com', '123.456.789-01', 'Santos', 'Gonzaga', 'Rua das Flores, 123', '', '2026-08-01'],
                    ['c2', 'Maria Santos', '(13) 99876-5432', 'maria@email.com', '987.654.321-00', 'Guaruja', 'Pitangueiras', 'Av. Atlantica, 456', 'Cliente VIP', '2026-08-05'],
                    ['c3', 'Pedro Costa', '(13) 99123-4567', 'pedro@email.com', '456.789.123-45', 'Santos', 'Aparecida', 'Rua XV de Novembro, 789', '', '2026-08-08'],
                    ['c4', 'Ana Paula', '(13) 99456-7890', 'ana@email.com', '789.123.456-78', 'Guaruja', 'Enseada', 'Rua do Porto, 321', 'Indicacao', '2026-08-10']
                ];
                initialClients.forEach(c => stmtClient.run(c));
                stmtClient.finalize();

                // Seed Services
                const stmtService = db.prepare(`
                    INSERT INTO services (id, name, category, price, desc)
                    VALUES (?, ?, ?, ?, ?)
                `);
                const initialServices = [
                    ['s1', 'Formatacao Completa', 'Notebook', 80.00, 'Formatacao com backup, instalacao de drivers e programas basicos'],
                    ['s2', 'Troca de Tela Notebook', 'Notebook', 350.00, 'Substituicao de tela LCD/LED com garantia'],
                    ['s3', 'Upgrade SSD + RAM', 'Notebook', 200.00, 'Instalacao de SSD e expansao de memoria RAM'],
                    ['s4', 'Limpeza e Pasta Termica', 'PC Gamer', 120.00, 'Limpeza interna completa e troca de pasta termica'],
                    ['s5', 'Montagem PC Gamer', 'PC Gamer', 500.00, 'Montagem completa de PC gamer sob encomenda'],
                    ['s6', 'Troca de Tela Celular', 'Celular', 180.00, 'Troca de tela/touchscreen com garantia'],
                    ['s7', 'Troca de Bateria', 'Celular', 120.00, 'Substituicao de bateria original'],
                    ['s8', 'Landing Page', 'Site', 800.00, 'Criacao de landing page responsiva e otimizada'],
                    ['s9', 'Suporte Remoto', 'Remoto', 60.00, 'Atendimento remoto para resolucao de problemas'],
                    ['s10', 'Recuperacao de Dados', 'Outro', 250.00, 'Recuperacao de dados em HD, SSD e pendrives']
                ];
                initialServices.forEach(s => stmtService.run(s));
                stmtService.finalize();

                // Seed Orders
                const stmtOrder = db.prepare(`
                    INSERT INTO orders (id, clientId, device, brand, serviceId, status, value, problem, solution, payStatus, payMethod, dueDate, payDate, payObs, created, updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const initialOrders = [
                    ['OS001', 'c1', 'Notebook Dell Inspiron 15', 'Dell', 's1', 'analise', 80.00, 'Notebook muito lento, demora para ligar', '', 'pendente', '', '2026-08-17', '', '', '2026-08-10', '2026-08-10'],
                    ['OS002', 'c2', 'iPhone 13 Pro', 'Apple', 's6', 'manutencao', 280.00, 'Tela trincada apos queda', 'Troca de tela original em andamento', 'pendente', '', '2026-08-15', '', '', '2026-08-08', '2026-08-12'],
                    ['OS003', 'c3', 'PC Gamer RTX 4060', 'Montado', 's5', 'pronto', 520.00, 'Montagem de PC gamer completo', 'Montagem finalizada, testes de stress aprovados', 'pago', 'pix', '2026-08-12', '2026-08-12', 'Pagamento via PIX confirmado', '2026-08-05', '2026-08-12'],
                    ['OS004', 'c4', 'Samsung Galaxy S23', 'Samsung', 's7', 'aguardando', 120.00, 'Bateria nao segura carga', 'Aguardando chegada da bateria original', 'pendente', '', '2026-08-18', '', '', '2026-08-11', '2026-08-11'],
                    ['OS005', 'c1', 'Notebook Dell Inspiron 15', 'Dell', 's3', 'recebido', 200.00, 'Quer aumentar a velocidade do notebook', '', 'pendente', '', '2026-08-20', '', '', '2026-08-13', '2026-08-13'],
                    ['OS006', 'c2', 'PC Gamer', 'Montado', 's4', 'pronto', 120.00, 'PC esquentando muito', 'Limpeza completa e troca de pasta termica', 'pago', 'dinheiro', '2026-08-03', '2026-08-03', 'Pago na retirada', '2026-08-01', '2026-08-03']
                ];
                initialOrders.forEach(o => stmtOrder.run(o));
                stmtOrder.finalize();

                console.log('Tabelas relacionais semeadas com sucesso.');
            });
        }
    });
}

// Helper to generate next OS ID (OS007, OS008, etc.)
function generateOSId(callback) {
    db.all("SELECT id FROM orders WHERE id LIKE 'OS%'", [], (err, rows) => {
        let maxNum = 6;
        if (rows && rows.length > 0) {
            rows.forEach(r => {
                const num = parseInt(r.id.replace('OS', ''));
                if (!isNaN(num) && num > maxNum) {
                    maxNum = num;
                }
            });
        }
        const nextId = 'OS' + String(maxNum + 1).padStart(3, '0');
        callback(nextId);
    });
}

// Helper to generate unique client ID
function generateClientId(callback) {
    const id = 'c_' + Math.random().toString(36).substring(2, 8);
    db.get('SELECT id FROM clients WHERE id = ?', [id], (err, row) => {
        if (row) {
            generateClientId(callback);
        } else {
            callback(id);
        }
    });
}

// Memory storage for sessions
const activeSessions = new Set();

// Middleware to authenticate admin requests
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Nao autorizado. Token ausente.' });
    }
    
    if (!activeSessions.has(token)) {
        return res.status(403).json({ error: 'Sessao expirada ou invalida.' });
    }
    
    next();
}

// REST API - ADMIN LOGIN
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario e senha obrigatorios.' });
    }

    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro interno no banco de dados.' });
        }
        if (!row) {
            return res.status(401).json({ error: 'Usuario ou senha incorretos.' });
        }

        // Generate session token
        const token = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        activeSessions.add(token);
        res.json({ success: true, token });
    });
});

// REST API - UPDATE ADMIN CREDENTIALS
app.put('/api/admin/credentials', authenticateToken, (req, res) => {
    const { currentUsername, currentPassword, newUsername, newPassword } = req.body;
    
    if (!currentUsername || !currentPassword || !newUsername || !newPassword) {
        return res.status(400).json({ error: 'Todos os campos sao obrigatorios.' });
    }

    // Verify current credentials
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [currentUsername, currentPassword], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao verificar credenciais atuais.' });
        }
        if (!row) {
            return res.status(401).json({ error: 'Usuario ou senha atual incorretos.' });
        }

        // Perform update in SQLite
        const query = 'UPDATE users SET username = ?, password = ? WHERE username = ?';
        db.run(query, [newUsername, newPassword, currentUsername], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Erro ao atualizar as credenciais.' });
            }
            res.json({ success: true, message: 'Credenciais atualizadas com sucesso!' });
        });
    });
});


// Protect all admin CRUD routes with auth middleware
app.use('/api/clients', authenticateToken);
app.use('/api/services', authenticateToken);
app.use('/api/orders', authenticateToken);

/* ==========================================================================
   REST API - CLIENT BOOKINGS
   ========================================================================== */

// 1. Client Booking (Dynamic 24h setup)
app.post('/api/bookings', (req, res) => {
    const { name, phone, type, date, time, services, obs } = req.body;
    
    if (!name || !phone || !services || !date || !time) {
        return res.status(400).json({ error: 'Campos obrigatorios faltando.' });
    }

    // Find or create client by phone
    db.get('SELECT id FROM clients WHERE phone = ?', [phone], (err, clientRow) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro interno ao consultar cliente.' });
        }

        const handleBookingWithClientId = (clientId) => {
            generateOSId((osId) => {
                // Map category type to default seed service ID
                const typeMap = {
                    'computador': 's1',
                    'celular': 's6',
                    'gamer': 's5',
                    'site': 's8',
                    'remoto': 's9'
                };
                const serviceId = typeMap[type] || 's1';

                // Fetch service price
                db.get('SELECT price FROM services WHERE id = ?', [serviceId], (err, serviceRow) => {
                    const price = serviceRow ? serviceRow.price : 80;

                    // Date parsing: YYYY-MM-DD -> DD/MM/YYYY
                    const dateParts = date.split('-');
                    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : date;

                    // Due date is 5 days from now
                    const due = new Date(date);
                    due.setDate(due.getDate() + 5);
                    const formattedDue = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;

                    const todayStr = new Date().toISOString().split('T')[0];
                    const deviceName = type === 'computador' ? 'Notebook/Computador' 
                                       : type === 'celular' ? 'Celular/Tablet'
                                       : type === 'gamer' ? 'PC Gamer'
                                       : type === 'site' ? 'Projeto Web'
                                       : 'Equipamento';

                    const insertOrderQuery = `
                        INSERT INTO orders (id, clientId, device, brand, serviceId, status, value, problem, solution, payStatus, payMethod, dueDate, payDate, payObs, created, updated)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    db.run(insertOrderQuery, [
                        osId, clientId, deviceName, '', serviceId, 'recebido', price,
                        obs || `Serviços requisitados: ${services}`, `Agendamento online agendado para ${formattedDate} as ${time}.`,
                        'pendente', '', formattedDue, '', '', todayStr, todayStr
                    ], (err) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({ error: 'Erro ao registrar ordem de serviço.' });
                        }
                        res.status(201).json({
                            success: true,
                            os: osId,
                            name: name,
                            date: formattedDate,
                            time: time
                        });
                    });
                });
            });
        };

        if (clientRow) {
            handleBookingWithClientId(clientRow.id);
        } else {
            // Register new client
            generateClientId((newClientId) => {
                const todayStr = new Date().toISOString().split('T')[0];
                const insertClientQuery = `
                    INSERT INTO clients (id, name, phone, email, doc, city, neighborhood, address, obs, created)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                db.run(insertClientQuery, [
                    newClientId, name, phone, 'cliente@email.com', '', 'Santos', '', '', 'Criado via site', todayStr
                ], (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: 'Erro ao registrar cliente.' });
                    }
                    handleBookingWithClientId(newClientId);
                });
            });
        }
    });
});

// 2. Client tracking (flat JSON wrapper for index.html)
app.get('/api/os/:code', (req, res) => {
    const searchCode = req.params.code.trim();

    const query = `
        SELECT o.*, c.name as clientName, c.phone as clientPhone, c.email as clientEmail, s.name as serviceName
        FROM orders o
        LEFT JOIN clients c ON o.clientId = c.id
        LEFT JOIN services s ON o.serviceId = s.id
        WHERE o.id = ? OR c.phone = ? OR REPLACE(REPLACE(c.phone, '(', ''), ')', '') = ?
    `;

    db.get(query, [searchCode, searchCode, searchCode], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro na consulta do banco de dados.' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Ordem de serviço nao encontrada.' });
        }

        // Map status strings to progress timeline steps
        const statusMap = {
            'recebido': 'recebido',
            'analise': 'em-analise',
            'aguardando': 'aguardando',
            'manutencao': 'em-manutencao',
            'pronto': 'pronto'
        };

        const stepMap = {
            'recebido': 1,
            'analise': 2,
            'aguardando': 3,
            'manutencao': 4,
            'pronto': 5
        };

        // Format dates: YYYY-MM-DD -> DD/MM/YYYY
        const formatDate = (dateStr) => {
            if (!dateStr) return 'A definir';
            if (dateStr.includes('/')) return dateStr;
            const parts = dateStr.split('-');
            return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
        };

        res.json({
            client: row.clientName,
            device: row.device,
            status: statusMap[row.status] || 'em-analise',
            step: stepMap[row.status] || 2,
            date: formatDate(row.created),
            estimate: formatDate(row.dueDate)
        });
    });
});


/* ==========================================================================
   REST API - CLIENTS CRUD
   ========================================================================== */
app.get('/api/clients', (req, res) => {
    db.all('SELECT * FROM clients ORDER BY name ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/clients', (req, res) => {
    const { name, phone, email, doc, city, neighborhood, address, obs } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Nome e Telefone sao obrigatorios.' });

    generateClientId((id) => {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            INSERT INTO clients (id, name, phone, email, doc, city, neighborhood, address, obs, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(query, [id, name, phone, email, doc, city, neighborhood, address, obs, today], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ success: true, id });
        });
    });
});

app.put('/api/clients/:id', (req, res) => {
    const { name, phone, email, doc, city, neighborhood, address, obs } = req.body;
    const query = `
        UPDATE clients 
        SET name = ?, phone = ?, email = ?, doc = ?, city = ?, neighborhood = ?, address = ?, obs = ?
        WHERE id = ?
    `;
    db.run(query, [name, phone, email, doc, city, neighborhood, address, obs, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Cliente nao encontrado.' });
        res.json({ success: true });
    });
});

app.delete('/api/clients/:id', (req, res) => {
    // Check foreign keys
    db.get('SELECT COUNT(*) as count FROM orders WHERE clientId = ?', [req.params.id], (err, row) => {
        if (row && row.count > 0) {
            return res.status(400).json({ error: 'Este cliente possui ordens de servico ativas e nao pode ser excluido.' });
        }
        db.run('DELETE FROM clients WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});


/* ==========================================================================
   REST API - SERVICES CRUD
   ========================================================================== */
app.get('/api/services', (req, res) => {
    db.all('SELECT * FROM services ORDER BY name ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/services', (req, res) => {
    const { name, category, price, desc } = req.body;
    if (!name || !category || price === undefined) return res.status(400).json({ error: 'Campos obrigatorios faltando.' });

    const id = 's_' + Math.random().toString(36).substring(2, 8);
    const query = `
        INSERT INTO services (id, name, category, price, desc)
        VALUES (?, ?, ?, ?, ?)
    `;
    db.run(query, [id, name, category, Number(price), desc], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ success: true, id });
    });
});

app.put('/api/services/:id', (req, res) => {
    const { name, category, price, desc } = req.body;
    const query = `
        UPDATE services 
        SET name = ?, category = ?, price = ?, desc = ?
        WHERE id = ?
    `;
    db.run(query, [name, category, Number(price), desc, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/services/:id', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM orders WHERE serviceId = ?', [req.params.id], (err, row) => {
        if (row && row.count > 0) {
            return res.status(400).json({ error: 'Este servico esta vinculado a ordens de servico e nao pode ser excluido.' });
        }
        db.run('DELETE FROM services WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});


/* ==========================================================================
   REST API - ORDERS CRUD
   ========================================================================== */
app.get('/api/orders', (req, res) => {
    const query = `
        SELECT o.*, c.name as clientName, c.phone as clientPhone, c.email as clientEmail, s.name as serviceName
        FROM orders o
        LEFT JOIN clients c ON o.clientId = c.id
        LEFT JOIN services s ON o.serviceId = s.id
        ORDER BY o.created DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/orders', (req, res) => {
    const { clientId, device, brand, serviceId, status, value, problem, solution, payStatus, payMethod, dueDate, payDate, payObs } = req.body;

    if (!clientId || !device || !serviceId) {
        return res.status(400).json({ error: 'Campos obrigatorios faltando.' });
    }

    generateOSId((osId) => {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            INSERT INTO orders (id, clientId, device, brand, serviceId, status, value, problem, solution, payStatus, payMethod, dueDate, payDate, payObs, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(query, [
            osId, clientId, device, brand, serviceId, status || 'recebido', Number(value || 0),
            problem, solution, payStatus || 'pendente', payMethod, dueDate, payDate, payObs, today, today
        ], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ success: true, id: osId });
        });
    });
});

app.put('/api/orders/:id', (req, res) => {
    const { clientId, device, brand, serviceId, status, value, problem, solution, payStatus, payMethod, dueDate, payDate, payObs } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const query = `
        UPDATE orders 
        SET clientId = ?, device = ?, brand = ?, serviceId = ?, status = ?, value = ?, 
            problem = ?, solution = ?, payStatus = ?, payMethod = ?, dueDate = ?, payDate = ?, payObs = ?, updated = ?
        WHERE id = ?
    `;

    db.run(query, [
        clientId, device, brand, serviceId, status, Number(value || 0),
        problem, solution, payStatus, payMethod, dueDate, payDate, payObs, today, req.params.id
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/orders/:id', (req, res) => {
    db.run('DELETE FROM orders WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// Start Server
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
