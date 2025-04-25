const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose(); // Importe o pacote sqlite3
const jwt = require('jsonwebtoken');
const app = express();
const cors = require('cors'); // Importe o pacote cors
const PORT = process.env.PORT || 3000;
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Builder } = require('xml2js');
const config = require('./config');
const { vpsUrl } = require('./config');
const compression = require('compression');
const cron = require('node-cron');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
app.use(compression());
app.use(bodyParser.json({ limit: '50mb' })); // Define o limite máximo para 50MB
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Configuração do CORS
app.use(cors());

// Caminho para o arquivo do banco de dados SQLite
const dbPath = path.resolve(__dirname, 'database.db');

// Cria uma nova conexão com o banco de dados SQLite
const db = new sqlite3.Database(dbPath);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/imagens/perfil'); // Diretório onde os arquivos serão armazenados
    },
    filename: function (req, file, cb) {
        const userId = req.body.fotoPerfil || 'unknown'; // Se userId não estiver presente, use 'unknown'
        const fileExtension = '.jpg'; // Alterando a extensão para jpg
        const uniqueSuffix = uuidv4(); // Gera um identificador único
        const fileName = `usuario-${userId}-${uniqueSuffix}${fileExtension}`; // Nome do arquivo com sufixo único e extensão jpg
        cb(null, fileName); // Nome do arquivo
    }
});

const upload = multer({ storage: storage });

db.serialize(() => {
    // Criação da tabela "animes"
   db.run('CREATE TABLE IF NOT EXISTS animes (id INTEGER PRIMARY KEY AUTOINCREMENT, capa TEXT, titulo TEXT NOT NULL, tituloAlternativo TEXT, selo TEXT, sinopse TEXT, classificacao TEXT, status TEXT, qntd_temporadas INTEGER, anoLancamento INTEGER, dataPostagem DATE, ovas TEXT, filmes TEXT, estudio TEXT, diretor TEXT, genero TEXT, tipoMidia TEXT, visualizacoes INTEGER DEFAULT 0)');

  
    // Criação da tabela "episodios"
    db.run('CREATE TABLE IF NOT EXISTS episodios (id INTEGER PRIMARY KEY AUTOINCREMENT, temporada INTEGER, numero INTEGER, nome TEXT, link TEXT, capa_ep TEXT, anime_id INTEGER, FOREIGN KEY (anime_id) REFERENCES animes(id))');

    // Criação da tabela "usuarios"
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            imagem_perfil TEXT
        )
    `);

    db.run('CREATE TABLE IF NOT EXISTS progresso_animes (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, anime_id INTEGER, episodio_assistido INTEGER, FOREIGN KEY (usuario_id) REFERENCES usuarios(id), FOREIGN KEY (anime_id) REFERENCES animes(id))');
    // Criação da tabela "admin"
    db.run('CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha TEXT NOT NULL)');

    db.run('CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY AUTOINCREMENT, idTemporario TEXT, linkVideo TEXT, dataExpiracao INTEGER)');
}); /// criar as tabela necessarias caso nao exista ainda

app.use('/uploads/imagens/perfil', express.static(path.join(__dirname, 'uploads/imagens/perfil')));

app.get('/categorias', (req, res) => {
    // Verifica se o parâmetro "categorias" foi fornecido na consulta
    if (!req.query.categorias) {
        return res.status(400).json({ error: 'Parâmetro "categorias" não fornecido na consulta' });
    }
    
    // Divide a string de categorias solicitadas em um array
    const categoriasSolicitadas = req.query.categorias.split(',');
    console.log('Categorias solicitadas:', categoriasSolicitadas);

    // Cria um objeto para armazenar a contagem de animes para cada categoria solicitada
    const categoriasResponse = {};

    // Executa a consulta SQL para obter todos os animes
    db.all('SELECT genero FROM animes', (err, rows) => {
        if (err) {
            // Se houver um erro na consulta SQL, retorna uma mensagem de erro
            console.error('Erro na consulta SQL:', err.message);
            return res.status(500).json({ error: 'Erro ao executar a consulta SQL' });
        } else {
            // Para cada linha da consulta, verifica se cada categoria solicitada está presente
            rows.forEach(row => {
                const generos = row.genero.split(',');
                generos.forEach(genero => {
                    if (categoriasSolicitadas.includes(genero.trim())) {
                        categoriasResponse[genero.trim()] = (categoriasResponse[genero.trim()] || 0) + 1;
                    }
                });
            });

            // Retorna a resposta contendo a contagem de animes para cada categoria solicitada
            return res.json(categoriasResponse);
        }
    });
}); /// Rota para obter a quantidade de categorias e animes em cada categoria


app.post('/upload', upload.single('fotoPerfil'), (req, res) => {
    console.log('Conteúdo do corpo da solicitação:', req.body); // Adicione esta linha
    const userId = req.body.fotoPerfil; // ID do usuário enviado no corpo da solicitação

    // Verifica se o ID do usuário é válido (opcional)
    if (!userId) {
        return res.status(400).json({ error: 'ID do usuário não fornecido' });
    }

    // Verifica se o ID do usuário é válido consultando o banco de dados (opcional)
    db.get('SELECT * FROM usuarios WHERE id = ?', [userId], (err, user) => {
        if (err) {
            console.error('Erro ao consultar o banco de dados:', err);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        if (!user) {
            console.log('Usuário não encontrado com o ID:', userId);
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Log para verificar se o usuário foi encontrado no banco de dados
        console.log('Usuário encontrado:', user);

        // Renomeia o arquivo da imagem de perfil com o ID do usuário
        const oldPath = req.file.path;
        const newPath = path.join(path.dirname(oldPath), `usuario-${userId}${path.extname(oldPath)}`);
        fs.renameSync(oldPath, newPath);

        // Atualiza o banco de dados com o caminho da imagem de perfil
        const imagePath = newPath.replace(/\\/g, '/'); // Substitui '\' por '/' para evitar problemas com caminhos de arquivo no Windows
        db.run('UPDATE usuarios SET imagem_perfil = ? WHERE id = ?', [imagePath, userId], (err) => {
            if (err) {
                console.error('Erro ao atualizar o banco de dados:', err);
                return res.status(500).json({ error: 'Erro ao salvar imagem de perfil' });
            }

            res.status(200).json({ message: 'Imagem de perfil enviada e associada com sucesso' });
        });
    });
}); /// rpta pra realizar envio da foto de perfil do usuario ja cadastrado

app.get('/obter-imagem-de-perfil/:userId', (req, res) => {
    const userId = req.params.userId;
  
    // Consulte o banco de dados para obter o caminho da imagem de perfil do usuário
    db.get('SELECT imagem_perfil FROM usuarios WHERE id = ?', [userId], (err, user) => {
      if (err) {
        console.error('Erro ao consultar o banco de dados:', err);
        return res.status(500).json({ error: 'Erro ao consultar o banco de dados' });
      }
      
      let imageUrl;
      if (user && user.imagem_perfil) {
          // Se o usuário tiver uma imagem de perfil, retorne o URL dessa imagem
          imageUrl = user.imagem_perfil;
      } else {
          // Se o usuário não tiver uma imagem de perfil, retorne o URL da imagem padrão
          imageUrl = 'uploads/imagens/perfil/padrao.jpg'; // Substitua com o caminho correto da sua imagem padrão
      }

      const vpsUrl = config.vpsUrl;

      const fullUrl = `${vpsUrl}/${imageUrl}`;
  
      // Retorna o URL da imagem como resposta
      res.json({ url: fullUrl });
    });
});  /// rota pra obter o link de perfil do usuario pelo ID

app.get('/download', (req, res) => {
    try {
        // Caminho do arquivo a ser baixado
        const filePath = 'database.db';

        // Verificar se o arquivo existe
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('O arquivo não existe.');
        }

        // Enviar o arquivo como resposta para download
        res.download(filePath, 'database.db', (err) => {
            if (err) {
                console.error('Erro ao enviar arquivo para download:', err);
                res.status(500).send('Erro ao baixar o arquivo.');
            } else {
                console.log('Arquivo enviado para download com sucesso.');
            }
        });
    } catch (error) {
        console.error('Erro ao processar a solicitação de download:', error);
        res.status(500).send('Erro ao processar a solicitação de download.');
    }
}); /// rota pra baixar o banco de dados pelo navegador

app.delete('/usuarios', (req, res) => {
    // Consulta SQL para limpar todas as credenciais de usuários
    db.run('DELETE FROM usuarios', (err) => {
        if (err) {
            console.error('Erro ao limpar todas as credenciais de usuários:', err);
            return res.status(500).json({ error: 'Erro ao limpar todas as credenciais de usuários' });
        }

        // Consulta SQL para recriar a tabela usuários, reiniciando a sequência
        db.run('DROP TABLE IF EXISTS usuarios', (err) => {
            if (err) {
                console.error('Erro ao recriar a tabela usuários:', err);
                return res.status(500).json({ error: 'Erro ao recriar a tabela usuários' });
            }

            // Crie novamente a tabela usuários
            db.run('CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, email TEXT, senha TEXT)', (err) => {
                if (err) {
                    console.error('Erro ao criar novamente a tabela usuários:', err);
                    return res.status(500).json({ error: 'Erro ao criar novamente a tabela usuários' });
                }

                // Todas as credenciais de usuários foram limpas e a sequência foi reiniciada com sucesso
                return res.status(200).json({ message: 'Todas as credenciais de usuários foram limpas e a sequência foi reiniciada com sucesso' });
            });
        });
    });
}); /// rota pra excluir todos usuarios do banco de dados

app.delete('/usuarios/:id', (req, res) => {
    const userId = req.params.id;

    // Consulta SQL para deletar o usuário pelo ID
    db.run('DELETE FROM usuarios WHERE id = ?', userId, (err) => {
        if (err) {
            console.error('Erro ao deletar usuário:', err);
            return res.status(500).json({ error: 'Erro ao deletar usuário' });
        }

        // Usuário deletado com sucesso
        return res.status(200).json({ message: 'Usuário deletado com sucesso' });
    });
}); /// rota pra deletar usuario pelo ID

app.delete('/usuarios/email/:email', (req, res) => {
    const userEmail = req.params.email;

    // Consulta SQL para deletar o usuário pelo email
    db.run('DELETE FROM usuarios WHERE email = ?', userEmail, (err) => {
        if (err) {
            console.error('Erro ao deletar usuário:', err);
            return res.status(500).json({ error: 'Erro ao deletar usuário' });
        }

        // Usuário deletado com sucesso
        return res.status(200).json({ message: 'Usuário deletado com sucesso' });
    });
}); /// Rota para deletar um usuário por email

app.delete('/usuarios/nome/:nome', (req, res) => {
    const userName = req.params.nome;

    // Consulta SQL para deletar o usuário pelo nome de usuário
    db.run('DELETE FROM usuarios WHERE nome = ?', userName, (err) => {
        if (err) {
            console.error('Erro ao deletar usuário:', err);
            return res.status(500).json({ error: 'Erro ao deletar usuário' });
        }

        // Usuário deletado com sucesso
        return res.status(200).json({ message: 'Usuário deletado com sucesso' });
    });
}); /// Rota para deletar um usuário por nome de usuário

 ///  rota de realizar login no site

app.post('/login', (req, res) => {
    const { user, senha } = req.body;

    // Consulta SQL para verificar se o email ou o nome de usuário correspondem
    db.get('SELECT * FROM usuarios WHERE (email = ? OR nome = ?) AND senha = ?', [user, user, senha], (err, row) => {
        if (err) {
            console.error('Erro ao fazer login:', err);
            return res.status(500).json({ error: 'Erro ao fazer login' });
        }

        // Verifique se o usuário foi encontrado
        if (row) {
            // Usuário autenticado com sucesso
            try {
                const token = jwt.sign({ id: row.id, nome: row.nome, email: row.email, vip: row.vip, admin: row.admin, imagem_perfil: row.imagem_perfil }, 'chave_secreta', { expiresIn: '30d' });
                return res.status(200).json({ message: 'Login bem-sucedido', token });
            } catch (e) {
                console.error('Erro ao criar token JWT:', e);
                return res.status(500).json({ error: 'Erro ao criar token JWT' });
            }
        } else {
            return res.status(401).json({ error: 'E-mail ou senha incorretos' });
        }
    });
});

app.post('/cadastro', (req, res) => {
    const { user, email, senha } = req.body;

    // Verifique se o email já está cadastrado
    db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error('Erro ao verificar o email:', err);
            return res.status(500).json({ error: 'Erro ao verificar o email' });
        }

        if (row) {
            // O email já está cadastrado
            return res.status(400).json({ error: 'O email já está cadastrado' });
        } else {
            // Insere o novo usuário no banco de dados
            db.run('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)', [user, email, senha], (err) => {
                if (err) {
                    console.error('Erro ao cadastrar o usuário:', err);
                    return res.status(500).json({ error: 'Erro ao cadastrar o usuário' });
                }

                // Usuário cadastrado com sucesso
                return res.status(201).json({ message: 'Usuário cadastrado com sucesso' });
            });
        }
    });
}); /// rota de realizar cadastro no site

const organizarEpisodios = () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT * FROM episodios
            ORDER BY anime_id, temporada, numero;
        `;
        
        db.all(query, (error, rows) => {
            if (error) {
                reject('Erro ao buscar episódios:', error);
            }
            
            const promises = [];
            let nextId = 1;
            
            // Itera sobre os episódios e atualiza os IDs
            rows.forEach(row => {
                const updateQuery = `
                    UPDATE episodios
                    SET id = ?
                    WHERE id = ? AND anime_id = ?;
                `;
                const updatePromise = new Promise((resolve, reject) => {
                    db.run(updateQuery, [nextId, row.id, row.anime_id], (error) => {
                        if (error) {
                            reject('Erro ao atualizar episódio:', error);
                        } else {
                            resolve();
                        }
                    });
                });
                promises.push(updatePromise);
                
                nextId++;
            });
            
            // Executa todas as promessas em paralelo
            Promise.all(promises)
                .then(() => {
                    resolve('IDs dos episódios atualizados com sucesso!');
                })
                .catch(error => {
                    reject(error);
                });
        });
    });
};

app.post('/inserirDados', (req, res) => {
    const anime = req.body;
    const episodios = anime.episodios; // Extrai os episódios do corpo da requisição
    delete anime.episodios; // Remove os episódios do objeto anime principal

    // Consulta para buscar o último ID inserido na tabela animes
    const queryUltimoId = 'SELECT MAX(id) as ultimoId FROM animes';

    // Consulta para inserir o novo anime
    const queryAnime = 'INSERT INTO animes (id, capa, titulo, tituloAlternativo, selo, sinopse, genero, classificacao, status, qntd_temporadas, anoLancamento, dataPostagem, ovas, filmes, estudio, diretor, tipoMidia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

    db.get(queryUltimoId, [], (error, row) => {
        if (error) {
            console.error('Erro ao buscar o último ID:', error);
            res.status(500).send('Erro ao inserir os dados do anime no banco de dados.');
            return;
        }

        const proximoId = (row.ultimoId || 0) + 1; // Incrementa o último ID encontrado ou define como 1 se não houver registros

        db.run(queryAnime, [
            proximoId, // Define o próximo ID
            anime.capa, 
            anime.titulo, 
            anime.tituloAlternativo, 
            anime.selo, 
            anime.sinopse,
            anime.genero.join(','), // Usando diretamente o valor do gênero recebido
            anime.classificacao, 
            anime.status, 
            anime.qntd_temporadas, 
            anime.anoLancamento, 
            anime.dataPostagem, 
            anime.ovas, 
            anime.filmes, 
            anime.estudio, 
            anime.diretor,
            anime.tipoMidia
        ], function(error) {
            if (error) {
                console.error('Erro ao inserir os dados do anime:', error);
                res.status(500).send('Erro ao inserir os dados do anime no banco de dados.');
                return;
            }
            
            console.log('Anime inserido com sucesso! ID:', proximoId);
            const animeId = proximoId;

            // Agora insira os episódios associados ao anime
            if (episodios && episodios.length > 0) {
                const queryEpisodios = 'INSERT INTO episodios (temporada, numero, nome, link, capa_ep, anime_id, data_lancamento) VALUES (?, ?, ?, ?, ?, ?, ?)';
                const agora = new Date().toISOString().slice(0, 19).replace('T', ' '); // Obtém a data e hora atuais no formato 'YYYY-MM-DD HH:MM:SS'
                
                episodios.forEach(episodio => {
                    db.run(queryEpisodios, [
                        episodio.temporada,
                        episodio.numero,
                        episodio.nome,
                        episodio.link,
                        episodio.capa_ep,
                        animeId,
                        agora // Define a data e hora atuais para cada episódio
                    ], function(error) {
                        if (error) {
                            console.error('Erro ao inserir episódio:', error);
                            return res.status(500).send('Erro ao inserir episódio no banco de dados.');
                        }
                        console.log('Episódio inserido com sucesso! ID:', this.lastID);
                    });
                });
            }

            // Retornar o ID do anime recém-inserido
            res.status(200).json({ id: animeId });
        });
    });
});
/// rota pra inserir dados no geral no banco de dados 

app.post('/inserirEpisodios', (req, res) => {
    const episodios = req.body.episodios;
    const animeId = req.body.animeId;
    console.log('Episódios recebidos:', episodios); 
    console.log('ID do anime associado:', animeId); 

    // Iniciar uma transação SQLite
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const query = 'INSERT INTO episodios (temporada, numero, nome, link, capa_ep, anime_id) VALUES (?, ?, ?, ?, ?, ?)';
        let successCount = 0;
    
        episodios.forEach(episodio => {
            // Verificar se o número do episódio já existe para o anime
            db.get('SELECT * FROM episodios WHERE temporada = ? AND numero = ? AND anime_id = ?', [episodio.temporada, episodio.numero, animeId], (error, row) => {
                if (error) {
                    console.error('Erro ao verificar a existência do episódio:', error);
                    db.run('ROLLBACK');
                    res.status(500).json({ message: 'Erro ao verificar a existência do episódio.' });
                    return;
                }
                if (row) {
                    console.error('O episódio já existe para este anime:', episodio.numero);
                    res.status(400).json({ message: 'O episódio já existe para este anime.' });
                    return;
                }
                
                // Se o episódio não existe, realizar a inserção
                db.run(query, [episodio.temporada, episodio.numero, episodio.nome, episodio.link, episodio.capa_ep, animeId], (error) => {
                    if (error) {
                        console.error('Erro ao inserir os dados do episódio:', error);
                        db.run('ROLLBACK');
                        res.status(500).json({ message: 'Erro ao inserir os dados do episódio no banco de dados.' });
                        return;
                    } else {
                        console.log('Dados do episódio inseridos com sucesso!');
                        successCount++;
                        if (successCount === episodios.length) {
                            // Se todos os episódios foram inseridos com sucesso, commit a transação
                            db.run('COMMIT');
                            res.status(200).json({ message: 'Dados dos episódios inseridos com sucesso!' });
                        }
                    }
                });
            });
        });
    });
}); /// inserir episodios no banco de dados 

app.put('/catalogo/:id', (req, res) => {
    const animeId = req.params.id;
    const newAnimeData = req.body;

    // Consulta SQL para atualizar os dados do anime pelo ID
    const query = `
        UPDATE animes 
        SET 
            id = ?,
            capa = ?,
            titulo = ?,
            tituloAlternativo = ?,
            selo = ?,
            sinopse = ?,
            genero = ?,
            classificacao = ?,
            status = ?,
            qntd_temporadas = ?,
            anoLancamento = ?,
            dataPostagem = ?,
            ovas = ?,
            filmes = ?,
            estudio = ?,
            diretor = ?,
            tipoMidia = ?
        WHERE 
            id = ?
    `;

    const dataValues = [
        newAnimeData.id,
        newAnimeData.capa,
        newAnimeData.titulo,
        newAnimeData.tituloAlternativo,
        newAnimeData.selo,
        newAnimeData.sinopse,
        newAnimeData.genero.join(','), // Considerando que os gêneros são enviados como uma lista
        newAnimeData.classificacao,
        newAnimeData.status,
        newAnimeData.qntd_temporadas,
        newAnimeData.anoLancamento,
        newAnimeData.dataPostagem,
        newAnimeData.ovas,
        newAnimeData.filmes,
        newAnimeData.estudio,
        newAnimeData.diretor,
        newAnimeData.tipoMidia,
        animeId
    ];

    // Incluir lógica para atualizar os dados dos episódios associados
    const updateEpisodesQuery = `
        UPDATE episodios 
        SET 
            temporada = ?,
            numero = ?,
            nome = ?,
            link = ?,
            capa_ep = ?
        WHERE 
            id = ? AND anime_id = ?
    `;

    const episodesData = newAnimeData.episodios;

    // Função para atualizar os episódios
    const updateEpisodes = (db, updateEpisodesQuery, episodesData, animeId) => {
        return new Promise((resolve, reject) => {
            // Exclui todos os episódios existentes para este anime
            const deleteEpisodesQuery = `
                DELETE FROM episodios 
                WHERE anime_id = ?;
            `;
            db.run(deleteEpisodesQuery, [animeId], (error) => {
                if (error) {
                    reject('Erro ao excluir episódios existentes:', error);
                }
                
    
                // Itera sobre os episódios fornecidos e insere-os no banco de dados
                episodesData.forEach(episodio => {
                    const episodeValues = [
                        episodio.temporada,
                        episodio.numero,
                        episodio.nome,
                        episodio.link,
                        episodio.capa_ep,
                        animeId,
                        episodio.alertanovoep || 0 
                    ];
    
                    const insertEpisodeQuery = `
                    INSERT INTO episodios (temporada, numero, nome, link, capa_ep, anime_id, alertanovoep) 
                        VALUES (?, ?, ?, ?, ?, ?, ?);
                    `;
                    db.run(insertEpisodeQuery, episodeValues, (error) => {
                        if (error) {
                            reject('Erro ao inserir episódio:', error);
                        }
                    });
                });
    
                // Resolve a promessa após a atualização dos episódios
                resolve();
            });
        });
    };

    // Atualizar os episódios primeiro
    updateEpisodes(db, updateEpisodesQuery, episodesData, animeId)
        .then(() => {
            // Após atualizar os episódios, atualizar os dados do anime principal
            db.run(query, dataValues, (error) => {
                if (error) {
                    console.error('Erro ao atualizar os dados do anime:', error);
                    return res.status(500).send('Erro ao atualizar os dados do anime no banco de dados.');
                }
                res.status(200).json({ message: 'Dados do anime atualizados com sucesso!' });
            });
        })
        .catch((error) => {
            console.error(error);
            return res.status(500).send(error);
        });
});/// rota pra editar um anime existente ja no banco de dados pelo ID

app.post('/marcar-alerta', (req, res) => {
    const { anime_id, numero } = req.body;

    if (!anime_id || !numero) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios não fornecidos' });
    }

    // Atualizar o alerta no banco de dados
    db.run(
        `UPDATE episodios
         SET alertanovoep = 0
         WHERE anime_id = ? AND numero = ?`,
        [anime_id, numero],
        function (err) {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'Erro ao atualizar o alerta' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ message: 'Nenhum episódio encontrado para atualizar' });
            }
            res.status(200).json({ message: 'Alerta marcado como 0 com sucesso' });
        }
    );
});

app.get('/todosAnimes/:id?', (req, res) => {
    const animeId = req.params.id;

    // Verifica se o parâmetro ID está presente na URL
    if (animeId) {
        // Consulta SQL para selecionar os dados de um anime específico pelo ID
        const query = `
            SELECT 
                a.id,
                a.capa,
                a.titulo,
                a.tituloAlternativo,
                a.selo,
                a.sinopse,
                a.genero,
                a.classificacao,
                a.status,
                a.qntd_temporadas,
                a.anoLancamento,
                a.dataPostagem,
                a.ovas,
                a.filmes,
                a.estudio,
                a.diretor,
                a.tipoMidia,
                e.temporada,
                e.numero,
                e.nome AS nome_episodio,
                e.link,
                e.capa_ep,
                e.alertanovoep,  
                a.visualizacoes AS visualizacoes
            FROM 
                animes a
            LEFT JOIN 
                episodios e ON a.id = e.anime_id
            WHERE
                a.id = ?
            ORDER BY e.numero ASC; // Ordena os episódios por número de episódio
        `;

        db.all(query, [animeId], (error, rows) => {
            if (error) {
                console.error('Erro ao selecionar os dados do anime:', error);
                return res.status(500).send('Erro ao selecionar os dados do anime do banco de dados.');
            }

            // Verifica se há resultados
            if (rows.length === 0) {
                return res.status(404).send('Anime não encontrado.');
            }

            // Mapeie os resultados para formatar os dados conforme desejado
            const anime = {
                id: rows[0].id,
                capa: rows[0].capa,
                titulo: rows[0].titulo,
                tituloAlternativo: rows[0].tituloAlternativo,
                selo: rows[0].selo,
                sinopse: rows[0].sinopse,
                generos: rows[0].genero ? rows[0].genero.split(',') : [],
                classificacao: rows[0].classificacao,
                status: rows[0].status,
                qntd_temporadas: rows[0].qntd_temporadas,
                anoLancamento: rows[0].anoLancamento,
                dataPostagem: rows[0].dataPostagem,
                ovas: rows[0].ovas,
                filmes: rows[0].filmes,
                estudio: rows[0].estudio,
                diretor: rows[0].diretor,
                tipoMidia: rows[0].tipoMidia,
                visualizacoes: rows[0].visualizacoes,
                episodios: []
            };

            // Adicione os episódios ao anime, se houver
            rows.forEach(row => {
                if (row.temporada && row.numero) {
                    // Se houver um episódio associado, adicione-o ao anime atual
                    anime.episodios.push({
                        temporada: row.temporada,
                        numero: row.numero,
                        nome: row.nome_episodio,
                        link: row.link,
                        capa_ep: row.capa_ep,
                        alertanovoep: row.alertanovoep 
                    });
                }
            });

            res.status(200).json(anime);
        });
    } else {
        // Se o parâmetro ID não estiver presente, retorna todos os animes
        // Consulta SQL para selecionar todos os dados da tabela "animes" juntamente com os episódios associados
        const query = `
            SELECT 
                a.id,
                a.capa,
                a.titulo,
                a.tituloAlternativo,
                a.selo,
                a.sinopse,
                a.genero,
                a.classificacao,
                a.status,
                a.qntd_temporadas,
                a.anoLancamento,
                a.dataPostagem,
                a.ovas,
                a.filmes,
                a.estudio,
                a.diretor,
                a.tipoMidia,
                e.temporada,
                e.numero,
                e.nome AS nome_episodio,
                e.link,
                e.capa_ep,
                e.alertanovoep,
                a.visualizacoes AS visualizacoes
            FROM 
                animes a
            LEFT JOIN 
                episodios e ON a.id = e.anime_id;
        `;

        db.all(query, (error, rows) => {
            if (error) {
                console.error('Erro ao selecionar os dados dos animes:', error);
                return res.status(500).send('Erro ao selecionar os dados dos animes do banco de dados.');
            }

            // Mapeie os resultados para formatar os dados conforme desejado
            const animes = [];
            let currentAnimeId = null;
            let currentAnime = null;

            rows.forEach(row => {
                if (row.id !== currentAnimeId) {
                    // Um novo anime foi encontrado
                    currentAnime = {
                        id: row.id,
                        capa: row.capa,
                        titulo: row.titulo,
                        tituloAlternativo: row.tituloAlternativo,
                        selo: row.selo,
                        sinopse: row.sinopse,
                        generos: row.genero ? row.genero.split(',') : [],
                        classificacao: row.classificacao,
                        status: row.status,
                        qntd_temporadas: row.qntd_temporadas,
                        anoLancamento: row.anoLancamento,
                        dataPostagem: row.dataPostagem,
                        ovas: row.ovas,
                        filmes: row.filmes,
                        estudio: row.estudio,
                        diretor: row.diretor,
                        tipoMidia: row.tipoMidia,
                        visualizacoes: row.visualizacoes,
                        episodios: []
                    };
                    animes.push(currentAnime);
                    currentAnimeId = row.id;
                }

                if (row.temporada && row.numero) {
                    // Se houver um episódio associado, adicione-o ao anime atual
                    currentAnime.episodios.push({
                        temporada: row.temporada,
                        numero: row.numero,
                        nome: row.nome_episodio,
                        link: row.link,
                        capa_ep: row.capa_ep,
                        alertanovoep: row.alertanovoep 
                    });
                }
            });

            res.status(200).json(animes);
        });
    }
}); /// rota que envia todos resultados de todos animes se nao especificar id como parametro e se especificar id retorna o valor de um catalogo em especifico

const RESULTS_PER_PAGE = 30; // Quantidade de resultados por página

app.get('/animesPagina/:page?', (req, res) => {
    const page = parseInt(req.params.page) || 1; // Página padrão é a página 1

    // Calcular o deslocamento
    const offset = (page - 1) * RESULTS_PER_PAGE;

    // Consulta SQL para contar o número total de registros na tabela de animes
    const countQuery = `SELECT COUNT(*) AS total FROM animes`;

    // Função para obter estatísticas
    function getStatistics(callback) {
        db.get('SELECT total_animes, total_episodios FROM estatisticas ORDER BY data_atualizacao DESC LIMIT 1', (error, row) => {
            if (error) {
                console.error('Erro ao consultar estatísticas:', error);
                return callback(error);
            }
            callback(null, row);
        });
    }

    // Obter o total de animes e episódios
    getStatistics((error, statistics) => {
        if (error) {
            return res.status(500).send('Erro ao obter estatísticas.');
        }

        // Consultar o total de registros e dados dos animes e episódios
        db.get(countQuery, (error, countRow) => {
            if (error) {
                console.error('Erro ao contar o número total de registros:', error);
                return res.status(500).send('Erro ao contar o número total de registros na tabela de animes.');
            }

            const totalRecords = countRow.total;
            const totalPages = Math.ceil(totalRecords / RESULTS_PER_PAGE);

            const query = `
                SELECT 
                    a.id AS anime_id,
                    a.capa AS anime_capa,
                    a.titulo AS anime_titulo,
                    a.tituloAlternativo AS anime_tituloAlternativo,
                    a.selo AS anime_selo,
                    a.sinopse AS anime_sinopse,
                    a.genero AS anime_genero,
                    a.classificacao AS anime_classificacao,
                    a.status AS anime_status,
                    a.qntd_temporadas AS anime_qntd_temporadas,
                    a.anoLancamento AS anime_anoLancamento,
                    a.dataPostagem AS anime_dataPostagem,
                    a.ovas AS anime_ovas,
                    a.filmes AS anime_filmes,
                    a.estudio AS anime_estudio,
                    a.diretor AS anime_diretor,
                    a.tipoMidia AS anime_tipoMidia,
                    e.temporada AS episodio_temporada,
                    e.numero AS episodio_numero,
                    e.nome AS episodio_nome,
                    e.link AS episodio_link,
                    e.capa_ep AS episodio_capa_ep
                FROM 
                    animes a
                LEFT JOIN 
                    episodios e ON a.id = e.anime_id
                WHERE 
                    a.id IN (
                        SELECT id FROM animes ORDER BY id ASC LIMIT ? OFFSET ?
                    )
                ORDER BY a.id ASC, e.numero ASC;
            `;

            db.all(query, [RESULTS_PER_PAGE, offset], (error, rows) => {
                if (error) {
                    console.error('Erro ao selecionar os dados dos animes:', error);
                    return res.status(500).send('Erro ao selecionar os dados dos animes do banco de dados.');
                }

                // Mapeie os resultados para formatar os dados conforme desejado
                const animes = [];
                let currentAnime = null;

                rows.forEach(row => {
                    if (!currentAnime || currentAnime.id !== row.anime_id) {
                        // Um novo anime foi encontrado
                        currentAnime = {
                            id: row.anime_id,
                            capa: row.anime_capa,
                            titulo: row.anime_titulo,
                            tituloAlternativo: row.anime_tituloAlternativo,
                            selo: row.anime_selo,
                            sinopse: row.anime_sinopse,
                            generos: row.anime_genero ? row.anime_genero.split(',') : [],
                            classificacao: row.anime_classificacao,
                            status: row.anime_status,
                            qntd_temporadas: row.anime_qntd_temporadas,
                            anoLancamento: row.anime_anoLancamento,
                            dataPostagem: row.anime_dataPostagem,
                            ovas: row.anime_ovas,
                            filmes: row.anime_filmes,
                            estudio: row.anime_estudio,
                            diretor: row.anime_diretor,
                            tipoMidia: row.anime_tipoMidia,
                            episodios: []
                        };
                        animes.push(currentAnime);
                    }

                    if (row.episodio_temporada && row.episodio_numero) {
                        // Adicione todos os dados do episódio ao anime atual
                        currentAnime.episodios.push({
                            temporada: row.episodio_temporada,
                            numero: row.episodio_numero,
                            nome: row.episodio_nome,
                            link: row.episodio_link,
                            capa_ep: row.episodio_capa_ep
                        });
                    }
                });

                const paginatedAnimes = animes.slice(0, RESULTS_PER_PAGE);

                // Retornar os dados no formato desejado
                res.status(200).json({
                    animes: paginatedAnimes,
                    totalPages: totalPages,
                    totalAnimes: statistics ? statistics.total_animes : null,
                    totalEpisodios: statistics ? statistics.total_episodios : null
                });
            });
        });
    });
}); /// recebe animes de acordo com a paginaçao

app.delete('/limparBanco', (req, res) => {
  // Consulta SQL para deletar todos os dados da tabela "animes"
  const deleteAnimesQuery = 'DELETE FROM animes';
  // Consulta SQL para deletar todos os dados da tabela "episodios"
  const deleteEpisodiosQuery = 'DELETE FROM episodios';
  // Consulta SQL para resetar a sequência da tabela "animes"
  const resetAnimesSequenceQuery = 'DELETE FROM sqlite_sequence WHERE name="animes"';
  // Consulta SQL para resetar a sequência da tabela "episodios"
  const resetEpisodiosSequenceQuery = 'DELETE FROM sqlite_sequence WHERE name="episodios"';

  db.run(deleteAnimesQuery, (error) => {
      if (error) {
          console.error('Erro ao limpar o banco de dados (animes):', error);
          res.status(500).send('Erro ao limpar o banco de dados (animes).');
          return;
      }
      console.log('Dados da tabela "animes" excluídos com sucesso!');

      // Após excluir os animes, exclua os episódios
      db.run(deleteEpisodiosQuery, (error) => {
          if (error) {
              console.error('Erro ao limpar o banco de dados (episódios):', error);
              res.status(500).send('Erro ao limpar o banco de dados (episódios).');
              return;
          }
          console.log('Dados da tabela "episódios" excluídos com sucesso!');

          // Após excluir os episódios, resete a sequência da tabela "animes"
          db.run(resetAnimesSequenceQuery, (error) => {
              if (error) {
                  console.error('Erro ao resetar a sequência da tabela "animes":', error);
                  res.status(500).send('Erro ao resetar a sequência da tabela "animes".');
                  return;
              }
              console.log('Sequência da tabela "animes" resetada com sucesso!');

              // Após excluir os episódios, resete a sequência da tabela "episodios"
              db.run(resetEpisodiosSequenceQuery, (error) => {
                  if (error) {
                      console.error('Erro ao resetar a sequência da tabela "episodios":', error);
                      res.status(500).send('Erro ao resetar a sequência da tabela "episodios".');
                      return;
                  }
                  console.log('Sequência da tabela "episodios" resetada com sucesso!');
                  res.status(200).json({ message: 'Banco de dados limpo com sucesso!' }); // Enviar resposta em JSON
              });
          });
      });
  });
}); /// rota que limpa o banco de dados por completo

app.delete('/excluirAnime/:id', (req, res) => {
    const animeId = req.params.id;

    // Consulta SQL para excluir o anime pelo ID
    const deleteAnimeQuery = 'DELETE FROM animes WHERE id = ?';

    // Consulta SQL para excluir os episódios associados ao anime pelo ID
    const deleteEpisodiosQuery = 'DELETE FROM episodios WHERE anime_id = ?';

    // Executa a consulta para excluir o anime pelo ID
    db.run(deleteAnimeQuery, [animeId], (error) => {
        if (error) {
            console.error('Erro ao excluir o anime:', error);
            res.status(500).send('Erro ao excluir o anime do banco de dados.');
            return;
        }
        console.log('Anime excluído com sucesso!');

        // Executa a consulta para excluir os episódios associados ao anime pelo ID
        db.run(deleteEpisodiosQuery, [animeId], (error) => {
            if (error) {
                console.error('Erro ao excluir os episódios do anime:', error);
                res.status(500).send('Erro ao excluir os episódios do anime do banco de dados.');
                return;
            }
            console.log('Episódios do anime excluídos com sucesso!');
            
            // Envie uma resposta indicando que o anime e seus episódios foram excluídos com sucesso
            res.status(200).json({ message: 'Anime e episódios excluídos com sucesso!' });
        });
    });
}); /// rota pra excluir um anime especifico pelo ID

app.put('/alterarDominio', (req, res) => {
    const { dominioAntigo, dominioNovo } = req.body;

    // Verifica se ambos os domínios foram fornecidos no corpo da solicitação
    if (!dominioAntigo || !dominioNovo) {
        return res.status(400).send('Os domínios antigo e novo devem ser fornecidos.');
    }

    // Atualizar links dos episódios
    db.run('UPDATE episodios SET link = REPLACE(link, ?, ?)', [dominioAntigo, dominioNovo], (error) => {
        if (error) {
            console.error('Erro ao atualizar os links dos episódios:', error);
            return res.status(500).send('Erro ao atualizar os links dos episódios.');
        }

        // Atualizar links das capas dos animes
        db.run('UPDATE animes SET capa = REPLACE(capa, ?, ?)', [dominioAntigo, dominioNovo], (error) => {
            if (error) {
                console.error('Erro ao atualizar os links das capas dos animes:', error);
                return res.status(500).send('Erro ao atualizar os links das capas dos animes.');
            }

            // Atualizar links das capas dos episódios
            db.run('UPDATE episodios SET capa_ep = REPLACE(capa_ep, ?, ?)', [dominioAntigo, dominioNovo], (error) => {
                if (error) {
                    console.error('Erro ao atualizar os links das capas dos episódios:', error);
                    return res.status(500).send('Erro ao atualizar os links das capas dos episódios.');
                }

                console.log('Links atualizados com sucesso.');
                res.status(200).send('Links atualizados com sucesso.');
            });
        });
    });
}); /// rota pra alterar o dominio do site onde os video e imagem de capas dos video estao sendo apontados bem util caso o dominio do site mude

app.post('/api/gerar-link-temporario', (req, res) => {
    const { linkVideo } = req.body;
    const idTemporario = uuidv4();
    const dataExpiracao = Date.now() + 2 * 60 * 60 * 1000; // 2 horas em milissegundos

    db.run("INSERT INTO links (idTemporario, linkVideo, dataExpiracao) VALUES (?, ?, ?)", [idTemporario, linkVideo, dataExpiracao], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao armazenar o link temporário no banco de dados' });
        }

        const temporaryLink = `${vpsUrl}/api/receber-link-temporario/${idTemporario}`;
        res.json({ temporaryLink });
    });
}); /// rota pra gerar link temporario

app.get('/api/receber-link-temporario/:idTemporario', (req, res) => {
    const { idTemporario } = req.params;

    db.get("SELECT linkVideo, dataExpiracao FROM links WHERE idTemporario = ?", [idTemporario], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao recuperar o link do vídeo do banco de dados' });
        }

        if (!row) {
            return res.status(404).json({ error: 'Link temporário não encontrado' });
        }

        const { linkVideo, dataExpiracao } = row;

        // Verifica se o link temporário expirou
        if (dataExpiracao < Date.now()) {
            // Se expirado, exclui o link temporário da tabela
            db.run("DELETE FROM links WHERE idTemporario = ?", [idTemporario], (deleteErr) => {
                if (deleteErr) {
                    return res.status(500).json({ error: 'Erro ao excluir o link temporário do banco de dados' });
                }

                // Após excluir o link, chama o vácuo para otimização do banco de dados
                db.run("VACUUM", [], (vacuumErr) => {
                    if (vacuumErr) {
                        console.error('Erro ao executar vacuum:', vacuumErr);
                    } else {
                        console.log('Vácuo executado com sucesso.');
                    }
                });
            });
            return res.status(404).json({ error: 'Link temporário expirado' });
        }

        // Redireciona para o link do vídeo correspondente
        res.redirect(linkVideo);
    });
}); /// rota pra receber o link temporario

app.get('/titulos-semelhantes/:id', (req, res) => {
    const animeId = req.params.id;

    const query = `
        SELECT 
            animes.id,
            animes.titulo,
            animes.capa AS foto_capa
        FROM 
            animes
        WHERE
            animes.genero = (SELECT genero FROM animes WHERE id = ?)
            AND animes.id != ?
        LIMIT 10;
    `;

    db.all(query, [animeId, animeId], (error, rows) => {
        if (error) {
            console.error('Erro ao selecionar os títulos semelhantes ao anime:', error);
            return res.status(500).send('Erro ao selecionar os títulos semelhantes ao anime do banco de dados.');
        }

        if (rows.length === 0) {
            return res.status(404).send('Não foram encontrados títulos semelhantes ao anime.');
        }

        // Formata os resultados conforme desejado
        const titulosSemelhantes = rows.map(row => ({
            id: row.id,
            titulo: row.titulo,
            foto_capa: row.foto_capa // Adiciona a URL da foto de capa
        }));

        res.status(200).json(titulosSemelhantes);
    });
});

app.get('/animes_exibir/:anime_id', (req, res) => {
    const animeId = req.params.anime_id;

    // Consulta SQL para obter informações do anime
    const animeQuery = `
        SELECT *
        FROM Animes_exibir
        WHERE anime_id = ?
    `;

    // Consulta SQL para obter episódios relacionados ao anime, ordenados pelo número do episódio
    const episodiosQuery = `
        SELECT episodios_exibir.*, 
               episodios_exibir.link_extra_1 AS link_extra_1,
               episodios_exibir.link_extra_2 AS link_extra_2,
               episodios_exibir.link_extra_3 AS link_extra_3
        FROM Episodios_exibir
        WHERE anime_id = ?
        ORDER BY episodio ASC
    `;

    // Executar a consulta SQL para obter informações do anime
    db.all(animeQuery, [animeId], (err, animeRows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro ao buscar informações do anime');
            return;
        }

        // Executar a consulta SQL para obter episódios relacionados ao anime
        db.all(episodiosQuery, [animeId], (err, episodiosRows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro ao buscar episódios do anime');
                return;
            }

            // Combinar dados do anime e episódios em uma única resposta
            const responseData = {
                anime: animeRows[0], // Assume-se que há apenas um anime com o mesmo anime_id
                episodios: episodiosRows
            };

            // Enviar os dados combinados como resposta
            res.json(responseData);
        });
    });
});

app.delete('/animes_exibir/:anime_id', (req, res) => {
    const animeId = req.params.anime_id;

    // Consulta SQL para excluir os episódios relacionados ao anime da tabela Episodios_exibir
    const deleteEpisodiosQuery = `
        DELETE FROM Episodios_exibir
        WHERE anime_id = ?
    `;

    // Executar a consulta SQL para excluir os episódios relacionados ao anime
    db.run(deleteEpisodiosQuery, [animeId], function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro ao excluir episódios do anime');
            return;
        }

        // Consulta SQL para redefinir o contador de sequência para a tabela episodios
        const resetEpisodiosSequenceQuery = `
            UPDATE SQLITE_SEQUENCE SET seq = 0 WHERE name = 'episodios';
        `;

        // Executar a consulta SQL para redefinir o contador de sequência para a tabela episodios
        db.run(resetEpisodiosSequenceQuery, function(err) {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro ao redefinir o contador de sequência para a tabela episodios');
                return;
            }

            // Envie uma resposta de sucesso após a exclusão e redefinição bem-sucedidas
            res.status(200).send('Episódios excluídos e contador de sequência redefinido com sucesso!');
        });
    });
}); /// Essa rota DELETE irá remover o anime e todos os episódios associados a ele com base no anime_id fornecido.

app.post('/animes_exibir/:anime_id', (req, res) => {
    const animeId = req.params.anime_id;
    const { titulo, episodios } = req.body;

    // Log dos dados recebidos
    console.log('Dados recebidos:');
    console.log('animeId:', animeId);
    console.log('titulo:', titulo);
    console.log('episodios:', episodios);

    // Inserir informações do anime na tabela Animes_exibir
    const insertAnimeQuery = `
        INSERT INTO Animes_exibir (anime_id, titulo)
        VALUES (?, ?)
    `;
    
    db.run(insertAnimeQuery, [animeId, titulo], function(err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro ao inserir anime');
            return;
        }

        // Anime inserido com sucesso, agora inserir os episódios relacionados
        episodios.forEach(episodio => {
            const { temporada, episodio: numEpisodio, descricao, link, link_extra } = episodio;
            const insertEpisodioQuery = `
                INSERT INTO Episodios_exibir (anime_id, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const values = [animeId, temporada, numEpisodio, descricao, link, link_extra.link_extra_1, link_extra.link_extra_2, link_extra.link_extra_3];
        
            db.run(insertEpisodioQuery, values, function(err) {
                if (err) {
                    console.error(err.message);
                    res.status(500).send('Erro ao inserir episódio');
                    return;
                }
            });
        });
        
        // Enviar resposta de sucesso após a conclusão da inserção de todos os episódios
        res.status(200).send('Anime e episódios inseridos com sucesso!');
    });
}); /// rota pra inserir os detalhes dos animes na tabela 

app.post('/animes_exibir_editar/:anime_id', (req, res) => {
    const animeId = req.params.anime_id;
    const { titulo, episodios } = req.body;

    // Log dos dados recebidos
    console.log('Dados recebidos:');
    console.log('animeId:', animeId);
    console.log('titulo:', titulo);
    console.log('episodios:', episodios);

    // Iniciar a transação
    db.serialize(() => {
        // Atualizar o título do anime
        db.run('UPDATE animes_exibir SET titulo = ? WHERE id = ?', [titulo, animeId], function(err) {
            if (err) {
                console.error('Erro ao atualizar o título do anime:', err.message);
                res.status(500).send('Erro ao atualizar o título do anime');
                return;
            }

            // Deletar todos os episódios existentes para o anime
            db.run('DELETE FROM Episodios_exibir WHERE anime_id = ?', [animeId], function(err) {
                if (err) {
                    console.error('Erro ao deletar episódios existentes:', err.message);
                    res.status(500).send('Erro ao deletar episódios existentes');
                    return;
                }

                // Inserir os novos episódios na ordem correta
                const insertEpisodioQuery = `
                    INSERT INTO Episodios_exibir (anime_id, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                let insertedCount = 0; // Contador para verificar se todos os episódios foram inseridos com sucesso
                episodios.forEach(episodio => {
                    const { temporada, episodio: numEpisodio, descricao, link, link_extra_1, link_extra_2, link_extra_3 } = episodio;
                    
                    // Verificar se os links extras foram enviados vazios e tratá-los adequadamente
                    const linksExtras = [link_extra_1, link_extra_2, link_extra_3];
                    const linksExtrasTratados = linksExtras.map(linkExtra => {
                        return linkExtra !== undefined ? linkExtra : null;
                    });

                    db.run(insertEpisodioQuery, [animeId, temporada, numEpisodio, descricao, link, ...linksExtrasTratados], function(err) {
                        if (err) {
                            console.error('Erro ao inserir episódio:', err.message);
                            res.status(500).send('Erro ao inserir episódio');
                            return;
                        }
                        insertedCount++;
                        // Verificar se todos os episódios foram inseridos
                        if (insertedCount === episodios.length) {
                            // Todos os episódios foram inseridos, enviar resposta de sucesso
                            res.status(200).send('Episódios atualizados com sucesso!');
                        }
                    });
                });
            });
        });
    });
}); /// rota pra editar os detalhes dos animes na tabela 

app.post('/animes/:id/visualizar', (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE animes SET visualizacoes = visualizacoes + 1 WHERE id = ?`, [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: `Visualizações do anime com ID ${id} incrementadas.` });
    });
}); /// rota pra incrementar visualizaçao de um anime com o id dele na tabela

app.get('/animes/:id/visualizacoes', (req, res) => {
    const { id } = req.params;
    db.get(`SELECT visualizacoes FROM animes WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: `Anime com ID ${id} não encontrado.` });
            return;
        }
        res.json({ id, visualizacoes: row.visualizacoes });
    });
}); /// rota pra receber os valores de vizualizados na tabela

app.post('/animes/:id/zerar', (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE animes SET visualizacoes = 0 WHERE id = ?`, [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: `Visualizações do anime com ID ${id} foram zeradas.` });
    });
}); /// rota pra zerar os valores de visualizados de uma anime na tabela

app.get('/animes/status/:status', (req, res) => {
    const { status } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    db.all(`SELECT * FROM animes WHERE status = ? LIMIT ? OFFSET ?`, [status, limit, offset], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        db.get(`SELECT COUNT(*) AS total FROM animes WHERE status = ?`, [status], (err, result) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            const total = result.total;
            const totalPages = Math.ceil(total / limit);

            res.json({
                paginaAtual: page,
                paginaTotal: totalPages,
                itensTotal: total,
                itens: rows
            });
        });
    });
}); ///rota pra receber status dos animes que estao em andamentos completos basicamente retorna os animes com base nos status deles
// Endpoint para gerar o sitemap

function generateMultipleSitemaps(res, urls, baseUrl) {
    const maxUrlsPerSitemap = 50000;
    const sitemapIndex = { sitemap: [] };
    const totalSitemaps = Math.ceil(urls.length / maxUrlsPerSitemap);
    const generatedFiles = [];

    try {
        for (let i = 0; i < totalSitemaps; i++) {
            const sitemapUrls = urls.slice(i * maxUrlsPerSitemap, (i + 1) * maxUrlsPerSitemap);

            const builder = new Builder();
            const sitemap = builder.buildObject({
                urlset: {
                    $: {
                        xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9',
                        'xmlns:image': 'http://www.google.com/schemas/sitemap-image/1.1'
                    },
                    url: sitemapUrls
                }
            });

            const fileName = `sitemap-${i + 1}.xml`;
            fs.writeFileSync(fileName, sitemap);
            generatedFiles.push(fileName);

            sitemapIndex.sitemap.push({ loc: `${baseUrl}/${fileName}` });
        }

        // Gera o sitemap-index.xml
        const builder = new Builder();
        const sitemapIndexXml = builder.buildObject({
            sitemapindex: {
                $: { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' },
                sitemap: sitemapIndex.sitemap
            }
        });

        const indexFile = 'sitemap-index.xml';
        fs.writeFileSync(indexFile, sitemapIndexXml);
        generatedFiles.push(indexFile);

        // Cria o arquivo ZIP
        const zipFile = 'sitemaps.zip';
        const output = fs.createWriteStream(zipFile);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            res.download(zipFile, zipFile, (err) => {
                if (err) {
                    console.error('Erro ao enviar o arquivo ZIP:', err);
                    res.status(500).send('Erro ao enviar o arquivo.');
                } else {
                    // Remove arquivos temporários
                    [...generatedFiles, zipFile].forEach(file => {
                        fs.unlink(file, err => {
                            if (err) console.error(`Erro ao remover ${file}:`, err);
                        });
                    });
                }
            });
        });

        archive.on('error', err => {
            console.error('Erro ao criar o ZIP:', err);
            res.status(500).send('Erro ao criar o arquivo ZIP.');
        });

        archive.pipe(output);
        generatedFiles.forEach(file => archive.file(file, { name: file }));
        archive.finalize();

    } catch (err) {
        console.error('Erro ao gerar sitemaps:', err);
        res.status(500).send('Erro ao gerar os sitemaps.');
    }
}


const escapeXml = (unsafe) => {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
};
const processAnimeEpisodes = (anime, type, baseUrl, urls) => {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT e.numero, e.capa_ep, e.nome AS nome_episodio, a.titulo AS titulo_anime FROM episodios e JOIN animes a ON e.anime_id = a.id WHERE e.anime_id = ?",
            [anime.id],
            (err, episodeRows) => {
                if (err) {
                    console.error('Erro na consulta SQL dos episódios:', err);
                    reject('Erro na consulta SQL dos episódios');
                    return;
                }

                episodeRows.forEach(episode => {
                    const loc = `${baseUrl}/d?id=${anime.id}&ep=${episode.numero}`;
                    const imageLoc = episode.capa_ep || '';
                    const imageTitle = `Assistir ${episode.titulo_anime} ${episode.nome_episodio}`;
                    urls.push({
                        loc: escapeXml(loc),
                        changefreq: 'daily',
                        priority: 0.8,
                        lastmod: new Date().toISOString().split('T')[0],
                        'image:image': [
                            {
                                'image:loc': escapeXml(imageLoc),
                                'image:title': escapeXml(imageTitle)
                            }
                        ]
                    });
                });

                resolve(); // Resolve a Promise quando os episódios forem processados
            }
        );
    });
};

app.get('/generate-sitemap', (req, res) => {
    const baseUrl = decodeURIComponent(req.query.url);
    const type = req.query.type; // 'a' para animes, 'e' para episódios, 't' para ambos

    console.log(baseUrl);

    if (!baseUrl) {
        return res.status(400).send('URL base é necessária como parâmetro.');
    }

    if (!type || !['a', 'e', 't'].includes(type)) {
        return res.status(400).send('Tipo inválido. Use "a", "e" ou "t".');
    }

    const fixDIRETORY = [
        { loc: `${baseUrl}/`, changefreq: 'daily', priority: 1.0 },
        { loc: `${baseUrl}/t?pagina=1`, changefreq: 'weekly', priority: 0.8 },
    ];

    db.all("SELECT id, capa, titulo FROM animes", [], (err, animeRows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Erro ao consultar o banco de dados.');
        }

        if (!animeRows.length) {
            return res.status(404).send('Nenhum anime encontrado no banco de dados.');
        }

        const urls = [];
        urls.push(...fixDIRETORY);

        let promises = [];

        animeRows.forEach(anime => {
            // Adiciona URL do anime se o tipo for 'a' ou 't'
            if (type === 'a' || type === 't') {
                const loc = `${baseUrl}/a?id=${anime.id}`;
                const animeTITLE = `Assistir ${anime.titulo} Online`;
                const image_link = anime.capa || '';
                urls.push({
                    loc: loc,
                    changefreq: 'daily',
                    priority: 0.8,
                    lastmod: new Date().toISOString().split('T')[0],
                    'image:image': [
                        {
                            'image:loc': escapeXml(image_link),
                            'image:title': escapeXml(animeTITLE)
                        }
                    ]
                });
            }

            // Adiciona URLs dos episódios se o tipo for 'e' ou 't'
            if (type === 'e' || type === 't') {
                promises.push(processAnimeEpisodes(anime, type, baseUrl, urls)); // Cria a promise para os episódios
            }
        });

        Promise.all(promises)
            .then(() => {
                urls.forEach((u, i) => {
                    if (!u.loc || typeof u.loc !== 'string' || !u.loc.startsWith('http')) {
                        console.error(`URL inválida no índice ${i}:`, u);
                    }
                });
                const urlsFiltradas = urls.filter(u =>
                    u.loc &&
                    typeof u.loc === 'string' &&
                    u.loc.startsWith('http') &&
                    !u.loc.includes('undefined') &&
                    !u.loc.endsWith('.')
                );
                console.log(urlsFiltradas);
                generateMultipleSitemaps(res, urlsFiltradas, baseUrl); // Chama a função para gerar múltiplos sitemaps depois de tudo estar pronto
            })
            .catch((err) => {
                console.error(err);
                return res.status(500).send('Erro ao processar os episódios.');
            });
    });
});
app.get('/episodiosPagina/:id', (req, res) => {
    const animeId = req.params.id;
    const pagina = parseInt(req.query.pagina) || 1; // Página padrão é 1
    const itensPorPagina = parseInt(req.query.itensPorPagina) || 10; // Padrão 10 episódios por página

    if (!animeId || isNaN(animeId)) {
        return res.status(400).send('ID de anime inválido.');
    }

    const offset = (pagina - 1) * itensPorPagina;

    // Consulta para contar o número total de episódios
    const countQuery = `SELECT COUNT(*) AS totalEpisodios FROM episodios WHERE anime_id = ?`;

    db.get(countQuery, [animeId], (countError, countResult) => {
        if (countError) {
            console.error('Erro ao contar os episódios:', countError);
            return res.status(500).send('Erro ao contar os episódios no banco de dados.');
        }

        const totalEpisodios = countResult ? countResult.totalEpisodios : 0;

        // Se não houver episódios, já retorna aqui
        if (totalEpisodios === 0) {
            return res.status(404).json({
                mensagem: 'Nenhum episódio encontrado para este anime.',
                totalEpisodios: 0,
                pagina: pagina,
                itensPorPagina: itensPorPagina,
                episodios: []
            });
        }

        // Consulta para buscar os episódios com paginação
        const query = `
            SELECT 
                e.temporada,
                e.numero,
                e.nome,
                e.anime_id,
                e.capa_ep,
                e.alertanovoep
            FROM 
                episodios e
            WHERE 
                e.anime_id = ?
            ORDER BY 
                e.temporada ASC, e.numero ASC
            LIMIT ? OFFSET ?;
        `;

        db.all(query, [animeId, itensPorPagina, offset], (error, rows) => {
            if (error) {
                console.error('Erro ao selecionar os episódios do anime:', error);
                return res.status(500).send('Erro ao selecionar os episódios no banco de dados.');
            }

            res.status(200).json({
                totalEpisodios: totalEpisodios,  // Total de episódios disponíveis
                pagina: pagina,
                itensPorPagina: itensPorPagina,
                episodios: rows
            });
        });
    });
});
/// rota pra retornar dados dos episodios de um anime especifico passando a pagina como parametro e a quantidade de episodios que serao exibidos nessa pagina 
app.get('/episodio/:animeId/:numero', (req, res) => {
    const animeId = req.params.animeId;
    const numero = parseInt(req.params.numero);

    // Validação do animeId e numero do episódio
    if (!animeId || isNaN(animeId)) {
        return res.status(400).send('ID de anime inválido.');
    }

    if (isNaN(numero)) {
        return res.status(400).send('Número do episódio inválido.');
    }

    // Consulta para buscar o episódio específico com base no número do episódio
    const query = `
        SELECT 
            e.temporada,
            e.numero,
            e.nome AS episodio_nome,
            e.anime_id,
            e.capa_ep,
            e.alertanovoep,
            a.id AS anime_id,
            a.capa AS anime_capa,
            a.titulo AS anime_titulo,
            a.genero AS anime_genero  -- Presumindo que os gêneros são armazenados como uma string separada por vírgulas
        FROM 
            episodios e
        JOIN 
            animes a ON e.anime_id = a.id  -- A chave primária da tabela animes é presumida como 'id'
        WHERE 
            e.anime_id = ? AND e.numero = ?;
    `;

    db.get(query, [animeId, numero], (error, row) => {
        if (error) {
            console.error('Erro ao selecionar o episódio:', error);
            return res.status(500).send('Erro ao selecionar o episódio no banco de dados.');
        }

        if (!row) {
            return res.status(404).json({
                mensagem: 'Episódio não encontrado.',
                animeId: animeId,
                numero: numero
            });
        }

        // Transformando a string de gêneros em um array
        const generos = row.anime_genero ? row.anime_genero.split(',').map(g => g.trim()) : [];

        res.status(200).json({
            anime: { 
                capa: row.anime_capa,
                animeid: row.anime_id,
                titulo: row.anime_titulo, 
                generos: generos
            },
            episodio: { 
                temporada: row.temporada, 
                numero: row.numero, 
                nome: row.episodio_nome, 
                capa_ep: row.capa_ep, 
                alertanovoep: row.alertanovoep 
            }
        });
    });
});



app.get('/pesquisa/termo', (req, res) => {
    const searchTerm = req.query.term; // Parâmetro de consulta 'term' na URL
    if (!searchTerm) {
        return res.status(400).json({ error: 'É necessário fornecer um termo de pesquisa.' });
    }

    const limit = req.query.limit || 100; // Limite padrão de resultados (até 100)

    // Consulta SQL para buscar animes que correspondem ao termo no título ou título alternativo
    const query = `
        SELECT a.*, e.*
        FROM animes AS a
        LEFT JOIN episodios AS e ON a.id = e.anime_id
        WHERE a.titulo LIKE '%' || ? || '%' OR a.tituloAlternativo LIKE '%' || ? || '%'
        LIMIT ?;
    `;
    
    db.all(query, [searchTerm, searchTerm, limit], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao buscar animes.' });
        }

        // Usar um objeto para armazenar os animes únicos e seus episódios
        const animeMap = {};

        rows.forEach(row => {
            const animeId = row.anime_id; // Usar anime_id para associar episódios ao anime correto

            // Verificar se o anime já está no mapa
            if (!animeMap[animeId]) {
                // Inicializar o objeto do anime
                animeMap[animeId] = {
                    id: row.anime_id, // Pode ser útil manter o id do anime aqui se necessário
                    capa: row.capa,
                    titulo: row.titulo,
                    tituloAlternativo: row.tituloAlternativo,
                    selo: row.selo,
                    sinopse: row.sinopse,
                    classificacao: row.classificacao,
                    status: row.status,
                    qntd_temporadas: row.qntd_temporadas,
                    anoLancamento: row.anoLancamento,
                    dataPostagem: row.dataPostagem,
                    ovas: row.ovas,
                    filmes: row.filmes,
                    estudio: row.estudio,
                    diretor: row.diretor,
                    genero: row.genero,
                    visualizacoes: row.visualizacoes,
                    tipoMidia: row.tipoMidia,
                    episodios: [] // Inicializa array para os episódios do anime
                };
            }

            // Adicionar o episódio ao anime correspondente
            animeMap[animeId].episodios.push({
                id: row.e_id,
                temporada: row.temporada,
                numero: row.numero,
                nome: row.nome,
                link: row.link,
                capa_ep: row.capa_ep
            });
        });

        // Converter o objeto em um array de objetos para enviar como resposta JSON
        const animes = Object.values(animeMap);

        // 🚀 Converter 'genero' para 'generos' como um array
        animes.forEach(anime => {
            anime.generos = anime.genero ? anime.genero.split(',').map(genero => genero.trim()) : [];
            anime.genero = anime.generos.join(', '); // Mantém compatibilidade
        });

        // Ordenar os episódios de cada anime em ordem crescente pelo número do episódio
        animes.forEach(anime => {
            anime.episodios.sort((a, b) => a.numero - b.numero);
        });

        // Enviar a resposta JSON com os dados organizados
        res.json(animes);
    });
});


app.get('/animesRecentes', (req, res) => {
    // Passo 1: Obter os IDs dos animes que têm episódios
    const queryAnimeIdsWithEpisodes = `
        SELECT DISTINCT
            a.id
        FROM 
            animes a
        JOIN 
            episodios e ON a.id = e.anime_id
        WHERE
            a.dataPostagem IS NOT NULL
        ORDER BY 
            a.dataPostagem DESC
    `;

    db.all(queryAnimeIdsWithEpisodes, (error, animeIdsRows) => {
        if (error) {
            console.error('Erro ao selecionar os IDs dos animes com episódios:', error);
            return res.status(500).send('Erro ao selecionar os IDs dos animes com episódios do banco de dados.');
        }

        // Obter os primeiros 35 IDs dos animes mais recentes com episódios
        const animeIds = animeIdsRows.map(row => row.id).slice(0, 35);

        if (animeIds.length === 0) {
            return res.status(200).json([]);
        }

        // Passo 2: Obter os detalhes dos animes mais recentes com episódios
        const queryAnimes = `
            SELECT 
                a.id,
                a.capa,
                a.titulo,
                a.tituloAlternativo,
                a.selo,
                a.sinopse,
                a.genero,
                a.classificacao,
                a.status,
                a.qntd_temporadas,
                a.anoLancamento,
                a.dataPostagem,
                a.ovas,
                a.filmes,
                a.estudio,
                a.diretor,
                a.tipoMidia,
                a.visualizacoes
            FROM 
                animes a
            WHERE
                a.id IN (${animeIds.join(',')})
            ORDER BY 
                a.dataPostagem DESC
        `;

        db.all(queryAnimes, (error, animesRows) => {
            if (error) {
                console.error('Erro ao selecionar os dados dos animes:', error);
                return res.status(500).send('Erro ao selecionar os dados dos animes do banco de dados.');
            }

            // Passo 3: Obter todos os episódios desses animes
            const queryEpisodios = `
                SELECT 
                    e.id AS episodio_id,
                    e.temporada,
                    e.numero,
                    e.nome AS nome_episodio,
                    e.link,
                    e.capa_ep,
                    e.anime_id
                FROM 
                    episodios e
                WHERE
                    e.anime_id IN (${animeIds.join(',')})
            `;

            db.all(queryEpisodios, (error, episodiosRows) => {
                if (error) {
                    console.error('Erro ao selecionar os dados dos episódios:', error);
                    return res.status(500).send('Erro ao selecionar os dados dos episódios do banco de dados.');
                }

                // Mapear os episódios por anime
                const animesMap = animesRows.reduce((map, anime) => {
                    map[anime.id] = {
                        id: anime.id,
                        capa: anime.capa,
                        titulo: anime.titulo,
                        tituloAlternativo: anime.tituloAlternativo,
                        selo: anime.selo,
                        sinopse: anime.sinopse,
                        generos: anime.genero ? anime.genero.split(',') : [],
                        classificacao: anime.classificacao,
                        status: anime.status,
                        qntd_temporadas: anime.qntd_temporadas,
                        anoLancamento: anime.anoLancamento,
                        dataPostagem: anime.dataPostagem,
                        ovas: anime.ovas,
                        filmes: anime.filmes,
                        estudio: anime.estudio,
                        diretor: anime.diretor,
                        tipoMidia: anime.tipoMidia,
                        visualizacoes: anime.visualizacoes,
                        episodios: []
                    };
                    return map;
                }, {});

                // Adicionar episódios aos respectivos animes
                episodiosRows.forEach(episodio => {
                    if (animesMap[episodio.anime_id]) {
                        animesMap[episodio.anime_id].episodios.push({
                            id: episodio.episodio_id,
                            temporada: episodio.temporada,
                            numero: episodio.numero,
                            nome: episodio.nome_episodio,
                            link: episodio.link,
                            capa_ep: episodio.capa_ep
                        });
                    }
                });

                // Converte o objeto em um array
                const result = animeIds.map(id => animesMap[id]).filter(anime => anime.episodios.length > 0);

                res.status(200).json(result);
            });
        });
    });
});

app.get('/FilmesRecentes', (req, res) => {
    // Consulta para obter até 20 animes do tipo 'filme' mais recentes
    const queryAnimes = `
        SELECT 
            a.id,
            a.capa,
            a.titulo,
            a.tituloAlternativo,
            a.selo,
            a.sinopse,
            a.genero,
            a.classificacao,
            a.status,
            a.qntd_temporadas,
            a.anoLancamento,
            a.dataPostagem,
            a.ovas,
            a.filmes,
            a.estudio,
            a.diretor,
            a.tipoMidia,
            a.visualizacoes
        FROM 
            animes a
        WHERE
            a.tipoMidia = 'Filme'
        ORDER BY 
            a.dataPostagem DESC
        LIMIT 20
    `;

    db.all(queryAnimes, (error, animesRows) => {
        if (error) {
            console.error('Erro ao selecionar os animes do tipo filme:', error);
            return res.status(500).send('Erro ao selecionar os animes do banco de dados.');
        }

        // 🚀 Converte 'genero' para 'generos' como um array
        const animesComGenerosArray = animesRows.map(anime => ({
            ...anime,
            generos: anime.genero ? anime.genero.split(',').map(genero => genero.trim()) : [] // Converte para array
        }));

        res.status(200).json(animesComGenerosArray);
    });
});


app.get('/AnimesAleatorios', (req, res) => {
    // Consulta para obter 20 animes aleatórios de qualquer tipo de mídia
    const queryAnimes = `
        SELECT 
            a.id,
            a.capa,
            a.titulo,
            a.tituloAlternativo,
            a.selo,
            a.sinopse,
            a.genero,
            a.classificacao,
            a.status,
            a.qntd_temporadas,
            a.anoLancamento,
            a.dataPostagem,
            a.ovas,
            a.filmes,
            a.estudio,
            a.diretor,
            a.tipoMidia,
            a.visualizacoes
        FROM 
            animes a
        ORDER BY 
            RANDOM()
        LIMIT 20
    `;

    db.all(queryAnimes, (error, animesRows) => {
        if (error) {
            console.error('Erro ao selecionar animes aleatórios:', error);
            return res.status(500).send('Erro ao selecionar animes do banco de dados.');
        }

        // 🚀 Converte 'genero' para 'generos' como um array
        const animesComGenerosArray = animesRows.map(anime => ({
            ...anime,
            generos: anime.genero ? anime.genero.split(',').map(genero => genero.trim()) : [] // Converte para array
        }));

        res.status(200).json(animesComGenerosArray);
    });
});


app.get('/animes_exibir/:anime_id/episodio/:episodio', (req, res) => {
    const animeId = req.params.anime_id;
    const episodioNum = parseInt(req.params.episodio, 10);

    // Consulta SQL para obter informações do anime
    const animeQuery = `
        SELECT *
        FROM Animes_exibir
        WHERE anime_id = ?
    `;

    // Consulta SQL para obter um episódio específico do anime
    const episodioQuery = `
        SELECT episodios_exibir.*, 
               episodios_exibir.link_extra_1 AS link_extra_1,
               episodios_exibir.link_extra_2 AS link_extra_2,
               episodios_exibir.link_extra_3 AS link_extra_3,
               episodios_exibir.descricao AS titulo  -- Adiciona o título do episódio
        FROM Episodios_exibir
        WHERE anime_id = ? AND episodio = ?
        LIMIT 1
    `;

    // Consulta para encontrar o episódio anterior
    const episodioAnteriorQuery = `
        SELECT episodio FROM Episodios_exibir
        WHERE anime_id = ? AND episodio < ?
        ORDER BY episodio DESC
        LIMIT 1
    `;

    // Consulta para encontrar o próximo episódio
    const proximoEpisodioQuery = `
        SELECT episodio FROM Episodios_exibir
        WHERE anime_id = ? AND episodio > ?
        ORDER BY episodio ASC
        LIMIT 1
    `;

    db.get(animeQuery, [animeId], (err, animeRow) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Erro ao buscar informações do anime');
            return;
        }

        if (!animeRow) {
            res.status(404).send('Anime não encontrado');
            return;
        }

        db.get(episodioQuery, [animeId, episodioNum], (err, episodioRow) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Erro ao buscar episódio do anime');
                return;
            }

            if (!episodioRow) {
                res.status(404).send('Episódio não encontrado');
                return;
            }

            // Buscar episódio anterior
            db.get(episodioAnteriorQuery, [animeId, episodioNum], (err, episodioAnteriorRow) => {
                if (err) {
                    console.error(err.message);
                    res.status(500).send('Erro ao buscar episódio anterior');
                    return;
                }

                // Buscar próximo episódio
                db.get(proximoEpisodioQuery, [animeId, episodioNum], (err, proximoEpisodioRow) => {
                    if (err) {
                        console.error(err.message);
                        res.status(500).send('Erro ao buscar próximo episódio');
                        return;
                    }

                    // Criar os links para o episódio anterior e próximo, se existirem
                    const episodioAnteriorLink = episodioAnteriorRow
                        ? `/animes_exibir/${animeId}/episodio/${episodioAnteriorRow.episodio}`
                        : null;

                    const proximoEpisodioLink = proximoEpisodioRow
                        ? `/animes_exibir/${animeId}/episodio/${proximoEpisodioRow.episodio}`
                        : null;

                    // Combinar os dados na resposta
                    const responseData = {
                        anime: animeRow,
                        episodios: [{
                            ...episodioRow,
                            titulo: episodioRow.titulo  // Inclui o título do episódio
                        }],
                        episodio_anterior: episodioAnteriorLink,
                        proximo_episodio: proximoEpisodioLink
                    };

                    res.json(responseData);
                });
            });
        });
    });
});

app.get('/animes-lancados-hoje', (req, res) => {
    const hoje = new Date().toISOString().split('T')[0]; // Data atual no formato YYYY-MM-DD

    // Consulta para obter os animes lançados hoje
    const queryAnimes = `
        SELECT 
            a.id,
            a.capa,
            a.titulo,
            a.tituloAlternativo,
            a.selo,
            a.sinopse,
            a.genero,
            a.classificacao,
            a.status,
            a.qntd_temporadas,
            a.anoLancamento,
            a.dataPostagem,
            a.ovas,
            a.filmes,
            a.estudio,
            a.diretor,
            a.tipoMidia,
            e.temporada,
            e.numero,
            e.nome AS nome_episodio,
            e.link,
            e.capa_ep,
            a.visualizacoes AS visualizacoes
        FROM 
            animes a
        LEFT JOIN 
            episodios e ON a.id = e.anime_id
        WHERE 
            a.dataPostagem = ?;
    `;

    // Consulta para obter os episódios com alertanovoep = 1 e informações dos animes relacionados
    const queryEpisodiosAlert = `
        SELECT 
            e.temporada,
            e.numero,
            e.nome AS nome_episodio,
            e.link,
            e.capa_ep,
            e.anime_id,
            a.capa AS anime_capa,
            a.titulo AS anime_titulo,
            a.tituloAlternativo AS anime_tituloAlternativo,
            a.selo AS anime_selo,
            a.sinopse AS anime_sinopse,
            a.genero AS anime_genero,
            a.classificacao AS anime_classificacao,
            a.status AS anime_status,
            a.qntd_temporadas AS anime_qntd_temporadas,
            a.anoLancamento AS anime_anoLancamento,
            a.dataPostagem AS anime_dataPostagem,
            a.ovas AS anime_ovas,
            a.filmes AS anime_filmes,
            a.estudio AS anime_estudio,
            a.diretor AS anime_diretor,
            a.tipoMidia AS anime_tipoMidia,
            a.visualizacoes AS anime_visualizacoes
        FROM 
            episodios e
        JOIN 
            animes a ON e.anime_id = a.id
        WHERE 
            e.alertanovoep = 1;
    `;

    // Primeira consulta: Animes lançados hoje
    db.all(queryAnimes, [hoje], (err, rowsAnimes) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: 'Erro ao buscar animes lançados hoje' });
            return;
        }

        // Organizar os dados dos animes lançados hoje
        const animesCompletos = {};

        rowsAnimes.forEach(row => {
            if (!animesCompletos[row.id]) {
                animesCompletos[row.id] = {
                    id: row.id,
                    capa: row.capa,
                    titulo: row.titulo,
                    tituloAlternativo: row.tituloAlternativo,
                    selo: row.selo,
                    sinopse: row.sinopse,
                    genero: row.genero,
                    classificacao: row.classificacao,
                    status: row.status,
                    qntd_temporadas: row.qntd_temporadas,
                    anoLancamento: row.anoLancamento,
                    dataPostagem: row.dataPostagem,
                    ovas: row.ovas,
                    filmes: row.filmes,
                    estudio: row.estudio,
                    diretor: row.diretor,
                    tipoMidia: row.tipoMidia,
                    visualizacoes: row.visualizacoes,
                    episodios: []
                };
            }

            // Adicionar episódios ao anime, se houver
            if (row.temporada && row.numero) {
                animesCompletos[row.id].episodios.push({
                    temporada: row.temporada,
                    numero: row.numero,
                    nome: row.nome_episodio,
                    link: row.link,
                    capa_ep: row.capa_ep
                });
            }
        });

        // Converter o objeto de animes completos em um array
        const animesResult = Object.values(animesCompletos);

        // Segunda consulta: Episódios com alertanovoep = 1 e informações dos animes relacionados
        db.all(queryEpisodiosAlert, (errAlert, rowsEpisodios) => {
            if (errAlert) {
                console.error(errAlert);
                res.status(500).json({ error: 'Erro ao buscar episódios com novo alerta' });
                return;
            }

            // Organizar os dados dos episódios com alertanovoep = 1
            const episodiosNovos = rowsEpisodios.map(row => ({
                temporada: row.temporada,
                numero: row.numero,
                nome: row.nome_episodio,
                link: row.link,
                capa_ep: row.capa_ep,
                anime: {
                    id: row.anime_id,
                    capa: row.anime_capa,
                    titulo: row.anime_titulo,
                    tituloAlternativo: row.anime_tituloAlternativo,
                    selo: row.anime_selo,
                    sinopse: row.anime_sinopse,
                    genero: row.anime_genero,
                    classificacao: row.anime_classificacao,
                    status: row.anime_status,
                    qntd_temporadas: row.anime_qntd_temporadas,
                    anoLancamento: row.anime_anoLancamento,
                    dataPostagem: row.anime_dataPostagem,
                    ovas: row.anime_ovas,
                    filmes: row.anime_filmes,
                    estudio: row.anime_estudio,
                    diretor: row.anime_diretor,
                    tipoMidia: row.anime_tipoMidia,
                    visualizacoes: row.anime_visualizacoes
                }
            }));

            // Responder com animes lançados hoje e episódios com alertanovoep = 1
            res.json({
                animesCompletos: animesResult,  // Animes lançados hoje
                episodiosNovos: episodiosNovos   // Episódios com alertanovoep = 1 e informações dos animes relacionados
            });
        });
    });
});

app.post('/enviarAviso', (req, res) => {
    const { titulo, conteudo } = req.body;

    // Validação simples dos dados recebidos
    if (!titulo || !conteudo) {
        return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' });
    }

    // Verifica se já existe um aviso ativo
    db.get('SELECT id FROM avisos WHERE ativo = 1', (error, row) => {
        if (error) {
            console.error('Erro ao verificar aviso ativo:', error.message);
            return res.status(500).json({ error: 'Erro ao verificar aviso ativo no banco de dados.' });
        }

        if (row) {
            // Se existe um aviso ativo, atualiza-o
            const updateQuery = `
                UPDATE avisos
                SET titulo = ?,
                    conteudo = ?,
                    dataHoraPostagem = CURRENT_TIMESTAMP,
                    ativo = 1
                WHERE id = ?
            `;
            const updateValues = [titulo, conteudo, row.id];

            db.run(updateQuery, updateValues, function(updateError) {
                if (updateError) {
                    console.error('Erro ao atualizar aviso:', updateError.message);
                    return res.status(500).json({ error: 'Erro ao atualizar aviso no banco de dados.' });
                } 
                
                // Retorna o ID do aviso atualizado
                res.json({ id: row.id, titulo, conteudo });
            });
        } else {
            // Se não existe um aviso ativo, insere um novo
            const insertQuery = `
                INSERT INTO avisos (titulo, conteudo)
                VALUES (?, ?)
            `;
            const insertValues = [titulo, conteudo];

            db.run(insertQuery, insertValues, function(insertError) {
                if (insertError) {
                    console.error('Erro ao inserir aviso:', insertError.message);
                    return res.status(500).json({ error: 'Erro ao inserir aviso no banco de dados.' });
                }
                
                // Retorna o ID do aviso inserido
                res.json({ id: this.lastID, titulo, conteudo });
            });
        }
    });
});

const sites = {
    'animesorionvip.net': async (inicio) => {
        try {
            const chromePath = puppeteer.executablePath();
            const browser = await puppeteer.launch({
                executablePath: chromePath, // Usa o caminho detectado
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            const url = `https://animesorionvip.net/animes/${inicio}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Aguarda a carga da div com id 'episodio_box'
            await page.waitForSelector('#episodio_box');

            // Extrai os links dos episódios da lista
            const episodeLinks = await page.evaluate(() => {
                const links = [];
                const episodeList = document.querySelector('.listaEP');
                const episodeItems = episodeList.querySelectorAll('li');
                episodeItems.forEach(item => {
                    const link = item.querySelector('a').getAttribute('href');
                    links.push(link);
                });
                return links;
            });

            // Itera sobre os links e acessa cada um deles
            const formattedLinks = [];
            for (const link of episodeLinks) {
                const episodePage = await browser.newPage();
                await episodePage.goto(link);

                // Aguarda a carga da div com id 'player-1'
                await episodePage.waitForSelector('#player-1');

                // Extrai o link da tag iframe dentro da div com id 'player-1'
                const iframeLink = await episodePage.evaluate(() => {
                    const iframe = document.querySelector('#player-1 iframe');
                    return iframe ? iframe.getAttribute('src') : null;
                });

                formattedLinks.push(iframeLink);

                await episodePage.close();
            }

            // Filtra links nulos
            const validLinks = formattedLinks.filter(link => link);

            // Ordena os links em ordem crescente
            validLinks.sort((a, b) => {
                const episodeNumberA = parseInt(a.split('/').pop(), 10);
                const episodeNumberB = parseInt(b.split('/').pop(), 10);
                return episodeNumberA - episodeNumberB;
            });

            await browser.close();

            return { LinksEncontrados: validLinks };
        } catch (error) {
            console.error('Erro:', error);
            throw new Error('Ocorreu um erro ao tentar acessar os episódios.');
        }
    }, /// funcionando

    'animesonline.fan': async (inicio) => {
        try {
            const chromePath = puppeteer.executablePath();
            const browser = await puppeteer.launch({
                executablePath: chromePath, // Usa o caminho detectado
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            const url = `https://animesonline.fan/${inicio}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
            // Aguarda a carga da div com a classe 'meio-conteudo'
            await page.waitForSelector('.meio-conteudo');
    
            // Extrai os links dos episódios da lista
            const episodeLinks = await page.evaluate(() => {
                const links = [];
                const episodeList = document.querySelectorAll('.meio-conteudo .post .episodios li a');
                episodeList.forEach((item, index) => {
                    const link = item.getAttribute('href');
                    links.push({ link, episodio: index + 1 });
                });
                return links;
            });

            console.log('Links encontrados:');
            console.log(episodeLinks);

            const formattedLinks = [];

            const processEpisode = async ({ link, episodio }) => {
                const episodePage = await browser.newPage();
                await episodePage.goto(link);
    
                // Aguarda o evento 'load' do documento para garantir que a página esteja completamente carregada
                await episodePage.evaluate(() => {
                    return new Promise(resolve => {
                        setTimeout(resolve, 20000);
                    });
                });

                // Aguarda o carregamento do elemento com o ID 'preroll'
                await episodePage.waitForSelector('#preroll');
    
                // Extrai o link do conteúdo do elemento #document dentro do iframe #preroll
                const linkFromDocument = await episodePage.evaluate(() => {
                    const documentContent = document.documentElement.innerHTML;
                    const links = documentContent.match(/https:\/\/tudogostoso\.blog\/\S+/g);
                    return links && links.length > 0 ? links[0].replace(/['"]+/g, '') : null;
                });
    
                if (linkFromDocument) {
                    // Navega para o URL limpo e obtém a URL final após redirecionamentos
                    await episodePage.goto(linkFromDocument, { waitUntil: 'networkidle2' });
    
                    await new Promise(resolve => setTimeout(resolve, 8000));
    
                    // Verifica se o vídeo está disponível
                    const isVideoAvailable = await episodePage.evaluate(() => {
                        const errorContainer = document.getElementById('errorContainer');
                        return !errorContainer || !errorContainer.querySelector('.errorMessage');
                    });
    
                    const finalUrl = episodePage.url();
                    if (isVideoAvailable) {
                        formattedLinks[episodio] = finalUrl;
                        console.log(`Episódio ${episodio} - Link: ${finalUrl} - Disponível: Sim`);
                    } else {
                        formattedLinks[episodio] = `Episódio ${episodio} indisponível`;
                        console.log(`Episódio ${episodio} - Vídeo indisponível`);
                    }
                }
    
                await episodePage.close();
            };
    
            // Processa os links em grupos de 10
            for (let i = 0; i < episodeLinks.length; i += 10) {
                const group = episodeLinks.slice(i, i + 10);
                await Promise.all(group.map(processEpisode));
            }
    
    
            await browser.close();
            
            return { LinksEncontrados: formattedLinks };
        } catch (error) {
            console.error('Erro:', error);
            throw new Error('Ocorreu um erro ao tentar acessar os episódios.');
        }
    }, /// funcionando
     
    'animeq.blog': async (inicio) => {
        try {
            console.log('Chromium Path:', puppeteer.executablePath());
            const chromePath = puppeteer.executablePath();
            const browser = await puppeteer.launch({
                executablePath: chromePath, // Usa o caminho detectado
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            const url = `https://animeq.blog/${inicio}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Aguarda a carga da div com a classe 'ListaContainer'
            await page.waitForSelector('.ListaContainer');

            // Extrai os links dos episódios da lista

            const episodeLinks = await page.evaluate(() => {
                const links = [];
                const episodeList = document.querySelector('#lAnimes');
                const episodeItems = episodeList.querySelectorAll('a');
                episodeItems.forEach((item, index) => {
                    const link = item.getAttribute('href');
                    links.push({ link, episodio: index + 1 });
                });
                return links;
            });

            console.log(episodeLinks)

            const formattedLinks = [];

            const processEpisode = async ({ link, episodio }) => {
                const episodePage = await browser.newPage();
                await episodePage.goto(link, {waitUntil: "domcontentloaded"});
            

                // Aguarda o carregamento do elemento com o ID 'preroll'
                await episodePage.waitForSelector('.mwidth');

                // Aguarda o evento 'load' do documento para garantir que a página esteja completamente carregada
                await episodePage.evaluate(() => {
                    return new Promise(resolve => {
                        setTimeout(resolve, 10000);
                    });
                });
                            
            
                // Extrai o link do conteúdo do elemento #document dentro do iframe #preroll
                const extractLink = async () => {
                    return episodePage.evaluate(() => {
                        const documentContent = document.documentElement.innerHTML;
                        
                        // Regular expression for cld.pt links
                        const cldLinksRegex = /https?:\/\/cld\.pt\/(?:dl\/download\/[\w-]+\/\d+|dl\/download\/[\w-]+\/\d+-\w+)\.mp4/g;
                        const cldLinks = documentContent.match(cldLinksRegex);
                        if (cldLinks && cldLinks.length > 0) {
                            return cldLinks[0];
                        }
                        
                        // Regular expression for blogger links
                        const bloggerLinks = documentContent.match(/https:\/\/www\.blogger\.com\/video\.g\?token=\S+/g);
                        if (bloggerLinks && bloggerLinks.length > 0) {
                            return bloggerLinks[0].replace(/['"]+/g, '');
                        }
                        
                        // Regular expression for animeq.online links
                        const animeqLinksRegex = /https:\/\/animeq\.online\/Midias\/Animes\/[\w-]+\/[\w%-]+\/\d+\.mp4/g;
                        const animeqLinks = documentContent.match(animeqLinksRegex);
                        if (animeqLinks && animeqLinks.length > 0) {
                            return animeqLinks[0];
                        }

                        const mangascloudRegex = /https?:\/\/mangas\.cloud\/.*\.mp4/g;
                        const mangascloudLinks = documentContent.match(mangascloudRegex);
                        if (mangascloudLinks && mangascloudLinks.length > 0) {
                            return mangascloudLinks[0];
                        }

                
                        return null;
                    });
                };

                const linkFromDocument = await extractLink();
            
                if (linkFromDocument) {
                    await episodePage.goto(linkFromDocument, { timeout: 60000, waitUntil: 'networkidle2' });

            
                    // Verifica se o vídeo está disponível
                    const isVideoAvailable = await episodePage.evaluate(() => {
                        const errorContainer = document.getElementById('errorContainer');
                        return !errorContainer || !errorContainer.querySelector('.errorMessage');
                    });
            
                    const finalUrl = episodePage.url();
                    if (isVideoAvailable) {
                        formattedLinks[episodio] = finalUrl;
                        console.log(`Episódio ${episodio} - Link: ${finalUrl} - Disponível: Sim`);
                    } else {
                        formattedLinks[episodio] = `Episódio ${episodio} indisponível`;
                        console.log(`Episódio ${episodio} - Vídeo indisponível`);
                    }
                } else {
                    formattedLinks[episodio] = `Episódio ${episodio} nada encontrado (null)`;
                    console.log(`Episódio ${episodio} - Link: invalido`);
                }
            
                await episodePage.close();
            };
            
            // Processa os links em grupos de 10
            // Processa os links em grupos de 10
            for (let i = 0; i < episodeLinks.length; i += 2) {
                const group = episodeLinks.slice(i, i + 2);
                await Promise.all(group.map(processEpisode));
            }
            
                        
        
            await browser.close();
            
            
            return { LinksEncontrados: formattedLinks };
        } catch (error) {
            console.error('Erro:', error);
            throw new Error('Ocorreu um erro ao tentar acessar os episódios.');
        }
    }, /// funcionando

    'goyabu.to': async (inicio) => {
        try {
            const chromePath = puppeteer.executablePath();
            const browser = await puppeteer.launch({
                executablePath: chromePath, // Usa o caminho detectado
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();

            const url = `https://goyabu.to/anime/${inicio}`;
            console.log(`Acessando URL: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Aumenta o timeout para 60 segundos

            // Verifica se a lista de episódios está presente
            await page.waitForSelector('ul.listaEps', { timeout: 60000 }); // Aguarda a presença da lista de episódios

            // Extrai os links dos episódios
            const episodeData = await page.evaluate(() => {
                const data = [];
                const episodeElements = document.querySelectorAll('ul.listaEps li');
                episodeElements.forEach(element => {
                    const anchor = element.querySelector('a');
                    if (anchor) {
                        const href = anchor.href;
                        const text = anchor.textContent;
                        const match = text.match(/Episódio (\d+)/);
                        const episodeNumber = match ? parseInt(match[1], 10) : null;
                        if (episodeNumber !== null) {
                            data.push({ href, episodeNumber });
                        }
                    }
                });
                return data;
            });
            
            episodeData.sort((a, b) => a.episodeNumber - b.episodeNumber);
            // Verifica se há links de episódios
              // Verifica se há links de episódios
            if (episodeData.length === 0) {
                console.warn('Nenhum link de episódio encontrado.');
            }

            // Navega até cada link dos episódios e extrai o URL do iframe
            const iframeLinks = [];
            for (const episode of episodeData) {
                const { href } = episode;
                console.log(`Acessando episódio: ${href}`);
                await page.goto(href, { waitUntil: 'networkidle2', timeout: 60000 }); // Aumenta o timeout para 60 segundos
                await page.waitForSelector('div#player iframe', { timeout: 60000 }); // Aguarda a presença do iframe
                const iframeLink = await page.evaluate(() => {
                    const iframe = document.querySelector('div#player iframe');
                    const src = iframe ? iframe.src : null;
                    console.log('URL do iframe:', src);
                    return src;
                });
                if (iframeLink) {
                    iframeLinks.push(iframeLink);
                } else {
                    console.warn('Nenhum iframe encontrado para o episódio:', href);
                }
            }
            await browser.close();
            return iframeLinks;

        } catch (error) {
            console.error('Erro:', error);
            throw new Error('Ocorreu algum erro');
        }
    },

    'animesgames.cc': async (inicio) => {
        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            const url = `https://animesgames.cc/animes/${inicio}`;
            console.log(`Acessando URL: ${url}`);

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Aumenta o timeout para 60 segundos
            await page.waitForSelector('div.listaEp', { timeout: 60000 }); // Aguarda a presença da lista de episódios


            const episodeLinks = await page.evaluate(() => {
                const links = [];
                const episodeElements = document.querySelectorAll('div.listaEp section.episodioItem a');
                episodeElements.forEach(element => {
                    links.push(element.href);
                });
                console.log('Links dos episódios:', links);
                return links;
            });

            if (episodeLinks.length === 0) {
                console.warn('Nenhum link de episódio encontrado.');
            }

            const iframeLinks = [];
            for (const link of episodeLinks) {
                console.log(`Acessando episódio: ${link}`);
                await page.goto(link, { waitUntil: 'networkidle2', timeout: 60000 });
            
                try {
                    await page.waitForSelector('div#jwplayer iframe', { timeout: 60000 });
                } catch (waitError) {
                    console.error('Erro ao esperar pelo seletor div#jwplayer iframe:', waitError);
                    continue; // Continua com o próximo episódio se o iframe não for encontrado
                }
            
                // Obtém o URL do iframe principal
                const iframeLink = await page.evaluate(() => {
                    const iframe = document.querySelector('div#jwplayer iframe');
                    return iframe ? iframe.src : null;
                });
            
                if (iframeLink) {
                    console.log('URL do iframe principal:', iframeLink);
            
                    // Navega para o link do iframe principal
                    await page.goto(iframeLink, { waitUntil: 'networkidle2', timeout: 60000 });
            
                    try {
                        await page.waitForSelector('iframe#player', { timeout: 60000 });
                    } catch (waitError) {
                        console.error('Erro ao esperar pelo seletor iframe#player:', waitError);
                        continue; // Continua com o próximo episódio se o iframe não for encontrado
                    }
            
                    // Obtém o URL do iframe secundário
                    const nestedIframeLink = await page.evaluate(() => {
                        const iframe = document.querySelector('iframe#player');
                        return iframe ? iframe.src : null;
                    });
            
                    if (nestedIframeLink) {
                        console.log('URL do iframe secundário:', nestedIframeLink);
            
                        // Navega para o link do iframe secundário
                        await page.goto(nestedIframeLink, { waitUntil: 'networkidle2', timeout: 60000 });
            
                        // Obtém o URL final da página
                        const finalUrl = page.url();
                        console.log('URL final obtido:', finalUrl);
                        iframeLinks.push(finalUrl); // Adiciona o URL final à lista
                    } else {
                        console.warn('Nenhum iframe secundário encontrado para o episódio:', link);
                    }
                } else {
                    console.warn('Nenhum iframe principal encontrado para o episódio:', link);
                }
            }
            

            await browser.close();
            return iframeLinks;


        } catch (error) {
            console.error('Erro:', error);
            throw new Error('Ocorreu algum erro');
        }
    }
};

app.get('/scrape/:site/:inicio', async (req, res) => {
    const { site, inicio } = req.params;
    try {
        if (!(site in sites)) {
            res.status(404).send('Site não suportado');
            return;
        }

        // Chama a função correspondente ao site com o ponto de início como argumento
        const scrapeFunction = sites[site];
        const data = await scrapeFunction(inicio);

        res.json(data);
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).send('Ocorreu um erro ao tentar acessar os episódios.');
    }
});

app.get('/verificarEpisodio', (req, res) => {
    const { nomeAnime, numeroEpisodio } = req.query;

    // Verifica se os parâmetros foram fornecidos
    if (!nomeAnime || !numeroEpisodio) {
        return res.status(400).json({ message: 'Parâmetros nomeAnime e numeroEpisodio são necessários.' });
    }

    const query = `
        SELECT e.id 
        FROM Episodios_exibir e
        JOIN Animes_exibir a ON e.anime_id = a.Anime_id
        WHERE a.titulo = ? AND e.episodio = ?
    `;

    db.get(query, [nomeAnime, numeroEpisodio], (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'Erro ao consultar o banco de dados.', error: err.message });
        }

        // Retorna apenas true ou false com base na existência do episódio
        const episodioExiste = !!row;
        res.json({ exists: episodioExiste });
    });
});

app.post('/adicionarEpisodio', (req, res) => {
    const { nomeAnime, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3 } = req.body;

    // Verifica se todos os campos obrigatórios foram fornecidos
    if (!nomeAnime || !episodio || !temporada || !link) {
        return res.status(400).json({ message: 'Os campos nomeAnime, temporada, episodio e link são obrigatórios.' });
    }

    // Consulta o ID do anime com base no nome fornecido
    const queryAnime = `SELECT Anime_id FROM Animes_exibir WHERE titulo = ?`;

    db.get(queryAnime, [nomeAnime], (err, anime) => {
        if (err) {
            return res.status(500).json({ message: 'Erro ao consultar o banco de dados.', error: err.message });
        }

        // Se o anime não for encontrado, retorne erro
        if (!anime) {
            return res.status(404).json({ message: 'Anime não encontrado.' });
        }

        // Verifica se o episódio já existe
        const queryCheckEpisodio = `
            SELECT COUNT(*) AS count 
            FROM Episodios_exibir 
            WHERE anime_id = ? AND episodio = ?
        `;

        db.get(queryCheckEpisodio, [anime.Anime_id, episodio], (err, result) => {
            if (err) {
                return res.status(500).json({ message: 'Erro ao consultar o banco de dados.', error: err.message });
            }

            // Se o episódio já existe, retorne erro
            if (result.count > 0) {
                return res.status(409).json({ message: 'O episódio já existe para este anime.' });
            }

            // Verifica a última ordem de episódios para o anime
            const queryLastEpisodio = `
                SELECT episodio 
                FROM Episodios_exibir 
                WHERE anime_id = ? 
                ORDER BY episodio DESC 
                LIMIT 1
            `;

            db.get(queryLastEpisodio, [anime.Anime_id], (err, lastEpisodio) => {
                if (err) {
                    return res.status(500).json({ message: 'Erro ao consultar o banco de dados.', error: err.message });
                }

                // Se não houver episódios, permite a inserção do episódio 1
                if (!lastEpisodio && episodio === 1) {
                    // Verifica se o anime existe na tabela Animes_exibir
                    const queryCheckAnimeExists = `
                        SELECT COUNT(*) AS count 
                        FROM Animes_exibir 
                        WHERE titulo = ?
                    `;

                    function formatEpisodeName(episodio) {
                        const episodeNumber = String(parseInt(episodio, 10)).padStart(3, '0'); // Formata com zeros à esquerda
                        return `Episódio ${episodeNumber}`; // Retorna o formato desejado
                    }
                
                    db.get(queryCheckAnimeExists, [nomeAnime], (err, animeExists) => {
                        if (err) {
                            return res.status(500).json({ message: 'Erro ao consultar o banco de dados.', error: err.message });
                        }
                
                        // Se o anime não existir na tabela Animes_exibir, retorne erro
                        if (animeExists.count === 0) {
                            return res.status(404).json({ message: 'Anime não encontrado na tabela de animes.' });
                        }
                
                        // Verificar se há um episódio anterior para obter a capa
                        const queryGetCapa = `
                            SELECT capa_ep 
                            FROM episodios 
                            WHERE anime_id = ? 
                            ORDER BY numero DESC 
                            LIMIT 1
                        `;
                
                        db.get(queryGetCapa, [anime.Anime_id], (err, resultado) => {
                            if (err) {
                                return res.status(500).json({ message: 'Erro ao consultar o banco de dados para a capa.', error: err.message });
                            }
                
                            // Se não houver episódios anteriores, use a capa padrão
                            const linkCapa = resultado ? resultado.capa_ep : 'https://via.placeholder.com/150';
                
                            // Inserir o novo episódio na tabela Episodios_exibir
                            const queryInsert = `
                                INSERT INTO Episodios_exibir (anime_id, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            `;
                
                            db.run(queryInsert, [anime.Anime_id, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3], function(err) {
                                if (err) {
                                    return res.status(500).json({ message: 'Erro ao inserir o episódio.', error: err.message });
                                }
                            
                                // Obter o ID do episódio recém-criado
                                const novoEpisodioId = this.lastID;
                            
                                // Gerar o link padrão usando os dados
                                const linkEpisodioGerado = `https://incriveiscuriosidades.online/animes/animes.html?animeId=${anime.Anime_id}&temporada=${temporada}&episodio=${episodio}`;

                                const descricaoFormatadaprimary = formatEpisodeName(episodio); // Utiliza a função para formatação
                                const nomeFormatadoprimary = `${nomeAnime} – ${descricaoFormatadaprimary}`; // Ex: "One Piece – Episódio 255"
                            
                                // Inserir o novo episódio na tabela episodios usando o link gerado
                                const queryInsertEpisodio = `
                                    INSERT INTO episodios (temporada, numero, nome, link, capa_ep, anime_id, alertanovoep)
                                    VALUES (?, ?, ?, ?, ?, ?, ?)
                                `;
                            
                                // Defina o valor de alertanovoep como 1
                                db.run(queryInsertEpisodio, [temporada, episodio, descricaoFormatadaprimary, linkEpisodioGerado, linkCapa, anime.Anime_id, 1], function(err) {
                                    if (err) {
                                        return res.status(500).json({ message: 'Erro ao inserir o episódio na tabela episodios.', error: err.message });
                                    }
                            
                                    // Retorna sucesso com os IDs do episódio recém-criado
                                    return res.status(201).json({ 
                                        message: 'Episódio adicionado com sucesso!', 
                                        episodioId: novoEpisodioId,
                                        animeTitulo: nomeAnime,
                                        animeId: anime.Anime_id
                                    });
                                });
                            });
                            
                        });
                    });
                }
                
                
                
                // Se houver um último episódio, verifica a ordem
                else if (lastEpisodio && lastEpisodio.episodio + 1 === episodio) {
                    // Função para formatar o nome do episódio
                    function formatEpisodeName(episodio) {
                        const episodeNumber = String(parseInt(episodio, 10)).padStart(3, '0'); // Formata com zeros à esquerda
                        return `Episódio ${episodeNumber}`; // Retorna o formato desejado
                    }
                
                    // Formatar a descrição para Episodios_exibir
                    const descricaoFormatada = formatEpisodeName(episodio); // Utiliza a função para formatação
                    const nomeFormatado = `${nomeAnime} – ${descricaoFormatada}`; // Ex: "One Piece – Episódio 255"
                
                    // Verificar se há um episódio anterior para obter a capa
                    const queryGetCapa = `
                        SELECT capa_ep 
                        FROM episodios 
                        WHERE anime_id = ? 
                        ORDER BY numero DESC 
                        LIMIT 1
                    `;
                
                    db.get(queryGetCapa, [anime.Anime_id], (err, resultado) => {
                        if (err) {
                            return res.status(500).json({ message: 'Erro ao consultar o banco de dados para a capa.', error: err.message });
                        }
                
                        // Se não houver episódios anteriores, use uma capa padrão
                        const linkCapa = resultado ? resultado.capa_ep : 'https://via.placeholder.com/150';
                
                        // Adicionando logs para verificar os valores antes da inserção
                        console.log(`Temporada: ${temporada}, Episódio: ${episodio}`);
                        console.log(`Nome formatado: ${nomeFormatado}, Capa: ${linkCapa}`);
                
                        // Inserir o novo episódio na tabela Episodios_exibir
                        const queryInsertEpisodiosExibir = `
                            INSERT INTO Episodios_exibir (anime_id, temporada, episodio, descricao, link, link_extra_1, link_extra_2, link_extra_3)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `;
                
                        db.run(queryInsertEpisodiosExibir, [anime.Anime_id, temporada, episodio, nomeFormatado, link, link_extra_1, link_extra_2, link_extra_3], function (err) {
                            if (err) {
                                return res.status(500).json({ message: 'Erro ao inserir o episódio.', error: err.message });
                            }
                
                            const novoEpisodioId = this.lastID;
                
                            // Gerar o link padrão usando os dados
                            const linkEpisodioGerado = `https://incriveiscuriosidades.online/animes/animes.html?animeId=${anime.Anime_id}&temporada=${temporada}&episodio=${episodio}`;
                
                            // Inserir o novo episódio na tabela episodios
                            const queryInsertEpisodios = `
                                INSERT INTO episodios (temporada, numero, nome, link, capa_ep, anime_id, alertanovoep)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `;
                
                            db.run(queryInsertEpisodios, [temporada, episodio, descricaoFormatada, linkEpisodioGerado, linkCapa, anime.Anime_id, 1], function (err) {
                                if (err) {
                                    return res.status(500).json({ message: 'Erro ao inserir o episódio na tabela episodios.', error: err.message });
                                }
                
                                // Retorna sucesso com o ID do episódio recém-criado
                                return res.status(201).json({
                                    message: 'Episódio adicionado com sucesso!',
                                    episodioId: this.lastID,
                                    animeTitulo: nomeAnime,
                                    animeId: anime.Anime_id
                                });
                            });
                        });
                    });
                } else {
                    // Retorna erro se o número do episódio não é o próximo na sequência
                    return res.status(409).json({ message: 'O número do episódio deve ser o próximo na sequência ou o primeiro.' });
                }
                
                
                
                
                
            });
        });
    });
});

app.get('/buscarEpisodios', async (req, res) => {
    const resultados = [];

    const chromePath = puppeteer.executablePath();
    const browser = await puppeteer.launch({
        executablePath: chromePath, // Usa o caminho detectado
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const sites = [
        { url: 'https://animeq.blog/' }
        // Adicione mais sites conforme necessário
    ];

    for (const site of sites) {
        try {
            let episodios = [];
            const page = await browser.newPage();
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36';
            await page.setUserAgent(userAgent);
            let bloggerLink = null; // Declare a variável aqui
            await page.setRequestInterception(true);

           // Configura a interceptação de requisições
           const allowJsLinks = new Set();
           const blockJsLinks = new Set(); // Adiciona a lista de links bloqueados
  
           // Adiciona links à lista permitida
           allowJsLinks.add('https://animeq.blog/');
           // Adiciona links à lista bloqueada
           blockJsLinks.add('https://example.com/block-this'); // Exemplo de link a ser bloqueado
           blockJsLinks.add('https://anotherexample.com/block-this-too'); // Adicione outros links conforme necessário
           
           // Configura a interceptação de requisições
           page.on('request', (request) => {
               const url = request.url();
           
               // Bloqueia requisições de JS e CSS para URLs bloqueadas
               if (request.resourceType() === 'stylesheet' || request.resourceType() === 'script') {
                   if (blockJsLinks.has(url)) {
                       request.abort(); // Bloqueia CSS e JS para URLs bloqueadas
                       return; // Retorna para evitar continuar a execução
                   }
               }
               
               // Permite requisições de JS e CSS para URLs permitidas, ou permite outras requisições
               if (allowJsLinks.has(url)) {
                   request.continue(); // Permite requisições de JS e CSS para URLs permitidas
               } else {
                   request.continue(); // Permite requisições de outros tipos
               }
           });
           
 
            const waitFor = (milliseconds) => {
                return new Promise(resolve => setTimeout(resolve, milliseconds));
            };
            // Verifica o site e faz a coleta de dados correspondente
            switch (site.url) {

                case 'https://animeq.blog/':
                    await page.goto(site.url, { waitUntil: 'networkidle0', timeout: 60000 }); // Aumentando para 60 segundos

                    // Espera até que o elemento com a classe .ContainerEps.mwidth apareça
                    await page.waitForSelector('.ContainerEps.mwidth', { timeout: 10000 }); // Espera até 10 segundos

                    // Lógica para extrair dados do site
                    const episodios = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('article.EpsItem')).map(episodio => ({
                            titulo: episodio.querySelector('.EpsItemTitulo').innerText,
                            link: episodio.querySelector('a').href,
                        }));
                    });

                    // Exibir os links no console
                    const links = episodios.map(episodio => episodio.link);
                    console.log('Links dos episódios:', links);
                    links.forEach(link => allowJsLinks.add(link));

                    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

                    for (const link of links) {
                        console.log(`Acessando o link: ${link}`);
                        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        await page.waitForSelector('.videoBox', { timeout: 10000 });
                        await wait(5000);
                    
                        const htmlContent = await page.evaluate(() => {
                            // Remove todas as tags <style> e <link> que carregam CSS
                            const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
                            styles.forEach(style => style.remove());
                        
                            // Remove todas as tags <script>
                            const scripts = document.querySelectorAll('script');
                            scripts.forEach(script => script.remove());
                        
                            // Remove todas as tags <svg>
                            const svgs = document.querySelectorAll('svg');
                            svgs.forEach(svg => svg.remove());
                        
                            // Extrai o HTML inteiro da página
                            return document.documentElement.innerHTML;
                        });
                    
                        const temporada = 1;
                        console.log(`Temporada definida: ${temporada}`);
    
                        // Busca a descrição do episódio
                        const descricaoMatch = htmlContent.match(/<div class="col"><center><h3><a href="[^"]*">([^<]*)<\/a><\/h3><\/center><\/div>/);
                        let descricao = null;
                        if (descricaoMatch) {
                            descricao = descricaoMatch[1];
                            console.log(`Descrição do episódio: ${descricao}`);
                        } else {
                            console.log('Nenhuma descrição encontrada para este episódio.');
                            continue; 
                        }
                        
                        const nomeAnime = await page.evaluate(() => {
                            const tituloElement = document.querySelector('.SingleTitulo .mwidth a');
                            if (tituloElement) {
                                // Extrai o texto completo
                                let tituloCompleto = tituloElement.textContent.trim();
                                
                                // Verifica se o título está no formato "Assistir NomeDoAnime - Episodio N Online"
                                if (/^Assistir .+ - Episodio \d+/i.test(tituloCompleto)) {
                                    // Remove "Assistir", o hífen, "Episodio [número]" e "Online"
                                    return tituloCompleto
                                        .replace(/^Assistir\s+/i, '')  // Remove "Assistir" do início
                                        .replace(/[-–]\s*Episodio \d+\s*Online/i, '')  // Remove "- Episodio [número] Online"
                                        .trim();  // Remove espaços extras
                                } else {
                                    // Caso o título seja algo como "NomeDoAnime Episodio [número] Online"
                                    return tituloCompleto
                                        .replace(/ Episódio \d+| Online/gi, '')  // Remove "Episódio [número]" e "Online"
                                        .trim();
                                }
                            }
                            return null;
                        });
                        
                        
                        if (nomeAnime) {
                            console.log(`Título do anime: ${nomeAnime}`);
                        } else {
                            console.log('Título não encontrado.');
                        }
                        const episodioMatch = descricao.match(/Episódio\s+(\d+)/);
                        let episodio = 1;
                        if (episodioMatch) {
                            episodio = parseInt(episodioMatch[1], 10);
                            console.log(`Número do episódio: ${episodio}`);
                        } else {
                            console.log('Número do episódio não encontrado.');
                        }
                       // Seleciona todos os links de abas
                        const abas = await page.$$('#RiverLabAbas li a');
                        function sleep(ms) {
                            return new Promise(resolve => setTimeout(resolve, ms));
                        }
                        // Clica em cada link com um intervalo de 3 segundos
                        for (let i = 0; i < abas.length; i++) {
                            const aba = abas[i];
                            
                            // Simula um clique na aba
                            await aba.click();
                            console.log(`Clicando na aba: ${await aba.evaluate(link => link.textContent)}`);

                            // Espera um tempo para o conteúdo carregar após o clique
                            await sleep(3000);
                        }
                                            
                        let linksEncontrados = [];

                        // Regex para verificar links de diferentes domínios
                       // Regex para verificar links de diferentes domínios
                        const bloggerLinkMatches = htmlContent.match(/https:\/\/www\.blogger\.com\/video\.g\?token=\S+/g); // Note o 'g' para múltiplos
                        const mangasCloudMatches = htmlContent.match(/https:\/\/mangas\.cloud\/[^"]*\.mp4/g);
                        const cldPtMatches = htmlContent.match(/https:\/\/cld\.pt\/[^?"]*\.mp4/g); 
                        const aniplayMatches = htmlContent.match(/https:\/\/aniplay\.online\/[^"]*\.mp4/g); // Adicionando domínio aniplay.online
                        const animeflixMatches = htmlContent.match(/https:\/\/animeflix\.blog\/[^"]*\.mp4/g);

                        if (animeflixMatches) {
                            console.log(`Conteúdo: ${animeflixMatches}`);
                        } else {
                            console.log('Nenhum vídeo MP4 encontrado nos domínios especificados.');
                        }
                        // Adicione os links encontrados aos arrays (até 3 links no total)
                        if (bloggerLinkMatches) {
                            linksEncontrados.push(...bloggerLinkMatches.map(link => link.replace(/\\|"/g, '')));
                        }
                        if (mangasCloudMatches) {
                            linksEncontrados.push(...mangasCloudMatches);
                        }
                        if (animeflixMatches) {
                            linksEncontrados.push(...animeflixMatches);
                        }
                        if (cldPtMatches) {
                            linksEncontrados.push(...cldPtMatches);
                        }
                        if (aniplayMatches) {
                            linksEncontrados.push(...aniplayMatches);
                        }




                        // Limite os links encontrados a 3 (caso tenha mais de 3)
                        linksEncontrados = linksEncontrados.slice(0, 3);
                        console.log(linksEncontrados)

                        // Atribua os links aos campos correspondentes
                        const episodioData = {
                            nomeAnime,
                            temporada,
                            episodio,
                            descricao,
                            link: linksEncontrados[0] || 'Link não encontrado',
                            link_extra_1: linksEncontrados[1] || null,
                            link_extra_2: linksEncontrados[2] || null,
                            link_extra_3: null  // No caso de ter apenas até 3 links, link_extra_3 ficará vazio
                        };
                    
                        console.log(JSON.stringify(episodioData, null, 4));
                    
                        // Envia os dados do episódio para a API
                        try {
                            const response = await fetch(`${vpsUrl}/adicionarEpisodio`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(episodioData)
                            });
                    
                            if (!response.ok) {
                                const errorData = await response.json();
                                console.error(`Erro na requisição: ${errorData.message || response.statusText}`);
                    
                                if (errorData.message === "O número do episódio deve ser o próximo na sequência ou o primeiro.") {

                                    console.log("Ação alternativa: O número do episódio está fora de sequência.");
                                    await page.waitForSelector('.ControlesEP #center');
                                    const episodeLink = await page.evaluate(() => {
                                        const centerElement = document.querySelector('.ControlesEP #center a');
                                        return centerElement ? centerElement.href : null;
                                    });

                                    if (episodeLink) {
                                    console.log("Extracted episode link:", episodeLink);
                                
                                    // Navigate to the episode page
                                    await page.goto(episodeLink);
                                    
                                        await wait(5000);
                                        await page.waitForSelector('.ListaContainer', { timeout: 10000 });
                                        const episodeLinks = await page.evaluate(() => {
                                            const episodeElements = Array.from(document.querySelectorAll('ul#lAnimes a'));
                                            return episodeElements.map(element => ({
                                                href: element.href,
                                                text: element.textContent.trim() // Extrair o texto para pegar o número do episódio
                                            }));
                                        });

                                        function extractEpisodeNumber(episodeText) {
                                            // Captura episódios inteiros e fracionados
                                            const match = episodeText.match(/Episódio\s+([\d.]+)/);
                                            return match ? parseFloat(match[1]) : null; // Usar parseFloat para lidar com frações
                                        }

                                        const sortedEpisodeLinks = episodeLinks
                                            .map(item => ({ ...item, episodeNumber: extractEpisodeNumber(item.text) }))
                                            .filter(item => item.episodeNumber !== null) // Filtrar episódios sem número
                                            .sort((a, b) => a.episodeNumber - b.episodeNumber); // Ordenar por número do episódio

                                        // Exibir resultados
                                        console.log(sortedEpisodeLinks);
                                        console.log("Episódios ordenados:", sortedEpisodeLinks);

                                        console.log(episodeLinks)

                                        await page.goto(episodeLink);
                                        await wait(5000);
                                        await page.waitForSelector('.ListaContainer', { timeout: 10000 });
                                        
                                        
                                        // Função para processar episódios em ordem
                                        async function processEpisodesInOrder(sortedEpisodeLinks, vpsUrl) {
                                            for (let index = 0; index < sortedEpisodeLinks.length; index++) { // Usar index para contar
                                                const url = sortedEpisodeLinks[index]; // Obter o link atual
                                                const page = await browser.newPage();
                                                let attempts = 0;
                                                let linksEncontrados = [];
                                                const maxAttempts = 3;
                                                const episodioenvio = index + 1; // Define o número do episódio baseado no índice (1, 2, 3, ...)
                                        
                                                let descricaoenvio = null;
                                        
                                                while (attempts < maxAttempts && linksEncontrados.length === 0) {
                                                    try {
                                                        console.log("Processing episode:", url);
                                                        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                                                        await page.waitForSelector('.videoBox', { timeout: 25000 });
                                                        await wait(20000); // Adicione um atraso adicional se necessário
                                        
                                                        const htmlContent = await page.evaluate(() => document.documentElement.innerHTML);
                                                        const temporada = 1;
                                                        console.log(`Temporada definida: ${temporada}`);
                                        
                                                        const descricaoMatchenvio = htmlContent.match(/<div class="col"><center><h3><a href="[^"]*">([^<]*)<\/a><\/h3><\/center><\/div>/);
                                        
                                                        if (descricaoMatchenvio) {
                                                            descricaoenvio = descricaoMatchenvio[1];
                                                            console.log(`Descrição do episódio: ${descricaoenvio}`);
                                                        } else {
                                                            console.log('Nenhuma descrição encontrada para este episódio.');
                                                            continue; // Pular este episódio e passar para o próximo
                                                        }
                                        
                                                        const nomeAnime = await page.evaluate(() => {
                                                            const tituloElement = document.querySelector('.SingleTitulo .mwidth a');
                                                            if (tituloElement) {
                                                                // Extrai o texto completo
                                                                let tituloCompleto = tituloElement.textContent.trim();
                                                                
                                                                // Verifica se o título está no formato "Assistir NomeDoAnime - Episodio N Online"
                                                                if (/^Assistir .+ - Episodio \d+/i.test(tituloCompleto)) {
                                                                    // Remove "Assistir", o hífen, "Episodio [número]" e "Online"
                                                                    return tituloCompleto
                                                                        .replace(/^Assistir\s+/i, '')  // Remove "Assistir" do início
                                                                        .replace(/[-–]\s*Episodio \d+\s*Online/i, '')  // Remove "- Episodio [número] Online"
                                                                        .trim();  // Remove espaços extras
                                                                } else {
                                                                    // Caso o título seja algo como "NomeDoAnime Episodio [número] Online"
                                                                    return tituloCompleto
                                                                        .replace(/ Episódio \d+| Online/gi, '')  // Remove "Episódio [número]" e "Online"
                                                                        .trim();
                                                                }
                                                            }
                                                            return null;
                                                        });
                                                        
                                        
                                                        // Regex para verificar links de diferentes domínios
                                                        const bloggerLinkMatches = htmlContent.match(/https:\/\/www\.blogger\.com\/video\.g\?token=\S+/g);
                                                        const mangasCloudMatches = htmlContent.match(/https:\/\/mangas\.cloud\/[^"]*\.mp4/g);
                                                        const animeflixMatches = htmlContent.match(/https:\/\/animeflix\.blog\/[^"]*\.mp4/g);
                                                        const cldPtMatches = htmlContent.match(/https:\/\/cld\.pt\/dl\/download\/[^"]*\.mp4/g);
                                                        const aniplayMatches = htmlContent.match(/https:\/\/aniplay\.online\/[^"]*\.mp4/g);
                                        
                                                        // Adicione os links encontrados aos arrays
                                                        if (bloggerLinkMatches) {
                                                            linksEncontrados.push(...bloggerLinkMatches.map(link => link.replace(/\\|"/g, '')));
                                                        }
                                                        if (mangasCloudMatches) {
                                                            linksEncontrados.push(...mangasCloudMatches);
                                                        }
                                                        if (animeflixMatches) {
                                                            linksEncontrados.push(...animeflixMatches);
                                                        }
                                                        if (cldPtMatches) {
                                                            linksEncontrados.push(...cldPtMatches);
                                                        }
                                                        if (aniplayMatches) {
                                                            linksEncontrados.push(...aniplayMatches);
                                                        }
                                        
                                                        // Verificar se links foram encontrados
                                                        if (linksEncontrados.length === 0) {
                                                            attempts++; // Incrementar tentativas
                                                            console.log(`Nenhum link encontrado. Tentativa ${attempts} de ${maxAttempts}.`);
                                                            await wait(3000); // Esperar um pouco antes de tentar novamente
                                                        } else {
                                                            console.log(`Links encontrados: ${linksEncontrados}`);
                                                        }
                                        
                                                    } catch (error) {
                                                        console.error(`Erro ao processar o episódio ${url}: ${error.message}`);
                                                        break; // Sair do loop em caso de erro
                                                    }
                                                }
                                        
                                                if (linksEncontrados.length === 0) {
                                                    console.log(`Falha ao encontrar links após ${maxAttempts} tentativas para o episódio: ${url.href}`);
                                                    await page.close(); // Fechar a aba após as tentativas
                                                    continue; // Passar para o próximo episódio
                                                }
                                        
                                                const episodioData = {
                                                    nomeAnime,
                                                    temporada,
                                                    episodio: episodioenvio, // Usar o índice + 1 como número do episódio
                                                    descricao: descricaoenvio,
                                                    link: linksEncontrados[0] || 'Link não encontrado',
                                                    link_extra_1: linksEncontrados[1] || null,
                                                    link_extra_2: linksEncontrados[2] || null,
                                                    link_extra_3: null
                                                };
                                        
                                                console.log(JSON.stringify(episodioData, null, 4));
                                        
                                                try {
                                                    const response = await fetch(`${vpsUrl}/adicionarEpisodio`, {
                                                        method: 'POST',
                                                        headers: {
                                                            'Content-Type': 'application/json'
                                                        },
                                                        body: JSON.stringify(episodioData)
                                                    });
                                        
                                                    const responseData = await response.json();
                                                    console.log(`Episódio adicionado com sucesso: ${JSON.stringify(responseData)}`);
                                                    await wait(2000);
                                                } catch (error) {
                                                    console.error(`Erro ao adicionar episódio: ${error.message}`);
                                                } finally {
                                                    await page.close(); // Fechar a aba após o processamento
                                                }
                                        
                                                await wait(5000); // Aguardar antes de processar o próximo episódio
                                            }
                                        }
                                        
                                        
                                        await processEpisodesInOrder(sortedEpisodeLinks, vpsUrl);
                                        
                                        
                                        
                                        console.log("Extracted episode URLs:", episodeLinks);
                                        await wait(5000);
                                    } else {
                                       console.error("Episode link not found.");
                                    }
        
                                } else {
                                    throw new Error(`Erro na resposta: ${response.status} ${errorData.message || response.statusText}`);
                                }
                                continue; 
                            }
                    
                            const responseData = await response.json();
                            console.log(`Episódio adicionado com sucesso: ${JSON.stringify(responseData)}`);
                            await wait(2000);
                        } catch (error) {
                            console.error(`Erro ao adicionar episódio: ${error.message}`);
                        }
                    }

                    break;

               

                case 'http://site2.com':
                    await page.goto(site.url);
                    // Lógica para extrair dados do site 2
                    episodios = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('.episode')).map(episode => ({
                            title: episode.querySelector('.title').innerText,
                            link: episode.querySelector('a').href,
                        }));
                    });
                    break;

                case 'http://site3.com':
                    await page.goto(site.url);
                    // Lógica para extrair dados do site 3
                    episodios = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('.episode-item')).map(item => ({
                            title: item.querySelector('.episode-title').innerText,
                            link: item.querySelector('a').href,
                        }));
                    });
                    break;

                // Adicione mais casos conforme necessário
                default:
                    return res.status(400).json({ message: `Site não suportado: ${site.url}` });
            }

            resultados.push({ site: site.url, episodios });
            await page.close();
        } catch (error) {
            console.error(`Erro ao buscar dados de ${site.url}:`, error);
            resultados.push({ site: site.url, error: 'Erro ao buscar dados.' });
        }
    }

    await browser.close();
    res.status(200).json({ resultados });
});



app.post('/api/suporte', (req, res) => {
    const { usuario_id, tipo_report, descricao } = req.body;

    const sql = `INSERT INTO suporte (usuario_id, tipo_report, descricao)
                 VALUES (?, ?, ?)`;

    db.run(sql, [usuario_id, tipo_report, descricao], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({
            message: "Report inserido com sucesso!",
            report_id: this.lastID
        });
    });
});

// Rota para listar todos os reports de suporte
app.get('/api/suporte', (req, res) => {
    const sql = "SELECT * FROM suporte";
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({
            reports: rows
        });
    });
});

app.get('/avisoAtivo', (req, res) => {
    const query = `
        SELECT id, titulo, conteudo, dataHoraPostagem
        FROM avisos
        WHERE ativo = 1
    `;

    db.get(query, (error, row) => {
        if (error) {
            console.error('Erro ao selecionar aviso ativo:', error.message);
            return res.status(500).json({ error: 'Erro ao selecionar aviso ativo do banco de dados.' });
        }

        if (!row) {
            return res.status(404).json({ message: 'Nenhum aviso ativo encontrado.' });
        }

        res.json(row);
    });
});

function updateStatistics() {
    db.serialize(() => {
        // Consultar o total de animes
        db.get('SELECT COUNT(*) AS total_animes FROM animes', (err, row) => {
            if (err) {
                console.error('Erro ao consultar total de animes:', err);
                return;
            }
            const totalAnimes = row.total_animes;

            // Consultar o total de episódios
            db.get('SELECT COUNT(*) AS total_episodios FROM episodios', (err, row) => {
                if (err) {
                    console.error('Erro ao consultar total de episódios:', err);
                    return;
                }
                const totalEpisodios = row.total_episodios;

                // Atualizar a tabela de estatísticas
                db.run(`
                    INSERT INTO estatisticas (total_animes, total_episodios)
                    VALUES (?, ?)
                `, [totalAnimes, totalEpisodios], (err) => {
                    if (err) {
                        console.error('Erro ao atualizar estatísticas:', err);
                    } else {
                        console.log('Estatísticas atualizadas com sucesso');
                    }
                });
            });
        });
    });
}

function excluirSuportesAntigos() {
    const sql = `DELETE FROM suporte WHERE data_criacao <= datetime('now', '-30 days')`;

    db.run(sql, function(err) {
        if (err) {
            console.error("Erro ao excluir registros antigos:", err.message);
        } else {
            console.log(`Registros antigos excluídos: ${this.changes}`);
        }
    });
}

cron.schedule('0 0 * * *', () => {
    console.log('Executando atualização diária de estatísticas...');
    updateStatistics();
});


/// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
