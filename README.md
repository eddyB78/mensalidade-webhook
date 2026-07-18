# Mensalidade WhatsApp Bot

Webhook seguro para integrar o aplicativo Mensalidade com a Evolution API e o Firebase.

## Comandos

| Comando | Ação |
|---|---|
| `ajuda` | Lista os comandos |
| `status João` | Consulta a situação do aluno |
| `alunos` | Lista alunos com pendências |
| `cursos` | Lista os cursos |
| `pago João curso` | Marca um curso como pago |
| `pago João` | Marca os cursos mensais como pagos |
| `despago João` | Desmarca o pagamento atual |
| `novo Maria +5511999999` | Adiciona um aluno |

## Configuração

Todas as credenciais devem ser configuradas como variáveis secretas da hospedagem. Nunca coloque chaves diretamente no código.

| Variável | Obrigatória | Descrição |
|---|---:|---|
| `EVOLUTION_API_URL` | Sim | Endereço HTTPS da Evolution API |
| `EVOLUTION_API_KEY` | Sim | Nova chave da Evolution API |
| `EVOLUTION_INSTANCE` | Sim | Nome da instância conectada |
| `WEBHOOK_SECRET` | Sim | Segredo exclusivo da rota do webhook |
| `FIREBASE_SERVICE_ACCOUNT` | Sim* | JSON da conta de serviço do Firebase |
| `GOOGLE_APPLICATION_CREDENTIALS` | Sim* | Alternativa para credencial em arquivo |
| `GMAIL_USER` | Não | Conta usada na recuperação por e-mail |
| `GMAIL_APP_PASSWORD` | Não | Nova senha de aplicativo do Gmail |
| `PORT` | Não | Porta HTTP, padrão `3000` |

Use uma das duas opções de credencial Firebase marcadas com `*`.

## Evolution API

Configure o webhook da instância para:

```text
https://SEU-WEBHOOK/webhook?secret=SEU_WEBHOOK_SECRET
```

Ative o evento `MESSAGES_UPSERT`.

## Execução

```bash
npm install
npm run check
npm start
```

O serviço responde em `/` e `/ping` para verificações de saúde.

## Docker

```bash
docker build -t mensalidade-webhook .
docker run --env-file .env -p 3000:3000 mensalidade-webhook
```

## Segurança

- Troque imediatamente qualquer chave que já tenha aparecido no histórico do GitHub.
- Restrinja a conta de serviço Firebase a este projeto.
- Use segredos diferentes para Evolution API e webhook.
- Não publique `.env` nem arquivos de conta de serviço.
