# 🤖 Mensalidade WhatsApp Bot

Webhook para integração WhatsApp + Mensalidade Cria Ti Na Luz via Evolution API.

## Comandos disponíveis

| Comando | Ação |
|---|---|
| `ajuda` | Lista todos os comandos |
| `status João` | Ver situação do aluno |
| `alunos` | Listar alunos com pendências |
| `cursos` | Listar cursos cadastrados |
| `pago João reconecao` | Marcar curso específico como pago |
| `pago João` | Marcar todos os cursos como pagos |
| `despago João reconecao` | Desmarcar pagamento |
| `novo Maria +5511999999` | Adicionar novo aluno |

## Variáveis de ambiente (Railway)

```
EVOLUTION_API_URL=https://sua-evolution.railway.app
EVOLUTION_API_KEY=sua-chave
EVOLUTION_INSTANCE=mensalidade
FIREBASE_PROJECT_ID=mensalidade-cria-ti
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
PORT=3000
```

## Deploy no Railway

1. Faça upload destes arquivos no GitHub
2. Conecte o repositório no Railway
3. Configure as variáveis de ambiente
4. Deploy automático!
