const express = require('express');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// EnumStatusAssinatura é serializado como string (StringEnumConverter + EnumMember).
const EnumStatusAssinatura = {
  Pendente: 'C',
  Processamento: 'P',
  Finalizada: 'F',
  Falha: 'E',
};

const PKCS7_BEGIN = '-----BEGIN PKCS7-----\n';
const PKCS7_END = '\n-----END PKCS7-----';

let nextFileId = 1;

// Log com timestamp e id da requisição (quando houver) para facilitar o rastreio.
function log(req, message, extra) {
  const id = req && req.id ? ` [${req.id}]` : '';
  const details = extra !== undefined ? ` ${JSON.stringify(extra)}` : '';
  console.log(`${new Date().toISOString()}${id} ${message}${details}`);
}

// Mascara o CPF nos logs: 12345678900 -> ***456789**
function maskCpf(cpf) {
  const digits = String(cpf || '');
  return digits.length >= 11 ? `***${digits.slice(3, 9)}**` : digits ? '***' : '(vazio)';
}

// Registra a chegada de cada requisição e o resultado ao final (status + duração).
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  const start = process.hrtime.bigint();
  log(req, `--> ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
  });
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    log(req, `<-- ${res.statusCode} (${ms.toFixed(1)} ms)`);
  });
  next();
});

app.use(express.json({ limit: '50mb' }));

// Erro no formato { StatusId, Message }
function errorBody(message, statusId = -1) {
  return { StatusId: statusId, Message: message };
}

// Envolve o arquivo recebido (base64) no envelope PKCS7 fake, sem alterar o conteúdo.
// O consumidor remove o cabeçalho/rodapé e faz Convert.FromBase64String, obtendo
// exatamente o mesmo arquivo que foi enviado.
function fakePkcs7(base64) {
  return PKCS7_BEGIN + base64 + PKCS7_END;
}

// Campos onde o conteúdo (base64) do documento pode vir quando ele é um objeto.
// O tipo de Documents não foi definido, então aceitamos os nomes mais comuns.
const CONTENT_FIELDS = ['Content', 'Value', 'File', 'FileContent', 'Data', 'Base64', 'Document', 'Arquivo', 'Conteudo'];

// Retorna o conteúdo base64 do documento exatamente como recebido.
// Aceita o documento como string (o próprio base64) ou como objeto com um dos campos acima.
function extractContent(doc) {
  if (typeof doc === 'string') return { content: doc, source: '(string)' };
  if (doc && typeof doc === 'object') {
    const field = CONTENT_FIELDS.find((name) => typeof doc[name] === 'string');
    if (field) return { content: doc[field], source: field };
  }
  return { content: '', source: null };
}

// O Pin do corpo é enviado em base64 (ex.: "MTIzNA==" -> "1234").
function decodePin(pin) {
  if (typeof pin !== 'string' || pin === '') return '';
  return Buffer.from(pin, 'base64').toString('utf8');
}

const README_PATH = path.join(__dirname, '..', 'README.md');

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.6;
         max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
  h1, h2, h3, h4 { line-height: 1.25; }
  h1, h2 { border-bottom: 1px solid #8884; padding-bottom: .3em; }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .9em;
         background: #8882; padding: .15em .4em; border-radius: 4px; }
  pre { background: #8882; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 4px solid #d9822b; background: #d9822b1a; }
  table { border-collapse: collapse; display: block; overflow-x: auto; }
  th, td { border: 1px solid #8884; padding: 6px 12px; text-align: left; }
  th { background: #8882; }
`;

// Página inicial: renderiza o README.md como HTML (lido a cada acesso, refletindo edições).
app.get('/', (req, res) => {
  fs.readFile(README_PATH, 'utf8', async (err, markdown) => {
    if (err) {
      log(req, 'Erro ao ler o README.md', { erro: err.message });
      return res.status(500).type('text/plain; charset=utf-8').send('README.md não encontrado.');
    }
    // marked é ESM-only; import() dinâmico funciona em CommonJS em qualquer versão do Node.
    let html;
    try {
      const { marked } = await import('marked');
      html = marked.parse(markdown);
    } catch (e) {
      log(req, 'Erro ao renderizar o README.md', { erro: e.message });
      return res.status(500).type('text/plain; charset=utf-8').send('Erro ao renderizar o README.md.');
    }
    res.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>totvs-fake-eval</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${html}
</body>
</html>`);
  });
});

app.post('/sign', (req, res) => {
  const queryPin = req.query.pin;
  const body = req.body || {};

  log(req, 'Corpo recebido', {
    queryPin,
    ConfigId: body.ConfigId,
    Pin: body.Pin,
    Cpf: maskCpf(body.Cpf),
    AttendanceId: body.AttendanceId,
    PatientId: body.PatientId,
    SignTime: body.SignTime,
    Documents: Array.isArray(body.Documents) ? body.Documents.length : body.Documents,
  });

  if (!queryPin) {
    log(req, 'Validação falhou: pin da query-string ausente');
    return res.status(400).json(errorBody('O parâmetro "pin" da query-string é obrigatório.'));
  }

  const bodyPin = decodePin(body.Pin);
  log(req, 'Pin do corpo decodificado de base64', { base64: body.Pin, decodificado: bodyPin });

  if (bodyPin !== queryPin) {
    log(req, 'Validação falhou: pin do corpo diferente do pin da query-string', {
      queryPin,
      bodyPin,
    });
    return res.status(400).json(errorBody('O pin informado no corpo é diferente do pin da query-string.'));
  }

  log(req, 'Validação do pin OK');

  const documents = Array.isArray(body.Documents) ? body.Documents : [];
  log(req, `Quantidade de documentos recebidos: ${documents.length}`);
  if (documents.length === 0) {
    log(req, 'Nenhum documento informado; será gerada uma assinatura padrão');
  }

  // HasError() avalia apenas o primeiro DocumentList/SignatureList e trata lista vazia
  // como erro, então sempre retornamos ao menos um documento com uma assinatura.
  const items = documents.length > 0 ? documents : [null];
  const documentList = items.map((doc, index) => {
    const documentId = String((doc && (doc.DocumentId || doc.Id)) || index + 1);
    const { content, source } = extractContent(doc);
    if (source) {
      log(req, `Documento ${documentId}: conteúdo lido de "${source}" e devolvido sem alteração`, {
        caracteresBase64: content.length,
        bytes: Buffer.from(content, 'base64').length,
      });
    } else {
      log(req, `Documento ${documentId}: nenhum conteúdo encontrado; assinatura retornará sem arquivo`, {
        camposRecebidos: doc && typeof doc === 'object' ? Object.keys(doc) : typeof doc,
      });
    }
    return {
      SignatureList: [
        {
          Status: { StatusId: 0, Message: 'Assinado com sucesso (fake)' },
          Type: 1,
          SignerList: [{ Cpf: body.Cpf }],
          SignatureId: randomUUID(),
          Value: fakePkcs7(content),
        },
      ],
      DocumentId: documentId,
      DocumentStatus: 'SIGNED',
      DocumentStatusEx: { StatusId: 0, Message: 'OK' },
      Content: null,
    };
  });

  const response = {
    MessageStatus: { StatusId: 0, Message: 'OK' },
    OptionalOutput: { DocumentList: documentList },
    FileId: nextFileId++,
    Status: EnumStatusAssinatura.Finalizada,
  };

  log(req, 'Assinatura fake gerada', {
    FileId: response.FileId,
    documentos: documentList.length,
    assinaturas: documentList.reduce((total, d) => total + d.SignatureList.length, 0),
    DocumentIds: documentList.map((d) => d.DocumentId),
  });

  res.json(response);
});

// JSON inválido no corpo
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    log(req, 'Validação falhou: JSON malformado no corpo', { erro: err.message });
    return res.status(400).json(errorBody('Corpo da requisição inválido (JSON malformado).'));
  }
  log(req, 'Erro inesperado', { erro: err.message });
  console.error(err);
  res.status(500).json(errorBody('Erro interno do servidor.'));
});

// Na Vercel o app é exportado e servido como função serverless; localmente sobe o servidor.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API de assinatura fake rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
