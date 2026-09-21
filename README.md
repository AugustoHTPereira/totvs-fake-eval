# totvs-fake-eval

API fake de assinatura digital para uso em **ambiente de desenvolvimento**. Simula o serviço de assinatura: valida o pin e devolve o(s) arquivo(s) recebido(s) embalado(s) em um envelope PKCS7 falso, sem realizar nenhuma assinatura real.

> Não use em produção. Nenhuma assinatura gerada aqui tem validade criptográfica.

## Requisitos

- Node.js 18+ (testado com Node 24)

## Como executar

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # reinicia automaticamente ao alterar o código
```

A porta pode ser alterada pela variável de ambiente `PORT`:

```bash
PORT=8080 npm start          # bash
$env:PORT=8080; npm start    # PowerShell
```

## Endpoint

### `POST /sign?pin={pin}`

Endpoint público (sem autenticação).

| Parâmetro | Onde         | Descrição                                                   |
| --------- | ------------ | ----------------------------------------------------------- |
| `pin`     | query-string | Chave de validação. Deve ser igual ao `Pin` do corpo (decodificado). |

#### Corpo (JSON)

```json
{
  "ConfigId": "TOTVS_ABC",
  "Cpf": "12345678900",
  "Pin": "MTIzNA==",
  "AttendanceId": 7,
  "PatientId": 665,
  "Documents": ["<arquivo em base64>"],
  "SignTime": "2026-09-21T10:13:34.0006855-03:00"
}
```

- **`Pin`** é enviado em **base64**. A API o decodifica antes de comparar com o `pin` da query-string (ex.: `MTIzNA==` → `1234`).
- **`Documents`** aceita cada item como:
  - uma **string** com o arquivo em base64; ou
  - um **objeto** com o base64 em um dos campos `Content`, `Value`, `File`, `FileContent`, `Data`, `Base64`, `Document`, `Arquivo` ou `Conteudo`. `DocumentId` (ou `Id`) é usado como identificador do documento; se ausente, usa-se o índice (1, 2, ...).

#### Resposta de sucesso — `200 OK`

Formato `DocumentResponse` (JSON em PascalCase, como as propriedades C#):

```json
{
  "MessageStatus": { "StatusId": 0, "Message": "OK" },
  "OptionalOutput": {
    "DocumentList": [
      {
        "SignatureList": [
          {
            "Status": { "StatusId": 0, "Message": "Assinado com sucesso (fake)" },
            "Type": 1,
            "SignerList": [{ "Cpf": "12345678900" }],
            "SignatureId": "8bd2b559-c022-450d-b833-2ad1a97fdfd2",
            "Value": "-----BEGIN PKCS7-----\n<arquivo em base64>\n-----END PKCS7-----"
          }
        ],
        "DocumentId": "1",
        "DocumentStatus": "SIGNED",
        "DocumentStatusEx": { "StatusId": 0, "Message": "OK" },
        "Content": null
      }
    ]
  },
  "FileId": 1,
  "Status": "F"
}
```

- Há um item em `DocumentList` para cada documento recebido, cada um com uma assinatura.
- **O arquivo é devolvido sem alterações**: `Value` contém exatamente o base64 recebido, entre o cabeçalho e o rodapé PKCS7. O `GetDocument()` do consumidor reconstrói o mesmo arquivo enviado.
- Se `Documents` vier vazio (ou o conteúdo não for encontrado), retorna uma assinatura sem arquivo, para que `HasError()` continue `false`.
- `Status` usa `EnumStatusAssinatura` serializado como string: `C` (Pendente), `P` (Processamento), `F` (Finalizada), `E` (Falha). Sucesso retorna `F`.
- `FileId` é um contador sequencial em memória (reinicia junto com o servidor).

#### Respostas de erro — `400 Bad Request`

Formato `{ "StatusId": int, "Message": string }`:

```json
{ "StatusId": -1, "Message": "O pin informado no corpo é diferente do pin da query-string." }
```

| Situação                                      | Mensagem                                                          |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `pin` ausente na query-string                 | `O parâmetro "pin" da query-string é obrigatório.`                |
| `Pin` do corpo (decodificado) ≠ `pin` da query | `O pin informado no corpo é diferente do pin da query-string.`    |
| JSON malformado                               | `Corpo da requisição inválido (JSON malformado).`                 |

Erros inesperados retornam `500` no mesmo formato.

## Exemplo de uso

```bash
curl -X POST "http://localhost:3000/sign?pin=1234" \
  -H "Content-Type: application/json" \
  -d '{
    "ConfigId": "TOTVS_ABC",
    "Cpf": "12345678900",
    "Pin": "MTIzNA==",
    "AttendanceId": 7,
    "PatientId": 665,
    "Documents": ["SGVsbG8gd29ybGQ="],
    "SignTime": "2026-09-21T10:13:34-03:00"
  }'
```

## Estrutura

```
.
├── package.json
└── src/
    └── server.js   # aplicação Express (rota /sign, validações e logs)
```