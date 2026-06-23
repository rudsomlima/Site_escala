# Escala de Acompanhamento

App de escala semanal (segunda a domingo) para revezamento de acompanhamento hospitalar.

## Funciona assim

- Cada dia mostra Manhã / Tarde / Noite.
- Os horários **não cobertos** aparecem como botões amarelos (ex: "+ 14:00–18:00").
- Toque no botão do horário → toque no nome → pronto, 2 toques para preencher uma vaga.
- "📋 Copiar p/ WhatsApp" gera o texto formatado pronto pra colar no grupo.
- Setas `‹ ›` no topo navegam entre semanas (o histórico de todas as semanas fica salvo).

## Rodar localmente

```bash
npm install
npm run dev
```

Sem configurar nada, os dados ficam salvos num arquivo local (`.data/weeks.json`) só para
desenvolvimento — isso **não funciona em produção na Vercel** (sistema de arquivos é temporário lá).

## Deploy na Vercel com dados permanentes

1. Suba este projeto num repositório Git e importe na Vercel (vercel.com/new).
2. No painel do projeto na Vercel, vá em **Storage → Create Database → KV** (Vercel KV / Upstash Redis) e conecte ao projeto.
3. A Vercel cria automaticamente as variáveis de ambiente `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
4. Faça um novo deploy (ou redeploy) — a partir daí todos os dados ficam salvos permanentemente no banco da Vercel.

Sem o passo 2, o site funciona mas perde os dados a cada novo deploy/cold start.
